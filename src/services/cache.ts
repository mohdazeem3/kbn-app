import { useEffect, useRef } from 'react';

/**
 * High-performance in-memory cache with:
 * 1. Configurable TTL per entity type (master data vs transactional balances).
 * 2. In-flight promise deduplication to prevent duplicate network requests.
 * 3. Tag-based instant invalidation on mutations (sales, stock arrivals, payments, cancellations).
 * 4. Race-condition protection: In-flight queries started before a mutation are prevented
 *    from overwriting newer database data.
 * 5. React hook `useCacheInvalidation` with dirty-flagging when hidden, preventing
 *    unnecessary background requests while tabs are inactive.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
  tags: string[];
}

export interface CacheOptions {
  ttlMs?: number;
  tags?: string[];
  forceRefresh?: boolean;
}

export const TTL = {
  MASTER_DATA: 5 * 60 * 1000,    // 5 minutes for fruits, varieties, suppliers, customers
  BALANCES: 30 * 1000,            // 30 seconds for supplier_balances, customer_balances
  STOCK: 20 * 1000,               // 20 seconds for stock_batches
  BILLS: 30 * 1000,               // 30 seconds for sales bills
  LEDGER: 30 * 1000,              // 30 seconds for account ledger views
  DASHBOARD: 15 * 1000,           // 15 seconds for dashboard summary
  EXPENSES: 30 * 1000,            // 30 seconds for expenses
};

class DataCacheManager {
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private tagIndex = new Map<string, Set<string>>();
  private listeners = new Set<(invalidatedTags: string[]) => void>();
  private invalidationTimestamps = new Map<string, number>();

  /**
   * Fetches data with in-memory caching, in-flight request deduplication,
   * and mutation race-condition protection.
   */
  async fetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    const forceRefresh = options?.forceRefresh ?? false;
    const ttlMs = options?.ttlMs ?? TTL.BALANCES;
    const tags = options?.tags ?? [];

    if (!forceRefresh) {
      const existing = this.cache.get(key) as CacheEntry<T> | undefined;
      if (existing) {
        if (Date.now() - existing.timestamp < existing.ttlMs) {
          return existing.data;
        }
        // Entry is expired: remove from cache
        this.cache.delete(key);
      }

      // Check if the same request is currently in flight
      const pending = this.inFlight.get(key) as Promise<T> | undefined;
      if (pending) {
        return pending;
      }
    } else {
      // Force refresh: clear existing entry immediately
      this.cache.delete(key);
    }

    const requestStartedAt = Date.now();

    // Launch request with deduplication
    const requestPromise = (async () => {
      try {
        const result = await fetcher();

        // Race-condition guard: verify no mutation invalidated this key or its tags while in flight
        const keyInvalidatedAt = this.invalidationTimestamps.get(key) ?? 0;
        const tagInvalidated = tags.some(
          (t) => (this.invalidationTimestamps.get(t) ?? 0) >= requestStartedAt
        );

        // Only store in cache if no mutation occurred while this request was running
        if (keyInvalidatedAt < requestStartedAt && !tagInvalidated) {
          this.set(key, result, { ttlMs, tags });
        }

        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, requestPromise);
    return requestPromise;
  }

  /**
   * Directly sets a value into cache.
   */
  set<T>(key: string, data: T, options?: { ttlMs?: number; tags?: string[] }): void {
    const ttlMs = options?.ttlMs ?? TTL.BALANCES;
    const tags = options?.tags ?? [];

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
      tags,
    });

    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set<string>();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  /**
   * Synchronously peek at existing cached data if valid.
   */
  get<T>(key: string): T | null {
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing && Date.now() - existing.timestamp < existing.ttlMs) {
      return existing.data;
    }
    return null;
  }

  /**
   * Invalidate specific tags and notify all registered listeners.
   */
  invalidateTags(tags: string | string[]): void {
    const tagList = Array.isArray(tags) ? tags : [tags];
    const affectedKeys = new Set<string>();
    const now = Date.now();

    for (const tag of tagList) {
      this.invalidationTimestamps.set(tag, now);
      const keys = this.tagIndex.get(tag);
      if (keys) {
        for (const k of keys) {
          affectedKeys.add(k);
          this.cache.delete(k);
          this.invalidationTimestamps.set(k, now);
        }
        this.tagIndex.delete(tag);
      }
    }

    // Also remove from inFlight if any
    for (const k of affectedKeys) {
      this.inFlight.delete(k);
    }

    if (tagList.length > 0) {
      for (const listener of this.listeners) {
        try {
          listener(tagList);
        } catch (e) {
          console.error('Error in cache listener:', e);
        }
      }
    }
  }

  /**
   * Invalidate a single key directly.
   */
  invalidateKey(key: string): void {
    this.invalidationTimestamps.set(key, Date.now());
    this.cache.delete(key);
    this.inFlight.delete(key);
  }

  /**
   * Clear everything in cache.
   */
  clear(): void {
    const now = Date.now();
    for (const tag of this.tagIndex.keys()) {
      this.invalidationTimestamps.set(tag, now);
    }
    for (const key of this.cache.keys()) {
      this.invalidationTimestamps.set(key, now);
    }
    this.cache.clear();
    this.inFlight.clear();
    this.tagIndex.clear();
    for (const listener of this.listeners) {
      try {
        listener(['*']);
      } catch (e) {
        console.error('Error in cache listener:', e);
      }
    }
  }

  /**
   * Subscribe to cache invalidation events.
   */
  subscribe(listener: (invalidatedTags: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const appCache = new DataCacheManager();

// ============================================================================
// Specialized Invalidation Helpers (Business Rule Guardrails)
// ============================================================================

/**
 * Called after creating or cancelling a sales bill.
 */
export function invalidateOnSale(customerId?: string | null): void {
  const tags = ['bills', 'stock', 'customer_balances', 'dashboard', 'customer_ledger'];
  if (customerId) {
    tags.push(`customer_ledger:${customerId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after receiving, editing, or cancelling a stock delivery.
 */
export function invalidateOnStockDelivery(supplierId?: string | null): void {
  const tags = ['stock', 'supplier_balances', 'deliveries', 'dashboard', 'supplier_ledger'];
  if (supplierId) {
    tags.push(`supplier_ledger:${supplierId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after recording, reversing, or setting customer payment / opening balance.
 */
export function invalidateOnCustomerPayment(customerId?: string | null): void {
  const tags = ['customer_balances', 'bills', 'dashboard', 'customer_ledger'];
  if (customerId) {
    tags.push(`customer_ledger:${customerId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after recording, reversing, or reallocating supplier payment / opening balance.
 */
export function invalidateOnSupplierPayment(supplierId?: string | null): void {
  const tags = ['supplier_balances', 'stock', 'deliveries', 'dashboard', 'supplier_ledger'];
  if (supplierId) {
    tags.push(`supplier_ledger:${supplierId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after adding, updating, or toggling a customer.
 */
export function invalidateOnCustomerMutation(customerId?: string): void {
  const tags = ['customers', 'customer_balances', 'customer_ledger'];
  if (customerId) {
    tags.push(`customer_ledger:${customerId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after adding, updating, or toggling a supplier.
 */
export function invalidateOnSupplierMutation(supplierId?: string): void {
  const tags = ['suppliers', 'supplier_balances', 'supplier_ledger'];
  if (supplierId) {
    tags.push(`supplier_ledger:${supplierId}`);
  }
  appCache.invalidateTags(tags);
}

/**
 * Called after adding, updating, or toggling a fruit or variety.
 */
export function invalidateOnFruitMutation(): void {
  appCache.invalidateTags(['fruits', 'varieties', 'stock', 'suppliers']);
}

// ============================================================================
// React Hook for Automatic Revalidation
// ============================================================================

export interface CacheInvalidationOptions {
  isActive?: boolean;
  enabled?: boolean;
}

/**
 * React hook that triggers a callback when any of the specified cache tags are invalidated.
 * If isActive is false, it defers the refresh until the component becomes active again,
 * preventing unnecessary background requests and eliminating duplicate subscriptions.
 */
export function useCacheInvalidation(
  tags: string[],
  onInvalidated: () => void,
  options?: CacheInvalidationOptions
): void {
  const isActive = options?.isActive ?? true;
  const enabled = options?.enabled ?? true;
  const isDirtyRef = useRef(false);
  const onInvalidatedRef = useRef(onInvalidated);
  onInvalidatedRef.current = onInvalidated;

  // Stabilize tags so inline arrays don't re-subscribe on every render
  const tagsKey = tags.slice().sort().join(',');

  useEffect(() => {
    if (!enabled) return;

    const currentTags = tagsKey.split(',').filter(Boolean);
    const unsubscribe = appCache.subscribe((invalidatedTags) => {
      const match = invalidatedTags.some((invTag) => {
        if (invTag === '*') return true;
        return currentTags.some((subTag) => {
          return (
            invTag === subTag ||
            invTag.startsWith(`${subTag}:`) ||
            subTag.startsWith(`${invTag}:`)
          );
        });
      });

      if (match) {
        if (isActive) {
          onInvalidatedRef.current();
        } else {
          isDirtyRef.current = true;
        }
      }
    });

    return unsubscribe;
  }, [tagsKey, enabled, isActive]);

  // When tab becomes active, if it was invalidated while in the background, refresh once
  useEffect(() => {
    if (isActive && isDirtyRef.current) {
      isDirtyRef.current = false;
      onInvalidatedRef.current();
    }
  }, [isActive]);
}

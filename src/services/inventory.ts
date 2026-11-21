import { supabase } from '@/lib/supabase';
import type {
  AvailableStockBatch,
  DeliveryBalance,
  DeliveryBatchDetail,
  DeliveryDetailWithBatches,
  EditStockDeliveryInput,
  EditStockDeliveryResult,
  ReceiveStockDeliveryInput,
  StockBatchView,
} from '@/types/database';

interface RawBatchJoinRow {
  id: string;
  delivery_id: string;
  line_no: number;
  fruit_id: string;
  variety_id: string;
  boxes_received: number;
  boxes_remaining: number;
  purchase_rate: number;
  purchase_amount: number | null;
  fruits: { name: string } | { name: string }[] | null;
  fruit_varieties: { name: string } | { name: string }[] | null;
}

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function formatInventoryError(error: PostgrestErrorLike | null, fallback: string): Error {
  if (!error) return new Error(fallback);

  const code = error.code ?? '';
  const msg = error.message ?? '';

  // 1. PL/pgSQL business logic exceptions (RAISE EXCEPTION has code P0001) -> always show actual actionable message!
  if (code === 'P0001' && msg) {
    return new Error(msg);
  }

  // 2. Permission denied
  if (code === '42501') {
    return new Error('You do not have permission to perform this action. Please sign in again.');
  }

  // 3. Genuine PostgREST schema cache missing function/table
  if (
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    msg.toLowerCase().includes('schema cache')
  ) {
    return new Error(
      `Database function or table is not ready in API schema cache (${msg || code}). Please reload schema cache or apply migrations.`
    );
  }

  // 4. Missing table or column errors
  if (code === '42P01' || code === '42703') {
    return new Error(`Database schema error: ${msg || fallback}`);
  }

  // 5. Undefined function error (display actual message, e.g. function signature mismatch)
  if (code === '42883') {
    return new Error(`Database function error: ${msg || fallback}`);
  }

  return new Error(msg || fallback);
}

/**
 * Returns the calendar date as YYYY-MM-DD in the shop timezone (Asia/Kolkata)
 * so default form dates always match public.shop_today() regardless of client OS timezone.
 */
export function getLocalIsoDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }

  const fallbackYear = date.getFullYear();
  const fallbackMonth = String(date.getMonth() + 1).padStart(2, '0');
  const fallbackDay = String(date.getDate()).padStart(2, '0');
  return `${fallbackYear}-${fallbackMonth}-${fallbackDay}`;
}

export function formatDisplayDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate;
  const local = new Date(parts[0], parts[1] - 1, parts[2]);
  return local.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Atomically creates one delivery, one stock batch per variety line, and optional
 * Cash / UPI / split immediate supplier payment via receive_stock_delivery RPC.
 */
export async function receiveStockDelivery(input: ReceiveStockDeliveryInput): Promise<string> {
  if (!input.supplier_id) throw new Error('Please select a supplier for this delivery.');
  if (!input.received_date) throw new Error('Please choose the received date.');
  if (!input.items.length) throw new Error('Add at least one variety line to this delivery.');

  let computedTotal = 0;
  const payloadItems = input.items.map((item, idx) => {
    if (!item.fruit_id) {
      throw new Error(`Select a fruit category on line ${idx + 1}.`);
    }
    if (!item.variety_id) {
      throw new Error(`Select a variety on line ${idx + 1}.`);
    }
    if (!Number.isInteger(item.boxes) || item.boxes <= 0) {
      throw new Error(`Boxes on line ${idx + 1} must be a whole number greater than zero.`);
    }
    if (!Number.isFinite(item.purchase_rate) || item.purchase_rate <= 0) {
      throw new Error(`Purchase rate on line ${idx + 1} must be greater than zero.`);
    }
    const rate = Math.round(item.purchase_rate * 100) / 100;
    computedTotal += Math.round(item.boxes * rate * 100) / 100;
    return {
      fruit_id: item.fruit_id,
      variety_id: item.variety_id,
      boxes: item.boxes,
      purchase_rate: rate,
    };
  });

  const paidCash = Math.round(Math.max(0, input.paid_cash) * 100) / 100;
  const paidUpi = Math.round(Math.max(0, input.paid_upi) * 100) / 100;
  const roundedTotal = Math.round(computedTotal * 100) / 100;

  if (paidCash < 0 || paidUpi < 0) {
    throw new Error('Paid amounts cannot be negative.');
  }
  if (Math.round((paidCash + paidUpi) * 100) > Math.round(roundedTotal * 100)) {
    throw new Error(
      `Immediate payment (₹${(paidCash + paidUpi).toLocaleString('en-IN')}) cannot exceed delivery total (₹${roundedTotal.toLocaleString('en-IN')}).`
    );
  }

  const { data, error } = await supabase.rpc('receive_stock_delivery', {
    p_supplier_id: input.supplier_id,
    p_fruit_id: input.fruit_id ?? null,
    p_received_date: input.received_date,
    p_items: payloadItems,
    p_note: input.note?.trim() || null,
    p_paid_cash: paidCash,
    p_paid_upi: paidUpi,
    p_payment_note: input.payment_note?.trim() || null,
    p_idempotency_key: input.idempotency_key,
  });

  if (error) {
    throw formatInventoryError(error, 'Could not save stock delivery. Please try again.');
  }

  return data as string;
}

/**
 * Loads active delivery stock batches enriched with delivery-level payment status
 * by joining available_stock_batches and delivery_balances views.
 */
export async function listStockBatches(): Promise<StockBatchView[]> {
  const [batchesRes, deliveriesRes] = await Promise.all([
    supabase
      .from('available_stock_batches')
      .select(
        'batch_id, delivery_id, delivery_no, received_date, line_no, fruit_id, fruit_name, variety_id, variety_name, default_sell_rate, supplier_id, supplier_name, supplier_active, boxes_received, boxes_remaining, boxes_sold, purchase_rate, purchase_amount, remaining_stock_value, delivery_note, created_at'
      )
      .order('received_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('line_no', { ascending: true }),
    supabase
      .from('delivery_balances')
      .select(
        'delivery_id, delivery_no, supplier_id, supplier_name, supplier_active, fruit_id, fruit_name, received_date, boxes_received, boxes_remaining, purchase_amount, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
      )
      .eq('status', 'active'),
  ]);

  if (batchesRes.error) {
    throw formatInventoryError(batchesRes.error, 'Could not load stock batches.');
  }
  if (deliveriesRes.error) {
    throw formatInventoryError(deliveriesRes.error, 'Could not load delivery payment statuses.');
  }

  const deliveryMap = new Map<string, DeliveryBalance>();
  for (const d of (deliveriesRes.data ?? []) as DeliveryBalance[]) {
    deliveryMap.set(d.delivery_id, d);
  }

  return ((batchesRes.data ?? []) as AvailableStockBatch[]).map((batch) => {
    const del = deliveryMap.get(batch.delivery_id);
    return {
      ...batch,
      boxes_received: Number(batch.boxes_received),
      boxes_remaining: Number(batch.boxes_remaining),
      boxes_sold: Number(batch.boxes_sold),
      purchase_rate: Number(batch.purchase_rate),
      purchase_amount: Number(batch.purchase_amount),
      remaining_stock_value: Number(batch.remaining_stock_value),
      delivery_payment_status: del?.payment_status ?? 'unpaid',
      delivery_purchase_amount: Number(del?.purchase_amount ?? batch.purchase_amount),
      delivery_amount_paid: Number(del?.amount_paid ?? 0),
      delivery_outstanding_amount: Number(del?.outstanding_amount ?? batch.purchase_amount),
    };
  });
}

/**
 * Loads delivery details, all child batches, active sold counts, allocation history flags,
 * and amount paid against the delivery.
 */
export async function getDeliveryDetail(deliveryId: string): Promise<DeliveryDetailWithBatches> {
  const [deliveryRes, batchesRes] = await Promise.all([
    supabase
      .from('delivery_balances')
      .select('*')
      .eq('delivery_id', deliveryId)
      .single(),
    supabase
      .from('stock_batches')
      .select('id, delivery_id, line_no, fruit_id, variety_id, boxes_received, boxes_remaining, purchase_rate, purchase_amount, fruits(name), fruit_varieties(name)')
      .eq('delivery_id', deliveryId)
      .order('line_no', { ascending: true }),
  ]);

  if (deliveryRes.error) {
    throw formatInventoryError(deliveryRes.error, 'Could not load delivery balance details.');
  }
  if (batchesRes.error) {
    throw formatInventoryError(batchesRes.error, 'Could not load delivery batches.');
  }

  const rawBatches = (batchesRes.data || []) as unknown as RawBatchJoinRow[];
  const batchIds = rawBatches.map((b) => b.id);

  let allocatedBatchIds = new Set<string>();
  if (batchIds.length > 0) {
    const { data: allocations, error: allocErr } = await supabase
      .from('bill_item_batch_allocations')
      .select('batch_id')
      .in('batch_id', batchIds);

    if (allocErr) {
      throw formatInventoryError(allocErr, 'Could not check batch allocation history.');
    }
    if (allocations) {
      allocatedBatchIds = new Set(allocations.map((a: { batch_id: string }) => a.batch_id));
    }
  }

  const delivery = deliveryRes.data as DeliveryBalance;
  const batches: DeliveryBatchDetail[] = rawBatches.map((b) => {
    const boxesReceived = Number(b.boxes_received);
    const boxesRemaining = Number(b.boxes_remaining);
    const fruitName = Array.isArray(b.fruits)
      ? b.fruits[0]?.name ?? 'Unknown Fruit'
      : b.fruits?.name ?? 'Unknown Fruit';
    const varietyName = Array.isArray(b.fruit_varieties)
      ? b.fruit_varieties[0]?.name ?? 'Unknown Variety'
      : b.fruit_varieties?.name ?? 'Unknown Variety';

    return {
      id: b.id,
      delivery_id: b.delivery_id,
      line_no: Number(b.line_no),
      fruit_id: b.fruit_id,
      fruit_name: fruitName,
      variety_id: b.variety_id,
      variety_name: varietyName,
      boxes_received: boxesReceived,
      boxes_remaining: boxesRemaining,
      boxes_sold: Math.max(0, boxesReceived - boxesRemaining),
      purchase_rate: Number(b.purchase_rate),
      purchase_amount: Number(b.purchase_amount ?? (boxesReceived * Number(b.purchase_rate))),
      has_allocations: allocatedBatchIds.has(b.id),
    };
  });

  return {
    delivery,
    batches,
    amount_paid: Number(delivery.amount_paid ?? 0),
  };
}

/**
 * Atomically updates an existing stock delivery, adjusts/adds/removes batch lines,
 * validates historical allocation protection and supplier payment constraints,
 * and records an audit log row via edit_stock_delivery RPC.
 */
export async function editStockDelivery(
  input: EditStockDeliveryInput
): Promise<EditStockDeliveryResult> {
  if (!input.delivery_id) {
    throw new Error('Delivery ID is required.');
  }
  if (!input.correction_reason || !input.correction_reason.trim()) {
    throw new Error('Please enter a reason for this delivery correction.');
  }
  if (!input.items || input.items.length === 0) {
    throw new Error('Add at least one variety line to this delivery.');
  }

  const payloadItems = input.items.map((item, idx) => {
    if (!item.fruit_id) {
      throw new Error(`Select a fruit category on line ${idx + 1}.`);
    }
    if (!item.variety_id) {
      throw new Error(`Select a variety on line ${idx + 1}.`);
    }
    if (!Number.isInteger(item.boxes) || item.boxes <= 0) {
      throw new Error(`Boxes on line ${idx + 1} must be a whole number greater than zero.`);
    }
    if (!Number.isFinite(item.purchase_rate) || item.purchase_rate <= 0) {
      throw new Error(`Purchase rate on line ${idx + 1} must be greater than zero.`);
    }

    return {
      batch_id: item.batch_id || null,
      fruit_id: item.fruit_id,
      variety_id: item.variety_id,
      boxes: item.boxes,
      purchase_rate: Math.round(item.purchase_rate * 100) / 100,
    };
  });

  const { data, error } = await supabase.rpc('edit_stock_delivery', {
    p_delivery_id: input.delivery_id,
    p_items: payloadItems,
    p_note: input.note?.trim() || null,
    p_correction_reason: input.correction_reason.trim(),
  });

  if (error) {
    throw formatInventoryError(error, 'Could not update stock delivery. Please check errors and try again.');
  }

  return data as EditStockDeliveryResult;
}

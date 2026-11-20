import { supabase } from '@/lib/supabase';
import type {
  AvailableStockBatch,
  DeliveryBalance,
  ReceiveStockDeliveryInput,
  StockBatchView,
} from '@/types/database';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function formatInventoryError(error: PostgrestErrorLike | null, fallback: string): Error {
  if (!error) return new Error(fallback);

  const code = error.code ?? '';
  const msg = error.message ?? '';

  if (
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42P01' ||
    code === '42883' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  ) {
    return new Error(
      'The stock database tables or RPCs are not ready yet. Apply the prepared Supabase migrations first, then tap Retry.'
    );
  }

  if (code === '42501') {
    return new Error('You do not have permission to perform this action. Please sign in again.');
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
  if (!input.fruit_id) throw new Error('Please select a fruit category.');
  if (!input.supplier_id) throw new Error('Please select a supplier for this fruit.');
  if (!input.received_date) throw new Error('Please choose the received date.');
  if (!input.items.length) throw new Error('Add at least one variety line to this delivery.');

  let computedTotal = 0;
  const payloadItems = input.items.map((item, idx) => {
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
    p_fruit_id: input.fruit_id,
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

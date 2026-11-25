import { supabase } from '@/lib/supabase';
import { appCache, TTL, invalidateOnSale } from './cache';
import type {
  BillBalance,
  BillBatchAllocationDetail,
  BillDetail,
  BillItemDetail,
  BillPaymentAllocationDetail,
  BillReturn,
  BillReturnItem,
  CancelBillInput,
  CreateBillInput,
  CustomerRefundRecord,
  PaymentMode,
  ProcessBillReturnInput,
  ProcessBillReturnResult,
} from '@/types/database';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function formatSalesError(error: PostgrestErrorLike | null, fallback: string): Error {
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
      'The sales and billing database tables or RPCs are not ready yet. Apply the prepared Supabase migrations first, then tap Retry.'
    );
  }

  if (code === '42501') {
    return new Error('You do not have permission to perform this action. Please sign in again.');
  }

  return new Error(msg || fallback);
}

/**
 * Atomically saves a bill, its commercial lines, manual batch allocations,
 * stock deductions, and unified Cash/UPI customer_payments via create_bill RPC.
 * Returns the created BillBalance (including generated unique bill_no).
 */
export async function createBill(input: CreateBillInput): Promise<BillBalance> {
  if (!input.bill_date) {
    throw new Error('Please choose the bill date.');
  }
  if (!input.items.length) {
    throw new Error('Add at least one fruit item with stock batch allocations.');
  }

  let computedSubtotal = 0;
  const payloadItems = input.items.map((item, idx) => {
    const lineNum = idx + 1;
    if (!item.fruit_id || !item.variety_id) {
      throw new Error(`Select a fruit and variety on item ${lineNum}.`);
    }
    if (!item.allocations.length) {
      throw new Error(`Allocate at least one stock batch on item ${lineNum}.`);
    }
    if (!Number.isInteger(item.boxes) || item.boxes <= 0) {
      throw new Error(`Total boxes on item ${lineNum} must be a whole number greater than zero.`);
    }
    if (!Number.isFinite(item.sell_rate) || item.sell_rate <= 0) {
      throw new Error(`Selling rate per box on item ${lineNum} must be greater than zero.`);
    }

    let allocSum = 0;
    const seenBatches = new Set<string>();
    const cleanAllocs = item.allocations.map((alloc) => {
      if (!alloc.batch_id) {
        throw new Error(`Invalid stock batch on item ${lineNum}.`);
      }
      if (seenBatches.has(alloc.batch_id)) {
        throw new Error(`Duplicate stock batch selected on item ${lineNum}.`);
      }
      seenBatches.add(alloc.batch_id);
      if (!Number.isInteger(alloc.boxes) || alloc.boxes <= 0) {
        throw new Error(`Allocated boxes on item ${lineNum} must be whole numbers greater than zero.`);
      }
      allocSum += alloc.boxes;
      return {
        batch_id: alloc.batch_id,
        boxes: alloc.boxes,
      };
    });

    if (allocSum !== item.boxes) {
      throw new Error(`Allocated batch boxes (${allocSum}) must equal item boxes (${item.boxes}) on item ${lineNum}.`);
    }

    const rate = Math.round(item.sell_rate * 100) / 100;
    computedSubtotal += Math.round(item.boxes * rate * 100) / 100;

    return {
      fruit_id: item.fruit_id,
      variety_id: item.variety_id,
      boxes: item.boxes,
      sell_rate: rate,
      allocations: cleanAllocs,
    };
  });

  const paidCash = Math.round(Math.max(0, input.paid_cash) * 100) / 100;
  const paidUpi = Math.round(Math.max(0, input.paid_upi) * 100) / 100;
  const subtotal = Math.round(computedSubtotal * 100) / 100;
  const totalPaid = Math.round((paidCash + paidUpi) * 100) / 100;

  if (Math.round(totalPaid * 100) > Math.round(subtotal * 100)) {
    throw new Error(
      `Total payment (₹${totalPaid.toLocaleString('en-IN')}) cannot exceed bill total (₹${subtotal.toLocaleString('en-IN')}).`
    );
  }

  if (input.customer_id === null && Math.round(totalPaid * 100) !== Math.round(subtotal * 100)) {
    throw new Error(
      `Cash Customer sales must be paid in full (₹${subtotal.toLocaleString('en-IN')}). Choose a registered customer for credit.`
    );
  }

  const { data: billId, error } = await supabase.rpc('create_bill', {
    p_customer_id: input.customer_id,
    p_bill_date: input.bill_date,
    p_items: payloadItems,
    p_paid_cash: paidCash,
    p_paid_upi: paidUpi,
    p_note: input.note?.trim() || null,
    p_idempotency_key: input.idempotency_key,
  });

  if (error) {
    throw formatSalesError(error, 'Could not save bill. Please try again.');
  }

  const createdId = billId as string;
  const { data: billRow, error: fetchError } = await supabase
    .from('bill_balances')
    .select(
      'bill_id, bill_no, customer_id, is_cash_customer, customer_name_snapshot, bill_date, subtotal, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
    )
    .eq('bill_id', createdId)
    .single();

  if (fetchError || !billRow) {
    invalidateOnSale(input.customer_id);
    return {
      bill_id: createdId,
      bill_no: 'Saved',
      customer_id: input.customer_id,
      is_cash_customer: input.customer_id === null,
      customer_name_snapshot: input.customer_id === null ? 'Cash Customer' : 'Customer',
      bill_date: input.bill_date,
      subtotal,
      amount_paid: totalPaid,
      outstanding_amount: Math.round((subtotal - totalPaid) * 100) / 100,
      payment_status:
        totalPaid >= subtotal ? 'paid' : totalPaid === 0 ? 'unpaid' : 'partial',
      status: 'active',
      cancelled_at: null,
      cancel_reason: null,
      note: input.note?.trim() || null,
      created_at: new Date().toISOString(),
    };
  }

  invalidateOnSale(input.customer_id);
  return normalizeBillBalance(billRow as BillBalance);
}

function normalizeBillBalance(row: BillBalance): BillBalance {
  return {
    ...row,
    subtotal: Number(row.subtotal),
    amount_paid: Number(row.amount_paid),
    outstanding_amount: Number(row.outstanding_amount),
  };
}

export async function listBills(options?: { forceRefresh?: boolean; limit?: number }): Promise<BillBalance[]> {
  const cacheKey = options?.limit ? `bills:limit:${options.limit}` : 'bills:all';
  return appCache.fetch(
    cacheKey,
    async () => {
      let query = supabase
        .from('bill_balances')
        .select(
          'bill_id, bill_no, customer_id, is_cash_customer, customer_name_snapshot, bill_date, subtotal, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
        )
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) {
        throw formatSalesError(error, 'Could not load sales history.');
      }

      return ((data ?? []) as BillBalance[]).map(normalizeBillBalance);
    },
    { ttlMs: TTL.BILLS, tags: ['bills'], forceRefresh: options?.forceRefresh }
  );
}

interface RawBatchAllocRow {
  id: string;
  bill_item_id: string;
  batch_id: string;
  boxes: number;
  stock_batches:
    | {
        purchase_rate: number;
        stock_deliveries:
          | {
              delivery_no: string;
              received_date: string;
              suppliers: { name: string } | { name: string }[] | null;
            }
          | {
              delivery_no: string;
              received_date: string;
              suppliers: { name: string } | { name: string }[] | null;
            }[]
          | null;
      }
    | {
        purchase_rate: number;
        stock_deliveries:
          | {
              delivery_no: string;
              received_date: string;
              suppliers: { name: string } | { name: string }[] | null;
            }
          | {
              delivery_no: string;
              received_date: string;
              suppliers: { name: string } | { name: string }[] | null;
            }[]
          | null;
      }[]
    | null;
}

interface RawBillItemRow {
  id: string;
  bill_id: string;
  line_no: number;
  fruit_id: string;
  variety_id: string;
  fruit_name_snapshot: string;
  variety_name_snapshot: string;
  boxes: number;
  sell_rate: number;
  line_total: number;
  bill_item_batch_allocations: RawBatchAllocRow[] | null;
}

interface RawPaymentAllocRow {
  id: string;
  customer_payment_id: string;
  amount: number;
  status: 'active' | 'cancelled' | 'refunded';
  refund_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  customer_payments:
    | {
        payment_origin: 'bill_sale' | 'collection';
        mode: PaymentMode;
        payment_date: string;
        note: string | null;
        status: 'active' | 'cancelled';
      }
    | {
        payment_origin: 'bill_sale' | 'collection';
        mode: PaymentMode;
        payment_date: string;
        note: string | null;
        status: 'active' | 'cancelled';
      }[]
    | null;
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function getBillReturns(billId: string): Promise<BillReturn[]> {
  try {
    const { data, error } = await supabase
      .from('bill_returns')
      .select(
        'id, bill_id, return_no, customer_id, customer_name_snapshot, return_date, total_boxes, total_amount, refund_amount, refund_mode, refund_id, reason, created_at, bill_return_items(id, return_id, bill_item_id, batch_id, fruit_id, variety_id, fruit_name_snapshot, variety_name_snapshot, boxes, sell_rate, line_total, created_at)'
      )
      .eq('bill_id', billId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as unknown as Array<BillReturn & { bill_return_items?: BillReturnItem[] }>).map((r) => ({
      ...r,
      total_boxes: Number(r.total_boxes),
      total_amount: Number(r.total_amount),
      refund_amount: Number(r.refund_amount),
      items: (r.bill_return_items ?? []).map((i) => ({
        ...i,
        boxes: Number(i.boxes),
        sell_rate: Number(i.sell_rate),
        line_total: Number(i.line_total),
      })),
    }));
  } catch {
    return [];
  }
}

export async function processBillReturn(
  input: ProcessBillReturnInput
): Promise<ProcessBillReturnResult> {
  const { data, error } = await supabase.rpc('process_bill_return', {
    p_bill_id: input.bill_id,
    p_items: input.items,
    p_refund_mode: input.refund_mode,
    p_refund_date: input.refund_date || null,
    p_reason: input.reason?.trim() || null,
    p_idempotency_key: input.idempotency_key || null,
  });

  if (error) {
    throw formatSalesError(error, 'Could not process bill return.');
  }

  invalidateOnSale();
  return data as ProcessBillReturnResult;
}

export async function getBillDetail(billId: string): Promise<BillDetail> {
  const [billRes, itemsRes, payRes, refundRes, returns] = await Promise.all([
    supabase
      .from('bill_balances')
      .select(
        'bill_id, bill_no, customer_id, is_cash_customer, customer_name_snapshot, bill_date, subtotal, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
      )
      .eq('bill_id', billId)
      .single(),
    supabase
      .from('bill_items')
      .select(
        'id, bill_id, line_no, fruit_id, variety_id, fruit_name_snapshot, variety_name_snapshot, boxes, sell_rate, line_total, bill_item_batch_allocations(id, bill_item_id, batch_id, boxes, stock_batches(purchase_rate, stock_deliveries(delivery_no, received_date, suppliers(name))))'
      )
      .eq('bill_id', billId)
      .order('line_no', { ascending: true }),
    supabase
      .from('customer_payment_allocations')
      .select(
        'id, customer_payment_id, amount, status, refund_id, reversed_at, reversal_reason, customer_payments(payment_origin, mode, payment_date, note, status)'
      )
      .eq('bill_id', billId)
      .order('created_at', { ascending: true }),
    supabase
      .from('customer_refunds')
      .select('id, bill_id, customer_id, customer_name_snapshot, amount, mode, refund_date, note, created_at')
      .eq('bill_id', billId)
      .maybeSingle(),
    getBillReturns(billId),
  ]);

  if (billRes.error) throw formatSalesError(billRes.error, 'Could not load bill summary.');
  if (itemsRes.error) throw formatSalesError(itemsRes.error, 'Could not load bill items.');
  if (payRes.error) throw formatSalesError(payRes.error, 'Could not load bill payment allocations.');
  if (refundRes.error) throw formatSalesError(refundRes.error, 'Could not load bill refund record.');

  const items: BillItemDetail[] = ((itemsRes.data ?? []) as RawBillItemRow[]).map((row) => {
    const allocations: BillBatchAllocationDetail[] = (row.bill_item_batch_allocations ?? []).map(
      (alloc) => {
        const batch = unwrapSingle(alloc.stock_batches);
        const delivery = unwrapSingle(batch?.stock_deliveries);
        const supplier = unwrapSingle(delivery?.suppliers);
        return {
          id: alloc.id,
          bill_item_id: alloc.bill_item_id,
          batch_id: alloc.batch_id,
          boxes: Number(alloc.boxes),
          delivery_no: delivery?.delivery_no ?? 'Delivery',
          received_date: delivery?.received_date ?? '',
          supplier_name: supplier?.name ?? 'Supplier',
          purchase_rate: Number(batch?.purchase_rate ?? 0),
        };
      }
    );

    return {
      id: row.id,
      bill_id: row.bill_id,
      line_no: Number(row.line_no),
      fruit_id: row.fruit_id,
      variety_id: row.variety_id,
      fruit_name_snapshot: row.fruit_name_snapshot,
      variety_name_snapshot: row.variety_name_snapshot,
      boxes: Number(row.boxes),
      sell_rate: Number(row.sell_rate),
      line_total: Number(row.line_total),
      allocations,
    };
  });

  const paymentAllocations: BillPaymentAllocationDetail[] = (
    (payRes.data ?? []) as RawPaymentAllocRow[]
  ).map((row) => {
    const cp = unwrapSingle(row.customer_payments);
    return {
      id: row.id,
      customer_payment_id: row.customer_payment_id,
      amount: Number(row.amount),
      status: row.status,
      refund_id: row.refund_id,
      reversed_at: row.reversed_at,
      reversal_reason: row.reversal_reason,
      payment_origin: cp?.payment_origin ?? 'collection',
      mode: cp?.mode ?? 'cash',
      payment_date: cp?.payment_date ?? '',
      payment_note: cp?.note ?? null,
      payment_status: cp?.status ?? 'active',
    };
  });

  const refundRow = refundRes.data as CustomerRefundRecord | null;
  const refund: CustomerRefundRecord | null = refundRow
    ? { ...refundRow, amount: Number(refundRow.amount) }
    : null;

  return {
    bill: normalizeBillBalance(billRes.data as BillBalance),
    items,
    paymentAllocations,
    refund,
    returns,
  };
}

/**
 * Cancels an active bill via cancel_bill RPC (never deletes bill or payment history).
 * Restores stock to exact batches; requires explicit refund_mode if money was received.
 */
export async function cancelBill(input: CancelBillInput): Promise<void> {
  const { error } = await supabase.rpc('cancel_bill', {
    p_bill_id: input.bill_id,
    p_reason: input.reason?.trim() || null,
    p_refund_mode: input.refund_mode,
    p_refund_date: input.refund_date || null,
    p_refund_note: input.refund_note?.trim() || null,
  });

  if (error) {
    throw formatSalesError(error, 'Could not cancel bill.');
  }

  invalidateOnSale();
}

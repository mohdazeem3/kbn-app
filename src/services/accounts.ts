import { supabase } from '@/lib/supabase';
import {
  appCache,
  TTL,
  invalidateOnCustomerPayment,
  invalidateOnSupplierPayment,
  invalidateOnStockDelivery,
} from './cache';
import type {
  AddCustomerPaymentInput,
  AddSupplierPaymentInput,
  BillBalance,
  CancelDeliveryInput,
  CustomerAccountDetail,
  CustomerBalance,
  CustomerOpeningBalance,
  CustomerPaymentAllocationItem,
  CustomerPaymentRecord,
  CustomerRefundWithBill,
  CustomerReturnRecord,
  DeliveryBalance,
  PaymentMode,
  ReallocateSupplierAllocationInput,
  SupplierAccountDetail,
  SupplierBalance,
  SupplierOpeningBalance,
  SupplierPaymentAllocationItem,
  SupplierPaymentRecord,
  SupplierRefundRecord,
} from '@/types/database';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function formatAccountsError(error: PostgrestErrorLike | null, fallback: string): Error {
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
      'The account ledger views or RPCs are not ready yet. Apply the prepared Supabase migrations first, then tap Retry.'
    );
  }

  if (code === '42501') {
    return new Error('You do not have permission to perform this action. Please sign in again.');
  }

  return new Error(msg || fallback);
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeCustomerBalance(row: CustomerBalance): CustomerBalance {
  return {
    ...row,
    opening_balance: Number(row.opening_balance),
    opening_balance_paid: Number(row.opening_balance_paid),
    opening_balance_outstanding: Number(row.opening_balance_outstanding),
    active_bills_count: Number(row.active_bills_count),
    bills_total: Number(row.bills_total),
    bills_paid: Number(row.bills_paid),
    bills_outstanding: Number(row.bills_outstanding),
    outstanding_balance: Number(row.outstanding_balance),
  };
}

function normalizeSupplierBalance(row: SupplierBalance): SupplierBalance {
  return {
    ...row,
    fruit_ids: Array.isArray(row.fruit_ids)
      ? row.fruit_ids
      : row.fruit_id
        ? [row.fruit_id]
        : [],
    fruit_count: Number(row.fruit_count ?? (row.fruit_ids?.length ?? (row.fruit_id ? 1 : 0))),
    opening_balance: Number(row.opening_balance),
    opening_balance_paid: Number(row.opening_balance_paid),
    opening_balance_outstanding: Number(row.opening_balance_outstanding),
    active_deliveries_count: Number(row.active_deliveries_count),
    total_boxes_received: Number(row.total_boxes_received),
    deliveries_total: Number(row.deliveries_total),
    deliveries_paid: Number(row.deliveries_paid),
    deliveries_outstanding: Number(row.deliveries_outstanding),
    outstanding_balance: Number(row.outstanding_balance),
  };
}

// ============================================================================
// Customer Accounts & Payments
// ============================================================================

export async function listCustomerBalances(options?: { forceRefresh?: boolean }): Promise<CustomerBalance[]> {
  return appCache.fetch(
    'customer_balances',
    async () => {
      const { data, error } = await supabase
        .from('customer_balances')
        .select(
          'customer_id, name, phone, active, opening_balance_id, opening_balance, opening_balance_paid, opening_balance_outstanding, active_bills_count, bills_total, bills_paid, bills_outstanding, outstanding_balance'
        )
        .order('active', { ascending: false })
        .order('outstanding_balance', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw formatAccountsError(error, 'Could not load customer balances.');
      return ((data ?? []) as CustomerBalance[]).map(normalizeCustomerBalance);
    },
    { ttlMs: TTL.BALANCES, tags: ['customer_balances'], forceRefresh: options?.forceRefresh }
  );
}

interface RawCustomerPaymentAllocRow {
  id: string;
  customer_payment_id: string;
  bill_id: string | null;
  opening_balance_id: string | null;
  amount: number;
  status: 'active' | 'cancelled' | 'refunded';
  refund_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  bills: { bill_no: string; bill_date: string } | { bill_no: string; bill_date: string }[] | null;
  customer_opening_balances:
    | { as_of_date: string }
    | { as_of_date: string }[]
    | null;
}

interface RawCustomerPaymentRow {
  id: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  payment_origin: 'bill_sale' | 'collection';
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  customer_payment_allocations: RawCustomerPaymentAllocRow[] | null;
}

interface RawCustomerRefundRow {
  id: string;
  bill_id: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  amount: number;
  mode: PaymentMode;
  refund_date: string;
  note: string | null;
  created_at: string;
  bills: { bill_no: string } | { bill_no: string }[] | null;
}

interface RawCustomerReturnRow {
  id: string;
  bill_id: string;
  return_no: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  return_date: string;
  total_boxes: number;
  total_amount: number;
  refund_amount: number;
  refund_mode: PaymentMode | null;
  refund_id: string | null;
  reason: string | null;
  created_at: string;
  bills: { bill_no: string } | { bill_no: string }[] | null;
}

interface PagedQueryResult<T> {
  data: T[] | null;
  error: PostgrestErrorLike | null;
}

async function fetchAllPages<T>(
  queryFn: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>
): Promise<PagedQueryResult<T>> {
  const pageSize = 1000;
  let all: T[] = [];
  let from = 0;
  while (true) {
    const res = await queryFn(from, from + pageSize - 1);
    if (res.error) return res;
    const batch = res.data ?? [];
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

export async function getCustomerAccountDetail(
  customerId: string,
  options?: { forceRefresh?: boolean }
): Promise<CustomerAccountDetail> {
  return appCache.fetch(
    `customer_ledger:${customerId}`,
    async () => {
      const [balRes, obRes, billsRes, payRes, refundRes, returnRes] = await Promise.all([
        supabase
          .from('customer_balances')
          .select(
            'customer_id, name, phone, active, opening_balance_id, opening_balance, opening_balance_paid, opening_balance_outstanding, active_bills_count, bills_total, bills_paid, bills_outstanding, outstanding_balance'
          )
          .eq('customer_id', customerId)
          .single(),
        supabase
          .from('customer_opening_balances')
          .select('id, customer_id, amount, as_of_date, note, status, cancelled_at, cancel_reason, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
        fetchAllPages<BillBalance>((from, to) =>
          supabase
            .from('bill_balances')
            .select(
              'bill_id, bill_no, customer_id, is_cash_customer, customer_name_snapshot, bill_date, subtotal, total_returned, net_subtotal, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
            )
            .eq('customer_id', customerId)
            .order('bill_date', { ascending: false })
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllPages<RawCustomerPaymentRow>((from, to) =>
          supabase
            .from('customer_payments')
            .select(
              'id, customer_id, customer_name_snapshot, payment_origin, amount, mode, payment_date, note, status, cancelled_at, cancel_reason, created_at, customer_payment_allocations(id, customer_payment_id, bill_id, opening_balance_id, amount, status, refund_id, reversed_at, reversal_reason, bills(bill_no, bill_date), customer_opening_balances(as_of_date))'
            )
            .eq('customer_id', customerId)
            .order('payment_date', { ascending: false })
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllPages<RawCustomerRefundRow>((from, to) =>
          supabase
            .from('customer_refunds')
            .select(
              'id, bill_id, customer_id, customer_name_snapshot, amount, mode, refund_date, note, created_at, bills(bill_no)'
            )
            .eq('customer_id', customerId)
            .order('refund_date', { ascending: false })
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllPages<RawCustomerReturnRow>((from, to) =>
          supabase
            .from('bill_returns')
            .select(
              'id, bill_id, return_no, customer_id, customer_name_snapshot, return_date, total_boxes, total_amount, refund_amount, refund_mode, refund_id, reason, created_at, bills(bill_no)'
            )
            .eq('customer_id', customerId)
            .order('return_date', { ascending: false })
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
      ]);

      if (balRes.error) throw formatAccountsError(balRes.error, 'Could not load customer account.');
      if (obRes.error) throw formatAccountsError(obRes.error, 'Could not load opening balances.');
      if (billsRes.error) throw formatAccountsError(billsRes.error, 'Could not load customer bills.');
      if (payRes.error) throw formatAccountsError(payRes.error, 'Could not load customer payments.');
      if (refundRes.error) throw formatAccountsError(refundRes.error, 'Could not load customer refunds.');
      // Graceful fallback for customer returns if migration 012 has not yet been applied:
      if (returnRes.error) {
        console.warn('Customer returns not available (migration 012 pending):', returnRes.error.message);
      }

      const openingBalances: CustomerOpeningBalance[] = (
        (obRes.data ?? []) as CustomerOpeningBalance[]
      ).map((o) => ({ ...o, amount: Number(o.amount) }));

      const bills: BillBalance[] = ((billsRes.data ?? []) as BillBalance[]).map((b) => ({
        ...b,
        subtotal: Number(b.subtotal),
        total_returned: b.total_returned ? Number(b.total_returned) : 0,
        net_subtotal: b.net_subtotal ? Number(b.net_subtotal) : Number(b.subtotal),
        amount_paid: Number(b.amount_paid),
        outstanding_amount: Number(b.outstanding_amount),
      }));

      const payments: CustomerPaymentRecord[] = ((payRes.data ?? []) as RawCustomerPaymentRow[]).map(
        (p) => {
          const allocations: CustomerPaymentAllocationItem[] = (
            p.customer_payment_allocations ?? []
          ).map((a) => {
            const bill = unwrapSingle(a.bills);
            const ob = unwrapSingle(a.customer_opening_balances);
            return {
              id: a.id,
              customer_payment_id: a.customer_payment_id,
              bill_id: a.bill_id,
              opening_balance_id: a.opening_balance_id,
              target_label: a.bill_id ? (bill?.bill_no ?? 'Bill') : 'Opening Balance',
              target_date: a.bill_id ? (bill?.bill_date ?? null) : (ob?.as_of_date ?? null),
              amount: Number(a.amount),
              status: a.status,
              refund_id: a.refund_id,
              reversed_at: a.reversed_at,
              reversal_reason: a.reversal_reason,
            };
          });

          return {
            id: p.id,
            customer_id: p.customer_id,
            customer_name_snapshot: p.customer_name_snapshot,
            payment_origin: p.payment_origin,
            amount: Number(p.amount),
            mode: p.mode,
            payment_date: p.payment_date,
            note: p.note,
            status: p.status,
            cancelled_at: p.cancelled_at,
            cancel_reason: p.cancel_reason,
            created_at: p.created_at,
            allocations,
          };
        }
      );

      const refunds: CustomerRefundWithBill[] = ((refundRes.data ?? []) as RawCustomerRefundRow[]).map(
        (r) => {
          const bill = unwrapSingle(r.bills);
          return {
            id: r.id,
            bill_id: r.bill_id,
            bill_no: bill?.bill_no ?? 'Bill',
            customer_id: r.customer_id,
            customer_name_snapshot: r.customer_name_snapshot,
            amount: Number(r.amount),
            mode: r.mode,
            refund_date: r.refund_date,
            note: r.note,
            created_at: r.created_at,
          };
        }
      );

      const returns: CustomerReturnRecord[] = ((returnRes.data ?? []) as RawCustomerReturnRow[]).map(
        (r) => {
          const bill = unwrapSingle(r.bills);
          return {
            id: r.id,
            bill_id: r.bill_id,
            bill_no: bill?.bill_no ?? 'Bill',
            customer_id: r.customer_id,
            customer_name_snapshot: r.customer_name_snapshot,
            return_no: r.return_no,
            return_date: r.return_date,
            total_boxes: Number(r.total_boxes),
            total_amount: Number(r.total_amount),
            refund_amount: Number(r.refund_amount),
            refund_mode: r.refund_mode,
            refund_id: r.refund_id,
            reason: r.reason,
            created_at: r.created_at,
          };
        }
      );

      return {
        balance: normalizeCustomerBalance(balRes.data as CustomerBalance),
        openingBalances,
        bills,
        payments,
        refunds,
        returns,
      };
    },
    {
      ttlMs: TTL.LEDGER,
      tags: ['customer_ledger', `customer_ledger:${customerId}`],
      forceRefresh: options?.forceRefresh,
    }
  );
}

export async function addCustomerPayment(input: AddCustomerPaymentInput): Promise<string> {
  if (!input.customer_id) throw new Error('Customer is required.');
  if (!input.allocations.length) {
    throw new Error('Explicitly allocate this payment to at least one bill or opening balance.');
  }

  let sum = 0;
  const payloadAllocs = input.allocations.map((a) => {
    const amt = Math.round(a.amount * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Every allocation amount must be greater than zero.');
    }
    sum += amt;
    return a.bill_id
      ? { bill_id: a.bill_id, amount: amt }
      : { opening_balance_id: a.opening_balance_id, amount: amt };
  });

  const roundedAmount = Math.round(input.amount * 100) / 100;
  const roundedSum = Math.round(sum * 100) / 100;
  if (Math.round(roundedSum * 100) !== Math.round(roundedAmount * 100)) {
    throw new Error(
      `Allocated total (₹${roundedSum.toLocaleString('en-IN')}) must match payment amount (₹${roundedAmount.toLocaleString('en-IN')}).`
    );
  }

  const { data, error } = await supabase.rpc('add_customer_payment', {
    p_customer_id: input.customer_id,
    p_amount: roundedAmount,
    p_mode: input.mode,
    p_payment_date: input.payment_date,
    p_allocations: payloadAllocs,
    p_note: input.note?.trim() || null,
    p_idempotency_key: input.idempotency_key,
  });

  if (error) throw formatAccountsError(error, 'Could not record customer payment.');
  invalidateOnCustomerPayment(input.customer_id);
  return data as string;
}

export async function cancelCustomerPayment(paymentId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('cancel_customer_payment', {
    p_payment_id: paymentId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not cancel customer payment.');
  invalidateOnCustomerPayment();
}

export async function setCustomerOpeningBalance(
  customerId: string,
  amount: number,
  asOfDate: string,
  note: string | null
): Promise<string> {
  const rounded = Math.round(amount * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error('Opening balance must be greater than zero.');
  }
  const { data, error } = await supabase.rpc('set_customer_opening_balance', {
    p_customer_id: customerId,
    p_amount: rounded,
    p_as_of_date: asOfDate || null,
    p_note: note?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not set customer opening balance.');
  invalidateOnCustomerPayment(customerId);
  return data as string;
}

export async function cancelCustomerOpeningBalance(
  openingBalanceId: string,
  reason: string | null
): Promise<void> {
  const { error } = await supabase.rpc('cancel_customer_opening_balance', {
    p_opening_balance_id: openingBalanceId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not cancel customer opening balance.');
  invalidateOnCustomerPayment();
}

// ============================================================================
// Supplier Accounts, Deliveries, Payments, Reallocations & Opening Balances
// ============================================================================

export async function listSupplierBalances(options?: { forceRefresh?: boolean }): Promise<SupplierBalance[]> {
  return appCache.fetch(
    'supplier_balances',
    async () => {
      const { data, error } = await supabase
        .from('supplier_balances')
        .select(
          'supplier_id, name, phone, fruit_id, fruit_name, active, opening_balance_id, opening_balance, opening_balance_paid, opening_balance_outstanding, active_deliveries_count, total_boxes_received, deliveries_total, deliveries_paid, deliveries_outstanding, outstanding_balance, fruit_ids, fruit_count'
        )
        .order('active', { ascending: false })
        .order('outstanding_balance', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw formatAccountsError(error, 'Could not load supplier balances.');
      return ((data ?? []) as SupplierBalance[]).map(normalizeSupplierBalance);
    },
    { ttlMs: TTL.BALANCES, tags: ['supplier_balances'], forceRefresh: options?.forceRefresh }
  );
}

interface RawSupplierPaymentAllocRow {
  id: string;
  supplier_payment_id: string;
  delivery_id: string | null;
  opening_balance_id: string | null;
  amount: number;
  status: 'active' | 'reallocated' | 'refunded' | 'cancelled';
  refund_id: string | null;
  reallocated_from_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  stock_deliveries:
    | { delivery_no: string; received_date: string }
    | { delivery_no: string; received_date: string }[]
    | null;
  supplier_opening_balances:
    | { as_of_date: string }
    | { as_of_date: string }[]
    | null;
}

interface RawSupplierPaymentRow {
  id: string;
  supplier_id: string;
  payment_origin: 'delivery_receipt' | 'settlement';
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  supplier_payment_allocations: RawSupplierPaymentAllocRow[] | null;
}

interface RawSupplierRefundRow {
  id: string;
  delivery_id: string;
  supplier_id: string;
  amount: number;
  mode: PaymentMode;
  refund_date: string;
  note: string | null;
  created_at: string;
  stock_deliveries: { delivery_no: string } | { delivery_no: string }[] | null;
}

export async function getSupplierAccountDetail(
  supplierId: string,
  options?: { forceRefresh?: boolean }
): Promise<SupplierAccountDetail> {
  return appCache.fetch(
    `supplier_ledger:${supplierId}`,
    async () => {
      const [balRes, obRes, delRes, payRes, refundRes] = await Promise.all([
        supabase
          .from('supplier_balances')
          .select(
            'supplier_id, name, phone, fruit_id, fruit_name, active, opening_balance_id, opening_balance, opening_balance_paid, opening_balance_outstanding, active_deliveries_count, total_boxes_received, deliveries_total, deliveries_paid, deliveries_outstanding, outstanding_balance, fruit_ids, fruit_count'
          )
          .eq('supplier_id', supplierId)
          .single(),
        supabase
          .from('supplier_opening_balances')
          .select('id, supplier_id, amount, as_of_date, note, status, cancelled_at, cancel_reason, created_at')
          .eq('supplier_id', supplierId)
          .order('created_at', { ascending: false }),
        supabase
          .from('delivery_balances')
          .select(
            'delivery_id, delivery_no, supplier_id, supplier_name, supplier_active, fruit_id, fruit_name, received_date, boxes_received, boxes_remaining, purchase_amount, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at, fruit_ids, fruit_count'
          )
          .eq('supplier_id', supplierId)
          .order('received_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('supplier_payments')
          .select(
            'id, supplier_id, payment_origin, amount, mode, payment_date, note, status, cancelled_at, cancel_reason, created_at, supplier_payment_allocations(id, supplier_payment_id, delivery_id, opening_balance_id, amount, status, refund_id, reallocated_from_id, reversed_at, reversal_reason, stock_deliveries(delivery_no, received_date), supplier_opening_balances(as_of_date))'
          )
          .eq('supplier_id', supplierId)
          .order('payment_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('supplier_refunds')
          .select('id, delivery_id, supplier_id, amount, mode, refund_date, note, created_at, stock_deliveries(delivery_no)')
          .eq('supplier_id', supplierId)
          .order('refund_date', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      if (balRes.error) throw formatAccountsError(balRes.error, 'Could not load supplier account.');
      if (obRes.error) throw formatAccountsError(obRes.error, 'Could not load supplier opening balances.');
      if (delRes.error) throw formatAccountsError(delRes.error, 'Could not load supplier deliveries.');
      if (payRes.error) throw formatAccountsError(payRes.error, 'Could not load supplier payments.');
      if (refundRes.error) throw formatAccountsError(refundRes.error, 'Could not load supplier refunds.');

      const openingBalances: SupplierOpeningBalance[] = (
        (obRes.data ?? []) as SupplierOpeningBalance[]
      ).map((o) => ({ ...o, amount: Number(o.amount) }));

      const deliveries: DeliveryBalance[] = ((delRes.data ?? []) as DeliveryBalance[]).map((d) => ({
        ...d,
        boxes_received: Number(d.boxes_received),
        boxes_remaining: Number(d.boxes_remaining),
        boxes_purchase_amount: Number(d.purchase_amount),
        purchase_amount: Number(d.purchase_amount),
        amount_paid: Number(d.amount_paid),
        outstanding_amount: Number(d.outstanding_amount),
      }));

      const payments: SupplierPaymentRecord[] = ((payRes.data ?? []) as RawSupplierPaymentRow[]).map(
        (p) => {
          const allocations: SupplierPaymentAllocationItem[] = (
            p.supplier_payment_allocations ?? []
          ).map((a) => {
            const del = unwrapSingle(a.stock_deliveries);
            const ob = unwrapSingle(a.supplier_opening_balances);
            return {
              id: a.id,
              supplier_payment_id: a.supplier_payment_id,
              delivery_id: a.delivery_id,
              opening_balance_id: a.opening_balance_id,
              target_label: a.delivery_id ? (del?.delivery_no ?? 'Delivery') : 'Opening Balance',
              target_date: a.delivery_id ? (del?.received_date ?? null) : (ob?.as_of_date ?? null),
              amount: Number(a.amount),
              status: a.status,
              refund_id: a.refund_id,
              reallocated_from_id: a.reallocated_from_id,
              reversed_at: a.reversed_at,
              reversal_reason: a.reversal_reason,
            };
          });

          return {
            id: p.id,
            supplier_id: p.supplier_id,
            payment_origin: p.payment_origin,
            amount: Number(p.amount),
            mode: p.mode,
            payment_date: p.payment_date,
            note: p.note,
            status: p.status,
            cancelled_at: p.cancelled_at,
            cancel_reason: p.cancel_reason,
            created_at: p.created_at,
            allocations,
          };
        }
      );

      const refunds: SupplierRefundRecord[] = ((refundRes.data ?? []) as RawSupplierRefundRow[]).map(
        (r) => {
          const del = unwrapSingle(r.stock_deliveries);
          return {
            id: r.id,
            delivery_id: r.delivery_id,
            delivery_no: del?.delivery_no ?? 'Delivery',
            supplier_id: r.supplier_id,
            amount: Number(r.amount),
            mode: r.mode,
            refund_date: r.refund_date,
            note: r.note,
            created_at: r.created_at,
          };
        }
      );

      return {
        balance: normalizeSupplierBalance(balRes.data as SupplierBalance),
        openingBalances,
        deliveries,
        payments,
        refunds,
      };
    },
    {
      ttlMs: TTL.LEDGER,
      tags: ['supplier_ledger', `supplier_ledger:${supplierId}`],
      forceRefresh: options?.forceRefresh,
    }
  );
}

export async function addSupplierPayment(input: AddSupplierPaymentInput): Promise<string> {
  if (!input.supplier_id) throw new Error('Supplier is required.');
  if (!input.allocations.length) {
    throw new Error(
      'Explicitly allocate this supplier payment to at least one delivery or opening balance. Unallocated advances are not allowed.'
    );
  }

  let sum = 0;
  const payloadAllocs = input.allocations.map((a) => {
    const amt = Math.round(a.amount * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Every allocation amount must be greater than zero.');
    }
    sum += amt;
    return a.delivery_id
      ? { delivery_id: a.delivery_id, amount: amt }
      : { opening_balance_id: a.opening_balance_id, amount: amt };
  });

  const roundedAmount = Math.round(input.amount * 100) / 100;
  const roundedSum = Math.round(sum * 100) / 100;
  if (Math.round(roundedSum * 100) !== Math.round(roundedAmount * 100)) {
    throw new Error(
      `Allocated total (₹${roundedSum.toLocaleString('en-IN')}) must exactly match payment amount (₹${roundedAmount.toLocaleString('en-IN')}).`
    );
  }

  const { data, error } = await supabase.rpc('add_supplier_payment', {
    p_supplier_id: input.supplier_id,
    p_amount: roundedAmount,
    p_mode: input.mode,
    p_payment_date: input.payment_date,
    p_allocations: payloadAllocs,
    p_note: input.note?.trim() || null,
    p_idempotency_key: input.idempotency_key,
  });

  if (error) throw formatAccountsError(error, 'Could not record supplier payment.');
  invalidateOnSupplierPayment(input.supplier_id);
  return data as string;
}

export async function reallocateSupplierPaymentAllocation(
  input: ReallocateSupplierAllocationInput
): Promise<void> {
  if (!input.new_allocations.length) {
    throw new Error('Select at least one replacement delivery or opening balance.');
  }

  const payloadAllocs = input.new_allocations.map((a) => {
    const amt = Math.round(a.amount * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Every replacement allocation amount must be greater than zero.');
    }
    return a.delivery_id
      ? { delivery_id: a.delivery_id, amount: amt }
      : { opening_balance_id: a.opening_balance_id, amount: amt };
  });

  const { error } = await supabase.rpc('reallocate_supplier_payment_allocation', {
    p_allocation_id: input.allocation_id,
    p_new_allocations: payloadAllocs,
    p_reason: input.reason?.trim() || null,
  });

  if (error) throw formatAccountsError(error, 'Could not reallocate supplier payment.');
  invalidateOnSupplierPayment();
}

export async function cancelSupplierPayment(
  supplierPaymentId: string,
  reason: string | null
): Promise<void> {
  const { error } = await supabase.rpc('cancel_supplier_payment', {
    p_supplier_payment_id: supplierPaymentId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not cancel supplier payment.');
  invalidateOnSupplierPayment();
}

export async function cancelStockDelivery(input: CancelDeliveryInput): Promise<void> {
  const { error } = await supabase.rpc('cancel_stock_delivery', {
    p_delivery_id: input.delivery_id,
    p_reason: input.reason?.trim() || null,
    p_refund_mode: input.refund_mode,
    p_refund_date: input.refund_date || null,
    p_refund_note: input.refund_note?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not cancel stock delivery.');
  invalidateOnStockDelivery();
}

export async function setSupplierOpeningBalance(
  supplierId: string,
  amount: number,
  asOfDate: string,
  note: string | null
): Promise<string> {
  const rounded = Math.round(amount * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error('Opening balance must be greater than zero.');
  }
  const { data, error } = await supabase.rpc('set_supplier_opening_balance', {
    p_supplier_id: supplierId,
    p_amount: rounded,
    p_as_of_date: asOfDate || null,
    p_note: note?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not set supplier opening balance.');
  invalidateOnSupplierPayment(supplierId);
  return data as string;
}

export async function cancelSupplierOpeningBalance(
  openingBalanceId: string,
  reason: string | null
): Promise<void> {
  const { error } = await supabase.rpc('cancel_supplier_opening_balance', {
    p_opening_balance_id: openingBalanceId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw formatAccountsError(error, 'Could not cancel supplier opening balance.');
  invalidateOnSupplierPayment();
}

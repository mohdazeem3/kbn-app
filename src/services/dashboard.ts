import { supabase } from '@/lib/supabase';
import { appCache, TTL } from './cache';
import type {
  BillBalance,
  DashboardCollectionsBreakdown,
  DashboardData,
  DashboardOverview,
} from '@/types/database';

export interface RawPaymentAllocationForBreakdown {
  id: string;
  amount: number | string;
  status: string;
  opening_balance_id?: string | null;
  bill_id?: string | null;
  bills?: {
    id?: string;
    bill_date?: string;
    status?: string;
  } | Array<{
    id?: string;
    bill_date?: string;
    status?: string;
  }> | null;
}

export interface RawCustomerPaymentForBreakdown {
  id: string;
  amount: number | string;
  mode: string;
  payment_date: string;
  payment_origin?: string | null;
  status: string;
  customer_payment_allocations?: RawPaymentAllocationForBreakdown[] | null;
}

export function calculateCollectionsBreakdown(
  payments: RawCustomerPaymentForBreakdown[],
  todayDate: string
): DashboardCollectionsBreakdown {
  let cashFromTodayBills = 0;
  let cashFromOldDues = 0;
  let cashUnclassified = 0;

  let upiFromTodayBills = 0;
  let upiFromOldDues = 0;
  let upiUnclassified = 0;

  for (const payment of payments) {
    if (payment.status !== 'active') continue;
    const payAmt = Number(payment.amount) || 0;
    const mode = payment.mode === 'upi' ? 'upi' : 'cash';

    const activeAllocs = (payment.customer_payment_allocations ?? []).filter(
      (a) => a.status === 'active'
    );

    if (activeAllocs.length === 0) {
      if (mode === 'cash') cashUnclassified += payAmt;
      else upiUnclassified += payAmt;
      continue;
    }

    let allocatedTotal = 0;
    for (const alloc of activeAllocs) {
      const allocAmt = Number(alloc.amount) || 0;
      allocatedTotal += allocAmt;

      let isTodayBill = false;
      let isOldDue = false;

      if (alloc.opening_balance_id) {
        // Customer opening balances represent past outstanding debt
        isOldDue = true;
      } else if (alloc.bill_id) {
        const bill = Array.isArray(alloc.bills) ? alloc.bills[0] : alloc.bills;
        const billDate = bill?.bill_date;
        if (billDate === todayDate) {
          isTodayBill = true;
        } else if (billDate && billDate < todayDate) {
          isOldDue = true;
        } else if (billDate) {
          isOldDue = true;
        } else {
          // Bill was not found or has no date
          isOldDue = false;
        }
      }

      if (mode === 'cash') {
        if (isTodayBill) {
          cashFromTodayBills += allocAmt;
        } else if (isOldDue) {
          cashFromOldDues += allocAmt;
        } else {
          cashUnclassified += allocAmt;
        }
      } else {
        if (isTodayBill) {
          upiFromTodayBills += allocAmt;
        } else if (isOldDue) {
          upiFromOldDues += allocAmt;
        } else {
          upiUnclassified += allocAmt;
        }
      }
    }

    // Remainder of payment that wasn't allocated
    const unallocatedRemainder = Math.max(0, Math.round((payAmt - allocatedTotal) * 100) / 100);
    if (unallocatedRemainder > 0) {
      if (mode === 'cash') {
        cashUnclassified += unallocatedRemainder;
      } else {
        upiUnclassified += unallocatedRemainder;
      }
    }
  }

  const roundedCashToday = Math.round(cashFromTodayBills * 100) / 100;
  const roundedCashOld = Math.round(cashFromOldDues * 100) / 100;
  const roundedCashUnclass = Math.round(cashUnclassified * 100) / 100;

  const roundedUpiToday = Math.round(upiFromTodayBills * 100) / 100;
  const roundedUpiOld = Math.round(upiFromOldDues * 100) / 100;
  const roundedUpiUnclass = Math.round(upiUnclassified * 100) / 100;

  return {
    cash_from_today_bills: roundedCashToday,
    cash_from_old_dues: roundedCashOld,
    cash_unclassified: roundedCashUnclass,
    upi_from_today_bills: roundedUpiToday,
    upi_from_old_dues: roundedUpiOld,
    upi_unclassified: roundedUpiUnclass,
    total_unclassified: Math.round((roundedCashUnclass + roundedUpiUnclass) * 100) / 100,
  };
}

export const SHOP_TIMEZONE = 'Asia/Kolkata';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function formatDashboardError(error: PostgrestErrorLike | null, fallback: string): Error {
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
      'The dashboard views are not ready yet. Apply the prepared Supabase migrations first, then tap Retry.'
    );
  }

  if (code === '42501') {
    return new Error('You do not have permission to view the dashboard. Please sign in again.');
  }

  return new Error(msg || fallback);
}

/**
 * Formats today's heading date in the shop timezone (Asia/Kolkata).
 * When summary_date (YYYY-MM-DD) is returned from dashboard_overview, parses it safely
 * at noon IST so date boundaries never shift on non-IST client devices.
 */
export function formatShopHeadingDate(summaryDate?: string | null): string {
  const dateObj =
    summaryDate && /^\d{4}-\d{2}-\d{2}$/.test(summaryDate)
      ? new Date(`${summaryDate}T12:00:00+05:30`)
      : new Date();

  return dateObj.toLocaleDateString('en-IN', {
    timeZone: SHOP_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Formats an ISO timestamp's clock time in the shop timezone (Asia/Kolkata).
 */
export function formatShopTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    timeZone: SHOP_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function normalizeOverview(row: DashboardOverview): DashboardOverview {
  return {
    summary_date: row.summary_date,
    today_bills_count: Number(row.today_bills_count),
    today_sales_total: Number(row.today_sales_total),
    today_cash_received: Number(row.today_cash_received),
    today_upi_received: Number(row.today_upi_received),
    today_cash_refunded: Number(row.today_cash_refunded),
    today_upi_refunded: Number(row.today_upi_refunded),
    today_net_cash_received: Number(row.today_net_cash_received),
    today_net_upi_received: Number(row.today_net_upi_received),
    total_customer_dues: Number(row.total_customer_dues),
    total_supplier_dues: Number(row.total_supplier_dues),
  };
}

/**
 * Fetches all Dashboard summary numbers directly from public.dashboard_overview
 * (which computes today using public.shop_today() / Asia/Kolkata) and recent bills
 * from public.bill_balances without duplicating financial logic on the client.
 */
export async function getDashboardData(
  latestLimit = 8,
  options?: { forceRefresh?: boolean }
): Promise<DashboardData> {
  return appCache.fetch(
    `dashboard:${latestLimit}`,
    async () => {
      const [overviewRes, billsRes] = await Promise.all([
        supabase
          .from('dashboard_overview')
          .select(
            'summary_date, today_bills_count, today_sales_total, today_cash_received, today_upi_received, today_cash_refunded, today_upi_refunded, today_net_cash_received, today_net_upi_received, total_customer_dues, total_supplier_dues'
          )
          .single(),
        supabase
          .from('bill_balances')
          .select(
            'bill_id, bill_no, customer_id, is_cash_customer, customer_name_snapshot, bill_date, subtotal, amount_paid, outstanding_amount, payment_status, status, cancelled_at, cancel_reason, note, created_at'
          )
          .order('bill_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(latestLimit),
      ]);

      if (overviewRes.error) {
        throw formatDashboardError(overviewRes.error, 'Could not load dashboard summary.');
      }
      if (billsRes.error) {
        throw formatDashboardError(billsRes.error, 'Could not load latest sales.');
      }

      const overview = normalizeOverview(overviewRes.data as DashboardOverview);
      const summaryDate = overview.summary_date;

      let collectionsBreakdown: DashboardCollectionsBreakdown = {
        cash_from_today_bills: 0,
        cash_from_old_dues: 0,
        cash_unclassified: overview.today_cash_received,
        upi_from_today_bills: 0,
        upi_from_old_dues: 0,
        upi_unclassified: overview.today_upi_received,
        total_unclassified: overview.today_cash_received + overview.today_upi_received,
      };

      try {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('customer_payments')
          .select(
            'id, amount, mode, payment_date, payment_origin, status, customer_payment_allocations(id, amount, status, opening_balance_id, bill_id, bills(id, bill_date, status))'
          )
          .eq('payment_date', summaryDate)
          .eq('status', 'active');

        if (!paymentsError && paymentsData) {
          collectionsBreakdown = calculateCollectionsBreakdown(
            paymentsData as RawCustomerPaymentForBreakdown[],
            summaryDate
          );
        } else if (paymentsError) {
          console.warn('Could not query customer payments for breakdown:', paymentsError);
        }
      } catch (err) {
        console.warn('Could not calculate collections breakdown; using fallback', err);
      }

      const latestBills: BillBalance[] = ((billsRes.data ?? []) as BillBalance[]).map((b) => ({
        ...b,
        subtotal: Number(b.subtotal),
        amount_paid: Number(b.amount_paid),
        outstanding_amount: Number(b.outstanding_amount),
      }));

      return {
        overview,
        collectionsBreakdown,
        latestBills,
      };
    },
    { ttlMs: TTL.DASHBOARD, tags: ['dashboard'], forceRefresh: options?.forceRefresh }
  );
}

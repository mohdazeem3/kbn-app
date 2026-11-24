import { supabase } from '@/lib/supabase';
import { appCache, TTL } from './cache';
import type { BillBalance, DashboardData, DashboardOverview } from '@/types/database';

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

      const latestBills: BillBalance[] = ((billsRes.data ?? []) as BillBalance[]).map((b) => ({
        ...b,
        subtotal: Number(b.subtotal),
        amount_paid: Number(b.amount_paid),
        outstanding_amount: Number(b.outstanding_amount),
      }));

      return {
        overview: normalizeOverview(overviewRes.data as DashboardOverview),
        latestBills,
      };
    },
    { ttlMs: TTL.DASHBOARD, tags: ['dashboard'], forceRefresh: options?.forceRefresh }
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  ChevronRight,
  ClipboardList,
  IndianRupee,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Truck,
  Users,
} from 'lucide-react';
import { AlertBanner, Badge, Button, Card, LoadingCard } from '@/components/ui';
import { BillDetailModal } from '@/components/sales/BillDetailModal';
import {
  formatShopHeadingDate,
  formatShopTime,
  getDashboardData,
} from '@/services/dashboard';
import { useCacheInvalidation } from '@/services/cache';
import { formatDisplayDate } from '@/services/inventory';
import type { DashboardData, PaymentStatus } from '@/types/database';
import type { Page } from './pageTypes';

interface DashboardProps {
  onNavigate: (p: Page) => void;
  isActive?: boolean;
}

function paymentStatusTone(status: PaymentStatus): 'green' | 'orange' | 'red' | 'neutral' {
  if (status === 'paid') return 'green';
  if (status === 'partial') return 'orange';
  if (status === 'unpaid') return 'red';
  return 'neutral';
}

function paymentStatusLabel(status: PaymentStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'unpaid') return 'Unpaid';
  return 'Cancelled';
}

function getShopGreeting(now = new Date()): string {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const hour = Number(hourStr);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ onNavigate, isActive = true }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const result = await getDashboardData(8, { forceRefresh: isRefresh });
      setData(result);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useCacheInvalidation(['dashboard'], () => void loadDashboard(true), { isActive });

  const handleBillCancelled = (billNo: string) => {
    setNotice(`Cancelled bill ${billNo}. Today's sales, stock, and dues have been updated.`);
    void loadDashboard(true);
  };

  const overview = data?.overview ?? null;
  const latestBills = data?.latestBills ?? [];
  const hasRefundsToday =
    overview !== null && (overview.today_cash_refunded > 0 || overview.today_upi_refunded > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-mango-600">
            {formatShopHeadingDate(overview?.summary_date)}
          </p>
          <h1 className="font-display mt-1 text-4xl font-semibold text-leaf-950">
            {getShopGreeting()}
          </h1>
        </div>

        <Button
          variant="ghost"
          icon={RefreshCw}
          disabled={loading || refreshing}
          onClick={() => void loadDashboard(true)}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Prominent daily actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onNavigate('receive')}
          className="group flex items-center justify-between rounded-2xl bg-leaf-600 px-6 py-6 text-left shadow-card transition-all duration-150 hover:bg-leaf-700 hover:shadow-lifted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-leaf-500/50 text-white">
              <ArrowDownCircle className="h-8 w-8" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold text-white">Receive Stock</span>
              <span className="block text-base text-leaf-100">Record a new arrival</span>
            </span>
          </span>
          <ChevronRight
            className="h-7 w-7 text-leaf-200 transition-transform group-hover:translate-x-1"
            aria-hidden
          />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('sale')}
          className="group flex items-center justify-between rounded-2xl bg-mango-500 px-6 py-6 text-left shadow-card transition-all duration-150 hover:bg-mango-600 hover:shadow-lifted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mango-600"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-mango-400/50 text-white">
              <ArrowUpCircle className="h-8 w-8" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold text-white">New Sale</span>
              <span className="block text-base text-mango-100">Bill a shop in under a minute</span>
            </span>
          </span>
          <ChevronRight
            className="h-7 w-7 text-mango-200 transition-transform group-hover:translate-x-1"
            aria-hidden
          />
        </button>
      </div>

      {notice && <AlertBanner tone="success" message={notice} />}
      {loadError && (
        <AlertBanner
          tone="error"
          message={loadError}
          onRetry={() => void loadDashboard(false)}
        />
      )}

      {loading && !data ? (
        <LoadingCard label="Loading today's summary…" />
      ) : overview ? (
        <>
          {/* 2-Card Summary: Today's Sales & Outstanding Dues */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Card 1: Today's Sales */}
            <Card className="flex flex-col justify-between gap-5 p-6">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">
                    Today&apos;s Sales
                  </p>
                  <p className="font-display mt-1 text-4xl font-bold text-leaf-950">
                    ₹{overview.today_sales_total.toLocaleString('en-IN')}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-leaf-700">
                    {overview.today_bills_count}{' '}
                    {overview.today_bills_count === 1 ? 'Bill' : 'Bills'}
                  </p>
                </div>

                {/* Cash & UPI received today (gross active receipts incl. collections on older bills) */}
                <div className="space-y-2.5 border-t border-leaf-100 pt-4">
                  <span className="block text-xs font-bold uppercase tracking-wide text-leaf-700">
                    Collections
                  </span>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-leaf-100 bg-cream-100/80 px-4 py-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-leaf-700">
                        <IndianRupee className="h-3.5 w-3.5 text-leaf-600" aria-hidden />
                        Cash
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-leaf-950">
                        ₹{overview.today_cash_received.toLocaleString('en-IN')}
                      </p>
                    </div>

                    <div className="rounded-xl border border-leaf-100 bg-cream-100/80 px-4 py-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-leaf-700">
                        <Smartphone className="h-3.5 w-3.5 text-mango-600" aria-hidden />
                        UPI
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-leaf-950">
                        ₹{overview.today_upi_received.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actual Refunds Today — always shown separately, never silently subtracted */}
              <div
                className={`rounded-xl border px-4 py-3 ${
                  hasRefundsToday
                    ? 'border-mango-200 bg-mango-50/60'
                    : 'border-leaf-100 bg-cream-100/50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-leaf-800">
                    <RotateCcw className="h-3.5 w-3.5 text-mango-600" aria-hidden />
                    Refunds
                  </span>
                  {!hasRefundsToday && (
                    <span className="text-xs font-bold text-leaf-700">Cash ₹0 • UPI ₹0</span>
                  )}
                </div>

                {hasRefundsToday && (
                  <div className="mt-2 space-y-1 text-xs text-leaf-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Cash refunded:{' '}
                        <strong className="text-mango-800">
                          ₹{overview.today_cash_refunded.toLocaleString('en-IN')}
                        </strong>
                      </span>
                      <span>
                        UPI refunded:{' '}
                        <strong className="text-mango-800">
                          ₹{overview.today_upi_refunded.toLocaleString('en-IN')}
                        </strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-mango-200/70 pt-1 text-leaf-700">
                      <span>
                        Net Cash: <strong>₹{overview.today_net_cash_received.toLocaleString('en-IN')}</strong>
                      </span>
                      <span>
                        Net UPI: <strong>₹{overview.today_net_upi_received.toLocaleString('en-IN')}</strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Card 2: Outstanding Dues */}
            <Card className="flex flex-col gap-5 p-6">
              <h2 className="text-xs font-bold uppercase tracking-wide text-leaf-700">
                Outstanding Dues
              </h2>

              <div className="flex flex-1 flex-col justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('customers')}
                  className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-leaf-100 bg-cream-100/80 px-5 py-4 text-left transition-colors hover:border-leaf-300 hover:bg-leaf-50"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-100 text-leaf-700">
                      <Users className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="text-base font-bold text-leaf-900">Customers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-display text-2xl font-bold ${
                        overview.total_customer_dues > 0 ? 'text-mango-700' : 'text-leaf-700'
                      }`}
                    >
                      ₹{overview.total_customer_dues.toLocaleString('en-IN')}
                    </span>
                    <ChevronRight
                      className="h-5 w-5 text-leaf-500 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('suppliers')}
                  className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-leaf-100 bg-cream-100/80 px-5 py-4 text-left transition-colors hover:border-leaf-300 hover:bg-leaf-50"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mango-100 text-mango-700">
                      <Truck className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="text-base font-bold text-leaf-900">Suppliers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-display text-2xl font-bold ${
                        overview.total_supplier_dues > 0 ? 'text-mango-700' : 'text-leaf-700'
                      }`}
                    >
                      ₹{overview.total_supplier_dues.toLocaleString('en-IN')}
                    </span>
                    <ChevronRight
                      className="h-5 w-5 text-leaf-500 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </div>
                </button>
              </div>
            </Card>
          </div>

          {/* Latest Sales */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold text-leaf-950">Latest Sales</h2>
              <button
                type="button"
                onClick={() => onNavigate('bills')}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-base font-bold text-leaf-700 transition-colors hover:bg-leaf-100"
              >
                View all <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {latestBills.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-leaf-200 bg-cream-100 px-6 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-leaf-100">
                  <ClipboardList className="h-7 w-7 text-leaf-600" aria-hidden />
                </span>
                <h3 className="mt-4 text-xl font-bold text-leaf-900">No sales recorded yet</h3>
                <p className="mt-1 max-w-md text-base text-leaf-700">
                  Recent bills will appear here once recorded.
                </p>
              </div>
            ) : (
              <div className="mt-4 divide-y divide-leaf-100">
                {latestBills.map((bill) => {
                  const isCancelled = bill.status === 'cancelled';
                  const timeLabel = formatShopTime(bill.created_at);
                  const customerLabel = bill.is_cash_customer
                    ? 'Cash Customer'
                    : bill.customer_name_snapshot;
                  return (
                    <button
                      key={bill.bill_id}
                      type="button"
                      onClick={() => setSelectedBillId(bill.bill_id)}
                      className={`group flex w-full flex-wrap items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-cream-100/70 sm:rounded-xl sm:px-3 ${
                        isCancelled ? 'opacity-65' : ''
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-base font-extrabold text-leaf-950 ${
                              isCancelled ? 'line-through' : ''
                            }`}
                          >
                            {bill.bill_no}
                          </span>
                          <Badge tone={paymentStatusTone(bill.payment_status)}>
                            {paymentStatusLabel(bill.payment_status)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-leaf-700">
                          <span className="font-semibold text-leaf-900">{customerLabel}</span>
                          <span className="inline-flex items-center gap-1 text-xs text-leaf-600">
                            <Calendar className="h-3.5 w-3.5" aria-hidden />
                            {formatDisplayDate(bill.bill_date)}
                            {timeLabel ? ` • ${timeLabel}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums sm:min-w-[260px]">
                          <div>
                            <p className="text-xs font-semibold text-leaf-600">Total</p>
                            <p
                              className={`font-bold text-leaf-950 ${
                                isCancelled ? 'text-stone-500 line-through' : ''
                              }`}
                            >
                              ₹{bill.subtotal.toLocaleString('en-IN')}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-leaf-600">Paid</p>
                            <p className="font-bold text-leaf-700">
                              ₹{bill.amount_paid.toLocaleString('en-IN')}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-leaf-600">Due</p>
                            <p
                              className={`font-extrabold ${
                                bill.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
                              }`}
                            >
                              ₹{bill.outstanding_amount.toLocaleString('en-IN')}
                            </p>
                          </div>
                        </div>

                        <ChevronRight
                          className="h-5 w-5 text-leaf-400 transition-transform group-hover:translate-x-0.5 group-hover:text-leaf-700"
                          aria-hidden
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      ) : null}

      <BillDetailModal
        billId={selectedBillId}
        onClose={() => setSelectedBillId(null)}
        onCancelled={handleBillCancelled}
      />
    </div>
  );
}

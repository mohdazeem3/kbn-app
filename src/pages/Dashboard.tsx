import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  Calendar,
  ChevronRight,
  ClipboardList,
  IndianRupee,
  RefreshCw,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import { AlertBanner, Badge, Button, Card, LoadingCard } from '@/components/ui';
import { BillDetailModal } from '@/components/sales/BillDetailModal';
import { BillReturnModal } from '@/components/sales/BillReturnModal';
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
  const [showReturnModal, setShowReturnModal] = useState(false);

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

      {/* Prominent Actions: Full-Width New Sale & Fast Return / Refund */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onNavigate('sale')}
          className="group flex w-full items-center justify-between rounded-2xl bg-mango-500 px-6 py-5 text-left shadow-card transition-all duration-150 hover:bg-mango-600 hover:shadow-lifted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mango-600"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mango-400/50 text-white">
              <ArrowUpCircle className="h-7 w-7" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold text-black">New Sale</span>
              <span className="block text-sm text-mango-100">Bill a customer</span>
            </span>
          </span>
          <ChevronRight
            className="h-6 w-6 text-mango-200 transition-transform group-hover:translate-x-1"
            aria-hidden
          />
        </button>

        <button
          type="button"
          onClick={() => setShowReturnModal(true)}
          className="group flex w-full sm:w-auto sm:inline-flex items-center justify-between sm:justify-start gap-3 rounded-xl border-2 border-mango-300 bg-mango-50 px-4 py-2.5 text-left font-bold text-mango-950 transition-colors hover:border-mango-500 hover:bg-mango-100/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mango-500"
        >
          <span className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-mango-700" aria-hidden />
            <span className="text-sm font-extrabold text-mango-950">Return / Refund</span>
          </span>
          <span className="text-xs font-semibold text-mango-700 sm:ml-1">Search bill &amp; return boxes</span>
          <ChevronRight className="h-4 w-4 text-mango-600 transition-transform group-hover:translate-x-0.5 ml-auto sm:ml-1" aria-hidden />
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
          {/* Full-Width Today's Sales Section */}
          <Card className="p-6 space-y-5">
            {/* Header & Big Daily Total */}
            <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-leaf-100 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-leaf-700">
                  Today&apos;s Sales
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="font-display text-4xl font-extrabold text-leaf-950 tabular-nums">
                    ₹{overview.today_sales_total.toLocaleString('en-IN')}
                  </span>
                  <Badge tone="green">
                    {overview.today_bills_count}{' '}
                    {overview.today_bills_count === 1 ? 'Bill' : 'Bills'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Collections Breakdown: Cash & UPI */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-leaf-700 mb-2.5">
                Today&apos;s Collections
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-leaf-100 bg-cream-100/80 px-4 py-3">
                  <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-leaf-700">
                    <IndianRupee className="h-3.5 w-3.5 text-leaf-600" aria-hidden />
                    Cash Received
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-leaf-950 tabular-nums">
                    ₹{overview.today_cash_received.toLocaleString('en-IN')}
                  </p>
                </div>

                <div className="rounded-xl border border-leaf-100 bg-cream-100/80 px-4 py-3">
                  <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-leaf-700">
                    <Smartphone className="h-3.5 w-3.5 text-mango-600" aria-hidden />
                    UPI Received
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-leaf-950 tabular-nums">
                    ₹{overview.today_upi_received.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            </div>

            {/* Refunds Breakdown */}
            <div
              className={`rounded-xl border px-4 py-3 ${hasRefundsToday
                ? 'border-mango-200 bg-mango-50/60'
                : 'border-leaf-100 bg-cream-100/50'
                }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-leaf-800">
                  <RotateCcw className="h-3.5 w-3.5 text-mango-600" aria-hidden />
                  Today&apos;s Customer Refunds
                </span>
                {!hasRefundsToday && (
                  <span className="text-xs font-bold text-leaf-700">Cash ₹0 • UPI ₹0</span>
                )}
              </div>

              {hasRefundsToday && (
                <div className="mt-2 space-y-1.5 text-xs text-leaf-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      Cash refunded:{' '}
                      <strong className="text-mango-800 tabular-nums font-bold">
                        ₹{overview.today_cash_refunded.toLocaleString('en-IN')}
                      </strong>
                    </span>
                    <span>
                      UPI refunded:{' '}
                      <strong className="text-mango-800 tabular-nums font-bold">
                        ₹{overview.today_upi_refunded.toLocaleString('en-IN')}
                      </strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mango-200/70 pt-1.5 text-leaf-900 font-bold">
                    <span>
                      Net Cash in Hand:{' '}
                      <strong className="tabular-nums">
                        ₹{overview.today_net_cash_received.toLocaleString('en-IN')}
                      </strong>
                    </span>
                    <span>
                      Net UPI in Account:{' '}
                      <strong className="tabular-nums">
                        ₹{overview.today_net_upi_received.toLocaleString('en-IN')}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </Card>

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
                      className={`group flex w-full flex-wrap items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-cream-100/70 sm:rounded-xl sm:px-3 ${isCancelled ? 'opacity-65' : ''
                        }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-base font-extrabold text-leaf-950 ${isCancelled ? 'line-through' : ''
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
                              className={`font-bold text-leaf-950 ${isCancelled ? 'text-stone-500 line-through' : ''
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
                              className={`font-extrabold ${bill.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
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

      {showReturnModal && (
        <BillReturnModal
          open={showReturnModal}
          onClose={() => setShowReturnModal(false)}
          onReturnSuccess={(res, billNo) => {
            setNotice(
              `Return ${res.return_no} recorded for bill ${billNo}. ${res.returned_boxes} box(es) restored to stock.`
            );
            void loadDashboard(true);
          }}
        />
      )}
    </div>
  );
}

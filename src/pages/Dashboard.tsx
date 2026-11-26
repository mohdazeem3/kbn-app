import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Bell,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  History,
  RotateCcw,
  RotateCw,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { AlertBanner, LoadingCard } from '@/components/ui';
import { BillReturnModal } from '@/components/sales/BillReturnModal';
import {
  formatShopHeadingDate,
  getDashboardData,
} from '@/services/dashboard';
import { listStockBatches } from '@/services/inventory';
import { useCacheInvalidation } from '@/services/cache';
import type { DashboardData, StockBatchView } from '@/types/database';
import type { Page } from './pageTypes';

interface DashboardProps {
  onNavigate: (p: Page) => void;
  isActive?: boolean;
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

function getFruitEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('apple') || n.includes('seb')) return '🍎';
  if (n.includes('orange') || n.includes('santre') || n.includes('mosambi') || n.includes('kinnow')) return '🍊';
  if (n.includes('grape') || n.includes('angoor')) return '🍇';
  if (n.includes('banana') || n.includes('kela')) return '🍌';
  if (n.includes('mango') || n.includes('aam')) return '🥭';
  if (n.includes('pomegranate') || n.includes('anar')) return '🫐';
  if (n.includes('watermelon') || n.includes('tarbooz')) return '🍉';
  if (n.includes('papaya') || n.includes('papita')) return '🍈';
  if (n.includes('guava') || n.includes('amrood') || n.includes('pear') || n.includes('nashpati')) return '🍐';
  if (n.includes('pineapple') || n.includes('ananas')) return '🍍';
  return '📦';
}

export function Dashboard({ onNavigate, isActive = true }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [stockBatches, setStockBatches] = useState<StockBatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCollections, setShowCollections] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const [dashboardResult, stockResult] = await Promise.all([
        getDashboardData(8, { forceRefresh: isRefresh }),
        listStockBatches({ forceRefresh: isRefresh }),
      ]);
      setData(dashboardResult);
      setStockBatches(stockResult);
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

  useCacheInvalidation(['dashboard', 'stock'], () => void loadDashboard(true), { isActive });

  const overview = data?.overview ?? null;
  const breakdown = data?.collectionsBreakdown ?? null;
  const cashReceived = overview?.today_cash_received ?? 0;
  const upiReceived = overview?.today_upi_received ?? 0;
  const totalReceived = cashReceived + upiReceived;
  const cashRefunded = overview?.today_cash_refunded ?? 0;
  const upiRefunded = overview?.today_upi_refunded ?? 0;
  const totalRefunds = cashRefunded + upiRefunded;
  const hasRefundsToday = totalRefunds > 0;

  const cashFromTodayBills = breakdown?.cash_from_today_bills ?? 0;
  const cashFromOldDues = breakdown?.cash_from_old_dues ?? 0;
  const upiFromTodayBills = breakdown?.upi_from_today_bills ?? 0;
  const upiFromOldDues = breakdown?.upi_from_old_dues ?? 0;
  const totalUnclassified = breakdown?.total_unclassified ?? 0;

  // Compute low stock fruits from active stock batches
  const lowStockFruits = useMemo(() => {
    const map = new Map<string, { fruit_id: string; fruit_name: string; boxes_remaining: number }>();
    for (const b of stockBatches) {
      const existing = map.get(b.fruit_id) || {
        fruit_id: b.fruit_id,
        fruit_name: b.fruit_name,
        boxes_remaining: 0,
      };
      existing.boxes_remaining += b.boxes_remaining;
      map.set(b.fruit_id, existing);
    }
    // Low stock: fruits with remaining boxes <= 15
    const alertItems = Array.from(map.values())
      .filter((f) => f.boxes_remaining <= 15)
      .sort((a, b) => a.boxes_remaining - b.boxes_remaining)
      .slice(0, 4);

    if (alertItems.length === 0 && map.size > 0) {
      return Array.from(map.values())
        .sort((a, b) => a.boxes_remaining - b.boxes_remaining)
        .slice(0, 3);
    }
    return alertItems;
  }, [stockBatches]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      {/* 1. Header Banner with Fruit Basket Art */}
      <div className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-gradient-to-r from-cream-100/90 via-cream-100/60 to-cream-50/40 p-5 sm:p-6 shadow-sm">
        {/* Subtle Fruit Basket Accent matching approved reference */}
        <img
          src="/fruit-banner.png"
          alt="Fresh Fruits"
          className="pointer-events-none absolute right-0 top-0 h-full w-auto max-w-[48%] object-cover object-left opacity-90 mix-blend-multiply select-none hidden sm:block"
        />

        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-amber-700">
              <Calendar className="h-4 w-4 text-amber-600" aria-hidden />
              {formatShopHeadingDate(overview?.summary_date)}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-leaf-950">
              {getShopGreeting()}
            </h1>
          </div>

          <button
            type="button"
            disabled={loading || refreshing}
            onClick={() => void loadDashboard(true)}
            className="flex items-center gap-2 rounded-full border border-stone-300/80 bg-white/95 px-4 py-2 text-xs sm:text-sm font-bold text-leaf-950 shadow-sm transition hover:bg-white hover:border-leaf-600 hover:shadow disabled:opacity-50"
          >
            <RotateCw
              className={`h-4 w-4 text-leaf-800 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden
            />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
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
        <LoadingCard label="Loading today's dashboard…" />
      ) : (
        <>
          {/* 2. Quick Actions (New Sale & Return / Refund cards without heading) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1: New Sale (Primary Action) */}
            <button
              type="button"
              onClick={() => onNavigate('sale')}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-[#FF7A00] to-[#FF5500] p-5 text-left shadow-md shadow-orange-500/20 transition-all duration-150 hover:shadow-lg hover:shadow-orange-500/30 hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner">
                  <ShoppingCart className="h-6 w-6 text-white stroke-[2.2]" aria-hidden />
                </div>
                <div>
                  <span className="block font-display text-xl sm:text-2xl font-extrabold text-white">
                    New Sale
                  </span>
                  <span className="block text-xs sm:text-sm font-medium text-orange-100">
                    Bill a customer
                  </span>
                </div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-white transition-transform group-hover:translate-x-0.5 group-hover:bg-white/35">
                <ChevronRight className="h-5 w-5" aria-hidden />
              </div>
            </button>

            {/* Card 2: Return / Refund */}
            <button
              type="button"
              onClick={() => setShowReturnModal(true)}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-stone-200/90 bg-white/95 p-5 text-left shadow-sm transition-all duration-150 hover:border-amber-400 hover:shadow-md hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-50 text-leaf-800 border border-leaf-100">
                  <RotateCcw className="h-6 w-6 text-leaf-800 stroke-[2.2]" aria-hidden />
                </div>
                <div>
                  <span className="block font-display text-xl sm:text-2xl font-extrabold text-leaf-950">
                    Return / Refund
                  </span>
                  <span className="block text-xs sm:text-sm font-medium text-stone-500">
                    Process return or refund
                  </span>
                </div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-colors group-hover:bg-amber-100 group-hover:text-amber-800">
                <ChevronRight className="h-5 w-5" aria-hidden />
              </div>
            </button>
          </div>

          {/* 3. Business Summary Cards (Row of 4 cards) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Today's Sales */}
            <div className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5 shadow-sm transition-all hover:shadow">
              <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-emerald-50/70" />
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <TrendingUp className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 truncate">
                    Today&apos;s Sales
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-leaf-950 tabular-nums truncate">
                    ₹{overview ? overview.today_sales_total.toLocaleString('en-IN') : '0'}
                  </p>
                </div>
              </div>
            </div>

            {/* Today's Bills */}
            <div className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5 shadow-sm transition-all hover:shadow">
              <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-emerald-50/70" />
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <FileText className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 truncate">
                    Today&apos;s Bills
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-leaf-950 tabular-nums truncate">
                    {overview ? overview.today_bills_count : 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Cash Received */}
            <div className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5 shadow-sm transition-all hover:shadow">
              <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-emerald-50/70" />
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <Wallet className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 truncate">
                    Cash Received
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-leaf-950 tabular-nums truncate">
                    ₹{overview ? overview.today_cash_received.toLocaleString('en-IN') : '0'}
                  </p>
                </div>
              </div>
            </div>

            {/* UPI Received */}
            <div className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5 shadow-sm transition-all hover:shadow">
              <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-orange-50/70" />
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 border border-orange-100">
                  <Smartphone className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 truncate">
                    UPI Received
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-leaf-950 tabular-nums truncate">
                    ₹{overview ? overview.today_upi_received.toLocaleString('en-IN') : '0'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Lower Dashboard Grid (Two columns: Left column stacked [Today's Collections + Recent Bills], Right column [Stock Alerts]) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* LEFT COLUMN: Stacked Today's Collections + Recent Bills */}
            <div className="flex flex-col gap-4">
              {/* Card 1: Today's Collections */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm transition-all">
                <div className="flex items-center gap-2 pb-3.5 border-b border-stone-100">
                  <Wallet className="h-4 w-4 text-leaf-800" aria-hidden />
                  <h3 className="font-display text-base font-bold text-leaf-950">Today&apos;s Collections</h3>
                </div>

                <div className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-stone-500">
                      Today&apos;s Total Received
                    </p>
                    <p className="mt-1 text-2xl sm:text-3xl font-extrabold text-leaf-950 tabular-nums">
                      ₹{totalReceived.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCollections((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-300/80 bg-stone-50 px-3.5 py-1.5 text-xs font-bold text-leaf-950 shadow-sm transition hover:bg-stone-100 hover:border-leaf-600 focus-visible:outline-none"
                  >
                    <span>{showCollections ? 'Hide' : 'Show'}</span>
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-stone-500 transition-transform duration-200 ${
                        showCollections ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Expanded Details */}
                {showCollections && (
                  <div className="mt-4 pt-4 border-t border-stone-100 space-y-3.5">
                    {/* Primary Breakdown Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {/* 1. Cash from Today's Bills */}
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 flex flex-col justify-between">
                        <div className="flex items-center gap-1.5 text-emerald-800">
                          <Banknote className="h-4 w-4 shrink-0" aria-hidden />
                          <p className="text-[11px] font-bold leading-tight">Cash from Today&apos;s Bills</p>
                        </div>
                        <p className="mt-2 text-base sm:text-lg font-extrabold text-leaf-950 tabular-nums">
                          ₹{cashFromTodayBills.toLocaleString('en-IN')}
                        </p>
                        <p className="mt-0.5 text-[10px] font-medium text-emerald-700">New sales</p>
                      </div>

                      {/* 2. Cash Collected Against Old Dues */}
                      <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 flex flex-col justify-between">
                        <div className="flex items-center gap-1.5 text-sky-800">
                          <History className="h-4 w-4 shrink-0" aria-hidden />
                          <p className="text-[11px] font-bold leading-tight">Cash Against Old Dues</p>
                        </div>
                        <p className="mt-2 text-base sm:text-lg font-extrabold text-leaf-950 tabular-nums">
                          ₹{cashFromOldDues.toLocaleString('en-IN')}
                        </p>
                        <p className="mt-0.5 text-[10px] font-medium text-sky-700">Past bills &amp; opening</p>
                      </div>

                      {/* 3. UPI Received */}
                      <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 flex flex-col justify-between">
                        <div className="flex items-center gap-1.5 text-orange-700">
                          <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
                          <p className="text-[11px] font-bold leading-tight">UPI Received</p>
                        </div>
                        <p className="mt-2 text-base sm:text-lg font-extrabold text-leaf-950 tabular-nums">
                          ₹{upiReceived.toLocaleString('en-IN')}
                        </p>
                        <p className="mt-0.5 text-[10px] font-medium text-stone-500 truncate">
                          {upiFromOldDues > 0
                            ? `₹${upiFromTodayBills.toLocaleString('en-IN')} new • ₹${upiFromOldDues.toLocaleString('en-IN')} old`
                            : 'Online payments'}
                        </p>
                      </div>

                      {/* 4. Customer Refunds */}
                      <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 flex flex-col justify-between">
                        <div className="flex items-center gap-1.5 text-amber-800">
                          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
                          <p className="text-[11px] font-bold leading-tight">Customer Refunds</p>
                        </div>
                        <p className="mt-2 text-base sm:text-lg font-extrabold text-leaf-950 tabular-nums">
                          ₹{totalRefunds.toLocaleString('en-IN')}
                        </p>
                        <p className="mt-0.5 text-[10px] font-medium text-stone-500 truncate">
                          {hasRefundsToday
                            ? `Cash ₹${cashRefunded.toLocaleString('en-IN')} • UPI ₹${upiRefunded.toLocaleString('en-IN')}`
                            : 'No refunds today'}
                        </p>
                      </div>
                    </div>

                    {/* Unclassified Collections Safeguard (if any unallocated payments exist) */}
                    {totalUnclassified > 0 && (
                      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2 text-xs">
                        <div className="flex items-center gap-2 text-amber-900 font-semibold">
                          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                          <span>Unclassified Collections</span>
                        </div>
                        <span className="font-extrabold tabular-nums text-amber-950">
                          ₹{totalUnclassified.toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}

                    {/* Cash Subtotal Reconciliation Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100 text-xs">
                      <span className="text-stone-600 font-medium">
                        Total Cash Received: <strong className="font-bold text-leaf-950 tabular-nums">₹{cashReceived.toLocaleString('en-IN')}</strong>
                        <span className="text-stone-400 font-normal"> (₹{cashFromTodayBills.toLocaleString('en-IN')} bills + ₹{cashFromOldDues.toLocaleString('en-IN')} old dues)</span>
                      </span>
                      <span className="text-stone-500 font-medium">
                        Net Today: <strong className="font-bold text-emerald-800 tabular-nums">₹{(totalReceived - totalRefunds).toLocaleString('en-IN')}</strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: Recent Bills / Activity */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-leaf-800" aria-hidden />
                  <h3 className="font-display text-base font-bold text-leaf-950">Recent Bills / Activity</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('bills')}
                  className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-emerald-700 hover:text-emerald-900 transition"
                >
                  <span>View All</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Stock Alerts */}
            <div className="rounded-2xl border border-amber-200/70 bg-[#FFFBF5] p-5 shadow-sm flex flex-col justify-between h-full">
              <div>
                <div className="flex items-center justify-between pb-3.5 border-b border-amber-200/50">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-600" aria-hidden />
                    <h3 className="font-display text-base font-bold text-stone-900">Stock Alerts</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('stock')}
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-900 transition flex items-center gap-1"
                  >
                    View All <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="py-1 divide-y divide-amber-100/70">
                  {lowStockFruits.length === 0 ? (
                    <div className="py-8 text-center text-xs font-medium text-stone-500 space-y-1">
                      <p className="text-emerald-700 font-bold">✓ All fruits are well-stocked</p>
                      <p className="text-stone-400">No low stock warnings right now.</p>
                    </div>
                  ) : (
                    lowStockFruits.map((item) => (
                      <div
                        key={item.fruit_id}
                        className="flex items-center justify-between py-2.5 sm:py-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100/70 text-base">
                            {getFruitEmoji(item.fruit_name)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-stone-900 truncate">
                              {item.fruit_name}
                            </p>
                            <p className="text-[11px] font-medium text-stone-500 mt-0.5">
                              Only {item.boxes_remaining} {item.boxes_remaining === 1 ? 'box' : 'boxes'} left
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center rounded-full border border-orange-200 bg-orange-100/80 px-2.5 py-0.5 text-[11px] font-bold text-orange-700">
                          Low Stock
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Action Modals */}
      <BillReturnModal
        open={showReturnModal}
        onClose={() => setShowReturnModal(false)}
        onReturnSuccess={(_result, billNo) => {
          setNotice(`Processed return/refund for bill ${billNo}.`);
          void loadDashboard(true);
        }}
      />
    </div>
  );
}

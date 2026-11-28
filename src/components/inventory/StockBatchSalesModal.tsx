import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Search,
  Truck,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  LoadingCard,
  Modal,
  SelectInput,
  TextInput,
} from '@/components/ui';
import {
  getBatchSalesTraceability,
  type BatchTraceabilityResult,
} from '@/services/batchTraceability';
import { formatDisplayDate } from '@/services/inventory';
import type { PaymentStatus } from '@/types/database';

interface StockBatchSalesModalProps {
  batchId: string | null;
  asOfDate?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

type PaymentFilterType = 'all' | 'paid' | 'partial' | 'unpaid';

function paymentTone(status: PaymentStatus): 'green' | 'orange' | 'red' | 'neutral' {
  if (status === 'paid') return 'green';
  if (status === 'partial') return 'orange';
  if (status === 'unpaid') return 'red';
  return 'neutral';
}

function paymentLabel(status: PaymentStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'unpaid') return 'Unpaid';
  return 'Cancelled';
}

const PAGE_SIZE = 10;

export function StockBatchSalesModal({
  batchId,
  asOfDate,
  isOpen,
  onClose,
}: StockBatchSalesModalProps) {
  const [data, setData] = useState<BatchTraceabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters inside modal
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilterType>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Accordion state for returns and cancelled sales
  const [showReturns, setShowReturns] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);

  const loadData = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    try {
      const res = await getBatchSalesTraceability(batchId, asOfDate);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock batch sales data.');
    } finally {
      setLoading(false);
    }
  }, [batchId, asOfDate]);

  useEffect(() => {
    if (isOpen && batchId) {
      void loadData();
    } else {
      setData(null);
      setError(null);
      setSearchQuery('');
      setPaymentFilter('all');
      setCurrentPage(1);
    }
  }, [isOpen, batchId, asOfDate, loadData]);

  // Filtered active sales
  const filteredSales = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();

    return data.activeSales.filter((sale) => {
      if (paymentFilter !== 'all' && sale.paymentStatus !== paymentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        sale.billNo.toLowerCase().includes(q) ||
        sale.customerName.toLowerCase().includes(q) ||
        sale.billDate.includes(q)
      );
    });
  }, [data, searchQuery, paymentFilter]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredSales.slice(start, start + PAGE_SIZE);
  }, [filteredSales, currentPage]);

  // Totals for filtered view
  const filteredTotals = useMemo(() => {
    let totalBoxes = 0;
    let totalAmount = 0;
    for (const s of filteredSales) {
      totalBoxes += s.netBoxesSold;
      totalAmount += s.netLineAmount;
    }
    return {
      totalBoxes,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }, [filteredSales]);

  if (!isOpen) return null;

  const summary = data?.summary;
  const returns = data?.returns ?? [];
  const cancelledSales = data?.cancelledSales ?? [];

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={summary?.isHistorical ? 'Historical Batch Movement History' : 'Stock Batch Sales Traceability'}
      subtitle={
        summary
          ? summary.isHistorical && summary.asOfDate
            ? `${summary.fruitName} — ${summary.varietyName} • ${summary.deliveryNo} (Position as of ${formatDisplayDate(summary.asOfDate)})`
            : `${summary.fruitName} — ${summary.varietyName} • ${summary.deliveryNo} (Received ${formatDisplayDate(summary.receivedDate)})`
          : 'Where Did My Stock Go?'
      }
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        {loading && <LoadingCard label="Loading sales and batch traceability details…" />}

        {error && <AlertBanner tone="error" message={error} onRetry={() => void loadData()} />}

        {!loading && !error && data && summary && (
          <>
            {summary.isHistorical && summary.asOfDate && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-amber-950 flex items-center justify-between gap-3 text-xs sm:text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <span className="font-bold">Historical Position as of {formatDisplayDate(summary.asOfDate)}</span>
                  <span className="text-amber-800 text-xs">— Only movements on or before this date are shown.</span>
                </div>
              </div>
            )}

            {/* 1. Batch Summary Card */}
            <div className="rounded-2xl border border-leaf-200 bg-cream-50 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-leaf-200/60 pb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-leaf-600">
                    Batch Summary
                  </span>
                  <h3 className="font-display text-xl sm:text-2xl font-bold text-leaf-950">
                    {summary.fruitName} — {summary.varietyName}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-leaf-100 px-3 py-1 text-xs sm:text-sm font-bold text-leaf-900">
                    {summary.deliveryNo}
                  </span>
                  {summary.boxesRemaining <= 0 ? (
                    <Badge tone="neutral">Sold Out</Badge>
                  ) : (
                    <Badge tone="green">In Stock</Badge>
                  )}
                </div>
              </div>

              {/* Details & Delivery Origin */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-xs font-semibold text-leaf-600 block">Supplier</span>
                  <p className="font-bold text-leaf-950 flex items-center gap-1.5 mt-0.5">
                    <Truck className="h-4 w-4 text-leaf-500 shrink-0" aria-hidden />
                    <span>{summary.supplierName}</span>
                    {!summary.supplierActive && (
                      <span className="text-xs text-stone-500 font-normal">(Inactive)</span>
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-leaf-600 block">Delivery Date</span>
                  <p className="font-bold text-leaf-950 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="h-4 w-4 text-leaf-500 shrink-0" aria-hidden />
                    <span>{formatDisplayDate(summary.receivedDate)}</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-leaf-600 block">Purchase Rate</span>
                  <p className="font-bold text-leaf-950 mt-0.5">
                    ₹{summary.purchaseRate.toLocaleString('en-IN')}{' '}
                    <span className="text-xs font-normal text-leaf-700">/ box</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-leaf-600 block">Total Batch Cost</span>
                  <p className="font-bold text-leaf-950 mt-0.5">
                    ₹{summary.purchaseAmount.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {/* Quantities 4-Column Box */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-white p-4 border border-leaf-100 shadow-sm">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide text-leaf-600">
                    Received
                  </span>
                  <p className="tabular-nums mt-1 text-2xl font-extrabold text-leaf-950">
                    {summary.boxesReceived}{' '}
                    <span className="text-sm font-semibold text-leaf-600">bxs</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide text-leaf-600">
                    Sold (Net)
                  </span>
                  <p className="tabular-nums mt-1 text-2xl font-extrabold text-leaf-900">
                    {summary.netBoxesSold}{' '}
                    <span className="text-sm font-semibold text-leaf-600">bxs</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide text-leaf-600">
                    Remaining
                  </span>
                  <p
                    className={`tabular-nums mt-1 text-2xl font-extrabold ${
                      summary.boxesRemaining > 0 ? 'text-leaf-950' : 'text-stone-500'
                    }`}
                  >
                    {summary.boxesRemaining}{' '}
                    <span className="text-sm font-semibold text-leaf-600">bxs</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide text-leaf-600">
                    Stock Value Left
                  </span>
                  <p className="tabular-nums mt-1 text-2xl font-extrabold text-leaf-950">
                    ₹{summary.remainingStockValue.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {summary.deliveryNote && (
                <p className="mt-3 text-xs sm:text-sm text-leaf-700">
                  <span className="font-bold text-leaf-900">Delivery Note:</span>{' '}
                  {summary.deliveryNote}
                </p>
              )}
            </div>

            {/* 2. Stock Reconciliation Status Banner */}
            <div
              className={`rounded-xl border p-4 ${
                summary.isReconciled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="flex items-start gap-3">
                {summary.isReconciled ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                )}
                <div className="text-xs sm:text-sm">
                  <div className="font-bold flex flex-wrap items-center gap-2">
                    <span>
                      {summary.isReconciled
                        ? 'Stock Reconciled & Balanced'
                        : 'Stock Reconciliation Notice'}
                    </span>
                    <span className="text-xs font-normal rounded-md bg-white/70 px-2 py-0.5 border border-current">
                      Received ({summary.boxesReceived}) = Remaining ({summary.boxesRemaining}) + Net
                      Sold ({summary.netBoxesSold})
                    </span>
                  </div>
                  <p className="mt-1 text-xs opacity-90">{summary.reconciliationMessage}</p>
                </div>
              </div>
            </div>

            {/* 3. Customer Returns Accordion (if any) */}
            {returns.length > 0 && (
              <div className="rounded-xl border border-leaf-200 bg-white overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowReturns((prev) => !prev)}
                  className="w-full flex items-center justify-between p-4 bg-cream-50 hover:bg-cream-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <Undo2 className="h-4 w-4 text-amber-600" aria-hidden />
                    <span className="font-bold text-sm text-leaf-950">
                      Customer Returns on this Batch ({returns.length}{' '}
                      {returns.length === 1 ? 'return' : 'returns'} • {summary.totalBoxesReturned}{' '}
                      boxes restored)
                    </span>
                  </div>
                  {showReturns ? (
                    <ChevronUp className="h-4 w-4 text-leaf-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-leaf-600" />
                  )}
                </button>

                {showReturns && (
                  <div className="p-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-leaf-100 text-xs sm:text-sm">
                      <thead>
                        <tr className="text-left font-bold text-leaf-700">
                          <th className="py-2 pr-3">Return No</th>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Customer</th>
                          <th className="py-2 px-3">Original Invoice</th>
                          <th className="py-2 px-3 text-right">Boxes Restored</th>
                          <th className="py-2 px-3 text-right">Rate</th>
                          <th className="py-2 px-3 text-right">Return Amount</th>
                          <th className="py-2 pl-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-leaf-100 text-leaf-900">
                        {returns.map((r) => (
                          <tr key={r.id} className="hover:bg-cream-50/50">
                            <td className="py-2 pr-3 font-bold text-leaf-950">{r.returnNo}</td>
                            <td className="py-2 px-3">{formatDisplayDate(r.returnDate)}</td>
                            <td className="py-2 px-3 font-semibold">{r.customerName}</td>
                            <td className="py-2 px-3 text-leaf-700">{r.billNo}</td>
                            <td className="py-2 px-3 text-right font-extrabold text-amber-700">
                              +{r.boxes} bxs
                            </td>
                            <td className="py-2 px-3 text-right">
                              ₹{r.sellRate.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold">
                              ₹{r.lineTotal.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2 pl-3 text-stone-600 italic">
                              {r.reason || 'Customer return'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 4. Cancelled Bills Accordion (if any) */}
            {cancelledSales.length > 0 && (
              <div className="rounded-xl border border-stone-200 bg-white overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowCancelled((prev) => !prev)}
                  className="w-full flex items-center justify-between p-4 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-stone-500" aria-hidden />
                    <span className="font-bold text-sm text-stone-800">
                      Cancelled Invoices ({cancelledSales.length} bills • {summary.cancelledBoxes}{' '}
                      boxes restored to stock)
                    </span>
                  </div>
                  {showCancelled ? (
                    <ChevronUp className="h-4 w-4 text-stone-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-stone-600" />
                  )}
                </button>

                {showCancelled && (
                  <div className="p-4 overflow-x-auto text-xs sm:text-sm">
                    <p className="text-xs text-stone-500 mb-3">
                      When an invoice is cancelled, all allocated stock is returned to the batch's
                      available godown balance. Cancelled quantities are not counted as sold stock.
                    </p>
                    <table className="min-w-full divide-y divide-stone-200 text-xs sm:text-sm">
                      <thead>
                        <tr className="text-left font-bold text-stone-700">
                          <th className="py-2 pr-3">Invoice No</th>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Customer</th>
                          <th className="py-2 px-3 text-right">Allocated Boxes</th>
                          <th className="py-2 pl-3">Cancellation Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 text-stone-800">
                        {cancelledSales.map((cs) => (
                          <tr key={cs.allocationId} className="hover:bg-stone-50/50">
                            <td className="py-2 pr-3 font-bold text-stone-900">{cs.billNo}</td>
                            <td className="py-2 px-3">{formatDisplayDate(cs.billDate)}</td>
                            <td className="py-2 px-3 font-semibold">{cs.customerName}</td>
                            <td className="py-2 px-3 text-right font-extrabold text-stone-700">
                              {cs.boxesAllocated} bxs (Restored)
                            </td>
                            <td className="py-2 pl-3 italic text-stone-600">
                              {cs.cancelReason || 'Order cancelled'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 5. Sales Breakdown — Where Did These Boxes Go? */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-lg sm:text-xl font-bold text-leaf-950">
                    Sales Breakdown — Where Did These Boxes Go?
                  </h4>
                  <p className="text-xs sm:text-sm text-leaf-600">
                    Every invoice that consumed stock from this exact delivery batch
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-leaf-600 block">Total Sold</span>
                  <span className="tabular-nums font-extrabold text-base sm:text-lg text-leaf-950">
                    {summary.netBoxesSold} boxes{' '}
                    {summary.totalBoxesReturned > 0 && (
                      <span className="text-xs font-normal text-leaf-600">
                        ({summary.grossBoxesSold} gross − {summary.totalBoxesReturned} ret)
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Filters & Search */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2 relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-leaf-500"
                    aria-hidden
                  />
                  <TextInput
                    className="pl-9 py-2 text-sm"
                    placeholder="Search by invoice number or customer name…"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    aria-label="Search sales"
                  />
                </div>
                <div>
                  <SelectInput
                    value={paymentFilter}
                    onChange={(e) => {
                      setPaymentFilter(e.target.value as PaymentFilterType);
                      setCurrentPage(1);
                    }}
                    aria-label="Filter by payment status"
                    className="py-2 text-sm"
                  >
                    <option value="all">All Payment Statuses</option>
                    <option value="paid">Paid Only</option>
                    <option value="partial">Partially Paid</option>
                    <option value="unpaid">Unpaid Only</option>
                  </SelectInput>
                </div>
              </div>

              {/* Sales Table / Cards */}
              {filteredSales.length === 0 ? (
                <EmptyState
                  emoji="📦"
                  title={
                    data.activeSales.length === 0
                      ? 'No sales recorded yet'
                      : 'No matching sales found'
                  }
                  description={
                    data.activeSales.length === 0
                      ? `All ${summary.boxesReceived} boxes remain available in your godown.`
                      : 'Try adjusting your search query or payment status filter.'
                  }
                />
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto rounded-xl border border-leaf-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-leaf-100 text-sm">
                      <thead className="bg-cream-100/70">
                        <tr className="text-left font-bold text-leaf-800">
                          <th className="py-3 px-3.5 w-12 text-center">#</th>
                          <th className="py-3 px-3.5">Date</th>
                          <th className="py-3 px-3.5">Invoice</th>
                          <th className="py-3 px-3.5">Customer</th>
                          <th className="py-3 px-3.5 text-right">Quantity from Batch</th>
                          <th className="py-3 px-3.5 text-right">Selling Rate</th>
                          <th className="py-3 px-3.5 text-right">Line Amount</th>
                          <th className="py-3 px-3.5 text-center">Payment</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-leaf-100 text-leaf-950">
                        {paginatedSales.map((sale, idx) => {
                          const itemIndex = (currentPage - 1) * PAGE_SIZE + idx + 1;
                          const hasReturn = sale.boxesReturned > 0;
                          return (
                            <tr
                              key={sale.allocationId}
                              className="hover:bg-cream-50/60 transition-colors"
                            >
                              <td className="py-3 px-3.5 text-center text-xs text-leaf-600 font-semibold">
                                {itemIndex}
                              </td>
                              <td className="py-3 px-3.5 font-medium whitespace-nowrap text-leaf-700">
                                {formatDisplayDate(sale.billDate)}
                              </td>
                              <td className="py-3 px-3.5 font-bold text-leaf-950 whitespace-nowrap">
                                {sale.billNo}
                              </td>
                              <td className="py-3 px-3.5 font-semibold text-leaf-900">
                                {sale.customerName}
                              </td>
                              <td className="py-3 px-3.5 text-right whitespace-nowrap font-extrabold text-leaf-950">
                                <span>{sale.netBoxesSold} boxes</span>
                                {hasReturn && (
                                  <span className="block text-xs font-normal text-amber-700">
                                    ({sale.boxesAllocated} gross − {sale.boxesReturned} ret)
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-right font-medium text-leaf-800 whitespace-nowrap">
                                ₹{sale.sellRate.toLocaleString('en-IN')}/box
                              </td>
                              <td className="py-3 px-3.5 text-right font-extrabold text-leaf-950 whitespace-nowrap">
                                ₹{sale.netLineAmount.toLocaleString('en-IN')}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                <Badge tone={paymentTone(sale.paymentStatus)}>
                                  {paymentLabel(sale.paymentStatus)}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Table Footer with Totals */}
                      <tfoot className="bg-cream-100/90 font-bold border-t-2 border-leaf-200">
                        <tr className="text-leaf-950">
                          <td colSpan={4} className="py-3 px-3.5 text-right uppercase tracking-wider text-xs">
                            Total Quantity Sold:
                          </td>
                          <td className="py-3 px-3.5 text-right font-extrabold text-leaf-950">
                            {filteredTotals.totalBoxes} boxes
                          </td>
                          <td className="py-3 px-3.5 text-right uppercase tracking-wider text-xs">
                            Total Line Amount:
                          </td>
                          <td className="py-3 px-3.5 text-right font-extrabold text-leaf-950">
                            ₹{filteredTotals.totalAmount.toLocaleString('en-IN')}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile Card List View (< 768px) */}
                  <div className="md:hidden space-y-3">
                    {paginatedSales.map((sale, idx) => {
                      const itemIndex = (currentPage - 1) * PAGE_SIZE + idx + 1;
                      const hasReturn = sale.boxesReturned > 0;
                      return (
                        <div
                          key={sale.allocationId}
                          className="rounded-xl border border-leaf-200 bg-white p-4 shadow-sm space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2 border-b border-leaf-100 pb-2.5">
                            <div>
                              <span className="text-xs font-bold text-leaf-500">#{itemIndex}</span>
                              <h5 className="font-bold text-base text-leaf-950">{sale.customerName}</h5>
                              <p className="text-xs text-leaf-600">
                                {sale.billNo} • {formatDisplayDate(sale.billDate)}
                              </p>
                            </div>
                            <Badge tone={paymentTone(sale.paymentStatus)}>
                              {paymentLabel(sale.paymentStatus)}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-leaf-500 font-semibold block">Quantity Taken:</span>
                              <span className="font-extrabold text-sm text-leaf-950">
                                {sale.netBoxesSold} boxes
                              </span>
                              {hasReturn && (
                                <span className="block text-[11px] text-amber-700">
                                  ({sale.boxesAllocated} gross − {sale.boxesReturned} ret)
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="text-leaf-500 font-semibold block">Selling Rate:</span>
                              <span className="font-bold text-sm text-leaf-900">
                                ₹{sale.sellRate.toLocaleString('en-IN')}/box
                              </span>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-leaf-100 flex justify-between items-center">
                              <span className="text-leaf-600 font-semibold">Line Amount:</span>
                              <span className="font-extrabold text-base text-leaf-950">
                                ₹{sale.netLineAmount.toLocaleString('en-IN')}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Mobile Totals Bar */}
                    <div className="rounded-xl bg-cream-100 p-4 border border-leaf-200 flex justify-between items-center text-sm font-bold text-leaf-950">
                      <span>Total Sold ({filteredSales.length} sales):</span>
                      <span className="text-right">
                        <div>{filteredTotals.totalBoxes} boxes</div>
                        <div className="text-xs text-leaf-700 font-normal">
                          ₹{filteredTotals.totalAmount.toLocaleString('en-IN')}
                        </div>
                      </span>
                    </div>
                  </div>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <p className="text-xs sm:text-sm text-leaf-600 font-medium">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                        {Math.min(currentPage * PAGE_SIZE, filteredSales.length)} of{' '}
                        {filteredSales.length} sales
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={ArrowLeft}
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <span className="text-xs font-bold text-leaf-800 px-2">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={ArrowRight}
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Bottom Actions */}
            <div className="pt-4 border-t border-leaf-100 flex items-center justify-between">
              <Button variant="secondary" size="md" icon={RotateCw} onClick={() => void loadData()}>
                Refresh Data
              </Button>
              <Button variant="primary" size="md" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

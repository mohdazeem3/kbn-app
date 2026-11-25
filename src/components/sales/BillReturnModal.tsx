import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  IndianRupee,
  Loader2,
  RotateCcw,
  Search,
  Smartphone,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  LoadingCard,
  Modal,
  TextInput,
} from '@/components/ui';
import { formatDisplayDate, getLocalIsoDate } from '@/services/inventory';
import { getBillDetail, listBills, processBillReturn } from '@/services/sales';
import type {
  BillBalance,
  BillDetail,
  PaymentMode,
  PaymentStatus,
  ProcessBillReturnResult,
} from '@/types/database';

interface BillReturnModalProps {
  open: boolean;
  preselectedBillId?: string | null;
  onClose: () => void;
  onReturnSuccess?: (result: ProcessBillReturnResult, billNo: string) => void;
}

function statusTone(status: PaymentStatus): 'green' | 'orange' | 'red' | 'neutral' {
  if (status === 'paid') return 'green';
  if (status === 'partial') return 'orange';
  if (status === 'unpaid') return 'red';
  return 'neutral';
}

export function BillReturnModal({
  open,
  preselectedBillId = null,
  onClose,
  onReturnSuccess,
}: BillReturnModalProps) {
  const [selectedBillId, setSelectedBillId] = useState<string | null>(preselectedBillId);
  const [searchQuery, setSearchQuery] = useState('');
  const [bills, setBills] = useState<BillBalance[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);

  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Return quantities by bill_item_id
  const [returnedBoxes, setReturnedBoxes] = useState<Record<string, number>>({});
  const [refundMode, setRefundMode] = useState<PaymentMode | null>(null);
  const refundDate = useMemo(() => getLocalIsoDate(), []);
  const [returnReason, setReturnReason] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    result: ProcessBillReturnResult;
    billNo: string;
  } | null>(null);

  // Reset when modal opens/closes or preselectedBillId changes
  useEffect(() => {
    if (!open) {
      setSelectedBillId(null);
      setSearchQuery('');
      setDetail(null);
      setReturnedBoxes({});
      setRefundMode(null);
      setReturnReason('');
      setShowConfirm(false);
      setSubmitError(null);
      setSuccessResult(null);
      return;
    }
    if (preselectedBillId) {
      setSelectedBillId(preselectedBillId);
    }
  }, [open, preselectedBillId]);

  // Load bills list when searching without preselected bill
  useEffect(() => {
    if (!open || selectedBillId) return;
    let isMounted = true;
    setLoadingBills(true);
    setBillsError(null);

    listBills()
      .then((data) => {
        if (isMounted) {
          // Filter to active bills only
          setBills(data.filter((b) => b.status === 'active'));
        }
      })
      .catch((err) => {
        if (isMounted) {
          setBillsError(err instanceof Error ? err.message : 'Could not load bills list.');
        }
      })
      .finally(() => {
        if (isMounted) setLoadingBills(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, selectedBillId]);

  // Load bill details when a bill is selected
  const loadSelectedBillDetail = useCallback(async (billId: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    setReturnedBoxes({});
    setRefundMode(null);
    setShowConfirm(false);
    setSubmitError(null);

    try {
      const data = await getBillDetail(billId);
      setDetail(data);

      // Pre-select cash refund mode if bill had cash payment
      let cashTotal = 0;
      let upiTotal = 0;
      for (const pa of data.paymentAllocations) {
        if (pa.status === 'active') {
          if (pa.mode === 'cash') cashTotal += pa.amount;
          if (pa.mode === 'upi') upiTotal += pa.amount;
        }
      }
      if (upiTotal > cashTotal) setRefundMode('upi');
      else if (cashTotal > 0) setRefundMode('cash');
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Could not load bill details.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBillId) {
      void loadSelectedBillDetail(selectedBillId);
    } else {
      setDetail(null);
    }
  }, [selectedBillId, loadSelectedBillDetail]);

  // Filter bills in search step
  const filteredBills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return bills.slice(0, 10);
    return bills
      .filter((b) => {
        return (
          b.bill_no.toLowerCase().includes(q) ||
          b.customer_name_snapshot.toLowerCase().includes(q) ||
          (b.note ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 15);
  }, [bills, searchQuery]);

  // Compute previously returned boxes per item
  const previouslyReturnedMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!detail?.returns) return map;
    for (const ret of detail.returns) {
      for (const item of ret.items ?? []) {
        map.set(item.bill_item_id, (map.get(item.bill_item_id) ?? 0) + item.boxes);
      }
    }
    return map;
  }, [detail]);

  // Items return calculations
  const returnSummary = useMemo(() => {
    if (!detail) {
      return {
        totalBoxes: 0,
        totalGoodsValue: 0,
        eligibleRefund: 0,
        duesReduction: 0,
        validItemsCount: 0,
      };
    }

    let totalBoxes = 0;
    let totalGoodsValue = 0;
    let validItemsCount = 0;

    for (const item of detail.items) {
      const qty = returnedBoxes[item.id] || 0;
      if (qty > 0) {
        totalBoxes += qty;
        totalGoodsValue += Math.round(qty * item.sell_rate * 100) / 100;
        validItemsCount += 1;
      }
    }

    totalGoodsValue = Math.round(totalGoodsValue * 100) / 100;

    // Financial check: active money currently held on this bill
    // Note: paymentAllocations with status === 'active' already exclude refunded allocations
    let activePaid = 0;
    for (const pa of detail.paymentAllocations) {
      if (pa.status === 'active') {
        activePaid += pa.amount;
      }
    }

    let prevReturnAmount = 0;
    for (const r of detail.returns ?? []) {
      prevReturnAmount += r.total_amount;
    }

    const newNetSubtotal = Math.max(
      0,
      Math.round((detail.bill.subtotal - (prevReturnAmount + totalGoodsValue)) * 100) / 100
    );

    // If active paid money exceeds the new net subtotal of the bill, surplus is eligible for cash/UPI refund:
    const eligibleRefund = Math.max(0, Math.round((activePaid - newNetSubtotal) * 100) / 100);
    const duesReduction = Math.max(
      0,
      Math.round((totalGoodsValue - eligibleRefund) * 100) / 100
    );

    return {
      totalBoxes,
      totalGoodsValue,
      eligibleRefund,
      duesReduction,
      validItemsCount,
    };
  }, [detail, returnedBoxes]);

  const handleBoxChange = (billItemId: string, maxAvailable: number, val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      setReturnedBoxes((prev) => {
        const next = { ...prev };
        delete next[billItemId];
        return next;
      });
      return;
    }
    const clamped = Math.min(Math.max(1, num), maxAvailable);
    setReturnedBoxes((prev) => ({
      ...prev,
      [billItemId]: clamped,
    }));
  };

  const handleConfirmSubmit = async () => {
    if (!detail) return;
    setSubmitError(null);

    const itemsPayload = Object.entries(returnedBoxes)
      .filter(([, boxes]) => boxes > 0)
      .map(([bill_item_id, boxes]) => ({
        bill_item_id,
        boxes,
      }));

    if (itemsPayload.length === 0) {
      setSubmitError('Enter at least one box to return.');
      return;
    }

    if (returnSummary.eligibleRefund > 0 && !refundMode) {
      setSubmitError('Select refund method: Cash or UPI.');
      return;
    }

    setProcessing(true);
    const idempotencyKey = `ret_${detail.bill.bill_id}_${Date.now()}`;

    try {
      const res = await processBillReturn({
        bill_id: detail.bill.bill_id,
        items: itemsPayload,
        refund_mode: returnSummary.eligibleRefund > 0 ? refundMode : null,
        refund_date: refundDate,
        reason: returnReason.trim() || null,
        idempotency_key: idempotencyKey,
      });

      setSuccessResult({
        result: res,
        billNo: detail.bill.bill_no,
      });
      onReturnSuccess?.(res, detail.bill.bill_no);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not process return.');
    } finally {
      setProcessing(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={
        successResult
          ? 'Return Processed Successfully'
          : detail
          ? `Return Goods — Bill ${detail.bill.bill_no}`
          : 'Process Bill Return / Refund'
      }
      subtitle={
        detail
          ? `${detail.bill.customer_name_snapshot} • ${formatDisplayDate(detail.bill.bill_date)}`
          : 'Find the original bill to process returned fruit boxes'
      }
      onClose={processing ? () => undefined : onClose}
    >
      {/* SUCCESS SCREEN */}
      {successResult ? (
        <div className="space-y-5 text-center py-4">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-10 w-10" />
          </div>

          <div>
            <h3 className="font-display text-2xl font-bold text-leaf-950">
              Return {successResult.result.return_no} Recorded
            </h3>
            <p className="mt-1 text-sm text-leaf-700">
              Original Bill: <strong>{successResult.billNo}</strong>
            </p>
          </div>

          <div className="rounded-xl border border-leaf-100 bg-cream-50 p-4 text-left text-sm space-y-2">
            <div className="flex justify-between font-semibold">
              <span className="text-leaf-700">Boxes Restored to Stock:</span>
              <span className="font-bold text-leaf-950">
                {successResult.result.returned_boxes} box(es)
              </span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-leaf-700">Returned Goods Value:</span>
              <span className="font-bold text-leaf-950">
                ₹{successResult.result.return_amount.toLocaleString('en-IN')}
              </span>
            </div>
            {successResult.result.refund_amount > 0 ? (
              <div className="flex justify-between font-bold text-mango-800 border-t border-leaf-200 pt-2">
                <span>Customer Refund Paid:</span>
                <span>
                  ₹{successResult.result.refund_amount.toLocaleString('en-IN')} via{' '}
                  {successResult.result.refund_mode?.toUpperCase()}
                </span>
              </div>
            ) : (
              <div className="flex justify-between font-semibold text-leaf-800 border-t border-leaf-200 pt-2">
                <span>Customer Balance Adjustment:</span>
                <span>Outstanding Dues Reduced</span>
              </div>
            )}
            {successResult.result.is_full_return && (
              <p className="text-xs font-bold text-amber-700 pt-1">
                Notice: All items on this bill were returned. The bill status was updated to cancelled.
              </p>
            )}
          </div>

          <Button variant="accent" size="lg" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : !selectedBillId ? (
        /* STEP 1: BILL SEARCH */
        <div className="space-y-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
              aria-hidden
            />
            <TextInput
              className="pl-11"
              placeholder="Search bill number or customer name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {loadingBills ? (
            <LoadingCard label="Finding active bills…" />
          ) : billsError ? (
            <AlertBanner tone="error" message={billsError} />
          ) : filteredBills.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-leaf-200 bg-cream-50 p-8 text-center text-sm text-leaf-600">
              No matching active bills found. Try typing a bill number or customer name.
            </div>
          ) : (
            <div className="divide-y divide-leaf-100 rounded-xl border border-leaf-100 bg-white overflow-hidden max-h-[380px] overflow-y-auto">
              {filteredBills.map((b) => (
                <button
                  key={b.bill_id}
                  type="button"
                  onClick={() => setSelectedBillId(b.bill_id)}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left transition-colors hover:bg-cream-100/80"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-leaf-950 text-sm">{b.bill_no}</span>
                      <Badge tone={statusTone(b.payment_status)}>{b.payment_status}</Badge>
                    </div>
                    <p className="text-xs font-semibold text-leaf-700 truncate">
                      {b.customer_name_snapshot} • {formatDisplayDate(b.bill_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-extrabold text-leaf-950 tabular-nums">
                      ₹{b.subtotal.toLocaleString('en-IN')}
                    </span>
                    <ChevronRight className="h-4 w-4 text-leaf-400" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : loadingDetail ? (
        <LoadingCard label="Loading bill items and stock allocations…" />
      ) : detailError ? (
        <div className="space-y-3">
          <AlertBanner tone="error" message={detailError} />
          <Button variant="secondary" onClick={() => setSelectedBillId(null)}>
            Back to Bill Search
          </Button>
        </div>
      ) : detail ? (
        /* STEP 2: RETURN ITEMS & RECONCILIATION */
        <div className="space-y-4">
          {!preselectedBillId && (
            <button
              type="button"
              onClick={() => setSelectedBillId(null)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-leaf-700 hover:text-leaf-950 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Choose Different Bill
            </button>
          )}

          {/* Original Bill Totals Mini Strip */}
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-cream-100 p-3 text-center text-xs">
            <div>
              <span className="text-stone-600 block">Bill Total</span>
              <span className="font-extrabold text-leaf-950 text-sm tabular-nums">
                ₹{detail.bill.subtotal.toLocaleString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-stone-600 block">Amount Paid</span>
              <span className="font-extrabold text-leaf-700 text-sm tabular-nums">
                ₹{detail.bill.amount_paid.toLocaleString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-stone-600 block">Balance Due</span>
              <span className="font-extrabold text-mango-700 text-sm tabular-nums">
                ₹{detail.bill.outstanding_amount.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Item Return Rows */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-leaf-800">
              Select Returned Fruit Items
            </h4>

            <div className="space-y-2">
              {detail.items.map((item) => {
                const prevReturned = previouslyReturnedMap.get(item.id) || 0;
                const remainingReturnable = Math.max(0, item.boxes - prevReturned);
                const currentEntered = returnedBoxes[item.id] || 0;
                const isFullyReturned = remainingReturnable === 0;

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3.5 transition-colors ${
                      currentEntered > 0
                        ? 'border-mango-400 bg-mango-50/40'
                        : isFullyReturned
                        ? 'border-stone-200 bg-stone-50 opacity-60'
                        : 'border-leaf-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-leaf-950 text-sm">
                          {item.fruit_name_snapshot} — {item.variety_name_snapshot}
                        </p>
                        <p className="text-xs text-stone-600 mt-0.5">
                          Sold: <strong>{item.boxes} bx</strong> @ ₹{item.sell_rate}/bx
                          {prevReturned > 0 && (
                            <span className="text-amber-700 font-semibold ml-1.5">
                              ({prevReturned} bx already returned)
                            </span>
                          )}
                        </p>
                      </div>

                      {/* Return box input */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isFullyReturned ? (
                          <span className="text-xs font-bold text-stone-500 py-1 px-2 bg-stone-100 rounded-lg">
                            Fully Returned
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-leaf-700">Return:</span>
                            <input
                              type="number"
                              min={0}
                              max={remainingReturnable}
                              value={currentEntered === 0 ? '' : currentEntered}
                              onChange={(e) =>
                                handleBoxChange(item.id, remainingReturnable, e.target.value)
                              }
                              placeholder="0"
                              className="w-16 rounded-lg border-2 border-leaf-300 px-2 py-1 text-center font-bold text-leaf-950 focus:border-mango-500 focus:outline-none text-sm"
                            />
                            <span className="text-xs font-semibold text-stone-500">
                              / {remainingReturnable}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {currentEntered > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-mango-200 flex justify-between items-center text-xs">
                        <span className="text-mango-900 font-semibold">
                          {currentEntered} box(es) × ₹{item.sell_rate}
                        </span>
                        <span className="font-extrabold text-mango-950 text-sm">
                          = ₹{(currentEntered * item.sell_rate).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Refund Method & Calculations Strip */}
          {returnSummary.validItemsCount > 0 && (
            <div className="rounded-xl border-2 border-mango-300 bg-mango-50/70 p-4 space-y-3">
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-mango-950">Total Return Goods Value:</span>
                <span className="text-base text-mango-950 font-black tabular-nums">
                  ₹{returnSummary.totalGoodsValue.toLocaleString('en-IN')} ({returnSummary.totalBoxes} bx)
                </span>
              </div>

              {/* Refund breakdown */}
              {returnSummary.eligibleRefund > 0 ? (
                <div className="space-y-2 border-t border-mango-200 pt-2 text-xs">
                  <div className="flex justify-between font-bold text-leaf-950">
                    <span>Cash / UPI Refund to Customer:</span>
                    <span className="text-sm font-black text-mango-800">
                      ₹{returnSummary.eligibleRefund.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {returnSummary.duesReduction > 0 && (
                    <div className="flex justify-between text-stone-600">
                      <span>Remaining Return Dues Credit:</span>
                      <span className="font-bold">
                        ₹{returnSummary.duesReduction.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}

                  {/* Payment Mode Selector */}
                  <div className="pt-2">
                    <span className="block font-bold text-leaf-900 mb-1.5">
                      Select Customer Refund Mode:
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRefundMode('cash')}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border-2 py-2 px-3 text-xs font-bold transition-colors ${
                          refundMode === 'cash'
                            ? 'border-leaf-600 bg-white text-leaf-900 shadow-sm'
                            : 'border-leaf-200 bg-cream-50 text-stone-600 hover:border-leaf-400'
                        }`}
                      >
                        <IndianRupee className="h-3.5 w-3.5 text-leaf-600" /> Cash Refund
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundMode('upi')}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border-2 py-2 px-3 text-xs font-bold transition-colors ${
                          refundMode === 'upi'
                            ? 'border-mango-500 bg-white text-mango-950 shadow-sm'
                            : 'border-leaf-200 bg-cream-50 text-stone-600 hover:border-mango-400'
                        }`}
                      >
                        <Smartphone className="h-3.5 w-3.5 text-mango-600" /> UPI Refund
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-mango-200 pt-2 text-xs text-leaf-800 space-y-1">
                  <p className="font-semibold text-leaf-950">
                    Credit Customer Account (No Cash Payout):
                  </p>
                  <p className="text-stone-600">
                    This bill had an unpaid balance. Returning these boxes reduces customer&apos;s
                    outstanding dues by ₹{returnSummary.duesReduction.toLocaleString('en-IN')}.
                  </p>
                </div>
              )}

              {/* Optional reason */}
              <div className="pt-1">
                <TextInput
                  placeholder="Reason for return (e.g. Over-ordered, quality return)"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          )}

          {submitError && <AlertBanner tone="error" message={submitError} />}

          {/* Action confirmation dialog */}
          {showConfirm ? (
            <div className="rounded-xl border-2 border-red-300 bg-red-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-950 font-bold text-sm">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <span>Confirm Bill Return &amp; Stock Restoration</span>
              </div>
              <p className="text-xs text-red-900 leading-relaxed">
                You are returning <strong>{returnSummary.totalBoxes} box(es)</strong> for{' '}
                <strong>₹{returnSummary.totalGoodsValue.toLocaleString('en-IN')}</strong>. Stock
                will be restored to the original delivery batch immediately.
                {returnSummary.eligibleRefund > 0
                  ? ` Customer will be refunded ₹${returnSummary.eligibleRefund.toLocaleString('en-IN')} via ${refundMode?.toUpperCase()}.`
                  : ' Customer balance will be credited.'}
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowConfirm(false)}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => void handleConfirmSubmit()}
                  disabled={processing}
                  icon={processing ? Loader2 : RotateCcw}
                >
                  {processing ? 'Processing Return…' : 'Confirm & Save Return'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={processing}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="accent"
                icon={RotateCcw}
                disabled={returnSummary.validItemsCount === 0 || processing}
                onClick={() => setShowConfirm(true)}
              >
                Review &amp; Confirm Return ({returnSummary.totalBoxes} bx)
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Boxes,
  MessageCircle,
  Printer,
  RotateCcw,
  Truck,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  FieldWrap,
  LoadingCard,
  Modal,
  TextInput,
} from '@/components/ui';
import { PrintableBillModal } from '@/components/sales/PrintableBillModal';
import { WhatsAppShareModal } from '@/components/sales/WhatsAppShareModal';
import { BillReturnModal } from '@/components/sales/BillReturnModal';
import { formatDisplayDate } from '@/services/inventory';
import { cancelBill, getBillDetail } from '@/services/sales';
import type { BillDetail, PaymentMode, PaymentStatus } from '@/types/database';

interface BillDetailModalProps {
  billId: string | null;
  onClose: () => void;
  onCancelled: (billNo: string) => void;
}

function statusTone(status: PaymentStatus): 'green' | 'orange' | 'red' | 'neutral' {
  if (status === 'paid') return 'green';
  if (status === 'partial') return 'orange';
  if (status === 'unpaid') return 'red';
  return 'neutral';
}

function statusLabel(status: PaymentStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'unpaid') return 'Unpaid';
  return 'Cancelled';
}

export function BillDetailModal({ billId, onClose, onCancelled }: BillDetailModalProps) {
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRefundMode, setCancelRefundMode] = useState<PaymentMode>('cash');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const isClosingNestedRef = useRef(false);
  const nestedCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const activePaid = useMemo(() => {
    if (!detail) return 0;
    return detail.paymentAllocations
      .filter((pa) => pa.status === 'active')
      .reduce((sum, pa) => sum + pa.amount, 0);
  }, [detail]);

  const hasReturns = useMemo(() => {
    return Boolean(detail?.returns && detail.returns.length > 0);
  }, [detail]);

  const handleExecuteCancel = async () => {
    if (!detail) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelBill({
        bill_id: detail.bill.bill_id,
        reason: cancelReason.trim() || null,
        refund_mode: activePaid > 0 ? cancelRefundMode : null,
        refund_date: null,
        refund_note: null,
      });
      setShowCancelConfirm(false);
      onCancelled(detail.bill.bill_no);
      await loadDetail(detail.bill.bill_id);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Could not cancel bill.');
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    return () => {
      if (nestedCloseTimerRef.current) clearTimeout(nestedCloseTimerRef.current);
    };
  }, []);

  const handleClosePrint = useCallback(() => {
    setShowPrint(false);
    isClosingNestedRef.current = true;
    if (nestedCloseTimerRef.current) clearTimeout(nestedCloseTimerRef.current);
    nestedCloseTimerRef.current = setTimeout(() => {
      isClosingNestedRef.current = false;
    }, 400);
  }, []);

  const handleCloseWhatsApp = useCallback(() => {
    setShowWhatsApp(false);
    isClosingNestedRef.current = true;
    if (nestedCloseTimerRef.current) clearTimeout(nestedCloseTimerRef.current);
    nestedCloseTimerRef.current = setTimeout(() => {
      isClosingNestedRef.current = false;
    }, 400);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBillDetail(id);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bill details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!billId) {
      setDetail(null);
      setShowReturnModal(false);
      setShowPrint(false);
      setShowWhatsApp(false);
      setShowCancelConfirm(false);
      setCancelReason('');
      setCancelError(null);
      return;
    }
    setShowReturnModal(false);
    setShowPrint(false);
    setShowWhatsApp(false);
    setShowCancelConfirm(false);
    setCancelReason('');
    setCancelError(null);
    void loadDetail(billId);
  }, [billId, loadDetail]);

  return (
    <Modal
      open={Boolean(billId)}
      title={detail ? `Bill ${detail.bill.bill_no}` : 'Bill Details'}
      subtitle={
        detail
          ? `${detail.bill.customer_name_snapshot} • ${formatDisplayDate(detail.bill.bill_date)}`
          : undefined
      }
      onClose={onClose}
    >
      {loading ? (
        <LoadingCard label="Loading bill details…" />
      ) : error ? (
        <AlertBanner
          tone="error"
          message={error}
          onRetry={billId ? () => void loadDetail(billId) : undefined}
        />
      ) : detail ? (
        <div className="space-y-5">
          {/* Bill Header Totals */}
          <div className="rounded-xl bg-cream-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={statusTone(detail.bill.payment_status)}>
                {statusLabel(detail.bill.payment_status)}
              </Badge>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="!bg-[#25D366] hover:!bg-[#1EBE5D] text-white border-0 shadow-sm"
                  icon={MessageCircle}
                  onClick={() => {
                    if (!isClosingNestedRef.current) setShowWhatsApp(true);
                  }}
                >
                  Share on WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Printer}
                  onClick={() => {
                    if (!isClosingNestedRef.current) setShowPrint(true);
                  }}
                >
                  Print Receipt
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-bold uppercase text-leaf-600">Total</p>
                <p className="tabular-nums mt-0.5 text-lg font-extrabold text-leaf-950">
                  ₹{detail.bill.subtotal.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-bold uppercase text-leaf-600">Paid</p>
                <p className="tabular-nums mt-0.5 text-lg font-extrabold text-leaf-700">
                  ₹{detail.bill.amount_paid.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-bold uppercase text-leaf-600">Due</p>
                <p
                  className={`tabular-nums mt-0.5 text-lg font-extrabold ${
                    detail.bill.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
                  }`}
                >
                  ₹{detail.bill.outstanding_amount.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {detail.bill.note && (
              <p className="mt-3 text-sm text-leaf-700">
                <span className="font-bold text-leaf-900">Note:</span> {detail.bill.note}
              </p>
            )}
          </div>

          {/* Cancellation audit notice */}
          {detail.bill.status === 'cancelled' && (
            <AlertBanner
              tone="error"
              message={`Cancelled${detail.bill.cancelled_at ? ` on ${new Date(detail.bill.cancelled_at).toLocaleString('en-IN')}` : ''}${detail.bill.cancel_reason ? ` — ${detail.bill.cancel_reason}` : ''}. Stock boxes were restored to their original batches.`}
            />
          )}

          {/* Items & Batch Allocations */}
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-leaf-700">
              Items
            </h3>
            <div className="mt-2 space-y-3">
              {detail.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-leaf-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-leaf-950">
                        {item.line_no}. {item.fruit_name_snapshot} — {item.variety_name_snapshot}
                      </p>
                      <p className="tabular-nums text-sm font-semibold text-leaf-600">
                        {item.boxes} {item.boxes === 1 ? 'box' : 'boxes'} × ₹
                        {item.sell_rate.toLocaleString('en-IN')}/box
                      </p>
                    </div>
                    <p className="tabular-nums text-lg font-extrabold text-leaf-950">
                      ₹{item.line_total.toLocaleString('en-IN')}
                    </p>
                  </div>

                  {item.allocations.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-leaf-100 pt-2.5 text-xs">
                      {item.allocations.map((alloc) => (
                        <li
                          key={alloc.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream-50 px-3 py-1.5 text-leaf-800"
                        >
                          <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
                            <Boxes className="h-3.5 w-3.5 text-leaf-600" aria-hidden />
                            <span className="font-bold">{alloc.delivery_no}</span>
                            <span>•</span>
                            <Truck className="h-3.5 w-3.5 text-leaf-500" aria-hidden />
                            <span>{alloc.supplier_name}</span>
                            {alloc.received_date && (
                              <span className="text-leaf-600">
                                ({formatDisplayDate(alloc.received_date)})
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums font-bold text-leaf-950">
                            {alloc.boxes} {alloc.boxes === 1 ? 'box' : 'boxes'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Payment Allocations Audit Trail */}
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-leaf-700">
              Payments
            </h3>
            {detail.paymentAllocations.length === 0 ? (
              <p className="mt-2 rounded-xl bg-cream-50 px-4 py-3 text-sm text-leaf-600">
                No payments recorded yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {detail.paymentAllocations.map((pa) => (
                  <li
                    key={pa.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-leaf-100 bg-white px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold uppercase text-leaf-950">{pa.mode}</span>
                        <Badge
                          tone={
                            pa.status === 'active'
                              ? 'green'
                              : pa.status === 'refunded'
                                ? 'orange'
                                : 'neutral'
                          }
                        >
                          {pa.status === 'active'
                            ? 'Active'
                            : pa.status === 'refunded'
                              ? 'Refunded'
                              : 'Cancelled'}
                        </Badge>
                        <span className="text-xs font-semibold text-leaf-600">
                          {pa.payment_origin === 'bill_sale' ? 'At sale' : 'Collection'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-leaf-600">
                        {pa.payment_date ? formatDisplayDate(pa.payment_date) : ''}
                        {pa.payment_note ? ` • ${pa.payment_note}` : ''}
                      </p>
                    </div>
                    <span className="tabular-nums text-base font-extrabold text-leaf-950">
                      ₹{pa.amount.toLocaleString('en-IN')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Refund Record (if issued) */}
          {detail.refund && (
            <div className="rounded-xl border-2 border-mango-200 bg-mango-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-extrabold uppercase tracking-wide text-mango-900">
                  Customer Refund Recorded
                </p>
                <Badge tone="orange">{detail.refund.mode.toUpperCase()}</Badge>
              </div>
              <p className="tabular-nums mt-1 text-lg font-extrabold text-mango-950">
                ₹{detail.refund.amount.toLocaleString('en-IN')} refunded on{' '}
                {formatDisplayDate(detail.refund.refund_date)}
              </p>
              {detail.refund.note && (
                <p className="mt-1 text-sm text-mango-800">{detail.refund.note}</p>
              )}
            </div>
          )}

          {/* Return History (if returns have been recorded) */}
          {detail.returns && detail.returns.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-leaf-700">
                Returns &amp; Restocked Items
              </h3>
              <div className="space-y-2.5">
                {detail.returns.map((ret) => (
                  <div
                    key={ret.id}
                    className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 text-xs text-leaf-900 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                      <span className="text-amber-900">{ret.return_no}</span>
                      <span className="text-stone-600">
                        {formatDisplayDate(ret.return_date)}
                      </span>
                    </div>

                    <div className="flex justify-between font-semibold">
                      <span>Restored to stock:</span>
                      <span className="font-extrabold">{ret.total_boxes} box(es)</span>
                    </div>

                    {ret.refund_amount > 0 && (
                      <div className="flex justify-between font-bold text-mango-800">
                        <span>Refunded to customer:</span>
                        <span>
                          ₹{ret.refund_amount.toLocaleString('en-IN')}{' '}
                          {ret.refund_mode ? `(${ret.refund_mode.toUpperCase()})` : ''}
                        </span>
                      </div>
                    )}

                    {ret.reason && (
                      <p className="text-stone-600 italic">Reason: {ret.reason}</p>
                    )}

                    {ret.items && ret.items.length > 0 && (
                      <div className="border-t border-amber-200/80 pt-2 space-y-1">
                        {ret.items.map((i) => (
                          <div key={i.id} className="flex justify-between text-stone-700">
                            <span>
                              {i.fruit_name_snapshot} — {i.variety_name_snapshot} ({i.boxes} bx)
                            </span>
                            <span className="font-bold">
                              ₹{i.line_total.toLocaleString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions: Return / Refund AND Cancel Bill (Preserved together) */}
          {detail.bill.status === 'active' && (
            <div className="border-t border-leaf-100 pt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. Return / Refund Action */}
                <div className="rounded-xl border border-mango-200 bg-mango-50/50 p-3.5 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-mango-950 text-sm">
                      <RotateCcw className="h-4 w-4 text-mango-600" />
                      <span>Return / Refund</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-600">
                      Process returned fruit boxes, refund cash/UPI, and restore inventory to stock.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={RotateCcw}
                    onClick={() => setShowReturnModal(true)}
                    className="!border-mango-400 !text-mango-900 hover:!bg-mango-100 font-bold self-start"
                  >
                    Process Return
                  </Button>
                </div>

                {/* 2. Cancel Bill Action */}
                <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-red-950 text-sm">
                      <Ban className="h-4 w-4 text-red-600" />
                      <span>Cancel Entire Bill</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-600">
                      {hasReturns
                        ? 'Cannot cancel bill with recorded returns. Use Return / Refund instead.'
                        : 'Cancel an erroneously created bill. Restores all stock and reverses payments.'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Ban}
                    disabled={hasReturns}
                    onClick={() => {
                      setCancelError(null);
                      setShowCancelConfirm(true);
                    }}
                    className="!border-red-300 !text-red-700 hover:!bg-red-50 font-bold self-start"
                  >
                    Cancel Bill
                  </Button>
                </div>
              </div>

              {/* Inline Cancel Confirmation Card */}
              {showCancelConfirm && (
                <div className="rounded-xl border-2 border-red-300 bg-red-50/80 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-extrabold text-red-950">
                        Confirm Complete Bill Cancellation
                      </p>
                      <p className="text-xs text-red-800 mt-0.5">
                        This will cancel {detail.bill.bill_no}, restore all original stock boxes to their inward deliveries, and permanently cancel the bill.
                      </p>
                    </div>
                  </div>

                  {activePaid > 0 && (
                    <div className="rounded-lg bg-white p-3 border border-red-200 space-y-2">
                      <p className="text-xs font-bold text-leaf-900">
                        ₹{activePaid.toLocaleString('en-IN')} was collected on this bill. Choose customer refund payout method:
                      </p>
                      <div className="flex gap-4 text-xs font-bold text-leaf-900">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="cancelRefundMode"
                            value="cash"
                            checked={cancelRefundMode === 'cash'}
                            onChange={() => setCancelRefundMode('cash')}
                            className="text-mango-600 focus:ring-mango-500"
                          />
                          <span>Cash Payout</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="cancelRefundMode"
                            value="upi"
                            checked={cancelRefundMode === 'upi'}
                            onChange={() => setCancelRefundMode('upi')}
                            className="text-mango-600 focus:ring-mango-500"
                          />
                          <span>UPI Payout</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <FieldWrap label="Reason for cancellation (optional)">
                    <TextInput
                      placeholder="e.g. Mistaken bill entry / wrong customer selected"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      maxLength={200}
                    />
                  </FieldWrap>

                  {cancelError && (
                    <AlertBanner tone="error" message={cancelError} />
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowCancelConfirm(false)}
                      disabled={cancelling}
                    >
                      Keep Bill
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleExecuteCancel()}
                      disabled={cancelling}
                      className="!bg-red-600 hover:!bg-red-700 text-white border-0"
                    >
                      {cancelling ? 'Cancelling Bill…' : 'Yes, Confirm Cancellation'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {showReturnModal && detail && (
        <BillReturnModal
          open={showReturnModal}
          preselectedBillId={detail.bill.bill_id}
          onClose={() => setShowReturnModal(false)}
          onReturnSuccess={() => {
            void loadDetail(detail.bill.bill_id);
            onCancelled(detail.bill.bill_no);
          }}
        />
      )}

      {showPrint && detail && (
        <PrintableBillModal
          billId={detail.bill.bill_id}
          initialBillDetail={detail}
          onClose={handleClosePrint}
        />
      )}

      {showWhatsApp && detail && (
        <WhatsAppShareModal
          open={showWhatsApp}
          billId={detail.bill.bill_id}
          initialBillDetail={detail}
          onClose={handleCloseWhatsApp}
        />
      )}
    </Modal>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Boxes,
  IndianRupee,
  Loader2,
  MessageCircle,
  Printer,
  Smartphone,
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
import { formatDisplayDate, getLocalIsoDate } from '@/services/inventory';
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

  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundMode, setRefundMode] = useState<PaymentMode | null>(null);
  const [refundDate, setRefundDate] = useState(() => getLocalIsoDate());
  const [refundNote, setRefundNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);

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
      setShowCancelForm(false);
      setCancelError(null);
      return;
    }
    setShowCancelForm(false);
    setCancelReason('');
    setRefundMode(null);
    setRefundDate(getLocalIsoDate());
    setRefundNote('');
    setCancelError(null);
    void loadDetail(billId);
  }, [billId, loadDetail]);

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setCancelError(null);

    const needsRefund = detail.bill.amount_paid > 0;
    if (needsRefund && !refundMode) {
      setCancelError(
        `Select Cash or UPI refund mode to record the ₹${detail.bill.amount_paid.toLocaleString('en-IN')} refund.`
      );
      return;
    }

    setCancelling(true);
    try {
      await cancelBill({
        bill_id: detail.bill.bill_id,
        reason: cancelReason.trim() || null,
        refund_mode: needsRefund ? refundMode : null,
        refund_date: needsRefund ? refundDate : null,
        refund_note: needsRefund ? refundNote.trim() || null : null,
      });
      onCancelled(detail.bill.bill_no);
      onClose();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Could not cancel bill.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Modal
      open={Boolean(billId)}
      title={detail ? `Bill ${detail.bill.bill_no}` : 'Bill Details'}
      subtitle={
        detail
          ? `${detail.bill.customer_name_snapshot} • ${formatDisplayDate(detail.bill.bill_date)}`
          : undefined
      }
      onClose={cancelling ? () => undefined : onClose}
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
                  onClick={() => setShowWhatsApp(true)}
                >
                  Share on WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Printer}
                  onClick={() => setShowPrint(true)}
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

          {/* Cancel Bill Action (Audit-Preserving) */}
          {detail.bill.status === 'active' && (
            <div className="border-t border-leaf-100 pt-4">
              {!showCancelForm ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-leaf-600">
                    Cancel this bill and restore its stock allocations.
                  </p>
                  <Button
                    variant="secondary"
                    icon={Ban}
                    onClick={() => setShowCancelForm(true)}
                  >
                    Cancel Bill
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleConfirmCancel} className="space-y-4 rounded-xl border-2 border-red-200 bg-red-50/50 p-4">
                  <p className="text-base font-extrabold text-red-900">
                    Confirm Bill Cancellation ({detail.bill.bill_no})
                  </p>

                  {cancelError && <AlertBanner tone="error" message={cancelError} />}

                  {detail.bill.amount_paid > 0 ? (
                    <div className="space-y-3 rounded-xl bg-white p-3.5 text-sm text-leaf-800">
                      <p className="font-semibold">
                        <span className="font-extrabold text-leaf-950">
                          ₹{detail.bill.amount_paid.toLocaleString('en-IN')}
                        </span>{' '}
                        received on this bill. Select how you refunded the customer:
                      </p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setRefundMode('cash')}
                          aria-pressed={refundMode === 'cash'}
                          disabled={cancelling}
                          className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 font-bold transition-colors ${
                            refundMode === 'cash'
                              ? 'border-leaf-600 bg-leaf-50 text-leaf-800'
                              : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                          }`}
                        >
                          <IndianRupee className="h-4 w-4" aria-hidden /> Cash Refund
                        </button>
                        <button
                          type="button"
                          onClick={() => setRefundMode('upi')}
                          aria-pressed={refundMode === 'upi'}
                          disabled={cancelling}
                          className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 font-bold transition-colors ${
                            refundMode === 'upi'
                              ? 'border-leaf-600 bg-leaf-50 text-leaf-800'
                              : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                          }`}
                        >
                          <Smartphone className="h-4 w-4" aria-hidden /> UPI Refund
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FieldWrap label="Refund date">
                          <TextInput
                            type="date"
                            value={refundDate}
                            onChange={(e) => setRefundDate(e.target.value)}
                            disabled={cancelling}
                          />
                        </FieldWrap>
                        <label className="block">
                          <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                            <span>Refund Note</span>
                            <span className="text-xs font-semibold text-leaf-500">Optional</span>
                          </span>
                          <TextInput
                            placeholder="UPI ref or cash note"
                            value={refundNote}
                            onChange={(e) => setRefundNote(e.target.value)}
                            disabled={cancelling}
                          />
                        </label>
                      </div>
                      {!detail.bill.is_cash_customer && (
                        <p className="text-xs text-leaf-600">
                          Tip: If no money actually changed hands (mistaken payment entry), cancel
                          the payment first under Customers → Payments &amp; Refunds before
                          cancelling this bill.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-red-800">
                      No payment received on this bill. Allocated boxes will be restored to stock.
                    </p>
                  )}

                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                      <span>Cancellation Reason</span>
                      <span className="text-xs font-semibold text-leaf-500">Optional</span>
                    </span>
                    <TextInput
                      placeholder="Reason for cancellation"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      disabled={cancelling}
                    />
                  </label>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowCancelForm(false);
                        setCancelError(null);
                      }}
                      disabled={cancelling}
                    >
                      Keep Bill Active
                    </Button>
                    <Button
                      type="submit"
                      variant="accent"
                      icon={cancelling ? Loader2 : Ban}
                      disabled={cancelling}
                    >
                      {cancelling
                        ? 'Cancelling…'
                        : detail.bill.amount_paid > 0
                          ? 'Cancel Bill & Record Refund'
                          : 'Confirm Cancel Bill'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      ) : null}

      {showPrint && detail && (
        <PrintableBillModal
          billId={detail.bill.bill_id}
          initialBillDetail={detail}
          onClose={() => setShowPrint(false)}
        />
      )}

      {showWhatsApp && detail && (
        <WhatsAppShareModal
          open={showWhatsApp}
          billId={detail.bill.bill_id}
          initialBillDetail={detail}
          onClose={() => setShowWhatsApp(false)}
        />
      )}
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Boxes,
  Calendar,
  IndianRupee,
  Loader2,
  Phone,
  RotateCcw,
  Scale,
  Smartphone,
  Truck,
  Pencil,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  FieldWrap,
  LoadingCard,
  TextInput,
} from '@/components/ui';
import { EditDeliveryModal } from '@/components/inventory/EditDeliveryModal';
import { OpeningBalanceModal } from './OpeningBalanceModal';
import { ReallocateAllocationModal } from './ReallocateAllocationModal';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';
import {
  cancelStockDelivery,
  cancelSupplierOpeningBalance,
  cancelSupplierPayment,
  getSupplierAccountDetail,
  setSupplierOpeningBalance,
} from '@/services/accounts';
import { useCacheInvalidation } from '@/services/cache';
import { formatDisplayDate, getLocalIsoDate } from '@/services/inventory';
import type {
  DeliveryBalance,
  PaymentMode,
  PaymentStatus,
  SupplierAccountDetail,
  SupplierPaymentAllocationItem,
} from '@/types/database';

interface SupplierAccountViewProps {
  supplierId: string;
  onBack: () => void;
  onDataChanged?: () => void;
  isActive?: boolean;
}

type AccountTab = 'ledger' | 'deliveries' | 'payments' | 'opening';

interface LedgerRow {
  id: string;
  date: string;
  createdAt: string;
  kind: 'opening_balance' | 'delivery' | 'payment' | 'refund';
  title: string;
  subtitle: string;
  amount: number;
  statusLabel: string;
  statusTone: 'green' | 'orange' | 'red' | 'neutral';
  direction: 'payable' | 'paid' | 'refund';
  cancelled: boolean;
  note: string | null;
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

function allocationStatusBadge(
  status: SupplierPaymentAllocationItem['status']
): { label: string; tone: 'green' | 'orange' | 'red' | 'neutral' } {
  if (status === 'active') return { label: 'Active', tone: 'green' };
  if (status === 'reallocated') return { label: 'Reallocated', tone: 'neutral' };
  if (status === 'refunded') return { label: 'Refunded', tone: 'orange' };
  return { label: 'Cancelled', tone: 'red' };
}

export function SupplierAccountView({
  supplierId,
  onBack,
  onDataChanged,
  isActive = true,
}: SupplierAccountViewProps) {
  const [detail, setDetail] = useState<SupplierAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountTab>('ledger');

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [openingModalOpen, setOpeningModalOpen] = useState(false);
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [reallocatingAllocation, setReallocatingAllocation] =
    useState<SupplierPaymentAllocationItem | null>(null);

  // Inline cancel payment state
  const [cancellingPaymentId, setCancellingPaymentId] = useState<string | null>(null);
  const [cancelPaymentReason, setCancelPaymentReason] = useState('');
  const [submittingCancelPayment, setSubmittingCancelPayment] = useState(false);

  // Inline cancel delivery state
  const [cancellingDeliveryId, setCancellingDeliveryId] = useState<string | null>(null);
  const [cancelDeliveryReason, setCancelDeliveryReason] = useState('');
  const [deliveryRefundMode, setDeliveryRefundMode] = useState<PaymentMode | null>(null);
  const [deliveryRefundDate, setDeliveryRefundDate] = useState(() => getLocalIsoDate());
  const [deliveryRefundNote, setDeliveryRefundNote] = useState('');
  const [submittingCancelDelivery, setSubmittingCancelDelivery] = useState(false);

  // Inline cancel opening balance state
  const [showCancelOpening, setShowCancelOpening] = useState(false);
  const [cancelOpeningReason, setCancelOpeningReason] = useState('');
  const [submittingCancelOpening, setSubmittingCancelOpening] = useState(false);

  const loadAccount = useCallback(async (isBackground = false, forceRefresh = false) => {
    if (!isBackground) setLoading(true);
    setLoadError(null);
    try {
      const data = await getSupplierAccountDetail(supplierId, { forceRefresh });
      setDetail(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load supplier account.');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useCacheInvalidation(['supplier_ledger', `supplier_ledger:${supplierId}`], () => void loadAccount(true), { isActive });

  const unpaidDeliveries = useMemo(
    () =>
      detail
        ? detail.deliveries.filter((d) => d.status === 'active' && d.outstanding_amount > 0)
        : [],
    [detail]
  );

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    if (!detail) return [];
    const rows: LedgerRow[] = [];

    for (const ob of detail.openingBalances) {
      rows.push({
        id: `ob:${ob.id}`,
        date: ob.as_of_date,
        createdAt: ob.created_at,
        kind: 'opening_balance',
        title: 'Opening Balance',
        subtitle: ob.cancel_reason
          ? `Cancelled: ${ob.cancel_reason}`
          : 'Starting balance you owed supplier',
        amount: ob.amount,
        statusLabel: ob.status === 'active' ? 'Active' : 'Cancelled',
        statusTone: ob.status === 'active' ? 'orange' : 'neutral',
        direction: 'payable',
        cancelled: ob.status === 'cancelled',
        note: ob.note,
      });
    }

    for (const d of detail.deliveries) {
      rows.push({
        id: `del:${d.delivery_id}`,
        date: d.received_date,
        createdAt: d.created_at,
        kind: 'delivery',
        title: d.delivery_no,
        subtitle:
          d.status === 'cancelled'
            ? `Cancelled delivery${d.cancel_reason ? `: ${d.cancel_reason}` : ''}`
            : `${d.boxes_received} boxes of ${d.fruit_name} • ${paymentStatusLabel(d.payment_status)}`,
        amount: d.purchase_amount,
        statusLabel: d.status === 'cancelled' ? 'Cancelled' : paymentStatusLabel(d.payment_status),
        statusTone: d.status === 'cancelled' ? 'neutral' : paymentStatusTone(d.payment_status),
        direction: 'payable',
        cancelled: d.status === 'cancelled',
        note: d.note,
      });
    }

    for (const p of detail.payments) {
      rows.push({
        id: `pay:${p.id}`,
        date: p.payment_date,
        createdAt: p.created_at,
        kind: 'payment',
        title: `${p.mode.toUpperCase()} Supplier Payment`,
        subtitle:
          p.status === 'cancelled'
            ? `Cancelled payment${p.cancel_reason ? `: ${p.cancel_reason}` : ''}`
            : `Paid to supplier via ${p.mode.toUpperCase()}`,
        amount: p.amount,
        statusLabel: p.status === 'active' ? 'Paid' : 'Cancelled',
        statusTone: p.status === 'active' ? 'green' : 'neutral',
        direction: 'paid',
        cancelled: p.status === 'cancelled',
        note: p.note,
      });
    }

    for (const ref of detail.refunds) {
      rows.push({
        id: `ref:${ref.id}`,
        date: ref.refund_date,
        createdAt: ref.created_at,
        kind: 'refund',
        title: `Refund for ${ref.delivery_no}`,
        subtitle: `Supplier returned money via ${ref.mode.toUpperCase()} on delivery cancellation`,
        amount: ref.amount,
        statusLabel: 'Refund Received',
        statusTone: 'orange',
        direction: 'refund',
        cancelled: false,
        note: ref.note,
      });
    }

    rows.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return rows;
  }, [detail]);

  const handlePaymentSaved = ({ amount, mode }: { amount: number; mode: PaymentMode }) => {
    setActionError(null);
    setNotice(
      `Recorded ₹${amount.toLocaleString('en-IN')} ${mode.toUpperCase()} payment to supplier.`
    );
    void loadAccount();
    onDataChanged?.();
  };

  const handleSetOpeningBalance = async (values: {
    amount: number;
    asOfDate: string;
    note: string | null;
  }) => {
    setActionError(null);
    await setSupplierOpeningBalance(supplierId, values.amount, values.asOfDate, values.note);
    setNotice(`Set supplier opening balance of ₹${values.amount.toLocaleString('en-IN')}.`);
    await loadAccount();
    onDataChanged?.();
  };

  const handleReallocated = () => {
    setActionError(null);
    setNotice('Payment allocation reallocated cleanly. Delivery dues updated.');
    void loadAccount();
    onDataChanged?.();
  };

  const handleCancelPayment = async (paymentId: string) => {
    setActionError(null);
    setNotice(null);
    setSubmittingCancelPayment(true);
    try {
      await cancelSupplierPayment(paymentId, cancelPaymentReason.trim() || null);
      setCancellingPaymentId(null);
      setCancelPaymentReason('');
      setNotice('Supplier payment cancelled. Audit history preserved and delivery dues restored.');
      await loadAccount();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel supplier payment.');
    } finally {
      setSubmittingCancelPayment(false);
    }
  };

  const openCancelDelivery = (del: DeliveryBalance) => {
    setCancellingDeliveryId(del.delivery_id);
    setCancelDeliveryReason('');
    setDeliveryRefundMode(null);
    setDeliveryRefundDate(getLocalIsoDate());
    setDeliveryRefundNote('');
    setActionError(null);
  };

  const handleCancelDelivery = async (del: DeliveryBalance) => {
    setActionError(null);
    setNotice(null);

    const needsRefund = del.amount_paid > 0;
    if (needsRefund && !deliveryRefundMode) {
      setActionError(
        `Select Cash or UPI refund mode to record the ₹${del.amount_paid.toLocaleString('en-IN')} supplier refund, or reallocate those payments first.`
      );
      return;
    }

    setSubmittingCancelDelivery(true);
    try {
      await cancelStockDelivery({
        delivery_id: del.delivery_id,
        reason: cancelDeliveryReason.trim() || null,
        refund_mode: needsRefund ? deliveryRefundMode : null,
        refund_date: needsRefund ? deliveryRefundDate : null,
        refund_note: needsRefund ? deliveryRefundNote.trim() || null : null,
      });
      setCancellingDeliveryId(null);
      setNotice(
        needsRefund
          ? `Cancelled delivery ${del.delivery_no} and recorded ₹${del.amount_paid.toLocaleString('en-IN')} ${deliveryRefundMode?.toUpperCase()} refund.`
          : `Cancelled delivery ${del.delivery_no}. Unsold stock removed and supplier balance updated.`
      );
      await loadAccount();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel delivery.');
    } finally {
      setSubmittingCancelDelivery(false);
    }
  };

  const handleCancelOpeningBalance = async (openingBalanceId: string) => {
    setActionError(null);
    setNotice(null);
    setSubmittingCancelOpening(true);
    try {
      await cancelSupplierOpeningBalance(openingBalanceId, cancelOpeningReason.trim() || null);
      setShowCancelOpening(false);
      setCancelOpeningReason('');
      setNotice('Supplier opening balance cancelled. Audit history preserved.');
      await loadAccount();
      onDataChanged?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not cancel supplier opening balance.'
      );
    } finally {
      setSubmittingCancelOpening(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="space-y-6">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Suppliers
        </Button>
        <LoadingCard label="Loading supplier account…" />
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <div className="space-y-6">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Suppliers
        </Button>
        <AlertBanner tone="error" message={loadError} onRetry={() => void loadAccount()} />
      </div>
    );
  }

  if (!detail) return null;

  const { balance, openingBalances, deliveries, payments, refunds } = detail;
  const activeOpening = openingBalances.find((o) => o.status === 'active') ?? null;
  const cancelledOpenings = openingBalances.filter((o) => o.status === 'cancelled');

  const tabs: { id: AccountTab; label: string; count?: number }[] = [
    { id: 'ledger', label: 'Ledger', count: ledgerRows.length },
    { id: 'deliveries', label: 'Deliveries', count: deliveries.length },
    { id: 'payments', label: 'Payments & Refunds', count: payments.length + refunds.length },
    { id: 'opening', label: 'Opening Balance' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Suppliers
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {balance.active && !balance.opening_balance_id && (
            <Button
              variant="secondary"
              size="lg"
              icon={Scale}
              onClick={() => setOpeningModalOpen(true)}
            >
              Set Opening Balance
            </Button>
          )}
          <Button
            size="lg"
            icon={IndianRupee}
            disabled={balance.outstanding_balance <= 0}
            onClick={() => setPaymentModalOpen(true)}
          >
            Record Payment
          </Button>
        </div>
      </div>

      {/* Supplier Profile Card */}
      <Card className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-leaf-950">
                {balance.name}
              </h1>
              {balance.fruit_name ? (
                balance.fruit_name.split(', ').map((fname) => (
                  <Badge key={fname} tone="orange">
                    {fname}
                  </Badge>
                ))
              ) : (
                <Badge tone="neutral">No fruit linked</Badge>
              )}
              <Badge tone={balance.active ? 'green' : 'neutral'}>
                {balance.active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="inline-flex items-center gap-1.5 text-base font-semibold text-leaf-700">
              <Phone className="h-4 w-4 text-leaf-500" aria-hidden />
              {balance.phone || 'No phone number saved'}
            </p>
          </div>

          <div className="rounded-2xl bg-cream-100 p-4 sm:p-5 text-right">
            <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-leaf-600">
              Current Balance Payable
            </p>
            <p
              className={`tabular-nums mt-1 font-display text-3xl sm:text-4xl font-extrabold ${
                balance.outstanding_balance > 0 ? 'text-mango-700' : 'text-leaf-800'
              }`}
            >
              ₹{balance.outstanding_balance.toLocaleString('en-IN')}
            </p>
          </div>
        </div>

        {/* 3 Metric Breakdown Cards */}
        <div className="mt-6 grid gap-4 border-t border-leaf-100 pt-6 sm:grid-cols-3">
          <div className="rounded-xl bg-cream-100 p-4 sm:p-5">
            <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
              Active Deliveries
            </p>
            <p className="tabular-nums mt-1 text-2xl sm:text-3xl font-extrabold text-leaf-950">
              ₹{balance.deliveries_total.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-leaf-600">
              {balance.active_deliveries_count} deliver
              {balance.active_deliveries_count === 1 ? 'y' : 'ies'} •{' '}
              {balance.total_boxes_received.toLocaleString('en-IN')} boxes
            </p>
          </div>

          <div className="rounded-xl bg-cream-100 p-4 sm:p-5">
            <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
              Deliveries Due
            </p>
            <p
              className={`tabular-nums mt-1 text-2xl sm:text-3xl font-extrabold ${
                balance.deliveries_outstanding > 0 ? 'text-mango-700' : 'text-leaf-800'
              }`}
            >
              ₹{balance.deliveries_outstanding.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-leaf-600">
              Paid ₹{balance.deliveries_paid.toLocaleString('en-IN')} • {unpaidDeliveries.length}{' '}
              unpaid / partial
            </p>
          </div>

          <div className="rounded-xl bg-cream-100 p-4 sm:p-5">
            <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
              Opening Balance
            </p>
            <p className="tabular-nums mt-1 text-2xl sm:text-3xl font-extrabold text-leaf-950">
              ₹{balance.opening_balance_outstanding.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-leaf-600">
              {balance.opening_balance > 0
                ? `Original ₹${balance.opening_balance.toLocaleString('en-IN')} • Paid ₹${balance.opening_balance_paid.toLocaleString('en-IN')}`
                : 'No active opening balance'}
            </p>
          </div>
        </div>
      </Card>

      {notice && <AlertBanner tone="success" message={notice} />}
      {actionError && <AlertBanner tone="error" message={actionError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadAccount()} />}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-leaf-100 bg-white p-2 shadow-card">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition-colors ${
                active
                  ? 'bg-leaf-600 text-white shadow-sm'
                  : 'text-leaf-700 hover:bg-leaf-50 hover:text-leaf-950'
              }`}
            >
              <span>{t.label}</span>
              {typeof t.count === 'number' && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                    active ? 'bg-white/20 text-white' : 'bg-leaf-100 text-leaf-800'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: LEDGER */}
      {tab === 'ledger' && (
        <Card className="p-6 sm:p-7">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-leaf-950">Supplier Ledger</h2>
          </div>

          {ledgerRows.length === 0 ? (
            <EmptyState
              emoji="📒"
              title="No ledger entries yet"
              description="Stock deliveries, opening balances, supplier payments, and refunds will appear here."
            />
          ) : (
            <div className="divide-y divide-leaf-100">
              {ledgerRows.map((row) => {
                const kindBadge =
                  row.kind === 'delivery'
                    ? { label: 'Delivery', tone: 'neutral' as const }
                    : row.kind === 'payment'
                      ? { label: 'Payment', tone: 'green' as const }
                      : row.kind === 'refund'
                        ? { label: 'Refund', tone: 'orange' as const }
                        : { label: 'Opening', tone: 'orange' as const };

                return (
                  <div
                    key={row.id}
                    className={`flex flex-wrap items-start justify-between gap-4 py-4 ${
                      row.cancelled ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Badge tone={kindBadge.tone}>{kindBadge.label}</Badge>
                        <span
                          className={`text-base font-bold text-leaf-950 ${row.cancelled ? 'line-through' : ''}`}
                        >
                          {row.title}
                        </span>
                        <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-leaf-700">{row.subtitle}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-leaf-600">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" aria-hidden />
                          {formatDisplayDate(row.date)}
                        </span>
                        {row.note && <span>Note: {row.note}</span>}
                      </div>
                    </div>

                    <div className="text-right">
                      <p
                        className={`tabular-nums text-xl sm:text-2xl font-extrabold ${
                          row.cancelled
                            ? 'text-stone-500 line-through'
                            : row.direction === 'paid'
                              ? 'text-leaf-700'
                              : row.direction === 'refund'
                                ? 'text-mango-700'
                                : 'text-leaf-950'
                        }`}
                      >
                        {row.direction === 'paid' ? '− ' : row.direction === 'payable' ? '+ ' : ''}₹
                        {row.amount.toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs font-semibold text-leaf-600">
                        {row.direction === 'paid'
                          ? 'Paid to supplier'
                          : row.direction === 'refund'
                            ? 'Refund received'
                            : 'Payable'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* TAB 2: DELIVERIES */}
      {tab === 'deliveries' && (
        <div className="space-y-4">
          {deliveries.length === 0 ? (
            <EmptyState
              emoji="🚛"
              title="No deliveries from this supplier yet"
              description="Record stock arrivals under Receive Stock to see delivery-wise outstanding balances here."
            />
          ) : (
            deliveries.map((del) => {
              const hasSoldStock = del.boxes_remaining < del.boxes_received;
              const canCancel = del.status === 'active' && !hasSoldStock;
              const isCancellingThis = cancellingDeliveryId === del.delivery_id;

              return (
                <Card key={del.delivery_id} className="space-y-4 p-6 sm:p-7">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-xl font-bold text-leaf-950">{del.delivery_no}</h3>
                        <Badge tone={paymentStatusTone(del.payment_status)}>
                          {paymentStatusLabel(del.payment_status)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-leaf-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-leaf-500" aria-hidden />
                          {formatDisplayDate(del.received_date)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <Boxes className="h-4 w-4 text-leaf-500" aria-hidden />
                          {del.boxes_remaining} / {del.boxes_received} boxes left
                        </span>
                      </div>
                      {del.status === 'cancelled' && del.cancel_reason && (
                        <p className="text-sm font-semibold text-red-700">
                          Cancelled: {del.cancel_reason}
                        </p>
                      )}
                      {del.note && <p className="text-xs text-leaf-600">Note: {del.note}</p>}
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      <div className="grid grid-cols-3 gap-5 text-right">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Purchase</p>
                          <p className="tabular-nums text-lg font-bold text-leaf-950">
                            ₹{del.purchase_amount.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Paid</p>
                          <p className="tabular-nums text-lg font-bold text-leaf-700">
                            ₹{del.amount_paid.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Due</p>
                          <p
                            className={`tabular-nums text-lg font-extrabold ${
                              del.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
                            }`}
                          >
                            ₹{del.outstanding_amount.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      {del.status === 'active' && !isCancellingThis && (
                        <Button
                          variant="secondary"
                          icon={Pencil}
                          onClick={() => setEditingDeliveryId(del.delivery_id)}
                        >
                          Edit Delivery
                        </Button>
                      )}

                      {canCancel && !isCancellingThis && (
                        <Button
                          variant="secondary"
                          icon={Ban}
                          onClick={() => openCancelDelivery(del)}
                        >
                          Cancel Delivery
                        </Button>
                      )}
                    </div>
                  </div>

                  {del.status === 'active' && hasSoldStock && (
                    <p className="text-xs font-semibold text-leaf-600">
                      Delivery cannot be cancelled because {del.boxes_received - del.boxes_remaining}{' '}
                      box{del.boxes_received - del.boxes_remaining === 1 ? '' : 'es'} have already been sold.
                    </p>
                  )}

                  {isCancellingThis && (
                    <div className="space-y-4 rounded-xl border border-red-200 bg-red-50/70 p-5">
                      <p className="text-sm font-bold text-red-900">
                        Cancel delivery {del.delivery_no}?
                      </p>
                      <p className="text-xs text-red-800">
                        All {del.boxes_received} unsold boxes in this delivery will be removed from active stock, and the delivery will stay in audit history as Cancelled.
                      </p>

                      {del.amount_paid > 0 && (
                        <div className="space-y-3 rounded-xl border border-mango-200 bg-white p-4">
                          <p className="text-sm font-bold text-mango-900">
                            ₹{del.amount_paid.toLocaleString('en-IN')} is currently allocated to this delivery.
                          </p>
                          <p className="text-xs text-leaf-700">
                            Record the supplier refund below, or reallocate allocations first under Payments &amp; Refunds:
                          </p>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-leaf-700">
                                Refund Mode *
                              </span>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDeliveryRefundMode('cash')}
                                  className={`flex items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-sm font-bold ${
                                    deliveryRefundMode === 'cash'
                                      ? 'border-leaf-600 bg-leaf-600 text-white'
                                      : 'border-leaf-200 bg-white text-leaf-800'
                                  }`}
                                >
                                  <IndianRupee className="h-4 w-4" aria-hidden />
                                  Cash
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeliveryRefundMode('upi')}
                                  className={`flex items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-sm font-bold ${
                                    deliveryRefundMode === 'upi'
                                      ? 'border-leaf-600 bg-leaf-600 text-white'
                                      : 'border-leaf-200 bg-white text-leaf-800'
                                  }`}
                                >
                                  <Smartphone className="h-4 w-4" aria-hidden />
                                  UPI
                                </button>
                              </div>
                            </div>

                            <FieldWrap label="Refund Date">
                              <TextInput
                                id={`del-ref-date-${del.delivery_id}`}
                                type="date"
                                value={deliveryRefundDate}
                                onChange={(e) => setDeliveryRefundDate(e.target.value)}
                              />
                            </FieldWrap>
                          </div>

                          <FieldWrap label="Refund Note (optional)">
                            <TextInput
                              id={`del-ref-note-${del.delivery_id}`}
                              placeholder="e.g. Refund received from supplier"
                              value={deliveryRefundNote}
                              onChange={(e) => setDeliveryRefundNote(e.target.value)}
                            />
                          </FieldWrap>
                        </div>
                      )}

                      <FieldWrap label="Cancellation Reason (optional)">
                        <TextInput
                          id={`cancel-del-${del.delivery_id}`}
                          placeholder="e.g. Duplicate entry / shipment rejected"
                          value={cancelDeliveryReason}
                          onChange={(e) => setCancelDeliveryReason(e.target.value)}
                        />
                      </FieldWrap>

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setCancellingDeliveryId(null)}
                          disabled={submittingCancelDelivery}
                        >
                          Keep Delivery
                        </Button>
                        <Button
                          variant="accent"
                          icon={submittingCancelDelivery ? Loader2 : Ban}
                          disabled={submittingCancelDelivery}
                          onClick={() => void handleCancelDelivery(del)}
                        >
                          {submittingCancelDelivery ? 'Cancelling…' : 'Confirm Cancellation'}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: PAYMENTS & REFUNDS */}
      {tab === 'payments' && (
        <div className="space-y-6">
          {/* Supplier Payments */}
          <Card className="space-y-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-leaf-950">
                  Supplier Payments &amp; Allocations
                </h2>
              </div>
              <Button
                icon={IndianRupee}
                disabled={balance.outstanding_balance <= 0}
                onClick={() => setPaymentModalOpen(true)}
              >
                Record Payment
              </Button>
            </div>

            {payments.length === 0 ? (
              <EmptyState
                emoji="💵"
                title="No payments recorded yet"
                description="Record a Cash or UPI supplier payment and allocate it across outstanding deliveries or opening balance."
              />
            ) : (
              <div className="space-y-4">
                {payments.map((pay) => {
                  const hasRefundedAlloc = pay.allocations.some((a) => a.status === 'refunded');
                  const hasReallocatedAlloc = pay.allocations.some((a) => a.status === 'reallocated');
                  const canCancel =
                    pay.status === 'active' && !hasRefundedAlloc && !hasReallocatedAlloc;
                  const isCancellingThis = cancellingPaymentId === pay.id;

                  return (
                    <div
                      key={pay.id}
                      className={`rounded-2xl border p-5 ${
                        pay.status === 'cancelled'
                          ? 'border-stone-200 bg-stone-50/70'
                          : 'border-leaf-100 bg-cream-100/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              className={`tabular-nums text-2xl font-extrabold ${
                                pay.status === 'cancelled'
                                  ? 'text-stone-500 line-through'
                                  : 'text-leaf-950'
                              }`}
                            >
                              ₹{pay.amount.toLocaleString('en-IN')}
                            </span>
                            <Badge tone={pay.mode === 'cash' ? 'green' : 'orange'}>
                              {pay.mode === 'cash' ? (
                                <IndianRupee className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <Smartphone className="h-3.5 w-3.5" aria-hidden />
                              )}
                              {pay.mode.toUpperCase()}
                            </Badge>
                            <Badge tone={pay.status === 'active' ? 'green' : 'red'}>
                              {pay.status === 'active' ? 'Active' : 'Cancelled'}
                            </Badge>
                          </div>

                          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-700">
                            <Calendar className="h-4 w-4 text-leaf-500" aria-hidden />
                            {formatDisplayDate(pay.payment_date)}
                            {pay.note && <span className="ml-2 text-leaf-600">• {pay.note}</span>}
                          </p>

                          {pay.status === 'cancelled' && pay.cancel_reason && (
                            <p className="text-xs font-semibold text-red-700">
                              Reason: {pay.cancel_reason}
                            </p>
                          )}
                        </div>

                        {canCancel && !isCancellingThis && (
                          <Button
                            variant="secondary"
                            icon={Ban}
                            onClick={() => {
                              setCancellingPaymentId(pay.id);
                              setCancelPaymentReason('');
                              setActionError(null);
                            }}
                          >
                            Cancel Payment
                          </Button>
                        )}
                      </div>

                      {hasRefundedAlloc && pay.status === 'active' && (
                        <p className="mt-2 text-xs font-semibold text-mango-800">
                          Part of this payment was refunded via delivery cancellation and cannot be cancelled as an erroneous entry.
                        </p>
                      )}

                      {/* Allocations Breakdown */}
                      <div className="mt-4 space-y-2 border-t border-leaf-100 pt-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
                          Allocations
                        </p>
                        {pay.allocations.map((alloc) => {
                          const badge = allocationStatusBadge(alloc.status);
                          const canReallocate = alloc.status === 'active';

                          return (
                            <div
                              key={alloc.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Truck className="h-4 w-4 text-leaf-500" aria-hidden />
                                <span className="font-bold text-leaf-950">
                                  {alloc.target_label}
                                </span>
                                {alloc.target_date && (
                                  <span className="text-xs text-leaf-600">
                                    ({formatDisplayDate(alloc.target_date)})
                                  </span>
                                )}
                                <Badge tone={badge.tone}>{badge.label}</Badge>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="tabular-nums font-extrabold text-leaf-950">
                                  ₹{alloc.amount.toLocaleString('en-IN')}
                                </span>
                                {canReallocate && (
                                  <Button
                                    variant="secondary"
                                    size="md"
                                    icon={ArrowRightLeft}
                                    onClick={() => setReallocatingAllocation(alloc)}
                                  >
                                    Reallocate
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Inline Cancel Confirmation */}
                      {isCancellingThis && (
                        <div className="mt-4 space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4">
                          <p className="text-sm font-bold text-red-900">
                            Cancel this payment entry?
                          </p>
                          <p className="text-xs text-red-800">
                            This restores ₹{pay.amount.toLocaleString('en-IN')} back to the supplier’s unpaid deliveries.
                          </p>
                          <FieldWrap label="Reason (optional)">
                            <TextInput
                              id={`cancel-supp-pay-${pay.id}`}
                              placeholder="e.g. Wrong amount entered"
                              value={cancelPaymentReason}
                              onChange={(e) => setCancelPaymentReason(e.target.value)}
                            />
                          </FieldWrap>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => setCancellingPaymentId(null)}
                              disabled={submittingCancelPayment}
                            >
                              Keep Payment
                            </Button>
                            <Button
                              variant="accent"
                              icon={submittingCancelPayment ? Loader2 : Ban}
                              disabled={submittingCancelPayment}
                              onClick={() => void handleCancelPayment(pay.id)}
                            >
                              {submittingCancelPayment ? 'Cancelling…' : 'Confirm Cancellation'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Supplier Refunds */}
          <Card className="space-y-4 p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <RotateCcw className="h-5 w-5 text-mango-600" aria-hidden />
              <div>
                <h2 className="text-xl font-bold text-leaf-950">
                  Supplier Refunds
                </h2>
              </div>
            </div>

            {refunds.length === 0 ? (
              <p className="rounded-xl border border-dashed border-leaf-200 bg-cream-100/60 px-4 py-6 text-center text-sm font-semibold text-leaf-700">
                No supplier refunds recorded.
              </p>
            ) : (
              <div className="space-y-2.5">
                {refunds.map((ref) => (
                  <div
                    key={ref.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mango-200 bg-mango-50/40 px-4 py-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-leaf-950">Refund for {ref.delivery_no}</span>
                        <Badge tone="orange">{ref.mode.toUpperCase()}</Badge>
                      </div>
                      <p className="text-xs text-leaf-700">
                        {formatDisplayDate(ref.refund_date)}
                        {ref.note ? ` • ${ref.note}` : ''}
                      </p>
                    </div>
                    <span className="tabular-nums text-lg font-extrabold text-mango-800">
                      ₹{ref.amount.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: OPENING BALANCE */}
      {tab === 'opening' && (
        <div className="space-y-5">
          <Card className="space-y-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-leaf-950">Opening Balance</h2>
              </div>
              {balance.active && !activeOpening && (
                <Button icon={Scale} size="lg" onClick={() => setOpeningModalOpen(true)}>
                  Set Opening Balance
                </Button>
              )}
            </div>

            {activeOpening ? (
              <div className="space-y-4 rounded-2xl border border-leaf-200 bg-cream-100/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-display text-3xl font-extrabold text-leaf-950">
                        ₹{activeOpening.amount.toLocaleString('en-IN')}
                      </span>
                      <Badge tone="green">Active</Badge>
                    </div>
                    <p className="text-sm font-semibold text-leaf-700">
                      As of {formatDisplayDate(activeOpening.as_of_date)}
                      {activeOpening.note ? ` • ${activeOpening.note}` : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-5 text-right">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Paid</p>
                      <p className="tabular-nums text-lg font-bold text-leaf-700">
                        ₹{balance.opening_balance_paid.toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Remaining Due</p>
                      <p className="tabular-nums text-lg font-extrabold text-mango-700">
                        ₹{balance.opening_balance_outstanding.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>

                {balance.opening_balance_paid > 0 ? (
                  <AlertBanner
                    tone="info"
                    message={`₹${balance.opening_balance_paid.toLocaleString('en-IN')} has already been paid against this opening balance. Cancel those payment entries first if you need to cancel this opening balance.`}
                  />
                ) : !showCancelOpening ? (
                  <div className="flex justify-end border-t border-leaf-100 pt-3">
                    <Button
                      variant="secondary"
                      icon={Ban}
                      onClick={() => {
                        setShowCancelOpening(true);
                        setCancelOpeningReason('');
                        setActionError(null);
                      }}
                    >
                      Cancel Opening Balance
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4">
                    <p className="text-sm font-bold text-red-900">
                      Cancel this opening balance?
                    </p>
                    <FieldWrap label="Reason (optional)">
                      <TextInput
                        id="cancel-supp-ob-reason"
                        placeholder="e.g. Entered wrong starting balance"
                        value={cancelOpeningReason}
                        onChange={(e) => setCancelOpeningReason(e.target.value)}
                      />
                    </FieldWrap>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setShowCancelOpening(false)}
                        disabled={submittingCancelOpening}
                      >
                        Keep Opening Balance
                      </Button>
                      <Button
                        variant="accent"
                        icon={submittingCancelOpening ? Loader2 : Ban}
                        disabled={submittingCancelOpening}
                        onClick={() => void handleCancelOpeningBalance(activeOpening.id)}
                      >
                        {submittingCancelOpening ? 'Cancelling…' : 'Confirm Cancellation'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                emoji="⚖️"
                title="No active opening balance"
                description={
                  balance.active
                    ? 'Set a starting balance if you already owed money to this supplier before you started using this app.'
                    : 'Activate this supplier to set a new opening balance.'
                }
                action={
                  balance.active ? (
                    <Button icon={Scale} size="lg" onClick={() => setOpeningModalOpen(true)}>
                      Set Opening Balance
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Card>

          {cancelledOpenings.length > 0 && (
            <Card className="space-y-3 p-6 sm:p-7">
              <h3 className="text-base font-extrabold text-leaf-950">
                Cancelled Opening Balance History
              </h3>
              <div className="space-y-2">
                {cancelledOpenings.map((ob) => (
                  <div
                    key={ob.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="tabular-nums font-bold text-stone-600 line-through">
                        ₹{ob.amount.toLocaleString('en-IN')}
                      </span>
                      <span className="ml-2 text-xs text-stone-600">
                        as of {formatDisplayDate(ob.as_of_date)}
                      </span>
                      {ob.cancel_reason && (
                        <p className="text-xs font-semibold text-red-700">
                          Reason: {ob.cancel_reason}
                        </p>
                      )}
                    </div>
                    <Badge tone="neutral">Cancelled</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Modals */}
      <RecordSupplierPaymentModal
        open={paymentModalOpen}
        supplierId={balance.supplier_id}
        supplierName={balance.name}
        openingBalanceId={balance.opening_balance_id}
        openingBalanceOutstanding={balance.opening_balance_outstanding}
        unpaidDeliveries={unpaidDeliveries}
        onClose={() => setPaymentModalOpen(false)}
        onSaved={handlePaymentSaved}
      />

      <ReallocateAllocationModal
        open={Boolean(reallocatingAllocation)}
        allocation={reallocatingAllocation}
        openingBalanceId={balance.opening_balance_id}
        openingBalanceOutstanding={balance.opening_balance_outstanding}
        unpaidDeliveries={unpaidDeliveries}
        onClose={() => setReallocatingAllocation(null)}
        onReallocated={handleReallocated}
      />

      <OpeningBalanceModal
        open={openingModalOpen}
        partyType="supplier"
        partyName={balance.name}
        onClose={() => setOpeningModalOpen(false)}
        onSubmit={handleSetOpeningBalance}
      />

      <EditDeliveryModal
        deliveryId={editingDeliveryId}
        isOpen={Boolean(editingDeliveryId)}
        onClose={() => setEditingDeliveryId(null)}
        onSuccess={() => {
          void loadAccount();
          onDataChanged?.();
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Calendar,
  FileText,
  IndianRupee,
  Loader2,
  Phone,
  ReceiptText,
  RotateCcw,
  Scale,
  Smartphone,
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
import { BillDetailModal } from '@/components/sales/BillDetailModal';
import { CustomerStatementModal } from './CustomerStatementModal';
import { OpeningBalanceModal } from './OpeningBalanceModal';
import { RecordCustomerPaymentModal } from './RecordCustomerPaymentModal';
import {
  cancelCustomerOpeningBalance,
  cancelCustomerPayment,
  getCustomerAccountDetail,
  setCustomerOpeningBalance,
} from '@/services/accounts';
import { useCacheInvalidation } from '@/services/cache';
import { formatDisplayDate } from '@/services/inventory';
import type {
  CustomerAccountDetail,
  PaymentMode,
  PaymentStatus,
} from '@/types/database';

interface CustomerAccountViewProps {
  customerId: string;
  onBack: () => void;
  onDataChanged?: () => void;
  isActive?: boolean;
}

type AccountTab = 'ledger' | 'bills' | 'payments' | 'opening';

interface LedgerRow {
  id: string;
  date: string;
  createdAt: string;
  kind: 'opening_balance' | 'bill' | 'payment' | 'refund' | 'return';
  title: string;
  subtitle: string;
  amount: number;
  statusLabel: string;
  statusTone: 'green' | 'orange' | 'red' | 'neutral';
  direction: 'debit' | 'credit' | 'refund';
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

export function CustomerAccountView({
  customerId,
  onBack,
  onDataChanged,
  isActive = true,
}: CustomerAccountViewProps) {
  const [detail, setDetail] = useState<CustomerAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountTab>('ledger');

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [openingModalOpen, setOpeningModalOpen] = useState(false);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  // Inline cancel payment state
  const [cancellingPaymentId, setCancellingPaymentId] = useState<string | null>(null);
  const [cancelPaymentReason, setCancelPaymentReason] = useState('');
  const [submittingCancelPayment, setSubmittingCancelPayment] = useState(false);

  // Inline cancel opening balance state
  const [showCancelOpening, setShowCancelOpening] = useState(false);
  const [cancelOpeningReason, setCancelOpeningReason] = useState('');
  const [submittingCancelOpening, setSubmittingCancelOpening] = useState(false);

  const loadAccount = useCallback(async (isBackground = false, forceRefresh = false) => {
    if (!isBackground) setLoading(true);
    setLoadError(null);
    try {
      const data = await getCustomerAccountDetail(customerId, { forceRefresh });
      setDetail(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load customer account.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useCacheInvalidation(['customer_ledger', `customer_ledger:${customerId}`], () => void loadAccount(true), { isActive });

  const unpaidBills = useMemo(
    () => (detail ? detail.bills.filter((b) => b.status === 'active' && b.outstanding_amount > 0) : []),
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
        subtitle: ob.cancel_reason ? `Cancelled: ${ob.cancel_reason}` : 'Starting balance carried forward',
        amount: ob.amount,
        statusLabel: ob.status === 'active' ? 'Active' : 'Cancelled',
        statusTone: ob.status === 'active' ? 'orange' : 'neutral',
        direction: 'debit',
        cancelled: ob.status === 'cancelled',
        note: ob.note,
      });
    }

    for (const b of detail.bills) {
      rows.push({
        id: `bill:${b.bill_id}`,
        date: b.bill_date,
        createdAt: b.created_at,
        kind: 'bill',
        title: b.bill_no,
        subtitle:
          b.status === 'cancelled'
            ? `Cancelled bill${b.cancel_reason ? `: ${b.cancel_reason}` : ''}`
            : `Bill • ${paymentStatusLabel(b.payment_status)}`,
        amount: b.subtotal,
        statusLabel: b.status === 'cancelled' ? 'Cancelled' : paymentStatusLabel(b.payment_status),
        statusTone: b.status === 'cancelled' ? 'neutral' : paymentStatusTone(b.payment_status),
        direction: 'debit',
        cancelled: b.status === 'cancelled',
        note: b.note,
      });
    }

    for (const p of detail.payments) {
      rows.push({
        id: `pay:${p.id}`,
        date: p.payment_date,
        createdAt: p.created_at,
        kind: 'payment',
        title: `${p.mode.toUpperCase()} Payment`,
        subtitle:
          p.status === 'cancelled'
            ? `Cancelled payment${p.cancel_reason ? `: ${p.cancel_reason}` : ''}`
            : p.payment_origin === 'bill_sale'
              ? 'Paid at sale time'
              : 'Direct customer collection',
        amount: p.amount,
        statusLabel: p.status === 'active' ? 'Collected' : 'Cancelled',
        statusTone: p.status === 'active' ? 'green' : 'neutral',
        direction: 'credit',
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
        title: `Refund for ${ref.bill_no}`,
        subtitle: `Returned via ${ref.mode.toUpperCase()} upon bill cancellation`,
        amount: ref.amount,
        statusLabel: 'Refunded',
        statusTone: 'orange',
        direction: 'refund',
        cancelled: false,
        note: ref.note,
      });
    }

    for (const ret of detail.returns ?? []) {
      rows.push({
        id: `ret:${ret.id}`,
        date: ret.return_date,
        createdAt: ret.created_at,
        kind: 'return',
        title: `Return • ${ret.return_no}`,
        subtitle: `Returned goods for ${ret.bill_no} (${ret.total_boxes} bxs)${
          ret.refund_amount > 0
            ? ` • Refund ₹${ret.refund_amount.toLocaleString('en-IN')} via ${ret.refund_mode?.toUpperCase()}`
            : ' • Credited against bill balance'
        }`,
        amount: ret.total_amount,
        statusLabel: ret.refund_amount > 0 ? 'Refunded' : 'Credited',
        statusTone: 'orange',
        direction: 'credit',
        cancelled: false,
        note: ret.reason,
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
      `Recorded ₹${amount.toLocaleString('en-IN')} ${mode.toUpperCase()} payment and updated balance.`
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
    await setCustomerOpeningBalance(customerId, values.amount, values.asOfDate, values.note);
    setNotice(`Set opening balance of ₹${values.amount.toLocaleString('en-IN')}.`);
    await loadAccount();
    onDataChanged?.();
  };

  const handleCancelPayment = async (paymentId: string) => {
    setActionError(null);
    setNotice(null);
    setSubmittingCancelPayment(true);
    try {
      await cancelCustomerPayment(paymentId, cancelPaymentReason.trim() || null);
      setCancellingPaymentId(null);
      setCancelPaymentReason('');
      setNotice('Payment cancelled. Audit history preserved and dues restored.');
      await loadAccount();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel payment.');
    } finally {
      setSubmittingCancelPayment(false);
    }
  };

  const handleCancelOpeningBalance = async (openingBalanceId: string) => {
    setActionError(null);
    setNotice(null);
    setSubmittingCancelOpening(true);
    try {
      await cancelCustomerOpeningBalance(openingBalanceId, cancelOpeningReason.trim() || null);
      setShowCancelOpening(false);
      setCancelOpeningReason('');
      setNotice('Opening balance cancelled. Audit history preserved.');
      await loadAccount();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel opening balance.');
    } finally {
      setSubmittingCancelOpening(false);
    }
  };

  const handleBillCancelled = (billNo: string) => {
    setNotice(`Cancelled bill ${billNo}. Stock and balance updated.`);
    void loadAccount();
    onDataChanged?.();
  };

  if (loading && !detail) {
    return (
      <div className="space-y-6">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Customers
        </Button>
        <LoadingCard label="Loading customer account…" />
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <div className="space-y-6">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Customers
        </Button>
        <AlertBanner tone="error" message={loadError} onRetry={() => void loadAccount()} />
      </div>
    );
  }

  if (!detail) return null;

  const { balance, openingBalances, bills, payments, refunds } = detail;
  const activeOpening = openingBalances.find((o) => o.status === 'active') ?? null;
  const cancelledOpenings = openingBalances.filter((o) => o.status === 'cancelled');

  const tabs: { id: AccountTab; label: string; count?: number }[] = [
    { id: 'ledger', label: 'Ledger', count: ledgerRows.length },
    { id: 'bills', label: 'Bills', count: bills.length },
    { id: 'payments', label: 'Payments & Refunds', count: payments.length + refunds.length },
    { id: 'opening', label: 'Opening Balance' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back to Customers
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            icon={FileText}
            onClick={() => setStatementModalOpen(true)}
          >
            Download Statement
          </Button>
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

      {/* Customer Profile Card */}
      <Card className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-leaf-950">
                {balance.name}
              </h1>
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
              Current Outstanding Due
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
              Active Bills
            </p>
            <p className="tabular-nums mt-1 text-2xl sm:text-3xl font-extrabold text-leaf-950">
              ₹{balance.bills_total.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-leaf-600">
              {balance.active_bills_count} bill{balance.active_bills_count === 1 ? '' : 's'} • Paid ₹
              {balance.bills_paid.toLocaleString('en-IN')}
            </p>
          </div>

          <div className="rounded-xl bg-cream-100 p-4 sm:p-5">
            <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
              Bills Due
            </p>
            <p
              className={`tabular-nums mt-1 text-2xl sm:text-3xl font-extrabold ${
                balance.bills_outstanding > 0 ? 'text-mango-700' : 'text-leaf-800'
              }`}
            >
              ₹{balance.bills_outstanding.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-leaf-600">
              {unpaidBills.length} unpaid / partial bill{unpaidBills.length === 1 ? '' : 's'}
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
            <h2 className="text-xl font-bold text-leaf-950">Account Ledger</h2>
          </div>

          {ledgerRows.length === 0 ? (
            <EmptyState
              emoji="📒"
              title="No ledger entries yet"
              description="Bills, opening balances, payments, and refunds for this customer will appear here."
            />
          ) : (
            <div className="divide-y divide-leaf-100">
              {ledgerRows.map((row) => {
                const kindBadge =
                  row.kind === 'bill'
                    ? { label: 'Bill', tone: 'neutral' as const }
                    : row.kind === 'payment'
                      ? { label: 'Payment', tone: 'green' as const }
                      : row.kind === 'refund'
                        ? { label: 'Refund', tone: 'orange' as const }
                        : row.kind === 'return'
                          ? { label: 'Return', tone: 'orange' as const }
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
                            : row.direction === 'credit'
                              ? 'text-leaf-700'
                              : row.direction === 'refund'
                                ? 'text-mango-700'
                                : 'text-leaf-950'
                        }`}
                      >
                        {row.direction === 'credit' ? '− ' : row.direction === 'debit' ? '+ ' : ''}₹
                        {row.amount.toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs font-semibold text-leaf-600">
                        {row.kind === 'return'
                          ? 'Return Credit'
                          : row.direction === 'credit'
                            ? 'Received'
                            : row.direction === 'refund'
                              ? 'Refund paid out'
                              : 'Billed / Due'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* TAB 2: BILLS */}
      {tab === 'bills' && (
        <div className="space-y-4">
          {bills.length === 0 ? (
            <EmptyState
              emoji="🧾"
              title="No bills for this customer yet"
              description="Create a sale under New Sale to see bills and balances here."
            />
          ) : (
            bills.map((bill) => (
              <Card key={bill.bill_id} className="p-6 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-xl font-bold text-leaf-950">{bill.bill_no}</h3>
                      <Badge tone={paymentStatusTone(bill.payment_status)}>
                        {paymentStatusLabel(bill.payment_status)}
                      </Badge>
                    </div>
                    <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-700">
                      <Calendar className="h-4 w-4 text-leaf-500" aria-hidden />
                      {formatDisplayDate(bill.bill_date)}
                    </p>
                    {bill.status === 'cancelled' && bill.cancel_reason && (
                      <p className="text-sm font-semibold text-red-700">
                        Cancelled: {bill.cancel_reason}
                      </p>
                    )}
                    {bill.note && <p className="text-xs text-leaf-600">Note: {bill.note}</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    <div className="grid grid-cols-3 gap-5 text-right">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Total</p>
                        <p className="tabular-nums text-lg font-bold text-leaf-950">
                          ₹{bill.subtotal.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Paid</p>
                        <p className="tabular-nums text-lg font-bold text-leaf-700">
                          ₹{bill.amount_paid.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-leaf-600">Due</p>
                        <p
                          className={`tabular-nums text-lg font-extrabold ${
                            bill.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
                          }`}
                        >
                          ₹{bill.outstanding_amount.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      icon={ReceiptText}
                      onClick={() => setSelectedBillId(bill.bill_id)}
                    >
                      Details
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* TAB 3: PAYMENTS & REFUNDS */}
      {tab === 'payments' && (
        <div className="space-y-6">
          {/* Customer Payments */}
          <Card className="space-y-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-leaf-950">
                  Customer Payments
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
                description="Record a Cash or UPI collection and allocate it across outstanding bills or opening balance."
              />
            ) : (
              <div className="space-y-4">
                {payments.map((pay) => {
                  const hasRefundedAlloc = pay.allocations.some((a) => a.status === 'refunded');
                  const canCancel = pay.status === 'active' && !hasRefundedAlloc;
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
                            <Badge tone="neutral">
                              {pay.payment_origin === 'bill_sale' ? 'At sale' : 'Collection'}
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
                          Part or all of this payment was refunded via bill cancellation and cannot be cancelled as an erroneous entry.
                        </p>
                      )}

                      {/* Allocations Breakdown */}
                      <div className="mt-4 space-y-2 border-t border-leaf-100 pt-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
                          Allocations
                        </p>
                        {pay.allocations.map((alloc) => (
                          <div
                            key={alloc.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <FileText className="h-4 w-4 text-leaf-500" aria-hidden />
                              <span className="font-bold text-leaf-950">{alloc.target_label}</span>
                              {alloc.target_date && (
                                <span className="text-xs text-leaf-600">
                                  ({formatDisplayDate(alloc.target_date)})
                                </span>
                              )}
                              <Badge
                                tone={
                                  alloc.status === 'active'
                                    ? 'green'
                                    : alloc.status === 'refunded'
                                      ? 'orange'
                                      : 'red'
                                }
                              >
                                {alloc.status === 'active'
                                  ? 'Active'
                                  : alloc.status === 'refunded'
                                    ? 'Refunded'
                                    : 'Cancelled'}
                              </Badge>
                            </div>
                            <span className="tabular-nums font-extrabold text-leaf-950">
                              ₹{alloc.amount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Inline Cancel Confirmation */}
                      {isCancellingThis && (
                        <div className="mt-4 space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4">
                          <p className="text-sm font-bold text-red-900">
                            Cancel this payment entry?
                          </p>
                          <p className="text-xs text-red-800">
                            This restores ₹{pay.amount.toLocaleString('en-IN')} back to the customer’s unpaid dues.
                          </p>
                          <FieldWrap label="Reason (optional)">
                            <TextInput
                              id={`cancel-pay-${pay.id}`}
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

          {/* Actual Refunds */}
          <Card className="space-y-4 p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <RotateCcw className="h-5 w-5 text-mango-600" aria-hidden />
              <div>
                <h2 className="text-xl font-bold text-leaf-950">
                  Customer Refunds
                </h2>
              </div>
            </div>

            {refunds.length === 0 ? (
              <p className="rounded-xl border border-dashed border-leaf-200 bg-cream-100/60 px-4 py-6 text-center text-sm font-semibold text-leaf-700">
                No customer refunds recorded.
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
                        <span className="font-bold text-leaf-950">Refund for {ref.bill_no}</span>
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
                    message={`₹${balance.opening_balance_paid.toLocaleString('en-IN')} has already been collected against this opening balance. Cancel those payment entries first if you need to cancel this opening balance.`}
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
                        id="cancel-cust-ob-reason"
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
                    ? 'Set a starting balance if this customer already owed money before you started using this app.'
                    : 'Activate this customer to set a new opening balance.'
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
      <RecordCustomerPaymentModal
        open={paymentModalOpen}
        customerId={balance.customer_id}
        customerName={balance.name}
        openingBalanceId={balance.opening_balance_id}
        openingBalanceOutstanding={balance.opening_balance_outstanding}
        unpaidBills={unpaidBills}
        onClose={() => setPaymentModalOpen(false)}
        onSaved={handlePaymentSaved}
      />

      <OpeningBalanceModal
        open={openingModalOpen}
        partyType="customer"
        partyName={balance.name}
        onClose={() => setOpeningModalOpen(false)}
        onSubmit={handleSetOpeningBalance}
      />

      <BillDetailModal
        billId={selectedBillId}
        onClose={() => setSelectedBillId(null)}
        onCancelled={handleBillCancelled}
      />

      <CustomerStatementModal
        open={statementModalOpen}
        onClose={() => setStatementModalOpen(false)}
        detail={detail}
      />
    </div>
  );
}

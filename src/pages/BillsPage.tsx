import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Eye, Printer, RotateCw, Search, ShoppingCart } from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  SectionHeader,
  SelectInput,
  TextInput,
} from '@/components/ui';
import { BillDetailModal } from '@/components/sales/BillDetailModal';
import { PrintableBillModal } from '@/components/sales/PrintableBillModal';
import { formatDisplayDate } from '@/services/inventory';
import { listBills } from '@/services/sales';
import type { BillBalance, PaymentStatus } from '@/types/database';
import type { Page } from './pageTypes';

type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'cancelled';
type BillStatusFilter = 'active' | 'cancelled' | 'all';

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

export function BillsPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const [bills, setBills] = useState<BillBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<BillStatusFilter>('active');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [printBillId, setPrintBillId] = useState<string | null>(null);

  const loadBills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBills();
      setBills(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sales history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBills();
  }, [loadBills]);

  const customerChoices = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bills) {
      if (b.customer_id) map.set(b.customer_id, b.customer_name_snapshot);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [bills]);

  const filteredBills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bills.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (paymentFilter !== 'all' && b.payment_status !== paymentFilter) return false;
      if (customerFilter === 'cash_customer' && !b.is_cash_customer) return false;
      if (
        customerFilter !== 'all' &&
        customerFilter !== 'cash_customer' &&
        b.customer_id !== customerFilter
      ) {
        return false;
      }
      if (dateFrom && b.bill_date < dateFrom) return false;
      if (dateTo && b.bill_date > dateTo) return false;
      if (!q) return true;
      return (
        b.bill_no.toLowerCase().includes(q) ||
        b.customer_name_snapshot.toLowerCase().includes(q) ||
        (b.note ?? '').toLowerCase().includes(q)
      );
    });
  }, [bills, statusFilter, paymentFilter, customerFilter, dateFrom, dateTo, query]);

  const totals = useMemo(() => {
    let activeSales = 0;
    let activePaid = 0;
    let activeOutstanding = 0;
    for (const b of filteredBills) {
      if (b.status !== 'active') continue;
      activeSales += b.subtotal;
      activePaid += b.amount_paid;
      activeOutstanding += b.outstanding_amount;
    }
    return {
      activeSales: Math.round(activeSales * 100) / 100,
      activePaid: Math.round(activePaid * 100) / 100,
      activeOutstanding: Math.round(activeOutstanding * 100) / 100,
    };
  }, [filteredBills]);

  const clearFilters = () => {
    setQuery('');
    setCustomerFilter('all');
    setStatusFilter('all');
    setPaymentFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Sales History"
        action={
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg" icon={RotateCw} onClick={() => void loadBills()}>
              Refresh
            </Button>
            <Button variant="accent" size="lg" icon={ShoppingCart} onClick={() => onNavigate('sale')}>
              New Sale
            </Button>
          </div>
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} onRetry={() => void loadBills()} />}

      {loading ? (
        <LoadingCard label="Loading sales history…" />
      ) : bills.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No bills recorded yet"
          description="Create your first sale to see it here."
          action={
            <Button variant="accent" size="lg" icon={ShoppingCart} onClick={() => onNavigate('sale')}>
              Create First Sale
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary Strip */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-sm font-bold text-leaf-600">Sales</p>
              <p className="tabular-nums mt-1 text-3xl font-extrabold text-leaf-950">
                ₹{totals.activeSales.toLocaleString('en-IN')}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-bold text-leaf-600">Paid</p>
              <p className="tabular-nums mt-1 text-3xl font-extrabold text-leaf-700">
                ₹{totals.activePaid.toLocaleString('en-IN')}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-bold text-leaf-600">Due</p>
              <p className="tabular-nums mt-1 text-3xl font-extrabold text-mango-700">
                ₹{totals.activeOutstanding.toLocaleString('en-IN')}
              </p>
            </Card>
          </div>

          {/* Search & Filters */}
          <Card className="p-4">
            <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div className="relative md:col-span-2">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                  aria-hidden
                />
                <TextInput
                  className="pl-12"
                  placeholder="Search bill, customer, or note"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search bills"
                />
              </div>

              <SelectInput
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                aria-label="Filter by customer"
              >
                <option value="all">All customers</option>
                <option value="cash_customer">Cash Customer (Walk-in)</option>
                {customerChoices.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </SelectInput>

              <div className="grid grid-cols-2 gap-2">
                <SelectInput
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as BillStatusFilter)}
                  aria-label="Filter by bill status"
                >
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="all">All</option>
                </SelectInput>
                <SelectInput
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
                  aria-label="Filter by payment status"
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="cancelled">Cancelled</option>
                </SelectInput>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-leaf-700">From</span>
                <TextInput
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="From date"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-leaf-700">To</span>
                <TextInput
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="To date"
                />
              </label>
            </div>
          </Card>

          {filteredBills.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching bills"
              description="Try changing your search or filters."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Show All Bills
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredBills.map((bill) => (
                <Card key={bill.bill_id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="font-display text-xl font-semibold text-leaf-950">
                          {bill.bill_no}
                        </h2>
                        <Badge tone={paymentTone(bill.payment_status)}>
                          {paymentLabel(bill.payment_status)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-leaf-700">
                        <span>{bill.customer_name_snapshot}</span>
                        <span className="inline-flex items-center gap-1.5 text-leaf-600">
                          <Calendar className="h-4 w-4 text-leaf-500" aria-hidden />
                          {formatDisplayDate(bill.bill_date)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-5">
                      <div className="grid grid-cols-3 gap-4 text-right">
                        <div>
                          <p className="text-xs font-bold uppercase text-leaf-600">Total</p>
                          <p className="tabular-nums text-base font-extrabold text-leaf-950">
                            ₹{bill.subtotal.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase text-leaf-600">Paid</p>
                          <p className="tabular-nums text-base font-extrabold text-leaf-700">
                            ₹{bill.amount_paid.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase text-leaf-600">Due</p>
                          <p
                            className={`tabular-nums text-base font-extrabold ${
                              bill.outstanding_amount > 0 ? 'text-mango-700' : 'text-leaf-700'
                            }`}
                          >
                            ₹{bill.outstanding_amount.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          icon={Printer}
                          onClick={() => setPrintBillId(bill.bill_id)}
                          title="Print Receipt"
                        >
                          Print
                        </Button>
                        <Button
                          variant="secondary"
                          icon={Eye}
                          onClick={() => setSelectedBillId(bill.bill_id)}
                        >
                          View Details
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <BillDetailModal
        billId={selectedBillId}
        onClose={() => setSelectedBillId(null)}
        onCancelled={(billNo) => {
          setNotice(
            `Cancelled bill ${billNo}. Stock boxes were restored and audit history was preserved.`
          );
          void loadBills();
        }}
      />

      {printBillId && (
        <PrintableBillModal
          billId={printBillId}
          onClose={() => setPrintBillId(null)}
        />
      )}
    </div>
  );
}

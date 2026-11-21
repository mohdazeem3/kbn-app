import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, PackageOpen, Pencil, RotateCw, Search, Truck } from 'lucide-react';
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
import { EditDeliveryModal } from '@/components/inventory/EditDeliveryModal';
import { formatDisplayDate, listStockBatches } from '@/services/inventory';
import type { PaymentStatus, StockBatchView } from '@/types/database';
import type { Page } from './pageTypes';

type StockAvailabilityFilter = 'in_stock' | 'sold_out' | 'all';
type PaymentStatusFilter = 'all' | 'paid' | 'partial' | 'unpaid';

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

export function StockPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const [batches, setBatches] = useState<StockBatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [fruitFilter, setFruitFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] =
    useState<StockAvailabilityFilter>('in_stock');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatusFilter>('all');
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listStockBatches();
      setBatches(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock batches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const fruitChoices = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) map.set(b.fruit_id, b.fruit_name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [batches]);

  const supplierChoices = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) map.set(b.supplier_id, b.supplier_name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [batches]);

  const filteredBatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return batches.filter((b) => {
      if (availabilityFilter === 'in_stock' && b.boxes_remaining <= 0) return false;
      if (availabilityFilter === 'sold_out' && b.boxes_remaining > 0) return false;
      if (fruitFilter !== 'all' && b.fruit_id !== fruitFilter) return false;
      if (supplierFilter !== 'all' && b.supplier_id !== supplierFilter) return false;
      if (paymentFilter !== 'all' && b.delivery_payment_status !== paymentFilter) return false;
      if (!q) return true;
      return (
        b.fruit_name.toLowerCase().includes(q) ||
        b.variety_name.toLowerCase().includes(q) ||
        b.supplier_name.toLowerCase().includes(q) ||
        b.delivery_no.toLowerCase().includes(q) ||
        (b.delivery_note ?? '').toLowerCase().includes(q)
      );
    });
  }, [batches, availabilityFilter, fruitFilter, supplierFilter, paymentFilter, query]);

  const totals = useMemo(() => {
    let remainingBoxes = 0;
    let remainingValue = 0;
    let receivedBoxes = 0;
    for (const b of filteredBatches) {
      remainingBoxes += b.boxes_remaining;
      receivedBoxes += b.boxes_received;
      remainingValue += b.remaining_stock_value;
    }
    return {
      remainingBoxes,
      receivedBoxes,
      remainingValue: Math.round(remainingValue * 100) / 100,
    };
  }, [filteredBatches]);

  const clearFilters = () => {
    setQuery('');
    setFruitFilter('all');
    setSupplierFilter('all');
    setAvailabilityFilter('all');
    setPaymentFilter('all');
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Stock"
        action={
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg" icon={RotateCw} onClick={() => void loadBatches()}>
              Refresh
            </Button>
            <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
              Receive Stock
            </Button>
          </div>
        }
      />

      {error && <AlertBanner tone="error" message={error} onRetry={() => void loadBatches()} />}

      {loading ? (
        <LoadingCard label="Loading stock…" />
      ) : batches.length === 0 ? (
        <EmptyState
          emoji="📦"
          title="Your godown is empty"
          description="Receive your first delivery to see stock here."
          action={
            <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
              Receive Stock
            </Button>
          }
        />
      ) : (
        <>
          {/* 1. Search box & filters */}
          <Card className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <label className="block sm:col-span-2 xl:col-span-2">
                <span className="mb-1.5 block text-xs sm:text-sm font-bold text-leaf-800">
                  Search
                </span>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                    aria-hidden
                  />
                  <TextInput
                    className="pl-12 py-3.5 text-base md:text-lg"
                    placeholder="Search fruit, variety, supplier, delivery no…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search stock"
                  />
                </div>
              </label>

              <label className="block sm:col-span-1 xl:col-span-1">
                <span className="mb-1.5 block text-xs sm:text-sm font-bold text-leaf-800">
                  Fruit
                </span>
                <SelectInput
                  value={fruitFilter}
                  onChange={(e) => setFruitFilter(e.target.value)}
                  aria-label="Filter by fruit"
                  className="py-3.5 text-base"
                >
                  <option value="all">All fruits</option>
                  {fruitChoices.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </SelectInput>
              </label>

              <label className="block sm:col-span-1 xl:col-span-1">
                <span className="mb-1.5 block text-xs sm:text-sm font-bold text-leaf-800">
                  Supplier
                </span>
                <SelectInput
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  aria-label="Filter by supplier"
                  className="py-3.5 text-base"
                >
                  <option value="all">All suppliers</option>
                  {supplierChoices.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </SelectInput>
              </label>

              <label className="block sm:col-span-1 xl:col-span-1">
                <span className="mb-1.5 block text-xs sm:text-sm font-bold text-leaf-800">
                  Availability
                </span>
                <SelectInput
                  value={availabilityFilter}
                  onChange={(e) =>
                    setAvailabilityFilter(e.target.value as StockAvailabilityFilter)
                  }
                  aria-label="Filter by availability"
                  className="py-3.5 text-base"
                >
                  <option value="in_stock">In stock</option>
                  <option value="sold_out">Sold out</option>
                  <option value="all">All stock</option>
                </SelectInput>
              </label>

              <label className="block sm:col-span-1 xl:col-span-1">
                <span className="mb-1.5 block text-xs sm:text-sm font-bold text-leaf-800">
                  Payment
                </span>
                <SelectInput
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value as PaymentStatusFilter)}
                  aria-label="Filter by delivery payment status"
                  className="py-3.5 text-base"
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </SelectInput>
              </label>
            </div>
          </Card>

          {/* 2. Three large summary cards */}
          <div className="grid gap-5 sm:grid-cols-3">
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Boxes Remaining</p>
              <p className="tabular-nums mt-2 text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {totals.remainingBoxes.toLocaleString('en-IN')}
              </p>
              <p className="mt-2 text-sm font-semibold text-leaf-600">
                Out of {totals.receivedBoxes.toLocaleString('en-IN')} received in view
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Remaining Stock Value</p>
              <p className="tabular-nums mt-2 text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                ₹{totals.remainingValue.toLocaleString('en-IN')}
              </p>
              <p className="mt-2 text-sm font-semibold text-leaf-600">
                At purchase rate per box
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Stock Batches</p>
              <p className="tabular-nums mt-2 text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {filteredBatches.length}
              </p>
              <p className="mt-2 text-sm font-semibold text-leaf-600">
                Out of {batches.length} total active batches
              </p>
            </Card>
          </div>

          {/* 3. Stock History section with batch cards */}
          <div className="space-y-4">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-leaf-950">
              Stock History
            </h2>

            {filteredBatches.length === 0 ? (
              <EmptyState
                emoji="🔎"
                title="No matching stock batches"
                description="Try changing your search or filters."
                action={
                  <Button variant="secondary" size="lg" onClick={clearFilters}>
                    Show All Batches
                  </Button>
                }
              />
            ) : (
              <div className="space-y-5">
                {filteredBatches.map((batch) => (
                  <Card key={batch.batch_id} className="p-6 sm:p-7">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-display text-xl sm:text-2xl font-bold text-leaf-950">
                            {batch.fruit_name} — {batch.variety_name}
                          </h3>
                          {batch.boxes_remaining <= 0 && (
                            <Badge tone="neutral">
                              Sold out
                            </Badge>
                          )}
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:text-base font-semibold text-leaf-700">
                          <span className="inline-flex items-center gap-2">
                            <Truck className="h-5 w-5 text-leaf-500" aria-hidden />
                            <span>{batch.supplier_name}</span>
                            {!batch.supplier_active && (
                              <span className="text-xs text-stone-500 font-normal">(Inactive)</span>
                            )}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-leaf-500" aria-hidden />
                            <span>{formatDisplayDate(batch.received_date)}</span>
                          </span>
                          <span className="rounded-lg bg-cream-100 px-2.5 py-1 text-xs sm:text-sm font-bold text-leaf-800">
                            {batch.delivery_no}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-start sm:items-end gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={paymentTone(batch.delivery_payment_status)}>
                            {paymentLabel(batch.delivery_payment_status)}
                          </Badge>
                          <Button
                            variant="secondary"
                            size="md"
                            icon={Pencil}
                            onClick={() => setEditingDeliveryId(batch.delivery_id)}
                          >
                            Edit Delivery
                          </Button>
                        </div>
                        <span className="tabular-nums text-xs sm:text-sm font-semibold text-leaf-600">
                          Delivery paid ₹{batch.delivery_amount_paid.toLocaleString('en-IN')} / ₹
                          {batch.delivery_purchase_amount.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-4 rounded-xl bg-cream-100 p-4 sm:grid-cols-4 sm:p-5">
                      <div>
                        <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
                          Received
                        </p>
                        <p className="tabular-nums mt-1 text-xl sm:text-2xl font-extrabold text-leaf-950">
                          {batch.boxes_received} boxes
                        </p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
                          Remaining
                        </p>
                        <p
                          className={`tabular-nums mt-1 text-xl sm:text-2xl font-extrabold ${
                            batch.boxes_remaining > 0 ? 'text-leaf-800' : 'text-stone-500'
                          }`}
                        >
                          {batch.boxes_remaining} boxes
                        </p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
                          Purchase Rate
                        </p>
                        <p className="tabular-nums mt-1 text-xl sm:text-2xl font-extrabold text-leaf-950">
                          ₹{batch.purchase_rate.toLocaleString('en-IN')}/box
                        </p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-leaf-600">
                          Batch Cost
                        </p>
                        <p className="tabular-nums mt-1 text-xl sm:text-2xl font-extrabold text-leaf-950">
                          ₹{batch.purchase_amount.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    {batch.delivery_note && (
                      <p className="mt-4 text-sm sm:text-base text-leaf-700">
                        <span className="font-bold text-leaf-900">Note:</span> {batch.delivery_note}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <EditDeliveryModal
        deliveryId={editingDeliveryId}
        isOpen={Boolean(editingDeliveryId)}
        onClose={() => setEditingDeliveryId(null)}
        onSuccess={() => void loadBatches()}
      />
    </div>
  );
}

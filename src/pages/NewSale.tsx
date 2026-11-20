import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Calendar,
  CheckCircle2,
  Loader2,
  PackageOpen,
  Plus,
  ReceiptText,
  Trash2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  FieldWrap,
  LoadingCard,
  MoneyInput,
  SearchSelect,
  SectionHeader,
  TextInput,
} from '@/components/ui';
import type { SearchOption } from '@/components/ui';
import { listCustomers } from '@/services/masterData';
import {
  formatDisplayDate,
  generateIdempotencyKey,
  getLocalIsoDate,
  listStockBatches,
} from '@/services/inventory';
import { createBill } from '@/services/sales';
import type { BillBalance, Customer, StockBatchView } from '@/types/database';
import type { Page } from './pageTypes';

interface SaleLine {
  key: number;
  fruitId: string | null;
  varietyId: string | null;
  sellRate: string;
  /** Map of batch_id -> string box count typed manually by the user */
  allocations: Record<string, string>;
}

type BuyerKind = 'cash_customer' | 'registered';

let nextSaleLineKey = 1;
const createEmptySaleLine = (): SaleLine => ({
  key: nextSaleLineKey++,
  fruitId: null,
  varietyId: null,
  sellRate: '',
  allocations: {},
});

const WHOLE_POSITIVE_INT = /^[1-9]\d*$/;
const WHOLE_NON_NEGATIVE_INT = /^\d+$/;

function parseNonNegativeInt(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 0;
  if (!WHOLE_NON_NEGATIVE_INT.test(trimmed)) return NaN;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : NaN;
}

function parseNonNegativeMoney(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return NaN;
  return Math.round(num * 100) / 100;
}

interface NewSaleProps {
  onNavigate?: (p: Page) => void;
}

export function NewSale({ onNavigate }: NewSaleProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [availableBatches, setAvailableBatches] = useState<StockBatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [buyerKind, setBuyerKind] = useState<BuyerKind>('registered');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [billDate, setBillDate] = useState<string>(() => getLocalIsoDate());
  const [billNote, setBillNote] = useState('');
  const [lines, setLines] = useState<SaleLine[]>([createEmptySaleLine()]);

  const [paidCash, setPaidCash] = useState('');
  const [paidUpi, setPaidUpi] = useState('');

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateIdempotencyKey());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBill, setSavedBill] = useState<BillBalance | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [custList, batchList] = await Promise.all([listCustomers(), listStockBatches()]);
      setCustomers(custList.filter((c) => c.active));
      setAvailableBatches(batchList.filter((b) => b.boxes_remaining > 0));
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load customers and available stock.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const customerOptions: SearchOption[] = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.phone ?? 'No phone saved',
      })),
    [customers]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  // Fruits that currently have available stock boxes
  const fruitOptions: SearchOption[] = useMemo(() => {
    const map = new Map<string, { name: string; boxes: number; batches: number }>();
    for (const b of availableBatches) {
      const entry = map.get(b.fruit_id) ?? { name: b.fruit_name, boxes: 0, batches: 0 };
      entry.boxes += b.boxes_remaining;
      entry.batches += 1;
      map.set(b.fruit_id, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, info]) => ({
        id,
        label: info.name,
        sublabel: `${info.boxes} boxes left across ${info.batches} ${info.batches === 1 ? 'batch' : 'batches'}`,
      }));
  }, [availableBatches]);

  // Global allocated boxes per batch across ALL lines (for cross-line over-allocation guard)
  const totalAllocatedByBatch = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const parsed = parseNonNegativeInt(raw);
        if (!Number.isNaN(parsed) && parsed > 0) {
          totals.set(batchId, (totals.get(batchId) ?? 0) + parsed);
        }
      }
    }
    return totals;
  }, [lines]);

  const getVarietyOptionsForFruit = (fruitId: string | null): SearchOption[] => {
    if (!fruitId) return [];
    const map = new Map<
      string,
      { name: string; boxes: number; batches: number; defaultRate: number | null }
    >();
    for (const b of availableBatches) {
      if (b.fruit_id !== fruitId) continue;
      const entry = map.get(b.variety_id) ?? {
        name: b.variety_name,
        boxes: 0,
        batches: 0,
        defaultRate: b.default_sell_rate,
      };
      entry.boxes += b.boxes_remaining;
      entry.batches += 1;
      map.set(b.variety_id, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, info]) => ({
        id,
        label: info.name,
        sublabel: `${info.boxes} boxes in ${info.batches} ${info.batches === 1 ? 'batch' : 'batches'}${info.defaultRate !== null ? ` • Sugg ₹${info.defaultRate}/box` : ''}`,
      }));
  };

  const getBatchesForLine = (fruitId: string | null, varietyId: string | null): StockBatchView[] => {
    if (!fruitId || !varietyId) return [];
    return availableBatches.filter(
      (b) => b.fruit_id === fruitId && b.variety_id === varietyId && b.boxes_remaining > 0
    );
  };

  const updateLine = (key: number, patch: Partial<SaleLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setFormError(null);
  };

  const handleFruitChange = (key: number, nextFruitId: string) => {
    updateLine(key, {
      fruitId: nextFruitId,
      varietyId: null,
      allocations: {},
    });
  };

  const handleVarietyChange = (key: number, fruitId: string | null, nextVarietyId: string) => {
    const matchingBatch = availableBatches.find(
      (b) => b.fruit_id === fruitId && b.variety_id === nextVarietyId
    );
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const suggested =
          !l.sellRate.trim() && matchingBatch?.default_sell_rate
            ? String(matchingBatch.default_sell_rate)
            : l.sellRate;
        return {
          ...l,
          varietyId: nextVarietyId,
          sellRate: suggested,
          allocations: {},
        };
      })
    );
    setFormError(null);
  };

  const handleBatchAllocationChange = (lineKey: number, batchId: string, rawValue: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.key === lineKey ? { ...l, allocations: { ...l.allocations, [batchId]: rawValue } } : l
      )
    );
    setFormError(null);
  };

  const addLine = () => {
    setLines((prev) => [...prev, createEmptySaleLine()]);
  };

  const removeLine = (key: number) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  const lineSummaries = useMemo(() => {
    return lines.map((line) => {
      let totalBoxes = 0;
      let hasInvalidBox = false;
      let hasOverAlloc = false;

      const lineBatches = availableBatches.filter(
        (b) => b.fruit_id === line.fruitId && b.variety_id === line.varietyId
      );
      const batchMap = new Map(lineBatches.map((b) => [b.batch_id, b]));

      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (!WHOLE_NON_NEGATIVE_INT.test(trimmed)) {
          hasInvalidBox = true;
          continue;
        }
        const qty = Number(trimmed);
        if (qty === 0) continue;
        totalBoxes += qty;
        const batch = batchMap.get(batchId);
        const globalQty = totalAllocatedByBatch.get(batchId) ?? qty;
        if (!batch || globalQty > batch.boxes_remaining) {
          hasOverAlloc = true;
        }
      }

      const rate = Number(line.sellRate);
      const validRate = line.sellRate.trim() !== '' && Number.isFinite(rate) && rate > 0;
      const lineTotal =
        totalBoxes > 0 && validRate ? Math.round(totalBoxes * rate * 100) / 100 : 0;

      const firstBatch = lineBatches[0];
      return {
        key: line.key,
        fruitName: firstBatch?.fruit_name ?? '',
        varietyName: firstBatch?.variety_name ?? '',
        totalBoxes,
        lineTotal,
        hasInvalidBox,
        hasOverAlloc,
      };
    });
  }, [lines, availableBatches, totalAllocatedByBatch]);

  const { totalBoxes, subtotal, hasAnyStockIssue } = useMemo(() => {
    let boxes = 0;
    let sum = 0;
    let stockIssue = false;
    for (const s of lineSummaries) {
      boxes += s.totalBoxes;
      sum += s.lineTotal;
      if (s.hasInvalidBox || s.hasOverAlloc) stockIssue = true;
    }
    return {
      totalBoxes: boxes,
      subtotal: Math.round(sum * 100) / 100,
      hasAnyStockIssue: stockIssue,
    };
  }, [lineSummaries]);

  const cashNum = parseNonNegativeMoney(paidCash);
  const upiNum = parseNonNegativeMoney(paidUpi);
  const paymentNumbersValid = !Number.isNaN(cashNum) && !Number.isNaN(upiNum);
  const totalPaid = paymentNumbersValid ? Math.round((cashNum + upiNum) * 100) / 100 : 0;
  const creditAmount = Math.round((subtotal - totalPaid) * 100) / 100;
  const isOverpaid = paymentNumbersValid && Math.round(totalPaid * 100) > Math.round(subtotal * 100);
  const isCashCustomerWithCredit =
    buyerKind === 'cash_customer' && subtotal > 0 && Math.round(creditAmount * 100) > 0;

  const handleBuyerKindChange = (next: BuyerKind) => {
    setBuyerKind(next);
    setFormError(null);
    if (next === 'cash_customer') {
      setCustomerId(null);
      // Pre-fill full cash if no payment entered yet
      if (subtotal > 0 && totalPaid === 0) {
        setPaidCash(String(subtotal));
        setPaidUpi('');
      }
    }
  };

  const applyPresetFullCash = () => {
    setPaidCash(subtotal > 0 ? String(subtotal) : '');
    setPaidUpi('');
    setFormError(null);
  };

  const applyPresetFullUpi = () => {
    setPaidCash('');
    setPaidUpi(subtotal > 0 ? String(subtotal) : '');
    setFormError(null);
  };

  const applyPresetFullCredit = () => {
    if (buyerKind === 'cash_customer') return;
    setPaidCash('');
    setPaidUpi('');
    setFormError(null);
  };

  const validateAndBuildPayload = () => {
    if (buyerKind === 'registered' && !customerId) {
      throw new Error('Select a registered customer, or switch to Cash Customer for a walk-in sale.');
    }
    if (!billDate) {
      throw new Error('Choose the bill date.');
    }
    if (!lines.length) {
      throw new Error('Add at least one sale item.');
    }

    const batchMap = new Map(availableBatches.map((b) => [b.batch_id, b]));
    const globalBatchUsage = new Map<string, number>();

    const items = lines.map((line, idx) => {
      const lineNum = idx + 1;
      if (!line.fruitId || !line.varietyId) {
        throw new Error(`Item ${lineNum}: select both a fruit category and variety/grade.`);
      }

      const rate = Number(line.sellRate);
      if (!line.sellRate.trim() || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Item ${lineNum}: enter a selling rate per box greater than zero.`);
      }

      const cleanAllocs: { batch_id: string; boxes: number }[] = [];
      let lineBoxes = 0;

      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '0') continue;
        if (!WHOLE_POSITIVE_INT.test(trimmed)) {
          throw new Error(`Item ${lineNum}: allocated boxes must be whole numbers (1 or more).`);
        }
        const qty = Number(trimmed);
        const batch = batchMap.get(batchId);
        if (!batch || batch.fruit_id !== line.fruitId || batch.variety_id !== line.varietyId) {
          throw new Error(`Item ${lineNum}: selected batch does not match the chosen fruit/variety.`);
        }
        const newGlobal = (globalBatchUsage.get(batchId) ?? 0) + qty;
        if (newGlobal > batch.boxes_remaining) {
          throw new Error(
            `Item ${lineNum}: cannot allocate ${newGlobal} boxes from ${batch.delivery_no} (only ${batch.boxes_remaining} remaining).`
          );
        }
        globalBatchUsage.set(batchId, newGlobal);
        cleanAllocs.push({ batch_id: batchId, boxes: qty });
        lineBoxes += qty;
      }

      if (cleanAllocs.length === 0 || lineBoxes <= 0) {
        throw new Error(`Item ${lineNum}: manually allocate at least 1 box from an available stock batch.`);
      }

      return {
        fruit_id: line.fruitId,
        variety_id: line.varietyId,
        boxes: lineBoxes,
        sell_rate: Math.round(rate * 100) / 100,
        allocations: cleanAllocs,
      };
    });

    if (!paymentNumbersValid) {
      throw new Error('Enter valid non-negative Cash and UPI amounts.');
    }
    if (isOverpaid) {
      throw new Error(
        `Total payment (₹${totalPaid.toLocaleString('en-IN')}) cannot exceed bill total (₹${subtotal.toLocaleString('en-IN')}).`
      );
    }
    if (buyerKind === 'cash_customer' && Math.round(totalPaid * 100) !== Math.round(subtotal * 100)) {
      throw new Error(
        `Cash Customer bills cannot have credit. Collect the full ₹${subtotal.toLocaleString('en-IN')} in Cash and/or UPI.`
      );
    }

    return {
      customer_id: buyerKind === 'cash_customer' ? null : customerId,
      bill_date: billDate,
      items,
      paid_cash: cashNum,
      paid_upi: upiNum,
      note: billNote.trim() || null,
      idempotency_key: idempotencyKey,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSavedBill(null);

    let payload;
    try {
      payload = validateAndBuildPayload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Please review the bill before saving.');
      return;
    }

    setSaving(true);
    try {
      const created = await createBill(payload);
      setSavedBill(created);
      setLines([createEmptySaleLine()]);
      setPaidCash('');
      setPaidUpi('');
      setBillNote('');
      setIdempotencyKey(generateIdempotencyKey());
      // Refresh available stock to immediately reflect deducted boxes
      void loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save bill.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="New Sale"
        action={
          onNavigate ? (
            <Button variant="secondary" size="lg" icon={ReceiptText} onClick={() => onNavigate('bills')}>
              Sales History
            </Button>
          ) : undefined
        }
      />

      {savedBill && (
        <AlertBanner
          tone="success"
          message={`Saved Bill ${savedBill.bill_no} for ${savedBill.customer_name_snapshot} — Total ₹${savedBill.subtotal.toLocaleString('en-IN')} (Paid ₹${savedBill.amount_paid.toLocaleString('en-IN')}, Credit ₹${savedBill.outstanding_amount.toLocaleString('en-IN')}).`}
          action={
            onNavigate ? (
              <Button variant="secondary" icon={ReceiptText} onClick={() => onNavigate('bills')}>
                View in Sales History
              </Button>
            ) : undefined
          }
        />
      )}
      {formError && <AlertBanner tone="error" message={formError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />}

      {loading ? (
        <LoadingCard label="Loading customers and available stock batches…" />
      ) : !loadError && availableBatches.length === 0 ? (
        <EmptyState
          emoji="📦"
          title="No stock available to sell"
          description="Receive stock from a supplier first so you can manually allocate available boxes to a customer bill."
          action={
            onNavigate ? (
              <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
                Receive Stock
              </Button>
            ) : undefined
          }
        />
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1fr_380px]" noValidate>
          <div className="space-y-4">
            {/* Customer & Bill Details */}
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold text-leaf-950">
                  Customer &amp; Bill Info
                </h2>
                <div className="inline-flex rounded-xl border-2 border-leaf-200 bg-white p-1" role="group" aria-label="Customer type">
                  <button
                    type="button"
                    onClick={() => handleBuyerKindChange('registered')}
                    aria-pressed={buyerKind === 'registered'}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
                      buyerKind === 'registered'
                        ? 'bg-leaf-600 text-white shadow-sm'
                        : 'text-leaf-700 hover:bg-leaf-50'
                    }`}
                  >
                    <UserCheck className="h-4 w-4" aria-hidden /> Registered Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBuyerKindChange('cash_customer')}
                    aria-pressed={buyerKind === 'cash_customer'}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
                      buyerKind === 'cash_customer'
                        ? 'bg-mango-500 text-white shadow-sm'
                        : 'text-leaf-700 hover:bg-leaf-50'
                    }`}
                  >
                    <Wallet className="h-4 w-4" aria-hidden /> Cash Customer
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-5 md:grid-cols-2">
                {buyerKind === 'registered' ? (
                  <div>
                    <SearchSelect
                      label="Customer"
                      placeholder="Select customer"
                      options={customerOptions}
                      value={customerId}
                      onChange={(id) => {
                        setCustomerId(id);
                        setFormError(null);
                      }}
                      icon={false}
                    />
                    {customers.length === 0 && onNavigate && (
                      <p className="mt-1.5 text-sm font-semibold text-mango-700">
                        No registered customers yet.{' '}
                        <button
                          type="button"
                          onClick={() => onNavigate('customers')}
                          className="underline hover:text-mango-900"
                        >
                          Add customer
                        </button>{' '}
                        or use Cash Customer above.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center rounded-xl border-2 border-mango-200 bg-mango-50 px-4 py-3">
                    <div>
                      <p className="text-base font-extrabold text-mango-900">
                        Walk-in Cash Customer
                      </p>
                      <p className="text-sm text-mango-800">
                        Full payment required. Credit not allowed.
                      </p>
                    </div>
                  </div>
                )}

                <FieldWrap label="Bill date">
                  <div className="relative">
                    <Calendar
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                      aria-hidden
                    />
                    <TextInput
                      type="date"
                      className="pl-12"
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </FieldWrap>

                <div className="md:col-span-2">
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                      <span>Bill Note</span>
                      <span className="text-xs font-semibold text-leaf-500">Optional</span>
                    </span>
                    <TextInput
                      placeholder="Optional remark"
                      value={billNote}
                      onChange={(e) => setBillNote(e.target.value)}
                      disabled={saving}
                    />
                  </label>
                </div>
              </div>
            </Card>

            {/* Sale Item Cards with Manual Multi-Batch Allocation */}
            {lines.map((line, idx) => {
              const varietyOpts = getVarietyOptionsForFruit(line.fruitId);
              const lineBatches = getBatchesForLine(line.fruitId, line.varietyId);
              const summary = lineSummaries[idx];

              return (
                <Card key={line.key} className="p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-extrabold text-leaf-900">Item {idx + 1}</h2>
                      {summary.totalBoxes > 0 && (
                        <Badge tone="green">
                          {summary.totalBoxes} {summary.totalBoxes === 1 ? 'box' : 'boxes'} selected
                        </Badge>
                      )}
                    </div>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeLine(line.key)}
                        disabled={saving}
                        aria-label={`Remove item ${idx + 1}`}
                      >
                        <Trash2 className="h-5 w-5 text-red-600" aria-hidden /> Remove
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 grid gap-5 md:grid-cols-3">
                    <SearchSelect
                      label="Fruit"
                      placeholder="Select in-stock fruit"
                      options={fruitOptions}
                      value={line.fruitId}
                      onChange={(id) => handleFruitChange(line.key, id)}
                      icon={false}
                    />

                    <SearchSelect
                      label="Variety / Grade"
                      placeholder={
                        line.fruitId ? 'Select variety' : 'Select fruit first'
                      }
                      options={varietyOpts}
                      value={line.varietyId}
                      onChange={(id) => handleVarietyChange(line.key, line.fruitId, id)}
                      icon={false}
                    />

                    <FieldWrap label="Selling Rate / Box">
                      <MoneyInput
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={line.sellRate}
                        onChange={(e) => updateLine(line.key, { sellRate: e.target.value })}
                        disabled={saving}
                      />
                    </FieldWrap>
                  </div>

                  {/* Manual Batch Selection Table */}
                  {line.fruitId && line.varietyId && (
                    <div className="mt-5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-leaf-900">
                          <Boxes className="h-4 w-4 text-leaf-600" aria-hidden />
                          Batch Allocation
                        </p>
                        <span className="text-xs font-semibold text-leaf-600">
                          Choose the stock batches for this sale.
                        </span>
                      </div>

                      {lineBatches.length === 0 ? (
                        <p className="rounded-xl bg-cream-100 px-4 py-3 text-sm font-semibold text-leaf-700">
                          No available batches remaining for this variety.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {lineBatches.map((batch) => {
                            const rawVal = line.allocations[batch.batch_id] ?? '';
                            const thisLineQty = parseNonNegativeInt(rawVal);
                            const safeThisLine = Number.isNaN(thisLineQty) ? 0 : thisLineQty;
                            const globalQty = totalAllocatedByBatch.get(batch.batch_id) ?? 0;
                            const allocatedElsewhere = Math.max(0, globalQty - safeThisLine);
                            const maxForThisLine = Math.max(
                              0,
                              batch.boxes_remaining - allocatedElsewhere
                            );
                            const exceeds =
                              !Number.isNaN(thisLineQty) && thisLineQty > maxForThisLine;
                            const invalidInt =
                              rawVal.trim() !== '' && !WHOLE_NON_NEGATIVE_INT.test(rawVal.trim());

                            return (
                              <div
                                key={batch.batch_id}
                                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 transition-colors ${
                                  exceeds || invalidInt
                                    ? 'border-red-300 bg-red-50'
                                    : safeThisLine > 0
                                      ? 'border-leaf-500 bg-leaf-50/60'
                                      : 'border-leaf-100 bg-cream-50'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-extrabold text-leaf-950">
                                      {batch.delivery_no}
                                    </span>
                                    <span className="text-xs font-semibold text-leaf-700">
                                      {formatDisplayDate(batch.received_date)}
                                    </span>
                                    <span className="text-xs font-semibold text-leaf-600">
                                      • {batch.supplier_name}
                                    </span>
                                  </div>
                                  <p className="tabular-nums mt-0.5 text-xs font-semibold text-leaf-700">
                                    Available:{' '}
                                    <span className="font-extrabold text-leaf-950">
                                      {maxForThisLine} boxes
                                    </span>
                                    {allocatedElsewhere > 0 && (
                                      <span className="text-mango-700">
                                        {' '}
                                        ({allocatedElsewhere} used on another line)
                                      </span>
                                    )}{' '}
                                    • Cost ₹{batch.purchase_rate.toLocaleString('en-IN')}/box
                                  </p>
                                  {(exceeds || invalidInt) && (
                                    <p className="mt-1 text-xs font-bold text-red-700">
                                      {invalidInt
                                        ? 'Enter a whole number of boxes.'
                                        : `Cannot exceed ${maxForThisLine} available boxes.`}
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    max={maxForThisLine}
                                    step="1"
                                    placeholder="0"
                                    value={rawVal}
                                    onChange={(e) =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        e.target.value
                                      )
                                    }
                                    disabled={saving}
                                    aria-label={`Boxes from ${batch.delivery_no}`}
                                    className="tabular-nums w-24 rounded-xl border-2 border-leaf-200 bg-white px-3 py-2 text-right text-base font-bold text-leaf-950 focus:border-leaf-500 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving || maxForThisLine === 0}
                                    onClick={() =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        String(maxForThisLine)
                                      )
                                    }
                                    className="rounded-lg border border-leaf-300 bg-white px-2.5 py-2 text-xs font-bold text-leaf-700 hover:bg-leaf-100 disabled:opacity-40"
                                  >
                                    Max
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between rounded-xl bg-cream-100 px-5 py-3.5">
                    <span className="text-sm font-bold text-leaf-700">
                      Item Total ({summary.totalBoxes}{' '}
                      {summary.totalBoxes === 1 ? 'box' : 'boxes'})
                    </span>
                    <span className="tabular-nums text-2xl font-extrabold text-leaf-950">
                      ₹{summary.lineTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                </Card>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              size="lg"
              icon={Plus}
              onClick={addLine}
              disabled={saving}
            >
              Add Another Item
            </Button>
          </div>

          {/* Sticky Bill Summary & Cash / UPI / Credit Split */}
          <div className="xl:sticky xl:top-8 xl:self-start">
            <Card className="overflow-hidden">
              <div className="bg-leaf-700 px-6 py-5">
                <p className="text-sm font-bold uppercase tracking-wide text-leaf-200">
                  Bill Summary
                </p>
                <p className="tabular-nums mt-1 text-4xl font-extrabold text-white">
                  ₹{subtotal.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-sm text-leaf-100">
                  {totalBoxes} {totalBoxes === 1 ? 'box' : 'boxes'} •{' '}
                  {buyerKind === 'cash_customer'
                    ? 'Cash Customer (Walk-in)'
                    : selectedCustomer?.name ?? 'No customer selected'}
                </p>
              </div>

              <div className="space-y-5 p-6">
                {/* Quick Payment Presets */}
                <div>
                  <p className="mb-2 text-sm font-bold text-leaf-900">Quick Payment</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={applyPresetFullCash}
                      disabled={saving || subtotal <= 0}
                      className="rounded-xl border-2 border-leaf-200 bg-white px-2.5 py-2 text-xs font-bold text-leaf-800 transition-colors hover:border-leaf-500 hover:bg-leaf-50 disabled:opacity-40"
                    >
                      Full Cash
                    </button>
                    <button
                      type="button"
                      onClick={applyPresetFullUpi}
                      disabled={saving || subtotal <= 0}
                      className="rounded-xl border-2 border-leaf-200 bg-white px-2.5 py-2 text-xs font-bold text-leaf-800 transition-colors hover:border-leaf-500 hover:bg-leaf-50 disabled:opacity-40"
                    >
                      Full UPI
                    </button>
                    <button
                      type="button"
                      onClick={applyPresetFullCredit}
                      disabled={saving || buyerKind === 'cash_customer' || subtotal <= 0}
                      className="rounded-xl border-2 border-mango-200 bg-white px-2.5 py-2 text-xs font-bold text-mango-800 transition-colors hover:border-mango-500 hover:bg-mango-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Full Credit
                    </button>
                  </div>
                </div>

                {/* Split Cash + UPI Inputs */}
                <div className="grid grid-cols-2 gap-3">
                  <FieldWrap label="Cash">
                    <MoneyInput
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={paidCash}
                      onChange={(e) => {
                        setPaidCash(e.target.value);
                        setFormError(null);
                      }}
                      disabled={saving}
                    />
                  </FieldWrap>
                  <FieldWrap label="UPI">
                    <MoneyInput
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={paidUpi}
                      onChange={(e) => {
                        setPaidUpi(e.target.value);
                        setFormError(null);
                      }}
                      disabled={saving}
                    />
                  </FieldWrap>
                </div>

                {isOverpaid && (
                  <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-800">
                    Total payment exceeds bill total by ₹
                    {(totalPaid - subtotal).toLocaleString('en-IN')}.
                  </p>
                )}

                {isCashCustomerWithCredit && (
                  <p role="alert" className="rounded-xl bg-mango-50 px-3.5 py-2.5 text-sm font-bold text-mango-900">
                    Cash Customer cannot take ₹{creditAmount.toLocaleString('en-IN')} on credit.
                    Collect the full amount in Cash/UPI or choose a registered customer.
                  </p>
                )}

                {/* Itemized Preview */}
                {lineSummaries.some((s) => s.fruitName && s.totalBoxes > 0) && (
                  <ul className="space-y-2 border-t border-leaf-100 pt-4 text-sm">
                    {lineSummaries
                      .filter((s) => s.fruitName && s.totalBoxes > 0)
                      .map((s) => (
                        <li key={s.key} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium text-leaf-800">
                            {s.fruitName} ({s.varietyName}) × {s.totalBoxes}
                          </span>
                          <span className="tabular-nums font-bold text-leaf-950">
                            ₹{s.lineTotal.toLocaleString('en-IN')}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}

                {/* Live Paid vs Credit Breakdown */}
                <div className="space-y-2 border-t border-leaf-100 pt-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-leaf-700">Paid Now</span>
                    <span className="tabular-nums font-bold text-leaf-950">
                      ₹{totalPaid.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-leaf-700">Balance Due</span>
                    <span
                      className={`tabular-nums text-base font-extrabold ${
                        creditAmount > 0 ? 'text-mango-700' : 'text-leaf-700'
                      }`}
                    >
                      ₹{Math.max(0, creditAmount).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  icon={saving ? Loader2 : CheckCircle2}
                  disabled={saving || hasAnyStockIssue || isOverpaid || isCashCustomerWithCredit}
                >
                  {saving ? 'Saving Bill…' : 'Save Bill'}
                </Button>
              </div>
            </Card>
          </div>
        </form>
      )}
    </div>
  );
}

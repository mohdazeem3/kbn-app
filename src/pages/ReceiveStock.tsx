import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Calendar,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  AlertBanner,
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
import { listFruits, listFruitVarieties, listSuppliers } from '@/services/masterData';
import {
  generateIdempotencyKey,
  getLocalIsoDate,
  receiveStockDelivery,
} from '@/services/inventory';
import type { Fruit, FruitVariety, SupplierWithFruit } from '@/types/database';
import type { Page } from './pageTypes';

interface DeliveryLine {
  key: number;
  varietyId: string | null;
  boxes: string;
  purchaseRate: string;
}

type ImmediatePaymentChoice = 'later' | 'cash' | 'upi' | 'split';

let nextLineKey = 1;
const createEmptyLine = (): DeliveryLine => ({
  key: nextLineKey++,
  varietyId: null,
  boxes: '',
  purchaseRate: '',
});

const WHOLE_POSITIVE_INT = /^[1-9]\d*$/;

function parseBoxes(value: string): number {
  const trimmed = value.trim();
  if (!WHOLE_POSITIVE_INT.test(trimmed)) return 0;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : 0;
}

function parseNonNegativeMoney(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return NaN;
  return Math.round(num * 100) / 100;
}

interface ReceiveStockProps {
  onNavigate?: (p: Page) => void;
}

export function ReceiveStock({ onNavigate }: ReceiveStockProps) {
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [varieties, setVarieties] = useState<FruitVariety[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithFruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fruitId, setFruitId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [receivedDate, setReceivedDate] = useState<string>(() => getLocalIsoDate());
  const [deliveryNote, setDeliveryNote] = useState('');
  const [lines, setLines] = useState<DeliveryLine[]>([createEmptyLine()]);

  const [paymentChoice, setPaymentChoice] = useState<ImmediatePaymentChoice>('later');
  const [paidCash, setPaidCash] = useState('');
  const [paidUpi, setPaidUpi] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateIdempotencyKey());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const loadMasterData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [fruitList, varietyList, supplierList] = await Promise.all([
        listFruits(),
        listFruitVarieties(),
        listSuppliers(),
      ]);
      setFruits(fruitList);
      setVarieties(varietyList);
      setSuppliers(supplierList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load fruits and suppliers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMasterData();
  }, [loadMasterData]);

  const activeFruits = useMemo(() => fruits.filter((f) => f.active), [fruits]);

  const fruitOptions: SearchOption[] = useMemo(
    () =>
      activeFruits.map((f) => {
        const supCount = suppliers.filter(
          (s) => s.active && (s.fruit_ids?.includes(f.id) || s.fruit_id === f.id)
        ).length;
        const varCount = varieties.filter((v) => v.active && v.fruit_id === f.id).length;
        return {
          id: f.id,
          label: f.name,
          sublabel: `${varCount} ${varCount === 1 ? 'variety' : 'varieties'} • ${supCount} ${supCount === 1 ? 'supplier' : 'suppliers'}`,
        };
      }),
    [activeFruits, suppliers, varieties]
  );

  const filteredSuppliers = useMemo(
    () =>
      fruitId
        ? suppliers.filter(
            (s) => s.active && (s.fruit_ids?.includes(fruitId) || s.fruit_id === fruitId)
          )
        : [],
    [suppliers, fruitId]
  );

  const supplierOptions: SearchOption[] = useMemo(
    () =>
      filteredSuppliers.map((s) => ({
        id: s.id,
        label: s.name,
        sublabel: s.phone ? `${s.fruit_name} • ${s.phone}` : s.fruit_name,
      })),
    [filteredSuppliers]
  );

  const filteredVarieties = useMemo(
    () => (fruitId ? varieties.filter((v) => v.active && v.fruit_id === fruitId) : []),
    [varieties, fruitId]
  );

  const varietyOptions: SearchOption[] = useMemo(
    () =>
      filteredVarieties.map((v) => ({
        id: v.id,
        label: v.name,
        sublabel:
          v.default_sell_rate !== null
            ? `Selling price ref: ₹${Number(v.default_sell_rate).toLocaleString('en-IN')}/box`
            : undefined,
      })),
    [filteredVarieties]
  );

  const selectedFruit = useMemo(
    () => activeFruits.find((f) => f.id === fruitId) ?? null,
    [activeFruits, fruitId]
  );

  const selectedSupplier = useMemo(
    () => filteredSuppliers.find((s) => s.id === supplierId) ?? null,
    [filteredSuppliers, supplierId]
  );

  const handleFruitChange = (nextFruitId: string) => {
    setFruitId(nextFruitId);
    setSupplierId(null);
    setLines((prev) => prev.map((l) => ({ ...l, varietyId: null })));
    setFormError(null);
    setSavedNotice(null);
  };

  const updateLine = (key: number, patch: Partial<DeliveryLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setFormError(null);
  };

  const addLine = () => {
    setLines((prev) => [...prev, createEmptyLine()]);
  };

  const removeLine = (key: number) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  const handlePaymentChoice = (next: ImmediatePaymentChoice) => {
    setPaymentChoice(next);
    setFormError(null);
    if (next === 'later') {
      setPaidCash('');
      setPaidUpi('');
      setPaymentNote('');
    } else if (next === 'cash') {
      setPaidUpi('');
    } else if (next === 'upi') {
      setPaidCash('');
    }
  };

  const { totalBoxes, grandTotal } = useMemo(() => {
    let boxesSum = 0;
    let amountSum = 0;
    for (const line of lines) {
      const b = parseBoxes(line.boxes);
      const r = Number(line.purchaseRate);
      if (b > 0) boxesSum += b;
      if (b > 0 && Number.isFinite(r) && r > 0) {
        amountSum += Math.round(b * r * 100) / 100;
      }
    }
    return {
      totalBoxes: boxesSum,
      grandTotal: Math.round(amountSum * 100) / 100,
    };
  }, [lines]);

  const effectiveCash = paymentChoice === 'cash' || paymentChoice === 'split' ? parseNonNegativeMoney(paidCash) : 0;
  const effectiveUpi = paymentChoice === 'upi' || paymentChoice === 'split' ? parseNonNegativeMoney(paidUpi) : 0;
  const paidNowValid = !Number.isNaN(effectiveCash) && !Number.isNaN(effectiveUpi);
  const paidNow = paidNowValid ? Math.round((effectiveCash + effectiveUpi) * 100) / 100 : 0;
  const remainingPayable = Math.round((grandTotal - paidNow) * 100) / 100;
  const overpayment = paidNowValid && Math.round(paidNow * 100) > Math.round(grandTotal * 100);

  const validateAndBuildPayload = () => {
    if (!fruitId) {
      throw new Error('Select a fruit category for this delivery.');
    }
    if (!supplierId) {
      throw new Error('Select the supplier who sent this delivery.');
    }
    if (!receivedDate) {
      throw new Error('Choose the delivery received date.');
    }
    if (lines.length === 0) {
      throw new Error('Add at least one variety line.');
    }

    const items = lines.map((line, idx) => {
      const lineNum = idx + 1;
      if (!line.varietyId) {
        throw new Error(`Variety Batch ${lineNum}: select a variety / grade.`);
      }
      const trimmedBoxes = line.boxes.trim();
      if (!WHOLE_POSITIVE_INT.test(trimmedBoxes)) {
        throw new Error(`Variety Batch ${lineNum}: boxes must be a whole number (1 or more).`);
      }
      const boxes = Number(trimmedBoxes);
      const rate = Number(line.purchaseRate);
      if (!line.purchaseRate.trim() || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(
          `Variety Batch ${lineNum}: purchase rate per box is required and must be greater than zero.`
        );
      }
      return {
        variety_id: line.varietyId,
        boxes,
        purchase_rate: Math.round(rate * 100) / 100,
      };
    });

    if (!paidNowValid) {
      throw new Error('Enter valid non-negative Cash and UPI payment amounts.');
    }
    if (paymentChoice === 'cash' && effectiveCash <= 0) {
      throw new Error('Enter the Cash amount paid now, or switch to Pay Later.');
    }
    if (paymentChoice === 'upi' && effectiveUpi <= 0) {
      throw new Error('Enter the UPI amount paid now, or switch to Pay Later.');
    }
    if (paymentChoice === 'split' && (effectiveCash <= 0 || effectiveUpi <= 0)) {
      throw new Error('For Cash + UPI split, enter amounts greater than zero for both Cash and UPI.');
    }
    if (overpayment) {
      throw new Error(
        `Immediate payment (₹${paidNow.toLocaleString('en-IN')}) cannot exceed delivery purchase total (₹${grandTotal.toLocaleString('en-IN')}).`
      );
    }

    return {
      supplier_id: supplierId,
      fruit_id: fruitId,
      received_date: receivedDate,
      items,
      note: deliveryNote.trim() || null,
      paid_cash: effectiveCash,
      paid_upi: effectiveUpi,
      payment_note: paidNow > 0 ? paymentNote.trim() || null : null,
      idempotency_key: idempotencyKey,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSavedNotice(null);

    let payload;
    try {
      payload = validateAndBuildPayload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Please check the delivery form.');
      return;
    }

    setSaving(true);
    try {
      await receiveStockDelivery(payload);
      const itemCount = payload.items.length;
      const summaryMsg =
        paidNow > 0
          ? `Recorded ${totalBoxes} boxes (${itemCount} ${itemCount === 1 ? 'batch' : 'batches'}) from ${selectedSupplier?.name ?? 'supplier'}. Paid ₹${paidNow.toLocaleString('en-IN')} now; ₹${remainingPayable.toLocaleString('en-IN')} remaining.`
          : `Recorded ${totalBoxes} boxes (${itemCount} ${itemCount === 1 ? 'batch' : 'batches'}) from ${selectedSupplier?.name ?? 'supplier'} on credit (₹${grandTotal.toLocaleString('en-IN')}).`;

      setSavedNotice(summaryMsg);
      setLines([createEmptyLine()]);
      setDeliveryNote('');
      setPaymentChoice('later');
      setPaidCash('');
      setPaidUpi('');
      setPaymentNote('');
      setIdempotencyKey(generateIdempotencyKey());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save delivery.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Receive Stock" />

      {savedNotice && (
        <AlertBanner
          tone="success"
          message={savedNotice}
          action={
            onNavigate ? (
              <Button variant="secondary" icon={Boxes} onClick={() => onNavigate('stock')}>
                View Stock
              </Button>
            ) : undefined
          }
        />
      )}
      {formError && <AlertBanner tone="error" message={formError} />}
      {loadError && (
        <AlertBanner tone="error" message={loadError} onRetry={() => void loadMasterData()} />
      )}

      {loading ? (
        <LoadingCard label="Loading fruits, varieties, and suppliers…" />
      ) : !loadError && activeFruits.length === 0 ? (
        <EmptyState
          emoji="🥭"
          title="Add fruit categories first"
          description="Before receiving stock, add at least one active fruit category, its varieties/grades, and its suppliers."
          action={
            onNavigate ? (
              <Button size="lg" onClick={() => onNavigate('fruits')}>
                Go to Fruits &amp; Varieties
              </Button>
            ) : undefined
          }
        />
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1fr_380px]" noValidate>
          <div className="space-y-4">
            {/* Delivery header */}
            <Card className="p-6">
              <h2 className="font-display text-xl font-semibold text-leaf-950">
                Delivery Details
              </h2>

              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <SearchSelect
                  label="Fruit category *"
                  placeholder="Select fruit category"
                  options={fruitOptions}
                  value={fruitId}
                  onChange={handleFruitChange}
                  icon={false}
                />

                <div>
                  <SearchSelect
                    label="Supplier *"
                    placeholder={
                      fruitId ? 'Select supplier for this fruit' : 'Select fruit category first'
                    }
                    options={supplierOptions}
                    value={supplierId}
                    onChange={(id) => {
                      setSupplierId(id);
                      setFormError(null);
                    }}
                    icon={false}
                  />
                  {fruitId && filteredSuppliers.length === 0 && (
                    <p className="mt-1.5 text-sm font-semibold text-mango-700">
                      No active suppliers linked to {selectedFruit?.name}.{' '}
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('suppliers')}
                          className="underline hover:text-mango-900"
                        >
                          Add supplier
                        </button>
                      )}
                    </p>
                  )}
                </div>

                <FieldWrap label="Received date *">
                  <div className="relative">
                    <Calendar
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                      aria-hidden
                    />
                    <TextInput
                      type="date"
                      className="pl-12"
                      value={receivedDate}
                      onChange={(e) => setReceivedDate(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </FieldWrap>

                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                    <span>Delivery note</span>
                    <span className="text-xs font-semibold text-leaf-500">Optional</span>
                  </span>
                  <TextInput
                    placeholder="Challan / Lorry no / Remarks"
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                    disabled={saving}
                  />
                </label>
              </div>

              {fruitId && filteredVarieties.length === 0 && (
                <div className="mt-4">
                  <AlertBanner
                    tone="info"
                    message={`No active varieties/grades exist under ${selectedFruit?.name} yet. Add at least one variety before recording this delivery.`}
                    action={
                      onNavigate ? (
                        <Button variant="secondary" onClick={() => onNavigate('fruits')}>
                          Add Varieties
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </Card>

            {/* Variety / Grade Batch Lines */}
            {lines.map((line, idx) => {
              const lineBoxes = parseBoxes(line.boxes);
              const lineRate = Number(line.purchaseRate);
              const lineTotal =
                lineBoxes > 0 && Number.isFinite(lineRate) && lineRate > 0
                  ? Math.round(lineBoxes * lineRate * 100) / 100
                  : 0;

              return (
                <Card key={line.key} className="p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-extrabold text-leaf-900">
                      Variety Batch {idx + 1}
                    </h2>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeLine(line.key)}
                        disabled={saving}
                        aria-label={`Remove variety batch ${idx + 1}`}
                      >
                        <Trash2 className="h-5 w-5 text-red-600" aria-hidden /> Remove
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    <SearchSelect
                      label="Variety / Grade *"
                      placeholder={
                        fruitId ? `Select ${selectedFruit?.name ?? 'fruit'} variety` : 'Select fruit category first'
                      }
                      options={varietyOptions}
                      value={line.varietyId}
                      onChange={(id) => updateLine(line.key, { varietyId: id })}
                      icon={false}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FieldWrap label="Boxes *">
                        <TextInput
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          placeholder="0"
                          className="tabular-nums"
                          value={line.boxes}
                          onChange={(e) => updateLine(line.key, { boxes: e.target.value })}
                          disabled={saving}
                        />
                      </FieldWrap>

                      <FieldWrap label="Purchase rate / box *">
                        <MoneyInput
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={line.purchaseRate}
                          onChange={(e) => updateLine(line.key, { purchaseRate: e.target.value })}
                          disabled={saving}
                        />
                      </FieldWrap>
                    </div>

                    <div className="lg:col-span-2">
                      <div className="flex items-center justify-between rounded-xl bg-cream-100 px-5 py-3.5">
                        <span className="text-sm font-bold text-leaf-700">Batch Total</span>
                        <span className="tabular-nums text-2xl font-extrabold text-leaf-950">
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
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
              Add another variety
            </Button>
          </div>

          {/* Sticky Delivery Summary & Immediate Supplier Payment */}
          <div className="xl:sticky xl:top-8 xl:self-start">
            <Card className="overflow-hidden">
              <div className="bg-leaf-700 px-6 py-5">
                <p className="text-sm font-bold uppercase tracking-wide text-leaf-200">
                  Total Purchase
                </p>
                <p className="tabular-nums mt-1 text-4xl font-extrabold text-white">
                  ₹{grandTotal.toLocaleString('en-IN')}
                </p>
                <p className="mt-1 text-sm text-leaf-100">
                  {totalBoxes} {totalBoxes === 1 ? 'box' : 'boxes'} across {lines.length}{' '}
                  {lines.length === 1 ? 'variety batch' : 'variety batches'}
                </p>
                <p className="mt-1 truncate text-sm text-leaf-200">
                  {selectedFruit?.name ?? 'No fruit selected'}
                  {selectedSupplier ? ` • ${selectedSupplier.name}` : ''}
                </p>
              </div>

              <div className="space-y-5 p-6">
                <fieldset>
                  <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                    <span>Payment Now</span>
                    <span className="text-xs font-semibold text-leaf-500">Optional</span>
                  </legend>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(
                      [
                        { id: 'later', label: 'Pay Later' },
                        { id: 'cash', label: 'Cash' },
                        { id: 'upi', label: 'UPI' },
                        { id: 'split', label: 'Cash + UPI' },
                      ] as const
                    ).map((opt) => {
                      const active = paymentChoice === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handlePaymentChoice(opt.id)}
                          aria-pressed={active}
                          disabled={saving}
                          className={`rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                            active
                              ? 'border-leaf-600 bg-leaf-50 text-leaf-800'
                              : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {(paymentChoice === 'cash' || paymentChoice === 'split') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-leaf-900">
                        <IndianRupee className="h-4 w-4 text-leaf-600" aria-hidden />
                        Cash
                      </span>
                      {paymentChoice === 'cash' && grandTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => setPaidCash(String(grandTotal))}
                          className="text-xs font-bold text-mango-700 hover:underline"
                        >
                          Pay full (₹{grandTotal.toLocaleString('en-IN')})
                        </button>
                      )}
                    </div>
                    <MoneyInput
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={paidCash}
                      onChange={(e) => setPaidCash(e.target.value)}
                      disabled={saving}
                      aria-label="Cash"
                    />
                  </div>
                )}

                {(paymentChoice === 'upi' || paymentChoice === 'split') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-leaf-900">
                        <Smartphone className="h-4 w-4 text-leaf-600" aria-hidden />
                        UPI
                      </span>
                      {paymentChoice === 'upi' && grandTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => setPaidUpi(String(grandTotal))}
                          className="text-xs font-bold text-mango-700 hover:underline"
                        >
                          Pay full (₹{grandTotal.toLocaleString('en-IN')})
                        </button>
                      )}
                    </div>
                    <MoneyInput
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={paidUpi}
                      onChange={(e) => setPaidUpi(e.target.value)}
                      disabled={saving}
                      aria-label="UPI"
                    />
                  </div>
                )}

                {paymentChoice !== 'later' && (
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-leaf-900">
                      <span>Payment Note</span>
                      <span className="text-xs font-semibold text-leaf-500">Optional</span>
                    </span>
                    <TextInput
                      placeholder="UPI ref or cash remark"
                      value={paymentNote}
                      onChange={(e) => setPaymentNote(e.target.value)}
                      disabled={saving}
                    />
                  </label>
                )}

                {overpayment && (
                  <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-800">
                    Immediate payment exceeds purchase total by ₹
                    {(paidNow - grandTotal).toLocaleString('en-IN')}.
                  </p>
                )}

                <div className="space-y-2 border-t border-leaf-100 pt-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-leaf-700">Paid Now</span>
                    <span className="tabular-nums font-bold text-leaf-950">
                      ₹{paidNow.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-leaf-700">Balance Due</span>
                    <span className="tabular-nums text-base font-extrabold text-mango-700">
                      ₹{Math.max(0, remainingPayable).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  icon={saving ? Loader2 : CheckCircle2}
                  disabled={saving || overpayment}
                >
                  {saving ? 'Saving Delivery…' : 'Save Delivery to Stock'}
                </Button>
              </div>
            </Card>
          </div>
        </form>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Apple,
  Boxes,
  Calendar,
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
  Printer,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  AlertBanner,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  MoneyInput,
  SearchSelect,
  TextInput,
} from '@/components/ui';
import type { SearchOption } from '@/components/ui';
import { listFruits, listFruitVarieties, listSuppliers } from '@/services/masterData';
import { useCacheInvalidation } from '@/services/cache';
import {
  generateIdempotencyKey,
  getLocalIsoDate,
  receiveStockDelivery,
} from '@/services/inventory';
import {
  PrintableDeliveryModal,
  type DeliveryPrintSnapshot,
} from '@/components/inventory/PrintableDeliveryModal';
import type {
  Fruit,
  FruitVariety,
  ReceiveStockDeliveryInput,
  ReceiveStockItemInput,
  SupplierWithFruit,
} from '@/types/database';
import type { Page } from './pageTypes';

interface DeliveryLine {
  key: number;
  fruitId: string | null;
  varietyId: string | null;
  boxes: string;
  purchaseRate: string;
}

type ImmediatePaymentChoice = 'later' | 'cash' | 'upi' | 'split';

let nextLineKey = 1;
const createEmptyLine = (defaultFruitId: string | null = null): DeliveryLine => ({
  key: nextLineKey++,
  fruitId: defaultFruitId,
  varietyId: null,
  boxes: '',
  purchaseRate: '',
});

const isLineBlank = (line: DeliveryLine, isSingleFruit: boolean): boolean => {
  if (isSingleFruit) {
    return !line.varietyId && !line.boxes.trim() && !line.purchaseRate.trim();
  }
  return !line.fruitId && !line.varietyId && !line.boxes.trim() && !line.purchaseRate.trim();
};

const ensureTrailingEmptyRow = (
  currentLines: DeliveryLine[],
  isSingleFruit: boolean,
  singleFruitId: string | null
): DeliveryLine[] => {
  const result = [...currentLines];
  while (
    result.length > 1 &&
    isLineBlank(result[result.length - 1], isSingleFruit) &&
    isLineBlank(result[result.length - 2], isSingleFruit)
  ) {
    result.pop();
  }
  if (result.length === 0 || !isLineBlank(result[result.length - 1], isSingleFruit)) {
    result.push(createEmptyLine(isSingleFruit ? singleFruitId : null));
  }
  return result;
};

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
  isActive?: boolean;
}

export function ReceiveStock({ onNavigate, isActive = true }: ReceiveStockProps) {
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [varieties, setVarieties] = useState<FruitVariety[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithFruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Left Box — Supplier Details
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierPhone, setSupplierPhone] = useState('');
  const [receivedDate, setReceivedDate] = useState<string>(() => getLocalIsoDate());

  // Right Box — Delivery & Payment
  const [deliveryNote, setDeliveryNote] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<ImmediatePaymentChoice>('later');
  const [paidCash, setPaidCash] = useState('');
  const [paidUpi, setPaidUpi] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  // Product Entry Lines
  const [lines, setLines] = useState<DeliveryLine[]>([createEmptyLine(null)]);

  // Save & Print State
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateIdempotencyKey());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [printDeliveryId, setPrintDeliveryId] = useState<string | null>(null);
  const [printSnapshot, setPrintSnapshot] = useState<DeliveryPrintSnapshot | null>(null);
  const [autoPrintTrigger, setAutoPrintTrigger] = useState(false);

  const loadMasterData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
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

  useCacheInvalidation(['suppliers', 'fruits', 'varieties'], () => void loadMasterData(true), { isActive });

  const activeFruits = useMemo(() => fruits.filter((f) => f.active), [fruits]);
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active), [suppliers]);

  const fruitsById = useMemo(() => {
    const map = new Map<string, Fruit>();
    for (const f of fruits) {
      map.set(f.id, f);
    }
    return map;
  }, [fruits]);

  const varietiesByFruit = useMemo(() => {
    const map = new Map<string, FruitVariety[]>();
    for (const v of varieties) {
      if (!v.active) continue;
      const existing = map.get(v.fruit_id) ?? [];
      existing.push(v);
      map.set(v.fruit_id, existing);
    }
    return map;
  }, [varieties]);

  const selectedSupplier = useMemo(
    () => (supplierId ? activeSuppliers.find((s) => s.id === supplierId) ?? null : null),
    [activeSuppliers, supplierId]
  );

  const supplierFruitOptions: SearchOption[] = useMemo(() => {
    if (!selectedSupplier) return [];
    const sFruitIds = selectedSupplier.fruit_ids?.length
      ? selectedSupplier.fruit_ids
      : selectedSupplier.fruit_id
        ? [selectedSupplier.fruit_id]
        : [];
    return activeFruits
      .filter((f) => sFruitIds.includes(f.id))
      .map((f) => {
        const varCount = (varietiesByFruit.get(f.id) ?? []).length;
        return {
          id: f.id,
          label: f.name,
          sublabel: `${varCount} ${varCount === 1 ? 'variety' : 'varieties'} available`,
        };
      });
  }, [selectedSupplier, activeFruits, varietiesByFruit]);

  const isSingleFruitSupplier = supplierFruitOptions.length === 1;
  const singleFruitId = isSingleFruitSupplier ? supplierFruitOptions[0].id : null;
  const singleFruitName = isSingleFruitSupplier ? supplierFruitOptions[0].label : '';

  const supplierOptions: SearchOption[] = useMemo(
    () =>
      activeSuppliers.map((s) => ({
        id: s.id,
        label: s.name,
        sublabel: s.phone ? `${s.fruit_name} • ${s.phone}` : s.fruit_name,
      })),
    [activeSuppliers]
  );

  const handleSupplierChange = (nextSupplierId: string | null) => {
    if (nextSupplierId === supplierId) return;
    setSupplierId(nextSupplierId);
    setFormError(null);
    setSavedNotice(null);

    if (!nextSupplierId) {
      setSupplierPhone('');
      setLines([createEmptyLine(null)]);
      return;
    }

    const nextSupplier = activeSuppliers.find((s) => s.id === nextSupplierId);
    // Autofill phone from supplier record; user can edit it for this delivery without touching master
    setSupplierPhone(nextSupplier?.phone ?? '');

    const sFruitIds = nextSupplier?.fruit_ids?.length
      ? nextSupplier.fruit_ids
      : nextSupplier?.fruit_id
        ? [nextSupplier.fruit_id]
        : [];
    const nextFruits = activeFruits.filter((f) => sFruitIds.includes(f.id));

    const defaultFruitId = nextFruits.length === 1 ? nextFruits[0].id : null;
    setLines([createEmptyLine(defaultFruitId)]);
  };

  const updateLine = (key: number, patch: Partial<DeliveryLine>) => {
    setLines((prev) => {
      const updated = prev.map((l) => (l.key === key ? { ...l, ...patch } : l));
      return ensureTrailingEmptyRow(updated, isSingleFruitSupplier, singleFruitId);
    });
    setFormError(null);
  };

  const handleLineFruitChange = (key: number, nextFruitId: string) => {
    setLines((prev) => {
      const updated = prev.map((l) =>
        l.key === key ? { ...l, fruitId: nextFruitId, varietyId: null } : l
      );
      return ensureTrailingEmptyRow(updated, isSingleFruitSupplier, singleFruitId);
    });
    setFormError(null);
  };

  const handleLineVarietyChange = (key: number, nextVarietyId: string) => {
    setLines((prev) => {
      const updated = prev.map((l) =>
        l.key === key ? { ...l, varietyId: nextVarietyId } : l
      );
      return ensureTrailingEmptyRow(updated, isSingleFruitSupplier, singleFruitId);
    });
    setFormError(null);
  };

  const addLine = () => {
    const defaultFruitId = isSingleFruitSupplier ? singleFruitId : null;
    setLines((prev) => {
      if (prev.length > 0 && isLineBlank(prev[prev.length - 1], isSingleFruitSupplier)) {
        return prev;
      }
      return [...prev, createEmptyLine(defaultFruitId)];
    });
    setFormError(null);
  };

  const removeLine = (key: number) => {
    setLines((prev) => {
      const filtered = prev.filter((l) => l.key !== key);
      return ensureTrailingEmptyRow(filtered, isSingleFruitSupplier, singleFruitId);
    });
    setFormError(null);
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
      if (grandTotal > 0) setPaidCash(String(grandTotal));
    } else if (next === 'upi') {
      setPaidCash('');
      if (grandTotal > 0) setPaidUpi(String(grandTotal));
    } else if (next === 'split') {
      if (!paidCash && !paidUpi && grandTotal > 0) {
        setPaidCash(String(grandTotal));
      }
    }
  };

  const { totalBoxes, grandTotal } = useMemo(() => {
    let boxesSum = 0;
    let amountSum = 0;
    for (const line of lines) {
      if (isLineBlank(line, isSingleFruitSupplier)) continue;
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
  }, [lines, isSingleFruitSupplier]);

  const distinctFruitNames = useMemo(() => {
    const set = new Set<string>();
    for (const line of lines) {
      if (isLineBlank(line, isSingleFruitSupplier)) continue;
      const fId = isSingleFruitSupplier ? singleFruitId : line.fruitId;
      if (fId) {
        const f = fruitsById.get(fId);
        if (f) set.add(f.name);
      }
    }
    return Array.from(set);
  }, [lines, isSingleFruitSupplier, singleFruitId, fruitsById]);

  const effectiveCash =
    paymentChoice === 'cash' || paymentChoice === 'split' ? parseNonNegativeMoney(paidCash) : 0;
  const effectiveUpi =
    paymentChoice === 'upi' || paymentChoice === 'split' ? parseNonNegativeMoney(paidUpi) : 0;
  const paidNowValid = !Number.isNaN(effectiveCash) && !Number.isNaN(effectiveUpi);
  const paidNow = paidNowValid ? Math.round((effectiveCash + effectiveUpi) * 100) / 100 : 0;
  const remainingPayable = Math.round((grandTotal - paidNow) * 100) / 100;
  const overpayment = paidNowValid && Math.round(paidNow * 100) > Math.round(grandTotal * 100);

  const validateAndBuildPayload = (): ReceiveStockDeliveryInput => {
    if (!supplierId || !selectedSupplier) {
      throw new Error('Select the supplier who sent this delivery.');
    }
    if (!receivedDate) {
      throw new Error('Choose the delivery received date.');
    }

    const activeLines = lines.filter((l) => !isLineBlank(l, isSingleFruitSupplier));
    if (activeLines.length === 0) {
      throw new Error('Add at least one variety batch line to this delivery.');
    }

    const sFruitIds = selectedSupplier.fruit_ids?.length
      ? selectedSupplier.fruit_ids
      : selectedSupplier.fruit_id
        ? [selectedSupplier.fruit_id]
        : [];

    const items: ReceiveStockItemInput[] = activeLines.map((line, idx) => {
      const lineNum = idx + 1;
      const lineFruitId = isSingleFruitSupplier ? singleFruitId : line.fruitId;

      if (!lineFruitId) {
        throw new Error(`Line ${lineNum}: select a fruit category.`);
      }
      if (!sFruitIds.includes(lineFruitId) && selectedSupplier.fruit_id !== lineFruitId) {
        throw new Error(
          `Line ${lineNum}: ${selectedSupplier.name} is not registered to supply ${fruitsById.get(lineFruitId)?.name ?? 'this fruit'
          }.`
        );
      }
      if (!line.varietyId) {
        throw new Error(`Line ${lineNum}: select a variety / grade.`);
      }
      const fruitVarieties = varietiesByFruit.get(lineFruitId) ?? [];
      if (!fruitVarieties.some((v) => v.id === line.varietyId)) {
        throw new Error(
          `Line ${lineNum}: selected variety does not belong to the chosen fruit category.`
        );
      }

      const trimmedBoxes = line.boxes.trim();
      if (!WHOLE_POSITIVE_INT.test(trimmedBoxes)) {
        throw new Error(`Line ${lineNum}: boxes must be a whole number (1 or more).`);
      }
      const boxes = Number(trimmedBoxes);
      const rate = Number(line.purchaseRate);
      if (!line.purchaseRate.trim() || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(
          `Line ${lineNum}: purchase rate per box is required and must be greater than zero.`
        );
      }

      return {
        fruit_id: lineFruitId,
        variety_id: line.varietyId,
        boxes,
        purchase_rate: Math.round(rate * 100) / 100,
      };
    });

    if (!paidNowValid) {
      throw new Error('Enter valid non-negative Cash and UPI payment amounts.');
    }
    if (paymentChoice === 'cash' && effectiveCash <= 0) {
      throw new Error('Enter the Cash amount paid now, or switch to CREDIT.');
    }
    if (paymentChoice === 'upi' && effectiveUpi <= 0) {
      throw new Error('Enter the UPI amount paid now, or switch to CREDIT.');
    }
    if (paymentChoice === 'split' && (effectiveCash <= 0 || effectiveUpi <= 0)) {
      throw new Error('For Cash + UPI split, enter amounts greater than zero for both Cash and UPI.');
    }
    if (overpayment) {
      throw new Error(
        `Immediate payment (₹${paidNow.toLocaleString('en-IN')}) cannot exceed delivery purchase total (₹${grandTotal.toLocaleString('en-IN')}).`
      );
    }

    const uniqueFruits = Array.from(new Set(items.map((i) => i.fruit_id)));
    const topLevelFruitId = uniqueFruits.length === 1 ? uniqueFruits[0] : null;

    return {
      supplier_id: supplierId,
      fruit_id: topLevelFruitId,
      received_date: receivedDate,
      items,
      note: deliveryNote.trim() || null,
      paid_cash: effectiveCash,
      paid_upi: effectiveUpi,
      payment_note: paidNow > 0 ? paymentNote.trim() || null : null,
      idempotency_key: idempotencyKey,
    };
  };

  const handleSave = async (shouldPrint: boolean) => {
    setFormError(null);
    setSavedNotice(null);

    let payload: ReceiveStockDeliveryInput;
    try {
      payload = validateAndBuildPayload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Please check the delivery form.');
      return;
    }

    // Build print snapshot before clearing form
    const snapshotItems = payload.items.map((item) => {
      const f = fruitsById.get(item.fruit_id);
      const v = (varietiesByFruit.get(item.fruit_id) ?? []).find((varItem) => varItem.id === item.variety_id);
      return {
        fruit_name: f?.name ?? 'Fruit',
        variety_name: v?.name ?? 'Variety',
        boxes: item.boxes,
        purchase_rate: item.purchase_rate,
        line_total: Math.round(item.boxes * item.purchase_rate * 100) / 100,
      };
    });

    const snapshot: DeliveryPrintSnapshot = {
      supplier_name: selectedSupplier?.name ?? 'Supplier',
      supplier_phone: supplierPhone.trim() || undefined,
      received_date: receivedDate,
      challan_no: deliveryNote.trim() || undefined,
      items: snapshotItems,
      total_boxes: totalBoxes,
      total_amount: grandTotal,
      amount_paid: paidNow,
      outstanding_amount: remainingPayable,
      payment_mode: paymentChoice,
      note: deliveryNote.trim() || undefined,
    };

    setSaving(true);
    try {
      const deliveryIdCreated = await receiveStockDelivery(payload);
      const itemCount = payload.items.length;
      const fruitSummary =
        distinctFruitNames.length > 0
          ? `${distinctFruitNames.join(', ')} (${distinctFruitNames.length} ${distinctFruitNames.length === 1 ? 'fruit' : 'fruits'
          })`
          : 'fruits';

      const summaryMsg =
        paidNow > 0
          ? `Saved ${totalBoxes} boxes of ${fruitSummary} (${itemCount} ${itemCount === 1 ? 'batch' : 'batches'
          }) from ${selectedSupplier?.name ?? 'supplier'}. Paid ₹${paidNow.toLocaleString(
            'en-IN'
          )} now; ₹${remainingPayable.toLocaleString('en-IN')} remaining.`
          : `Saved ${totalBoxes} boxes of ${fruitSummary} (${itemCount} ${itemCount === 1 ? 'batch' : 'batches'
          }) from ${selectedSupplier?.name ?? 'supplier'} on credit (₹${grandTotal.toLocaleString(
            'en-IN'
          )}).`;

      setSavedNotice(summaryMsg);

      // Reset form state with single trailing blank line
      const defaultFruitId = isSingleFruitSupplier ? singleFruitId : null;
      setLines([createEmptyLine(defaultFruitId)]);
      setDeliveryNote('');
      setPaymentChoice('later');
      setPaidCash('');
      setPaidUpi('');
      setPaymentNote('');
      setIdempotencyKey(generateIdempotencyKey());

      // If Save & Print was clicked, immediately open the print modal
      if (shouldPrint) {
        setPrintSnapshot(snapshot);
        setPrintDeliveryId(deliveryIdCreated);
        setAutoPrintTrigger(true);
      }

      void loadMasterData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save delivery.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Status Notifications */}
      {savedNotice && (
        <AlertBanner
          tone="success"
          message={savedNotice}
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={Printer}
                onClick={() => {
                  setAutoPrintTrigger(false);
                }}
              >
                Print Receipt
              </Button>
              {onNavigate && (
                <Button size="sm" variant="secondary" icon={Boxes} onClick={() => onNavigate('stock')}>
                  View Stock
                </Button>
              )}
            </div>
          }
        />
      )}
      {formError && <AlertBanner tone="error" message={formError} />}
      {loadError && (
        <AlertBanner tone="error" message={loadError} onRetry={() => void loadMasterData()} />
      )}

      {loading ? (
        <LoadingCard label="Loading suppliers, fruits, and varieties…" />
      ) : !loadError && activeSuppliers.length === 0 ? (
        <EmptyState
          emoji="🚛"
          title="Add active suppliers first"
          description="Before receiving stock, add at least one active supplier with registered fruit categories."
          action={
            onNavigate ? (
              <Button size="lg" icon={Truck} onClick={() => onNavigate('suppliers')}>
                Go to Suppliers
              </Button>
            ) : undefined
          }
        />
      ) : !loadError && activeFruits.length === 0 ? (
        <EmptyState
          emoji="🥭"
          title="Add fruit categories first"
          description="Before receiving stock, add at least one active fruit category and its varieties."
          action={
            onNavigate ? (
              <Button size="lg" icon={Apple} onClick={() => onNavigate('fruits')}>
                Go to Fruits &amp; Varieties
              </Button>
            ) : undefined
          }
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.target as HTMLElement;
              if (target.tagName === 'INPUT' && target.getAttribute('type') !== 'submit') {
                e.preventDefault();
              }
            }
          }}
          className="space-y-3 pb-8"
          noValidate
        >
          {/* SECTION 1: TWO COMPACT BOXES SIDE BY SIDE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
            {/* LEFT BOX — Supplier Details */}
            <div className="rounded-xl border border-leaf-200 bg-white p-3 shadow-xs flex flex-col justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                {/* Supplier Name Selector */}
                <div className="sm:col-span-12">
                  <SearchSelect
                    placeholder="Select supplier *"
                    options={supplierOptions}
                    value={supplierId}
                    onChange={handleSupplierChange}
                    icon={false}
                    compact
                    className="!h-10 !py-2 !px-3 !text-sm font-semibold"
                  />
                </div>

                {/* Supplier Mobile (autofilled from supplier, editable for this delivery only) */}
                <div className="sm:col-span-6">
                  <TextInput
                    type="tel"
                    placeholder="Supplier Mobile Number"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    disabled={saving}
                    compact
                    className="!h-10 !py-2 !px-3 !text-sm font-semibold"
                  />
                </div>

                {/* Received Date */}
                <div className="sm:col-span-6">
                  <div className="relative">
                    <Calendar
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-leaf-500"
                      aria-hidden
                    />
                    <TextInput
                      type="date"
                      value={receivedDate}
                      onChange={(e) => setReceivedDate(e.target.value)}
                      disabled={saving}
                      compact
                      className="!h-10 !py-2 !pl-9 !pr-3 !text-sm font-semibold"
                    />
                  </div>
                </div>
              </div>

              {selectedSupplier && supplierFruitOptions.length === 0 && (
                <div className="mt-2 text-xs font-semibold text-mango-800 bg-mango-50 p-2 rounded-lg border border-mango-200">
                  Supplier has no active fruit categories registered.
                </div>
              )}
            </div>

            {/* RIGHT BOX — Delivery and Payment */}
            <div className="rounded-xl border border-leaf-200 bg-white p-3 shadow-xs flex flex-col justify-between gap-2">
              {/* Row 1: Bill Number & Challan / Lorry No */}
              <div className="grid grid-cols-2 gap-2.5 items-center">
                <div className="flex h-10 items-center px-3 rounded-lg border border-leaf-200 bg-cream-100/90 text-sm font-bold text-leaf-950">
                  <span className="text-leaf-600 font-semibold mr-1.5 text-xs uppercase tracking-wider">Bill No</span>
                  <span className="truncate">Auto on Save</span>
                </div>
                <div>
                  <TextInput
                    placeholder="Challan / Lorry No"
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                    disabled={saving}
                    compact
                    className="!h-10 !py-2 !px-3 !text-sm font-semibold"
                  />
                </div>
              </div>

              {/* Row 2: Metrics Summary */}
              <div className="grid grid-cols-4 gap-2 py-1.5 px-2 rounded-lg bg-cream-50/80 border border-leaf-100 text-center">
                <div>
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Total</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-950 block truncate">
                    ₹{grandTotal.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Boxes</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-950 block truncate">
                    {totalBoxes}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Paid</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-700 block truncate">
                    ₹{paidNow.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-mango-800 block">Due</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-mango-900 block truncate">
                    ₹{Math.max(0, remainingPayable).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Row 3: Payment Amount Input & Mode Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                {/* 1. Payment Amount Input at the beginning */}
                <div className="flex items-center gap-2">
                  {paymentChoice === 'cash' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        min="0"
                        step="0.01"
                        placeholder="Cash Amount"
                        value={paidCash}
                        onChange={(e) => {
                          setPaidCash(e.target.value);
                          setFormError(null);
                        }}
                        disabled={saving}
                        aria-label="Cash amount paid"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                      />
                    </div>
                  )}

                  {paymentChoice === 'later' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        placeholder="0.00"
                        value=""
                        disabled
                        aria-label="Credit amount (pay later)"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg bg-cream-100/60 opacity-60 cursor-not-allowed"
                      />
                    </div>
                  )}

                  {paymentChoice === 'upi' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        min="0"
                        step="0.01"
                        placeholder="UPI Amount"
                        value={paidUpi}
                        onChange={(e) => {
                          setPaidUpi(e.target.value);
                          setFormError(null);
                        }}
                        disabled={saving}
                        aria-label="UPI amount paid"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                      />
                    </div>
                  )}

                  {paymentChoice === 'split' && (
                    <div className="flex items-center gap-2">
                      <div className="w-24 sm:w-28">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="Cash"
                          value={paidCash}
                          onChange={(e) => {
                            setPaidCash(e.target.value);
                            setFormError(null);
                          }}
                          disabled={saving}
                          aria-label="Cash split amount"
                          className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                        />
                      </div>
                      <div className="w-24 sm:w-28">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="UPI"
                          value={paidUpi}
                          onChange={(e) => {
                            setPaidUpi(e.target.value);
                            setFormError(null);
                          }}
                          disabled={saving}
                          aria-label="UPI split amount"
                          className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Mode Buttons: 1. CASH, 2. CREDIT, 3. UPI, 4. SPLIT */}
                <div className="inline-flex rounded-xl border border-leaf-200 bg-cream-100 p-1 shrink-0">
                  {(['cash', 'later', 'upi', 'split'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handlePaymentChoice(opt)}
                      disabled={saving}
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1 ${
                        paymentChoice === opt
                          ? opt === 'later'
                            ? 'bg-mango-600 text-white shadow-xs'
                            : 'bg-leaf-600 text-white shadow-xs'
                          : 'text-leaf-800 hover:bg-leaf-50'
                      }`}
                    >
                      {opt === 'later' ? 'CREDIT' : opt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: PRODUCT ENTRY TABLE (MAIN FOCUS) */}
          <div className="hidden md:block rounded-xl border border-leaf-200 bg-white shadow-xs">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-leaf-200 bg-cream-100 text-2xs font-extrabold uppercase tracking-wider text-leaf-800">
                  <th className="py-2 px-2.5 text-center w-10 rounded-tl-xl">#</th>
                  <th className="py-2 px-2.5 min-w-[180px]">Fruit Category</th>
                  <th className="py-2 px-2.5 min-w-[200px]">Variety / Grade</th>
                  <th className="py-2 px-2.5 w-28 text-right">Boxes</th>
                  <th className="py-2 px-2.5 w-32 text-right">Rate / Box</th>
                  <th className="py-2 px-2.5 w-32 text-right">Batch Total</th>
                  <th className="py-2 px-2 text-center w-10 rounded-tr-xl"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-leaf-100">
                {lines.map((line, idx) => {
                  const lineBoxes = parseBoxes(line.boxes);
                  const lineRate = Number(line.purchaseRate);
                  const lineTotal =
                    lineBoxes > 0 && Number.isFinite(lineRate) && lineRate > 0
                      ? Math.round(lineBoxes * lineRate * 100) / 100
                      : 0;

                  const lineFruitId = isSingleFruitSupplier ? singleFruitId : line.fruitId;
                  const lineVarieties = lineFruitId ? varietiesByFruit.get(lineFruitId) ?? [] : [];

                  const varietyOptions: SearchOption[] = lineVarieties.map((v) => ({
                    id: v.id,
                    label: v.name,
                    sublabel:
                      v.default_sell_rate !== null
                        ? `Sugg ₹${Number(v.default_sell_rate).toLocaleString('en-IN')}`
                        : undefined,
                  }));

                  const isBlank = isLineBlank(line, isSingleFruitSupplier);

                  return (
                    <tr
                      key={line.key}
                      className={`transition-colors ${isBlank ? 'bg-cream-50/20' : 'hover:bg-leaf-50/30'
                        }`}
                    >
                      {/* # */}
                      <td className="py-1 px-2.5 text-center font-bold text-xs text-leaf-500">
                        {idx + 1}
                      </td>

                      {/* Fruit Category */}
                      <td className="py-1 px-2.5">
                        {isSingleFruitSupplier ? (
                          <div className="flex h-8 items-center gap-1.5 rounded-lg border border-leaf-200 bg-leaf-50 px-2 text-xs font-extrabold text-leaf-950">
                            <Apple className="h-3.5 w-3.5 text-leaf-600 shrink-0" aria-hidden />
                            <span className="truncate">{singleFruitName}</span>
                            <Lock className="h-3 w-3 text-leaf-500 shrink-0 ml-auto" aria-hidden />
                          </div>
                        ) : (
                          <SearchSelect
                            compact
                            placeholder="Select fruit"
                            options={supplierFruitOptions}
                            value={line.fruitId}
                            onChange={(fId) => handleLineFruitChange(line.key, fId)}
                            disabled={!selectedSupplier || saving}
                            icon={false}
                          />
                        )}
                      </td>

                      {/* Variety / Grade */}
                      <td className="py-1 px-2.5">
                        <SearchSelect
                          compact
                          placeholder={
                            !selectedSupplier
                              ? 'Select supplier'
                              : !lineFruitId
                                ? 'Select fruit first'
                                : lineVarieties.length === 0
                                  ? 'No varieties'
                                  : 'Select variety'
                          }
                          options={varietyOptions}
                          value={line.varietyId}
                          onChange={(vId) => handleLineVarietyChange(line.key, vId)}
                          disabled={!selectedSupplier || !lineFruitId || saving}
                          icon={false}
                        />
                      </td>

                      {/* Boxes */}
                      <td className="py-1 px-2.5">
                        <TextInput
                          compact
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          placeholder="0"
                          className="text-right font-bold"
                          value={line.boxes}
                          onChange={(e) => updateLine(line.key, { boxes: e.target.value })}
                          disabled={saving}
                        />
                      </td>

                      {/* Rate / Box */}
                      <td className="py-1 px-2.5">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="font-bold text-right"
                          value={line.purchaseRate}
                          onChange={(e) => updateLine(line.key, { purchaseRate: e.target.value })}
                          disabled={saving}
                        />
                      </td>

                      {/* Batch Total */}
                      <td className="py-1 px-2.5 text-right tabular-nums text-xs font-extrabold text-leaf-950">
                        {lineTotal > 0 ? `₹${lineTotal.toLocaleString('en-IN')}` : '—'}
                      </td>

                      {/* Remove */}
                      <td className="py-1 px-2 text-center">
                        {lines.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            disabled={saving}
                            className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            title={`Remove row ${idx + 1}`}
                            aria-label={`Remove row ${idx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="inline-block w-3.5" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Layout (md:hidden) — Readable compact cards */}
          <div className="space-y-2.5 md:hidden">
            {lines.map((line, idx) => {
              const lineBoxes = parseBoxes(line.boxes);
              const lineRate = Number(line.purchaseRate);
              const lineTotal =
                lineBoxes > 0 && Number.isFinite(lineRate) && lineRate > 0
                  ? Math.round(lineBoxes * lineRate * 100) / 100
                  : 0;

              const lineFruitId = isSingleFruitSupplier ? singleFruitId : line.fruitId;
              const lineFruit = lineFruitId ? fruitsById.get(lineFruitId) : null;
              const lineVarieties = lineFruitId ? varietiesByFruit.get(lineFruitId) ?? [] : [];

              const varietyOptions: SearchOption[] = lineVarieties.map((v) => ({
                id: v.id,
                label: v.name,
                sublabel:
                  v.default_sell_rate !== null
                    ? `Sugg ₹${Number(v.default_sell_rate).toLocaleString('en-IN')}`
                    : undefined,
              }));

              const isBlank = isLineBlank(line, isSingleFruitSupplier);

              return (
                <Card
                  key={line.key}
                  className={`p-3 space-y-2 border transition-colors ${isBlank ? 'border-dashed border-leaf-200 bg-cream-50/50' : 'border-leaf-200'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-leaf-100 text-2xs font-bold text-leaf-800">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-extrabold text-leaf-950">
                        {lineFruit ? lineFruit.name : 'New Batch Row'}
                      </span>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={saving}
                        className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        aria-label={`Remove row ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {isSingleFruitSupplier ? (
                      <div className="flex items-center justify-between rounded-lg border border-leaf-200 bg-leaf-50 px-2.5 py-1.5 text-xs font-bold text-leaf-950">
                        <span className="flex items-center gap-1.5">
                          <Apple className="h-3.5 w-3.5 text-leaf-600" />
                          {singleFruitName}
                        </span>
                        <Lock className="h-3 w-3 text-leaf-500" />
                      </div>
                    ) : (
                      <SearchSelect
                        compact
                        placeholder="Select fruit"
                        options={supplierFruitOptions}
                        value={line.fruitId}
                        onChange={(fId) => handleLineFruitChange(line.key, fId)}
                        disabled={!selectedSupplier || saving}
                        icon={false}
                      />
                    )}

                    <SearchSelect
                      compact
                      placeholder={lineFruitId ? 'Select variety' : 'Select fruit first'}
                      options={varietyOptions}
                      value={line.varietyId}
                      onChange={(vId) => handleLineVarietyChange(line.key, vId)}
                      disabled={!selectedSupplier || !lineFruitId || saving}
                      icon={false}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <TextInput
                      compact
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      placeholder="Boxes"
                      className="font-bold text-right"
                      value={line.boxes}
                      onChange={(e) => updateLine(line.key, { boxes: e.target.value })}
                      disabled={saving}
                    />

                    <MoneyInput
                      compact
                      min="0"
                      step="0.01"
                      placeholder="Rate / Box"
                      className="font-bold text-right"
                      value={line.purchaseRate}
                      onChange={(e) => updateLine(line.key, { purchaseRate: e.target.value })}
                      disabled={saving}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-cream-100 px-2.5 py-1 text-xs">
                    <span className="font-bold text-leaf-700">Batch Total:</span>
                    <span className="tabular-nums font-extrabold text-leaf-950">
                      ₹{lineTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                </Card>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              icon={Plus}
              onClick={addLine}
              disabled={!selectedSupplier || saving}
            >
              Add Row
            </Button>
          </div>

          {/* SECTION 3: SAVE & PRINT ACTION AT THE BOTTOM */}
          <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 py-2.5 bg-white/95 backdrop-blur border-t border-leaf-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              {onNavigate && (
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  icon={Boxes}
                  onClick={() => onNavigate('stock')}
                >
                  View Stock
                </Button>
              )}
              {overpayment && (
                <span className="text-xs font-bold text-red-600">
                  Payment exceeds total by ₹{(paidNow - grandTotal).toLocaleString('en-IN')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="md"
                variant="secondary"
                icon={saving ? Loader2 : CheckCircle2}
                disabled={saving || overpayment || !selectedSupplier}
                onClick={() => void handleSave(false)}
              >
                {saving ? 'Saving…' : 'Save Delivery'}
              </Button>

              <Button
                type="button"
                size="md"
                variant="primary"
                icon={saving ? Loader2 : Printer}
                disabled={saving || overpayment || !selectedSupplier}
                onClick={() => void handleSave(true)}
              >
                {saving ? 'Saving…' : 'Save & Print'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Printable Delivery Receipt Modal */}
      {printDeliveryId && (
        <PrintableDeliveryModal
          deliveryId={printDeliveryId}
          snapshot={printSnapshot}
          autoPrint={autoPrintTrigger}
          onAutoPrintDone={() => setAutoPrintTrigger(false)}
          onClose={() => {
            setPrintDeliveryId(null);
            setPrintSnapshot(null);
            setAutoPrintTrigger(false);
          }}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Lock,
  Plus,
  RotateCw,
  Save,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  FieldWrap,
  LoadingCard,
  Modal,
  MoneyInput,
  SelectInput,
  TextInput,
} from '@/components/ui';
import {
  editStockDelivery,
  formatDisplayDate,
  getDeliveryDetail,
} from '@/services/inventory';
import {
  listFruits,
  listFruitVarieties,
  listSuppliers,
} from '@/services/masterData';
import type {
  DeliveryBalance,
  Fruit,
  FruitVariety,
  SupplierWithFruit,
} from '@/types/database';

interface EditDeliveryModalProps {
  deliveryId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface EditableBatchRow {
  tempKey: string;
  batch_id: string | null;
  line_no: number;
  fruit_id: string;
  variety_id: string;
  boxes: number;
  purchase_rate: number;
  boxes_sold: number;
  has_allocations: boolean;
  fruit_name: string;
  variety_name: string;
}

export function EditDeliveryModal({
  deliveryId,
  isOpen,
  onClose,
  onSuccess,
}: EditDeliveryModalProps) {
  const [delivery, setDelivery] = useState<DeliveryBalance | null>(null);
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [rows, setRows] = useState<EditableBatchRow[]>([]);
  const [note, setNote] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');

  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [varieties, setVarieties] = useState<FruitVariety[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithFruit[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!deliveryId) return;
    setLoading(true);
    setError(null);
    try {
      const [detailRes, fruitList, varietyList, supplierList] = await Promise.all([
        getDeliveryDetail(deliveryId),
        listFruits(),
        listFruitVarieties(),
        listSuppliers(),
      ]);

      setDelivery(detailRes.delivery);
      setAmountPaid(detailRes.amount_paid);
      setNote(detailRes.delivery.note ?? '');
      setCorrectionReason('');

      setFruits(fruitList);
      setVarieties(varietyList);
      setSuppliers(supplierList);

      const initialRows: EditableBatchRow[] = detailRes.batches.map((b) => ({
        tempKey: b.id,
        batch_id: b.id,
        line_no: b.line_no,
        fruit_id: b.fruit_id,
        variety_id: b.variety_id,
        boxes: b.boxes_received,
        purchase_rate: b.purchase_rate,
        boxes_sold: b.boxes_sold,
        has_allocations: b.has_allocations,
        fruit_name: b.fruit_name,
        variety_name: b.variety_name,
      }));

      setRows(initialRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load delivery details.');
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

  useEffect(() => {
    if (isOpen && deliveryId) {
      void loadData();
    } else {
      setDelivery(null);
      setRows([]);
      setNote('');
      setCorrectionReason('');
      setError(null);
    }
  }, [isOpen, deliveryId, loadData]);

  // Find registered fruits for the current delivery's supplier
  const supplierFruitOptions = useMemo(() => {
    if (!delivery) return [];
    const supp = suppliers.find((s) => s.id === delivery.supplier_id);
    const registeredIds = supp?.fruit_ids ?? (supp?.fruit_id ? [supp.fruit_id] : []);

    // Return active fruits that belong to this supplier, plus any fruit already on existing rows
    const rowFruitIds = new Set(rows.map((r) => r.fruit_id));
    return fruits.filter((f) => (f.active && registeredIds.includes(f.id)) || rowFruitIds.has(f.id));
  }, [delivery, suppliers, fruits, rows]);

  // Varieties lookup per fruit
  const varietiesByFruit = useMemo(() => {
    const map = new Map<string, FruitVariety[]>();
    for (const v of varieties) {
      if (!v.active) continue;
      const list = map.get(v.fruit_id) ?? [];
      list.push(v);
      map.set(v.fruit_id, list);
    }
    return map;
  }, [varieties]);

  const handleRowChange = (
    index: number,
    field: 'fruit_id' | 'variety_id' | 'boxes' | 'purchase_rate',
    value: string | number
  ) => {
    setRows((prev) => {
      const next = [...prev];
      const target = { ...next[index] };

      if (field === 'fruit_id') {
        const newFruitId = String(value);
        target.fruit_id = newFruitId;
        const availableVars = varietiesByFruit.get(newFruitId) ?? [];
        target.variety_id = availableVars[0]?.id ?? '';
        target.fruit_name = fruits.find((f) => f.id === newFruitId)?.name ?? 'Fruit';
        target.variety_name = availableVars[0]?.name ?? 'Variety';
      } else if (field === 'variety_id') {
        target.variety_id = String(value);
        const match = varieties.find((v) => v.id === String(value));
        if (match) target.variety_name = match.name;
      } else if (field === 'boxes') {
        target.boxes = typeof value === 'number' ? value : parseInt(value, 10) || 0;
      } else if (field === 'purchase_rate') {
        target.purchase_rate = typeof value === 'number' ? value : parseFloat(value) || 0;
      }

      next[index] = target;
      return next;
    });
  };

  const handleAddRow = () => {
    if (supplierFruitOptions.length === 0) return;
    const defaultFruit = supplierFruitOptions[0];
    const availableVars = varietiesByFruit.get(defaultFruit.id) ?? [];
    const defaultVariety = availableVars[0];

    const newRow: EditableBatchRow = {
      tempKey: 'new_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      batch_id: null,
      line_no: rows.length + 1,
      fruit_id: defaultFruit.id,
      variety_id: defaultVariety?.id ?? '',
      boxes: 1,
      purchase_rate: defaultVariety?.default_sell_rate ? Math.round(defaultVariety.default_sell_rate * 0.8) : 500,
      boxes_sold: 0,
      has_allocations: false,
      fruit_name: defaultFruit.name,
      variety_name: defaultVariety?.name ?? 'Variety',
    };

    setRows((prev) => [...prev, newRow]);
  };

  const handleRemoveRow = (index: number) => {
    const target = rows[index];
    if (target.has_allocations) {
      setError(`Cannot remove ${target.variety_name} because historical bill allocations exist for it.`);
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  // Live Recalculations
  const newTotalBoxes = useMemo(() => {
    return rows.reduce((acc, r) => acc + (Number.isFinite(r.boxes) ? r.boxes : 0), 0);
  }, [rows]);

  const newTotalAmount = useMemo(() => {
    return Math.round(
      rows.reduce((acc, r) => {
        const b = Number.isFinite(r.boxes) ? r.boxes : 0;
        const p = Number.isFinite(r.purchase_rate) ? r.purchase_rate : 0;
        return acc + b * p;
      }, 0) * 100
    ) / 100;
  }, [rows]);

  const newOutstanding = useMemo(() => {
    return Math.max(0, Math.round((newTotalAmount - amountPaid) * 100) / 100);
  }, [newTotalAmount, amountPaid]);

  const isOverpaid = newTotalAmount < amountPaid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryId) return;

    if (!correctionReason.trim()) {
      setError('Please provide a correction reason explaining why this delivery was edited.');
      return;
    }

    if (rows.length === 0) {
      setError('Delivery must contain at least one variety batch row.');
      return;
    }

    // Validation checks
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.fruit_id) {
        setError(`Please select a fruit category on row #${i + 1}.`);
        return;
      }
      if (!r.variety_id) {
        setError(`Please select a variety on row #${i + 1}.`);
        return;
      }
      if (!Number.isInteger(r.boxes) || r.boxes <= 0) {
        setError(`Boxes on row #${i + 1} must be a whole number greater than zero.`);
        return;
      }
      if (r.batch_id && r.boxes < r.boxes_sold) {
        setError(
          `Cannot reduce boxes on row #${i + 1} (${r.variety_name}) below active sold boxes (${r.boxes_sold}).`
        );
        return;
      }
      if (!Number.isFinite(r.purchase_rate) || r.purchase_rate <= 0) {
        setError(`Purchase rate on row #${i + 1} must be greater than zero.`);
        return;
      }
    }

    if (isOverpaid) {
      setError(
        `Corrected delivery total (₹${newTotalAmount.toLocaleString('en-IN')}) cannot be less than the amount already paid (₹${amountPaid.toLocaleString('en-IN')}). Please reallocate excess payment or cancel payment in the Supplier Account Payments tab before editing.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await editStockDelivery({
        delivery_id: deliveryId,
        items: rows.map((r) => ({
          batch_id: r.batch_id,
          fruit_id: r.fruit_id,
          variety_id: r.variety_id,
          boxes: r.boxes,
          purchase_rate: r.purchase_rate,
        })),
        note: note.trim() || null,
        correction_reason: correctionReason.trim(),
      });

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save delivery correction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`Edit Delivery ${delivery?.delivery_no ?? ''}`}
      subtitle="Correct quantities, purchase rates, and batch lines while preserving sales and audit history."
      maxWidth="max-w-4xl"
    >
      {loading ? (
        <LoadingCard label="Loading delivery details…" />
      ) : !delivery ? (
        <AlertBanner tone="error" message={error ?? 'Delivery not found.'} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <AlertBanner tone="error" message={error} />}

          {/* Delivery Meta Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-leaf-100 bg-cream-50 p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-leaf-800">
              <span className="inline-flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-leaf-600" aria-hidden />
                <span>Supplier: {delivery.supplier_name}</span>
                {!delivery.supplier_active && (
                  <span className="text-xs text-stone-500 font-normal">(Inactive)</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-leaf-600" aria-hidden />
                <span>Received: {formatDisplayDate(delivery.received_date)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={delivery.status === 'active' ? 'green' : 'neutral'}>
                {delivery.status.toUpperCase()}
              </Badge>
              <Badge tone={delivery.payment_status === 'paid' ? 'green' : delivery.payment_status === 'partial' ? 'orange' : 'neutral'}>
                {delivery.payment_status.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Batch Lines Editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold text-leaf-950">
                Delivery Variety Batches
              </h3>
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={Plus}
                onClick={handleAddRow}
                disabled={supplierFruitOptions.length === 0}
              >
                Add Variety Batch
              </Button>
            </div>

            <div className="space-y-3">
              {rows.map((row, idx) => {
                const varietiesForFruit = varietiesByFruit.get(row.fruit_id) ?? [];
                const lineTotal = Math.round(row.boxes * row.purchase_rate * 100) / 100;
                const minBoxes = row.batch_id ? Math.max(1, row.boxes_sold) : 1;
                const isUnderSold = row.batch_id && row.boxes < row.boxes_sold;

                return (
                  <Card key={row.tempKey} className="p-4 sm:p-5 relative">
                    <div className="flex items-center justify-between border-b border-leaf-100 pb-2 mb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-leaf-100 px-2 py-0.5 text-xs font-bold text-leaf-800">
                          Line #{idx + 1}
                        </span>
                        {row.has_allocations ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            <Lock className="h-3 w-3 text-amber-600" aria-hidden />
                            Historical bill allocations exist
                          </span>
                        ) : row.batch_id ? (
                          <span className="text-xs text-leaf-600 font-medium">Existing Batch</span>
                        ) : (
                          <span className="text-xs font-bold text-leaf-700 bg-leaf-50 px-2 py-0.5 rounded border border-leaf-200">
                            New Line
                          </span>
                        )}
                        {row.boxes_sold > 0 && (
                          <span className="text-xs font-bold text-mango-800 bg-mango-50 border border-mango-200 px-2 py-0.5 rounded-md">
                            {row.boxes_sold} active sold
                          </span>
                        )}
                      </div>

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        disabled={row.has_allocations}
                        className={`rounded-lg p-1.5 transition-colors ${
                          row.has_allocations
                            ? 'text-stone-300 cursor-not-allowed'
                            : 'text-stone-400 hover:bg-red-50 hover:text-red-600'
                        }`}
                        title={
                          row.has_allocations
                            ? 'Cannot remove: historical bill allocations exist for this batch.'
                            : 'Remove batch line'
                        }
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-12 items-end">
                      {/* Fruit selector */}
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-bold text-leaf-800 mb-1">
                          Fruit Category
                        </label>
                        {row.has_allocations ? (
                          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 flex items-center justify-between">
                            <span>{row.fruit_name}</span>
                            <Lock className="h-3.5 w-3.5 text-stone-400" />
                          </div>
                        ) : (
                          <SelectInput
                            value={row.fruit_id}
                            onChange={(e) => handleRowChange(idx, 'fruit_id', e.target.value)}
                            className="py-2 text-sm"
                          >
                            {supplierFruitOptions.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </SelectInput>
                        )}
                      </div>

                      {/* Variety selector */}
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-bold text-leaf-800 mb-1">
                          Variety
                        </label>
                        {row.has_allocations ? (
                          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 flex items-center justify-between">
                            <span>{row.variety_name}</span>
                            <Lock className="h-3.5 w-3.5 text-stone-400" />
                          </div>
                        ) : (
                          <SelectInput
                            value={row.variety_id}
                            onChange={(e) => handleRowChange(idx, 'variety_id', e.target.value)}
                            className="py-2 text-sm"
                          >
                            {varietiesForFruit.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </SelectInput>
                        )}
                      </div>

                      {/* Boxes */}
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-leaf-800 mb-1">
                          Boxes
                        </label>
                        <TextInput
                          type="number"
                          min={minBoxes}
                          step={1}
                          value={row.boxes || ''}
                          onChange={(e) => handleRowChange(idx, 'boxes', e.target.value)}
                          className={`py-2 text-sm text-right ${isUnderSold ? 'border-red-500 bg-red-50' : ''}`}
                        />
                      </div>

                      {/* Purchase Rate */}
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-leaf-800 mb-1">
                          Rate (₹/box)
                        </label>
                        <MoneyInput
                          value={row.purchase_rate}
                          onChange={(e) => handleRowChange(idx, 'purchase_rate', e.target.value)}
                          className="py-2 text-sm"
                        />
                      </div>

                      {/* Line Total */}
                      <div className="sm:col-span-2 text-right">
                        <span className="block text-xs font-bold text-leaf-600 mb-1">
                          Line Total
                        </span>
                        <p className="tabular-nums text-base font-extrabold text-leaf-950 py-2">
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    {isUnderSold && (
                      <p className="mt-2 text-xs font-bold text-red-600 flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                        Cannot reduce below active sold quantity ({row.boxes_sold} boxes).
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Delivery Note */}
          <FieldWrap label="Delivery Note (Optional)">
            <TextInput
              placeholder="e.g. Truck number, transport slip details…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FieldWrap>

          {/* Correction Reason (Required) */}
          <FieldWrap
            label="Correction Reason *"
            hint="Explain why this delivery is being modified (mandatory audit record)."
          >
            <TextInput
              required
              placeholder="e.g. Corrected box count as per physical gate count; revised rate"
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              className="font-medium"
            />
          </FieldWrap>

          {/* Realtime Recalculated Summary Card */}
          <Card className="p-5 sm:p-6 bg-cream-50 border-leaf-200">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-leaf-700 mb-3">
              Recalculated Delivery Balances
            </h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-semibold text-leaf-600">Total Boxes</p>
                <p className="tabular-nums text-xl sm:text-2xl font-extrabold text-leaf-950 mt-1">
                  {newTotalBoxes.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-leaf-500 mt-0.5">
                  was {delivery.boxes_received.toLocaleString('en-IN')} boxes
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-leaf-600">Purchase Total</p>
                <p className="tabular-nums text-xl sm:text-2xl font-extrabold text-leaf-950 mt-1">
                  ₹{newTotalAmount.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-leaf-500 mt-0.5">
                  was ₹{delivery.purchase_amount.toLocaleString('en-IN')}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-leaf-600">Amount Paid</p>
                <p className="tabular-nums text-xl sm:text-2xl font-extrabold text-leaf-700 mt-1">
                  ₹{amountPaid.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-leaf-500 mt-0.5">allocated to date</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-leaf-600">Remaining Due</p>
                <p
                  className={`tabular-nums text-xl sm:text-2xl font-extrabold mt-1 ${
                    newOutstanding > 0 ? 'text-mango-700' : 'text-leaf-800'
                  }`}
                >
                  ₹{newOutstanding.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-leaf-500 mt-0.5">after correction</p>
              </div>
            </div>

            {/* Overpayment rejection banner */}
            {isOverpaid && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" aria-hidden />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-red-900">
                      Cannot reduce delivery total below allocated payments
                    </p>
                    <p className="text-xs text-red-800">
                      The revised delivery total is ₹{newTotalAmount.toLocaleString('en-IN')}, but ₹
                      {amountPaid.toLocaleString('en-IN')} has already been paid against this delivery.
                      Please reallocate excess payments to other deliveries or cancel the mistaken payment
                      under the Supplier Account Payments tab before editing.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Form Actions */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              icon={saving ? RotateCw : Save}
              disabled={saving || isOverpaid || !correctionReason.trim() || rows.length === 0}
            >
              {saving ? 'Saving Correction…' : 'Save Correction'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

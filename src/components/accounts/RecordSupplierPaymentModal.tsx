import { useEffect, useMemo, useState } from 'react';
import { IndianRupee, Loader2, Smartphone } from 'lucide-react';
import { AlertBanner, Badge, Button, FieldWrap, Modal, TextInput } from '@/components/ui';
import { addSupplierPayment } from '@/services/accounts';
import { formatDisplayDate, generateIdempotencyKey, getLocalIsoDate } from '@/services/inventory';
import type {
  DeliveryBalance,
  PaymentMode,
  SupplierPaymentAllocationInput,
} from '@/types/database';

interface RecordSupplierPaymentModalProps {
  open: boolean;
  supplierId: string;
  supplierName: string;
  openingBalanceId: string | null;
  openingBalanceOutstanding: number;
  unpaidDeliveries: DeliveryBalance[];
  onClose: () => void;
  onSaved: (summary: { amount: number; mode: PaymentMode }) => void;
}

interface AllocationTarget {
  key: string;
  kind: 'opening_balance' | 'delivery';
  id: string;
  title: string;
  meta: string;
  outstanding: number;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function RecordSupplierPaymentModal({
  open,
  supplierId,
  supplierName,
  openingBalanceId,
  openingBalanceOutstanding,
  unpaidDeliveries,
  onClose,
  onSaved,
}: RecordSupplierPaymentModalProps) {
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [paymentDate, setPaymentDate] = useState(() => getLocalIsoDate());
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo<AllocationTarget[]>(() => {
    const list: AllocationTarget[] = [];
    if (openingBalanceId && openingBalanceOutstanding > 0) {
      list.push({
        key: `ob:${openingBalanceId}`,
        kind: 'opening_balance',
        id: openingBalanceId,
        title: 'Opening Balance',
        meta: 'Previous balance due',
        outstanding: openingBalanceOutstanding,
      });
    }
    for (const del of unpaidDeliveries) {
      if (del.status !== 'active' || del.outstanding_amount <= 0) continue;
      list.push({
        key: `del:${del.delivery_id}`,
        kind: 'delivery',
        id: del.delivery_id,
        title: del.delivery_no,
        meta: `${formatDisplayDate(del.received_date)} • ${del.boxes_received} boxes • Purchase ₹${del.purchase_amount.toLocaleString('en-IN')}`,
        outstanding: del.outstanding_amount,
      });
    }
    return list;
  }, [openingBalanceId, openingBalanceOutstanding, unpaidDeliveries]);

  useEffect(() => {
    if (!open) return;
    setMode('cash');
    setPaymentDate(getLocalIsoDate());
    setNote('');
    setAmounts({});
    setIdempotencyKey(generateIdempotencyKey());
    setError(null);
  }, [open]);

  const allocationSummary = useMemo(() => {
    let total = 0;
    let selectedCount = 0;
    let hasRowError = false;
    const rowErrors: Record<string, string> = {};
    const parsedAllocations: SupplierPaymentAllocationInput[] = [];

    for (const t of targets) {
      const raw = (amounts[t.key] ?? '').trim();
      if (!raw) continue;
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 0) {
        rowErrors[t.key] = 'Enter a valid positive amount.';
        hasRowError = true;
        continue;
      }
      const rounded = roundMoney(val);
      if (rounded === 0) continue;
      if (rounded > roundMoney(t.outstanding)) {
        rowErrors[t.key] = `Cannot exceed due ₹${t.outstanding.toLocaleString('en-IN')}.`;
        hasRowError = true;
        continue;
      }
      total = roundMoney(total + rounded);
      selectedCount++;
      parsedAllocations.push(
        t.kind === 'delivery'
          ? { delivery_id: t.id, amount: rounded }
          : { opening_balance_id: t.id, amount: rounded }
      );
    }

    return { total, selectedCount, hasRowError, rowErrors, parsedAllocations };
  }, [targets, amounts]);

  const setRowAmount = (key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (allocationSummary.hasRowError) {
      setError('Fix the highlighted allocation amounts before saving.');
      return;
    }
    if (allocationSummary.parsedAllocations.length === 0 || allocationSummary.total <= 0) {
      setError('Allocate this payment to at least one unpaid delivery or opening balance.');
      return;
    }
    if (!paymentDate) {
      setError('Select a payment date.');
      return;
    }

    setSaving(true);
    try {
      await addSupplierPayment({
        supplier_id: supplierId,
        amount: allocationSummary.total,
        mode,
        payment_date: paymentDate,
        allocations: allocationSummary.parsedAllocations,
        note: note.trim() || null,
        idempotency_key: idempotencyKey,
      });
      onSaved({ amount: allocationSummary.total, mode });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record supplier payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Record Supplier Payment"
      subtitle={`Pay ${supplierName} against specific deliveries or opening balance.`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {error && <AlertBanner tone="error" message={error} />}

        {targets.length === 0 ? (
          <AlertBanner
            tone="info"
            message="This supplier has no unpaid deliveries or outstanding opening balance. Unallocated supplier advances are not permitted."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-sm font-bold text-leaf-900">
                  Payment Mode *
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('cash')}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                      mode === 'cash'
                        ? 'border-leaf-600 bg-leaf-600 text-white'
                        : 'border-leaf-200 bg-white text-leaf-800 hover:bg-leaf-50'
                    }`}
                  >
                    <IndianRupee className="h-4 w-4" aria-hidden />
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('upi')}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                      mode === 'upi'
                        ? 'border-leaf-600 bg-leaf-600 text-white'
                        : 'border-leaf-200 bg-white text-leaf-800 hover:bg-leaf-50'
                    }`}
                  >
                    <Smartphone className="h-4 w-4" aria-hidden />
                    UPI
                  </button>
                </div>
              </div>

              <FieldWrap label="Payment Date *">
                <TextInput
                  id="supp-pay-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </FieldWrap>
            </div>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-leaf-900">
                  Allocate to Deliveries / Opening Balance <span className="text-mango-600">*</span>
                </span>
                {allocationSummary.selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmounts({})}
                    className="text-xs font-bold text-leaf-700 underline hover:text-leaf-950"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <p className="text-xs text-leaf-700">
                Every rupee must be explicitly allocated to a delivery or opening balance. No auto-FIFO or unallocated advance.
              </p>

              <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
                {targets.map((target) => {
                  const val = amounts[target.key] ?? '';
                  const rowErr = allocationSummary.rowErrors[target.key];
                  return (
                    <div
                      key={target.key}
                      className={`rounded-xl border p-3 transition-colors ${
                        rowErr
                          ? 'border-red-300 bg-red-50/40'
                          : val && Number(val) > 0
                            ? 'border-leaf-400 bg-leaf-50/50'
                            : 'border-leaf-100 bg-cream-100/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-leaf-950">{target.title}</span>
                            {target.kind === 'opening_balance' && (
                              <Badge tone="orange">Opening</Badge>
                            )}
                          </div>
                          <p className="text-xs text-leaf-700">{target.meta}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-semibold text-leaf-600">Due</span>
                          <p className="text-sm font-extrabold text-mango-700">
                            ₹{target.outstanding.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-center gap-2">
                        <div className="relative flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-leaf-600">
                            ₹
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            max={target.outstanding}
                            placeholder="0"
                            value={val}
                            onChange={(e) => setRowAmount(target.key, e.target.value)}
                            aria-label={`Amount for ${target.title}`}
                            className="w-full rounded-lg border-2 border-leaf-200 bg-white py-2 pl-7 pr-3 text-sm font-bold text-leaf-950 focus:border-leaf-500 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setRowAmount(target.key, String(target.outstanding))}
                          className="rounded-lg border border-leaf-300 bg-white px-3 py-2 text-xs font-bold text-leaf-800 hover:bg-leaf-100"
                        >
                          Full
                        </button>
                        {val && (
                          <button
                            type="button"
                            onClick={() => setRowAmount(target.key, '')}
                            className="rounded-lg px-2 py-2 text-xs font-bold text-leaf-600 hover:bg-leaf-100"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {rowErr && <p className="mt-1 text-xs font-semibold text-red-700">{rowErr}</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            <FieldWrap label="Note (optional)">
              <TextInput
                id="supp-pay-note"
                placeholder="e.g. Paid via GPay / mandi settlement"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FieldWrap>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-leaf-200 bg-leaf-50 px-4 py-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">
                  Total Payment ({mode.toUpperCase()})
                </p>
                <p className="text-xs text-leaf-700">
                  {allocationSummary.selectedCount === 0
                    ? 'No targets selected yet'
                    : `Allocated across ${allocationSummary.selectedCount} item${allocationSummary.selectedCount === 1 ? '' : 's'}`}
                </p>
              </div>
              <p className="font-display text-2xl font-bold text-leaf-950">
                ₹{allocationSummary.total.toLocaleString('en-IN')}
              </p>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-leaf-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {targets.length > 0 && (
            <Button
              type="submit"
              icon={saving ? Loader2 : IndianRupee}
              disabled={saving || allocationSummary.total <= 0 || allocationSummary.hasRowError}
            >
              {saving ? 'Recording…' : 'Record Payment'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { AlertBanner, Badge, Button, FieldWrap, Modal, TextInput } from '@/components/ui';
import { reallocateSupplierPaymentAllocation } from '@/services/accounts';
import { formatDisplayDate } from '@/services/inventory';
import type {
  DeliveryBalance,
  SupplierPaymentAllocationInput,
  SupplierPaymentAllocationItem,
} from '@/types/database';

interface ReallocateAllocationModalProps {
  open: boolean;
  allocation: SupplierPaymentAllocationItem | null;
  openingBalanceId: string | null;
  openingBalanceOutstanding: number;
  unpaidDeliveries: DeliveryBalance[];
  onClose: () => void;
  onReallocated: () => void;
}

interface TargetOption {
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

export function ReallocateAllocationModal({
  open,
  allocation,
  openingBalanceId,
  openingBalanceOutstanding,
  unpaidDeliveries,
  onClose,
  onReallocated,
}: ReallocateAllocationModalProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmounts({});
    setReason('');
    setError(null);
  }, [open, allocation?.id]);

  const targets = useMemo<TargetOption[]>(() => {
    if (!allocation) return [];
    const list: TargetOption[] = [];

    if (
      openingBalanceId &&
      openingBalanceOutstanding > 0 &&
      openingBalanceId !== allocation.opening_balance_id
    ) {
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
      if (del.delivery_id === allocation.delivery_id) continue;
      list.push({
        key: `del:${del.delivery_id}`,
        kind: 'delivery',
        id: del.delivery_id,
        title: del.delivery_no,
        meta: `${formatDisplayDate(del.received_date)} • ${del.boxes_received} boxes`,
        outstanding: del.outstanding_amount,
      });
    }

    return list;
  }, [allocation, openingBalanceId, openingBalanceOutstanding, unpaidDeliveries]);

  const totalEligibleCapacity = useMemo(
    () => roundMoney(targets.reduce((sum, t) => sum + t.outstanding, 0)),
    [targets]
  );

  const requiredAmount = allocation ? roundMoney(allocation.amount) : 0;

  const summary = useMemo(() => {
    let allocated = 0;
    let hasRowError = false;
    const rowErrors: Record<string, string> = {};
    const parsed: SupplierPaymentAllocationInput[] = [];

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
      allocated = roundMoney(allocated + rounded);
      parsed.push(
        t.kind === 'delivery'
          ? { delivery_id: t.id, amount: rounded }
          : { opening_balance_id: t.id, amount: rounded }
      );
    }

    const remaining = roundMoney(requiredAmount - allocated);
    const isExactMatch =
      !hasRowError &&
      parsed.length > 0 &&
      Math.round(allocated * 100) === Math.round(requiredAmount * 100);

    return { allocated, remaining, hasRowError, rowErrors, parsed, isExactMatch };
  }, [targets, amounts, requiredAmount]);

  const setRowAmount = (key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  };

  const handleFillRow = (target: TargetOption) => {
    const currentRow = roundMoney(Number(amounts[target.key] ?? 0) || 0);
    const availableToAssign = roundMoney(summary.remaining + currentRow);
    if (availableToAssign <= 0) return;
    const next = roundMoney(Math.min(target.outstanding, availableToAssign));
    setRowAmount(target.key, String(next));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocation) return;
    setError(null);

    if (!summary.isExactMatch) {
      setError(
        `Replacement allocations must total exactly ₹${requiredAmount.toLocaleString('en-IN')}.`
      );
      return;
    }

    setSaving(true);
    try {
      await reallocateSupplierPaymentAllocation({
        allocation_id: allocation.id,
        new_allocations: summary.parsed,
        reason: reason.trim() || null,
      });
      onReallocated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reallocate payment.');
    } finally {
      setSaving(false);
    }
  };

  const canReallocate = targets.length > 0 && totalEligibleCapacity >= requiredAmount;

  return (
    <Modal
      open={open && Boolean(allocation)}
      title="Reallocate Supplier Payment"
      subtitle="Move this allocation slice to other unpaid deliveries or opening balance without altering the original payment."
      onClose={onClose}
    >
      {allocation && (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          {error && <AlertBanner tone="error" message={error} />}

          <div className="rounded-xl border border-leaf-200 bg-cream-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">
              Moving Allocation
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-leaf-950">From {allocation.target_label}</span>
              <span className="font-display text-xl font-bold text-leaf-950">
                ₹{requiredAmount.toLocaleString('en-IN')}
              </span>
            </div>
            <p className="mt-1 text-xs text-leaf-700">
              The original allocation is marked as <strong>Reallocated</strong> for audit history, and new linked allocations are created below.
            </p>
          </div>

          {!canReallocate ? (
            <AlertBanner
              tone="info"
              message={
                targets.length === 0
                  ? 'No other unpaid deliveries or opening balance are available for this supplier. To cancel a paid delivery instead, record a supplier refund during delivery cancellation.'
                  : `Other unpaid items only have ₹${totalEligibleCapacity.toLocaleString('en-IN')} due, which is less than ₹${requiredAmount.toLocaleString('en-IN')}. Unallocated supplier advances are not permitted.`
              }
            />
          ) : (
            <>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-leaf-900">
                    Select Replacement Target(s) <span className="text-mango-600">*</span>
                  </span>
                  {summary.allocated > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmounts({})}
                      className="text-xs font-bold text-leaf-700 underline hover:text-leaf-950"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
                  {targets.map((target) => {
                    const val = amounts[target.key] ?? '';
                    const rowErr = summary.rowErrors[target.key];
                    return (
                      <div
                        key={target.key}
                        className={`rounded-xl border p-3 ${
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
                              aria-label={`Reallocate amount to ${target.title}`}
                              className="w-full rounded-lg border-2 border-leaf-200 bg-white py-2 pl-7 pr-3 text-sm font-bold text-leaf-950 focus:border-leaf-500 focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleFillRow(target)}
                            className="rounded-lg border border-leaf-300 bg-white px-3 py-2 text-xs font-bold text-leaf-800 hover:bg-leaf-100"
                          >
                            Fill
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

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-leaf-200 bg-leaf-50 px-4 py-3 text-sm">
                <div>
                  <span className="text-leaf-700">Assigned: </span>
                  <strong className="text-leaf-950">
                    ₹{summary.allocated.toLocaleString('en-IN')}
                  </strong>
                  <span className="text-leaf-600"> / ₹{requiredAmount.toLocaleString('en-IN')}</span>
                </div>
                {summary.isExactMatch ? (
                  <Badge tone="green">Exact match</Badge>
                ) : summary.remaining < 0 ? (
                  <Badge tone="red">
                    Over by ₹{Math.abs(summary.remaining).toLocaleString('en-IN')}
                  </Badge>
                ) : (
                  <Badge tone="orange">
                    Remaining ₹{summary.remaining.toLocaleString('en-IN')}
                  </Badge>
                )}
              </div>

              <FieldWrap label="Reason (optional)">
                <TextInput
                  id="realloc-reason"
                  placeholder="e.g. Moving payment before cancelling delivery"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FieldWrap>
            </>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-leaf-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {canReallocate && (
              <Button
                type="submit"
                icon={saving ? Loader2 : ArrowRightLeft}
                disabled={saving || !summary.isExactMatch}
              >
                {saving ? 'Reallocating…' : 'Confirm Reallocation'}
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

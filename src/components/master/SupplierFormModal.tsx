import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { AlertBanner, Button, FieldWrap, Modal, TextInput } from '@/components/ui';
import type { Fruit, SupplierInput, SupplierWithFruit } from '@/types/database';

interface SupplierFormModalProps {
  open: boolean;
  editing: SupplierWithFruit | null;
  fruits: Fruit[];
  onClose: () => void;
  onManageFruits?: () => void;
  onSubmit: (input: SupplierInput) => Promise<void>;
}

export function SupplierFormModal({
  open,
  editing,
  fruits,
  onClose,
  onManageFruits,
  onSubmit,
}: SupplierFormModalProps) {
  const [name, setName] = useState('');
  const [selectedFruitIds, setSelectedFruitIds] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    const initialFruitIds =
      editing?.fruit_ids && editing.fruit_ids.length > 0
        ? editing.fruit_ids
        : editing?.fruit_id
          ? [editing.fruit_id]
          : [];
    setSelectedFruitIds(initialFruitIds);
    setPhone(editing?.phone ?? '');
    setError(null);
    setSaving(false);
  }, [open, editing]);

  const fruitList = useMemo(() => {
    const editingFruitIds = new Set(
      editing?.fruit_ids?.length
        ? editing.fruit_ids
        : editing?.fruit_id
          ? [editing.fruit_id]
          : []
    );
    return fruits.filter((f) => f.active || editingFruitIds.has(f.id));
  }, [fruits, editing]);

  const noActiveFruits = !editing && fruitList.length === 0;

  const toggleFruit = (id: string) => {
    setSelectedFruitIds((prev) =>
      prev.includes(id) ? prev.filter((fId) => fId !== id) : [...prev, id]
    );
    setError(null);
  };

  const selectAll = () => {
    setSelectedFruitIds(fruitList.map((f) => f.id));
    setError(null);
  };

  const clearAll = () => {
    setSelectedFruitIds([]);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter the supplier name.');
      return;
    }

    if (selectedFruitIds.length === 0) {
      setError('Please select at least one fruit category for this supplier.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: trimmedName,
        fruit_ids: selectedFruitIds,
        fruit_id: selectedFruitIds[0] ?? null,
        phone: phone.trim() ? phone.trim() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save supplier.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Supplier' : 'Add Supplier'}
      onClose={saving ? () => undefined : onClose}
    >
      {noActiveFruits ? (
        <div className="space-y-5">
          <AlertBanner
            tone="info"
            message="Add at least one active fruit before adding a supplier, because every supplier is linked to the fruit(s) they supply."
          />
          <div className="flex flex-wrap justify-end gap-3 border-t border-leaf-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
            {onManageFruits && (
              <Button
                type="button"
                onClick={() => {
                  onClose();
                  onManageFruits();
                }}
              >
                Go to Fruits
              </Button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {error && <AlertBanner tone="error" message={error} />}

          <FieldWrap label="Supplier Name *">
            <TextInput
              placeholder="Enter supplier name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              autoFocus
            />
          </FieldWrap>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-leaf-800">
                Supplied Fruits *
                <span className="ml-2 text-xs font-normal text-leaf-600">
                  ({selectedFruitIds.length} of {fruitList.length} selected)
                </span>
              </label>
              {fruitList.length > 1 && (
                <div className="flex gap-2">
                  {selectedFruitIds.length < fruitList.length ? (
                    <button
                      type="button"
                      onClick={selectAll}
                      disabled={saving}
                      className="text-xs font-semibold text-leaf-700 hover:text-leaf-950 underline"
                    >
                      Select all
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={clearAll}
                      disabled={saving}
                      className="text-xs font-semibold text-leaf-600 hover:text-leaf-950 underline"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-52 overflow-y-auto p-1.5 rounded-xl border border-leaf-200 bg-leaf-50/40">
              {fruitList.map((fruit) => {
                const isSelected = selectedFruitIds.includes(fruit.id);
                return (
                  <button
                    key={fruit.id}
                    type="button"
                    onClick={() => toggleFruit(fruit.id)}
                    disabled={saving}
                    className={`flex items-center justify-between gap-2 px-3.5 py-3 rounded-lg text-sm transition-all text-left border ${
                      isSelected
                        ? 'bg-mango-50 border-mango-500 text-mango-950 font-bold shadow-sm ring-1 ring-mango-400'
                        : 'bg-white border-leaf-200 text-leaf-700 hover:border-leaf-300 hover:bg-leaf-50'
                    }`}
                  >
                    <span className="truncate">{fruit.name}</span>
                    {isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-mango-700 stroke-[2.5]" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded border border-leaf-300 bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
            {selectedFruitIds.length === 0 && (
              <p className="text-xs text-mango-700 font-medium">
                Select at least one fruit category.
              </p>
            )}
          </div>

          <FieldWrap label="Phone Number (Optional)">
            <TextInput
              type="tel"
              inputMode="tel"
              placeholder="Enter phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
            />
          </FieldWrap>

          <div className="flex flex-wrap justify-end gap-3 border-t border-leaf-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" icon={saving ? Loader2 : Save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Supplier'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  AlertBanner,
  Button,
  FieldWrap,
  Modal,
  MoneyInput,
  SearchSelect,
  TextInput,
} from '@/components/ui';
import type { SearchOption } from '@/components/ui';
import type { Fruit, FruitVariety, FruitVarietyInput } from '@/types/database';

interface VarietyFormModalProps {
  open: boolean;
  editing: FruitVariety | null;
  defaultFruitId: string | null;
  fruits: Fruit[];
  onClose: () => void;
  onSubmit: (input: FruitVarietyInput) => Promise<void>;
}

export function VarietyFormModal({
  open,
  editing,
  defaultFruitId,
  fruits,
  onClose,
  onSubmit,
}: VarietyFormModalProps) {
  const [fruitId, setFruitId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sellRate, setSellRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFruitId(editing?.fruit_id ?? defaultFruitId ?? null);
    setName(editing?.name ?? '');
    setSellRate(
      editing?.default_sell_rate !== null && editing?.default_sell_rate !== undefined
        ? String(editing.default_sell_rate)
        : ''
    );
    setError(null);
    setSaving(false);
  }, [open, editing, defaultFruitId]);

  const fruitOptions: SearchOption[] = useMemo(() => {
    return fruits
      .filter((f) => f.active || f.id === editing?.fruit_id || f.id === defaultFruitId)
      .map((f) => ({
        id: f.id,
        label: f.name,
        sublabel: f.active ? 'Active' : 'Inactive',
      }));
  }, [fruits, editing?.fruit_id, defaultFruitId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fruitId) {
      setError('Please select a fruit.');
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a variety name.');
      return;
    }

    let parsedRate: number | null = null;
    if (sellRate.trim() !== '') {
      const numericRate = Number(sellRate);
      if (!Number.isFinite(numericRate) || numericRate <= 0) {
        setError('Default selling rate must be greater than zero, or leave it blank.');
        return;
      }
      parsedRate = Math.round(numericRate * 100) / 100;
    }

    setSaving(true);
    try {
      await onSubmit({
        fruit_id: fruitId,
        name: trimmedName,
        default_sell_rate: parsedRate,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save variety.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Variety' : 'Add Variety'}
      onClose={saving ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AlertBanner tone="error" message={error} />}

        <SearchSelect
          label="Fruit"
          placeholder="Select fruit"
          options={fruitOptions}
          value={fruitId}
          onChange={setFruitId}
          icon={false}
        />

        <FieldWrap label="Variety Name">
          <TextInput
            placeholder="Enter variety name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </FieldWrap>

        <FieldWrap label="Default Selling Rate (Optional)">
          <MoneyInput
            min="0"
            step="0.01"
            placeholder="Rate per box (optional)"
            value={sellRate}
            onChange={(e) => setSellRate(e.target.value)}
            disabled={saving}
          />
        </FieldWrap>

        <div className="flex flex-wrap justify-end gap-3 border-t border-leaf-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" icon={saving ? Loader2 : Save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Variety'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

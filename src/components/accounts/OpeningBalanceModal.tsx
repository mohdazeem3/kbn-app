import { useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { AlertBanner, Button, FieldWrap, Modal, MoneyInput, TextInput } from '@/components/ui';
import { getLocalIsoDate } from '@/services/inventory';

interface OpeningBalanceModalProps {
  open: boolean;
  partyType: 'customer' | 'supplier';
  partyName: string;
  onClose: () => void;
  onSubmit: (values: { amount: number; asOfDate: string; note: string | null }) => Promise<void>;
}

export function OpeningBalanceModal({
  open,
  partyType,
  partyName,
  onClose,
  onSubmit,
}: OpeningBalanceModalProps) {
  const [amountStr, setAmountStr] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => getLocalIsoDate());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmountStr('');
    setAsOfDate(getLocalIsoDate());
    setNote('');
    setError(null);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = Number(amountStr);
    const rounded = Math.round(parsed * 100) / 100;
    if (!Number.isFinite(rounded) || rounded <= 0) {
      setError('Enter an opening balance greater than ₹0.');
      return;
    }
    if (!asOfDate) {
      setError('Select an as-of date.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        amount: rounded,
        asOfDate,
        note: note.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save opening balance.');
    } finally {
      setSaving(false);
    }
  };

  const subtitle =
    partyType === 'customer'
      ? `Previous balance owed by ${partyName} before starting in this app.`
      : `Previous balance you owed ${partyName} before starting in this app.`;

  return (
    <Modal open={open} title="Set Opening Balance" subtitle={subtitle} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {error && <AlertBanner tone="error" message={error} />}

        <AlertBanner
          tone="info"
          message={
            partyType === 'customer'
              ? 'Each customer can have one active opening balance. Later customer payments can be allocated against it directly.'
              : 'Each supplier can have one active opening balance. Later supplier payments can be allocated against it directly.'
          }
        />

        <FieldWrap label="Opening Balance Amount *">
          <MoneyInput
            id="opening-balance-amount"
            step="0.01"
            min="0.01"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            required
          />
        </FieldWrap>

        <FieldWrap label="As-of Date *">
          <TextInput
            id="opening-balance-date"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            required
          />
        </FieldWrap>

        <FieldWrap label="Note (optional)">
          <TextInput
            id="opening-balance-note"
            placeholder="e.g. Carried forward from old register"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FieldWrap>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-leaf-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" icon={saving ? Loader2 : Scale} disabled={saving}>
            {saving ? 'Saving…' : 'Save Opening Balance'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

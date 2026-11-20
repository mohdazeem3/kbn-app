import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { AlertBanner, Button, FieldWrap, Modal, TextInput } from '@/components/ui';
import type { Fruit, FruitInput } from '@/types/database';

interface FruitFormModalProps {
  open: boolean;
  editing: Fruit | null;
  onClose: () => void;
  onSubmit: (input: FruitInput) => Promise<void>;
}

export function FruitFormModal({ open, editing, onClose, onSubmit }: FruitFormModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setError(null);
    setSaving(false);
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a fruit name.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ name: trimmed });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save fruit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Fruit' : 'Add Fruit'}
      onClose={saving ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AlertBanner tone="error" message={error} />}

        <FieldWrap label="Fruit Name">
          <TextInput
            placeholder="Enter fruit name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </FieldWrap>

        <div className="flex flex-wrap justify-end gap-3 border-t border-leaf-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" icon={saving ? Loader2 : Save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Fruit'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

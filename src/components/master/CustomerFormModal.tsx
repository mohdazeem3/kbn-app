import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { AlertBanner, Button, FieldWrap, Modal, TextInput } from '@/components/ui';
import type { Customer, CustomerInput } from '@/types/database';

interface CustomerFormModalProps {
  open: boolean;
  editing: Customer | null;
  onClose: () => void;
  onSubmit: (input: CustomerInput) => Promise<void>;
}

export function CustomerFormModal({
  open,
  editing,
  onClose,
  onSubmit,
}: CustomerFormModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setPhone(editing?.phone ?? '');
    setError(null);
    setSaving(false);
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter the customer or shop name.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: trimmedName,
        phone: phone.trim() ? phone.trim() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Customer' : 'Add Customer'}
      onClose={saving ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AlertBanner tone="error" message={error} />}

        <FieldWrap label="Customer Name *">
          <TextInput
            placeholder="Enter customer or shop name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </FieldWrap>

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
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Banknote, Smartphone } from 'lucide-react';
import {
  AlertBanner,
  Button,
  FieldWrap,
  Modal,
  MoneyInput,
  SelectInput,
  TextInput,
} from '@/components/ui';
import {
  createExpense,
  getShopTodayDate,
  updateExpense,
} from '@/services/expenses';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpensePaymentMethod,
  type ExpenseRecord,
} from '@/types/database';

interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (expense: ExpenseRecord) => void;
  expenseToEdit?: ExpenseRecord | null;
}

export function ExpenseFormModal({
  open,
  onClose,
  onSaved,
  expenseToEdit = null,
}: ExpenseFormModalProps) {
  const isEditing = Boolean(expenseToEdit);

  const [expenseDate, setExpenseDate] = useState(getShopTodayDate());
  const [category, setCategory] = useState<ExpenseCategory>('Shop Expenses');
  const [customCategory, setCustomCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash');
  const [paidTo, setPaidTo] = useState('');
  const [description, setDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    if (expenseToEdit) {
      setExpenseDate(expenseToEdit.expense_date);
      setCategory(expenseToEdit.category);
      setCustomCategory(expenseToEdit.custom_category ?? '');
      setAmount(String(expenseToEdit.amount));
      setPaymentMethod(expenseToEdit.payment_method);
      setPaidTo(expenseToEdit.paid_to ?? '');
      setDescription(expenseToEdit.description ?? '');
    } else {
      setExpenseDate(getShopTodayDate());
      setCategory('Shop Expenses');
      setCustomCategory('');
      setAmount('');
      setPaymentMethod('cash');
      setPaidTo('');
      setDescription('');
    }
  }, [open, expenseToEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid expense amount greater than zero.');
      return;
    }

    if (category === 'Other' && !customCategory.trim()) {
      setError('Please specify the custom category name for Other.');
      return;
    }

    if (!expenseDate) {
      setError('Please select an expense date.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && expenseToEdit) {
        const updated = await updateExpense({
          id: expenseToEdit.id,
          expense_date: expenseDate,
          category,
          custom_category: category === 'Other' ? customCategory.trim() : null,
          amount: parsedAmount,
          payment_method: paymentMethod,
          paid_to: paidTo.trim() || null,
          description: description.trim() || null,
        });
        onSaved(updated);
      } else {
        const created = await createExpense({
          expense_date: expenseDate,
          category,
          custom_category: category === 'Other' ? customCategory.trim() : null,
          amount: parsedAmount,
          payment_method: paymentMethod,
          paid_to: paidTo.trim() || null,
          description: description.trim() || null,
        });
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save expense.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Expense' : 'Add New Expense'}
      subtitle="Record shop or operational expenditure paid via Cash or UPI."
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AlertBanner tone="error" message={error} />}

        {/* Expense Date & Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldWrap label="Expense Date">
            <TextInput
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
              aria-label="Expense Date"
            />
          </FieldWrap>

          <FieldWrap label="Payment Method">
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-extrabold transition-all ${
                  paymentMethod === 'cash'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-600'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                <Banknote className="h-4 w-4 text-emerald-600" />
                <span>Cash</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('upi')}
                className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-extrabold transition-all ${
                  paymentMethod === 'upi'
                    ? 'border-orange-500 bg-orange-50 text-orange-950 shadow-sm ring-1 ring-orange-500'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                <Smartphone className="h-4 w-4 text-orange-600" />
                <span>UPI</span>
              </button>
            </div>
          </FieldWrap>
        </div>

        {/* Category & Custom Category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldWrap label="Expense Category">
            <SelectInput
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              required
              aria-label="Expense Category"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </SelectInput>
          </FieldWrap>

          {category === 'Other' ? (
            <FieldWrap label="Specify Category">
              <TextInput
                placeholder="e.g. Repairs, Electricity"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                required
                aria-label="Specify Custom Category"
              />
            </FieldWrap>
          ) : (
            <FieldWrap label="Paid To (Optional)">
              <TextInput
                placeholder="Person or vendor name"
                value={paidTo}
                onChange={(e) => setPaidTo(e.target.value)}
                aria-label="Paid To"
              />
            </FieldWrap>
          )}
        </div>

        {category === 'Other' && (
          <FieldWrap label="Paid To (Optional)">
            <TextInput
              placeholder="Person or vendor name"
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              aria-label="Paid To"
            />
          </FieldWrap>
        )}

        {/* Amount */}
        <FieldWrap label="Amount (₹)">
          <MoneyInput
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            aria-label="Expense Amount"
            className="text-lg font-extrabold"
          />
        </FieldWrap>

        {/* Description / Notes */}
        <FieldWrap label="Description / Notes (Optional)">
          <TextInput
            placeholder="Additional notes about this expense..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
          />
        </FieldWrap>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Update Expense' : 'Add Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

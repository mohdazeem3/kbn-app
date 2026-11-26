import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  LogIn,
  Pencil,
  Plus,
  Printer,
  RotateCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  Modal,
  SectionHeader,
  SelectInput,
  TextInput,
} from '@/components/ui';
import { ExpenseFormModal } from '@/components/expenses/ExpenseFormModal';
import { PrintableExpenseReportModal } from '@/components/expenses/PrintableExpenseReportModal';
import {
  calculateExpenseSummary,
  deleteExpense,
  getShopCurrentMonthPrefix,
  getShopTodayDate,
  listExpenses,
} from '@/services/expenses';
import { formatDisplayDate } from '@/services/inventory';
import { useCacheInvalidation } from '@/services/cache';
import { useAuth } from '@/lib/auth';
import {
  EXPENSE_CATEGORIES,
  type ExpenseRecord,
} from '@/types/database';

export function ExpensesPage({ isActive = true }: { isActive?: boolean }) {
  const { signOut } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<ExpenseRecord | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Delete confirmation
  const [expenseToDelete, setExpenseToDelete] = useState<ExpenseRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const todayDate = useMemo(() => getShopTodayDate(), []);
  const monthPrefix = useMemo(() => getShopCurrentMonthPrefix(), []);

  const loadExpenses = useCallback(async (isBackground = false, forceRefresh = false) => {
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const data = await listExpenses({ forceRefresh });
      setExpenses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load expenses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  useCacheInvalidation(['expenses'], () => void loadExpenses(true), { isActive });

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses.filter((exp) => {
      if (categoryFilter !== 'all' && exp.category !== categoryFilter) return false;
      if (paymentFilter !== 'all' && exp.payment_method !== paymentFilter) return false;
      if (dateFrom && exp.expense_date < dateFrom) return false;
      if (dateTo && exp.expense_date > dateTo) return false;
      if (!q) return true;

      const categoryText = (exp.category === 'Other' && exp.custom_category
        ? `other ${exp.custom_category}`
        : exp.category
      ).toLowerCase();
      const paidToText = (exp.paid_to ?? '').toLowerCase();
      const descText = (exp.description ?? '').toLowerCase();

      return (
        categoryText.includes(q) ||
        paidToText.includes(q) ||
        descText.includes(q)
      );
    });
  }, [expenses, categoryFilter, paymentFilter, dateFrom, dateTo, query]);

  const summary = useMemo(() => {
    return calculateExpenseSummary(expenses, filteredExpenses, todayDate, monthPrefix);
  }, [expenses, filteredExpenses, todayDate, monthPrefix]);

  const clearFilters = () => {
    setQuery('');
    setCategoryFilter('all');
    setPaymentFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const handleOpenAdd = () => {
    setExpenseToEdit(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (expense: ExpenseRecord) => {
    setExpenseToEdit(expense);
    setFormOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!expenseToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteExpense(expenseToDelete.id);
      setNotice(`Deleted expense of ₹${expenseToDelete.amount.toLocaleString('en-IN')}.`);
      setExpenseToDelete(null);
      void loadExpenses(false, true);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete expense.');
    } finally {
      setDeleting(false);
    }
  };

  const isFiltered = Boolean(query || categoryFilter !== 'all' || paymentFilter !== 'all' || dateFrom || dateTo);
  const isAuthError = Boolean(
    error &&
      (error.toLowerCase().includes('sign in') ||
        error.toLowerCase().includes('session') ||
        error.toLowerCase().includes('jwt'))
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Expenses"
        action={
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="secondary"
              size="lg"
              icon={Printer}
              onClick={() => setReportOpen(true)}
              disabled={loading || expenses.length === 0}
            >
              Report
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={RotateCw}
              onClick={() => void loadExpenses(false, true)}
            >
              Refresh
            </Button>
            <Button
              variant="accent"
              size="lg"
              icon={Plus}
              onClick={handleOpenAdd}
            >
              Add Expense
            </Button>
          </div>
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && (
        <AlertBanner
          tone="error"
          message={error}
          onRetry={() => void loadExpenses(false, true)}
        />
      )}

      {/* A. Expenses Dashboard (3 Summary Cards) */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Today's Expenses */}
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
            Today&apos;s Expenses
          </p>
          <p className="tabular-nums mt-1 text-3xl font-extrabold text-leaf-950">
            {error && expenses.length === 0 ? (
              <span className="text-stone-400 font-bold">—</span>
            ) : loading && expenses.length === 0 ? (
              <span className="text-stone-300 font-bold">...</span>
            ) : (
              `₹${summary.today_expenses.toLocaleString('en-IN')}`
            )}
          </p>
          <p className="mt-1 text-xs text-stone-500 font-medium">
            {error && expenses.length === 0
              ? 'Unavailable (error loading data)'
              : `Recorded for today (${formatDisplayDate(todayDate)})`}
          </p>
        </Card>

        {/* This Month's Expenses */}
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
            This Month&apos;s Expenses
          </p>
          <p className="tabular-nums mt-1 text-3xl font-extrabold text-leaf-800">
            {error && expenses.length === 0 ? (
              <span className="text-stone-400 font-bold">—</span>
            ) : loading && expenses.length === 0 ? (
              <span className="text-stone-300 font-bold">...</span>
            ) : (
              `₹${summary.month_expenses.toLocaleString('en-IN')}`
            )}
          </p>
          <p className="mt-1 text-xs text-stone-500 font-medium">
            {error && expenses.length === 0
              ? 'Unavailable (error loading data)'
              : 'Cumulative total for current month'}
          </p>
        </Card>

        {/* Total Expenses (Filtered Period) */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
              Total Expenses
            </p>
            {isFiltered && !error && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                Filtered
              </span>
            )}
          </div>
          <p className="tabular-nums mt-1 text-3xl font-extrabold text-amber-900">
            {error && expenses.length === 0 ? (
              <span className="text-stone-400 font-bold">—</span>
            ) : loading && expenses.length === 0 ? (
              <span className="text-stone-300 font-bold">...</span>
            ) : (
              `₹${summary.total_expenses.toLocaleString('en-IN')}`
            )}
          </p>
          <p className="mt-1 text-xs text-stone-500 font-medium">
            {error && expenses.length === 0 ? (
              'Unavailable (error loading data)'
            ) : (
              <>
                Cash: <strong className="font-bold text-emerald-800">₹{summary.cash_expenses.toLocaleString('en-IN')}</strong> • UPI: <strong className="font-bold text-orange-800">₹{summary.upi_expenses.toLocaleString('en-IN')}</strong>
              </>
            )}
          </p>
        </Card>
      </div>

      {/* C. Expense Filters Strip */}
      <Card className="p-4">
        <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
              aria-hidden
            />
            <TextInput
              className="pl-12"
              placeholder="Search category, paid to, notes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search expenses"
            />
          </div>

          <SelectInput
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            aria-label="Filter by payment method"
          >
            <option value="all">All payment methods</option>
            <option value="cash">Cash only</option>
            <option value="upi">UPI only</option>
          </SelectInput>

          <label className="block">
            <span className="mb-1 block text-xs font-bold text-leaf-700">From</span>
            <TextInput
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-bold text-leaf-700">To</span>
            <TextInput
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
            />
          </label>
        </div>
      </Card>

      {/* Expense History List */}
      {error && expenses.length === 0 ? (
        <Card className="p-8 text-center border-red-200 bg-red-50/40">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 mb-3">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-extrabold text-red-950">Unable to load expenses</h3>
          <p className="mt-1.5 text-sm font-medium text-red-800 max-w-md mx-auto">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {isAuthError ? (
              <Button
                variant="primary"
                icon={LogIn}
                onClick={() => void signOut()}
              >
                Sign In Again
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={RotateCw}
                onClick={() => void loadExpenses(false, true)}
              >
                Retry
              </Button>
            )}
          </div>
        </Card>
      ) : loading ? (
        <LoadingCard label="Loading expenses…" />
      ) : expenses.length === 0 ? (
        <EmptyState
          emoji="💸"
          title="No expenses recorded yet"
          description="Record daily transport, labour, or market expenses to keep track of shop spending."
          action={
            <Button variant="accent" size="lg" icon={Plus} onClick={handleOpenAdd}>
              Add First Expense
            </Button>
          }
        />
      ) : filteredExpenses.length === 0 ? (
        <EmptyState
          emoji="🔎"
          title="No matching expenses"
          description="Try changing your search terms or date range filters."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Show All Expenses
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {filteredExpenses.map((expense) => {
            const isCash = expense.payment_method === 'cash';
            const displayCategory =
              expense.category === 'Other' && expense.custom_category
                ? `Other: ${expense.custom_category}`
                : expense.category;

            return (
              <Card
                key={expense.id}
                className="p-4 transition hover:border-leaf-300"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Left info */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold text-leaf-950">
                        {displayCategory}
                      </span>
                      <Badge tone={isCash ? 'green' : 'orange'}>
                        {expense.payment_method.toUpperCase()}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-600 font-medium">
                      <span className="inline-flex items-center gap-1 text-leaf-700">
                        <Calendar className="h-3.5 w-3.5 text-leaf-500" aria-hidden />
                        {formatDisplayDate(expense.expense_date)}
                      </span>
                      {expense.paid_to && (
                        <span>
                          Paid to: <strong className="font-bold text-stone-800">{expense.paid_to}</strong>
                        </span>
                      )}
                      {expense.description && (
                        <span className="italic text-stone-500 truncate max-w-md">
                          &ldquo;{expense.description}&rdquo;
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount & Actions */}
                  <div className="flex items-center gap-4 shrink-0">
                    <p className="tabular-nums text-lg sm:text-xl font-extrabold text-leaf-950">
                      ₹{expense.amount.toLocaleString('en-IN')}
                    </p>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(expense)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
                        title="Edit Expense"
                        aria-label="Edit Expense"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpenseToDelete(expense)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        title="Delete Expense"
                        aria-label="Delete Expense"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <ExpenseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        expenseToEdit={expenseToEdit}
        onSaved={(savedExp) => {
          setNotice(
            expenseToEdit
              ? `Updated expense of ₹${savedExp.amount.toLocaleString('en-IN')}.`
              : `Added new expense of ₹${savedExp.amount.toLocaleString('en-IN')}.`
          );
          void loadExpenses(false, true);
        }}
      />

      {/* Printable Report Modal */}
      <PrintableExpenseReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        expenses={filteredExpenses}
        summary={summary}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(expenseToDelete)}
        onClose={() => {
          if (!deleting) setExpenseToDelete(null);
        }}
        title="Delete Expense"
        subtitle="This action cannot be undone."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {deleteError && <AlertBanner tone="error" message={deleteError} />}

          <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 border border-red-200">
            <AlertTriangle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">
              <p className="font-bold">Are you sure you want to delete this expense?</p>
              {expenseToDelete && (
                <p className="mt-1 font-semibold">
                  {expenseToDelete.category} • ₹{expenseToDelete.amount.toLocaleString('en-IN')} on{' '}
                  {formatDisplayDate(expenseToDelete.expense_date)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setExpenseToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="!bg-red-600 hover:!bg-red-700 !border-red-600 text-white"
            >
              {deleting ? 'Deleting…' : 'Delete Expense'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

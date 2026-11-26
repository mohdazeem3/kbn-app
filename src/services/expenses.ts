import { supabase } from '@/lib/supabase';
import { appCache, TTL } from './cache';
import type {
  CreateExpenseInput,
  ExpenseRecord,
  ExpenseSummary,
  UpdateExpenseInput,
} from '@/types/database';

export const SHOP_TIMEZONE = 'Asia/Kolkata';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

export class ExpenseError extends Error {
  code?: string;
  isAuthExpired: boolean;
  isNetworkError: boolean;
  isPermissionError: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      isAuthExpired?: boolean;
      isNetworkError?: boolean;
      isPermissionError?: boolean;
    }
  ) {
    super(message);
    this.name = 'ExpenseError';
    this.code = options?.code;
    this.isAuthExpired = Boolean(options?.isAuthExpired);
    this.isNetworkError = Boolean(options?.isNetworkError);
    this.isPermissionError = Boolean(options?.isPermissionError);
  }
}

export async function formatExpenseError(
  error: PostgrestErrorLike | null,
  fallback: string
): Promise<ExpenseError> {
  if (!error) return new ExpenseError(fallback);

  const code = error.code ?? '';
  const msg = (error.message ?? '').trim();
  const lowerMsg = msg.toLowerCase();

  // 1. Network / connectivity errors
  if (
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('networkerror') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('net::err') ||
    lowerMsg.includes('abort') ||
    code === 'PGRST000' ||
    code === 'FETCH_ERROR'
  ) {
    return new ExpenseError(
      'Network connection error. Please check your internet connection and try again.',
      { code, isNetworkError: true }
    );
  }

  // 2. JWT Expired / Token invalid
  if (
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    lowerMsg.includes('jwt expired') ||
    lowerMsg.includes('token is expired') ||
    lowerMsg.includes('invalid claim')
  ) {
    return new ExpenseError('Your session has expired. Please sign in again.', {
      code,
      isAuthExpired: true,
    });
  }

  // 3. PostgreSQL 42501 (insufficient_privilege)
  if (code === '42501' || lowerMsg.includes('permission denied')) {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        return new ExpenseError('Your session has expired. Please sign in again.', {
          code,
          isAuthExpired: true,
        });
      }
    } catch {
      // Proceed to permission check error below
    }

    return new ExpenseError(
      'You do not have authorization to access shop expenses. Please contact your shop administrator.',
      { code, isPermissionError: true }
    );
  }

  // 4. Schema cache / Missing table errors
  if (
    code === 'PGRST205' ||
    code === '42P01' ||
    code === '42703' ||
    lowerMsg.includes('schema cache') ||
    lowerMsg.includes('does not exist')
  ) {
    return new ExpenseError(
      'The expenses database table is not ready yet. Apply the latest migrations first, then try again.',
      { code }
    );
  }

  // 5. Database check constraints
  if (lowerMsg.includes('expenses_amount_positive')) {
    return new ExpenseError('Expense amount must be a positive number greater than zero.', { code });
  }
  if (lowerMsg.includes('expenses_payment_method_valid')) {
    return new ExpenseError('Payment method must be either Cash or UPI.', { code });
  }
  if (lowerMsg.includes('expenses_category_valid')) {
    return new ExpenseError('Please select a valid expense category.', { code });
  }

  return new ExpenseError(msg || fallback, { code });
}

/**
 * Returns today's calendar date in YYYY-MM-DD format according to Asia/Kolkata timezone.
 */
export function getShopTodayDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Returns the current year-month prefix in YYYY-MM format according to Asia/Kolkata timezone.
 */
export function getShopCurrentMonthPrefix(): string {
  const today = getShopTodayDate();
  return today.slice(0, 7);
}

interface RawExpenseRow {
  id: string;
  expense_date: string;
  category: string;
  custom_category: string | null;
  amount: number | string;
  payment_method: string;
  paid_to: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function normalizeExpenseRow(row: RawExpenseRow): ExpenseRecord {
  return {
    id: row.id,
    expense_date: row.expense_date,
    category: row.category as ExpenseRecord['category'],
    custom_category: row.custom_category ?? null,
    amount: Number(row.amount),
    payment_method: row.payment_method as ExpenseRecord['payment_method'],
    paid_to: row.paid_to ?? null,
    description: row.description ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by ?? null,
  };
}

/**
 * Fetches all expenses ordered chronologically with newest first.
 */
export async function listExpenses(options?: { forceRefresh?: boolean }): Promise<ExpenseRecord[]> {
  return appCache.fetch(
    'expenses:all',
    async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(
          'id, expense_date, category, custom_category, amount, payment_method, paid_to, description, created_at, updated_at, created_by'
        )
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw await formatExpenseError(error, 'Could not load expenses list.');
      }

      return (data ?? []).map((row) => normalizeExpenseRow(row as RawExpenseRow));
    },
    { ttlMs: TTL.EXPENSES, tags: ['expenses'], forceRefresh: options?.forceRefresh }
  );
}

/**
 * Computes expense dashboard summaries: today, this month, and filtered totals.
 */
export function calculateExpenseSummary(
  allExpenses: ExpenseRecord[],
  filteredExpenses: ExpenseRecord[],
  todayDate: string,
  currentMonthPrefix: string
): ExpenseSummary {
  let todayExpenses = 0;
  let monthExpenses = 0;

  for (const exp of allExpenses) {
    if (exp.expense_date === todayDate) {
      todayExpenses += exp.amount;
    }
    if (exp.expense_date.startsWith(currentMonthPrefix)) {
      monthExpenses += exp.amount;
    }
  }

  let totalExpenses = 0;
  let cashExpenses = 0;
  let upiExpenses = 0;
  const categoryTotals: Record<string, number> = {};

  for (const exp of filteredExpenses) {
    totalExpenses += exp.amount;
    if (exp.payment_method === 'cash') {
      cashExpenses += exp.amount;
    } else if (exp.payment_method === 'upi') {
      upiExpenses += exp.amount;
    }

    const catKey = exp.category === 'Other' && exp.custom_category?.trim()
      ? `Other (${exp.custom_category.trim()})`
      : exp.category;

    categoryTotals[catKey] = (categoryTotals[catKey] ?? 0) + exp.amount;
  }

  return {
    today_expenses: Math.round(todayExpenses * 100) / 100,
    month_expenses: Math.round(monthExpenses * 100) / 100,
    total_expenses: Math.round(totalExpenses * 100) / 100,
    cash_expenses: Math.round(cashExpenses * 100) / 100,
    upi_expenses: Math.round(upiExpenses * 100) / 100,
    category_totals: Object.fromEntries(
      Object.entries(categoryTotals).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
  };
}

/**
 * Creates a new expense record in Supabase.
 */
export async function createExpense(input: CreateExpenseInput): Promise<ExpenseRecord> {
  const sanitizedAmount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    throw new Error('Please enter a valid expense amount greater than zero.');
  }

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id ?? null;

  const payload = {
    expense_date: input.expense_date,
    category: input.category,
    custom_category: input.category === 'Other' ? (input.custom_category?.trim() || null) : null,
    amount: sanitizedAmount,
    payment_method: input.payment_method,
    paid_to: input.paid_to?.trim() || null,
    description: input.description?.trim() || null,
    created_by: userId,
  };

  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select(
      'id, expense_date, category, custom_category, amount, payment_method, paid_to, description, created_at, updated_at, created_by'
    )
    .single();

  if (error) {
    throw await formatExpenseError(error, 'Could not save expense.');
  }

  appCache.invalidateTags(['expenses']);
  return normalizeExpenseRow(data as RawExpenseRow);
}

/**
 * Updates an existing expense record.
 */
export async function updateExpense(input: UpdateExpenseInput): Promise<ExpenseRecord> {
  const sanitizedAmount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    throw new Error('Please enter a valid expense amount greater than zero.');
  }

  const payload = {
    expense_date: input.expense_date,
    category: input.category,
    custom_category: input.category === 'Other' ? (input.custom_category?.trim() || null) : null,
    amount: sanitizedAmount,
    payment_method: input.payment_method,
    paid_to: input.paid_to?.trim() || null,
    description: input.description?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('expenses')
    .update(payload)
    .eq('id', input.id)
    .select(
      'id, expense_date, category, custom_category, amount, payment_method, paid_to, description, created_at, updated_at, created_by'
    )
    .single();

  if (error) {
    throw await formatExpenseError(error, 'Could not update expense.');
  }

  appCache.invalidateTags(['expenses']);
  return normalizeExpenseRow(data as RawExpenseRow);
}

/**
 * Deletes an expense record.
 */
export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', id);

  if (error) {
    throw await formatExpenseError(error, 'Could not delete expense.');
  }

  appCache.invalidateTags(['expenses']);
}

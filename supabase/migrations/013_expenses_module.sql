-- ============================================================================
-- Migration 013: Dedicated Expenses Module
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- Description: Creates the expenses table for recording operational and shop
-- expenses (Transport, Labour, Market Charges, etc.) paid via Cash or UPI.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT public.shop_today(),
  category text NOT NULL,
  custom_category text,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL,
  paid_to text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  CONSTRAINT expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT expenses_payment_method_valid CHECK (payment_method IN ('cash', 'upi')),
  CONSTRAINT expenses_category_valid CHECK (
    category IN (
      'Transport',
      'Labour',
      'Market Charges',
      'Shop Expenses',
      'Food & Refreshments',
      'Packing Materials',
      'Other'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON public.expenses (payment_method);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.expenses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expenses TO authenticated;

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO authenticated USING (public.is_authorized_user());

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (public.is_authorized_user());

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses
  FOR UPDATE TO authenticated USING (public.is_authorized_user()) WITH CHECK (public.is_authorized_user());

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses
  FOR DELETE TO authenticated USING (public.is_authorized_user());

COMMIT;

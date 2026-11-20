-- ============================================================================
-- Migration 003: Customer & Supplier Opening Balances
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Pre-existing customer dues at cutover (distinct from new sales/bills)
-- ----------------------------------------------------------------------------
CREATE TABLE public.customer_opening_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES public.customers(id),
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  as_of_date    date NOT NULL DEFAULT public.shop_today(),
  note          text NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at  timestamptz NULL,
  cancel_reason text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cob_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

-- At most one active opening balance per customer
CREATE UNIQUE INDEX cob_one_active_per_customer_uidx
  ON public.customer_opening_balances (customer_id)
  WHERE status = 'active';

CREATE INDEX cob_customer_status_idx
  ON public.customer_opening_balances (customer_id, status);

-- ----------------------------------------------------------------------------
-- 2. Pre-existing supplier payables at cutover (distinct from new deliveries)
-- ----------------------------------------------------------------------------
CREATE TABLE public.supplier_opening_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES public.suppliers(id),
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  as_of_date    date NOT NULL DEFAULT public.shop_today(),
  note          text NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at  timestamptz NULL,
  cancel_reason text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sob_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

-- At most one active opening balance per supplier
CREATE UNIQUE INDEX sob_one_active_per_supplier_uidx
  ON public.supplier_opening_balances (supplier_id)
  WHERE status = 'active';

CREATE INDEX sob_supplier_status_idx
  ON public.supplier_opening_balances (supplier_id, status);

COMMIT;

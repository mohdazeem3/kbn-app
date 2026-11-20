-- ============================================================================
-- Migration 006: Unified Customer Payments, Supplier Payments, Allocations & Refunds
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Unified customer payments (immediate bill_sale + later collection receipts)
-- ----------------------------------------------------------------------------
CREATE TABLE public.customer_payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            uuid NULL REFERENCES public.customers(id),
  customer_name_snapshot text NOT NULL CHECK (btrim(customer_name_snapshot) <> ''),
  payment_origin         text NOT NULL DEFAULT 'collection'
                         CHECK (payment_origin IN ('bill_sale', 'collection')),
  amount                 numeric(12,2) NOT NULL CHECK (amount > 0),
  mode                   text NOT NULL CHECK (mode IN ('cash', 'upi')),
  payment_date           date NOT NULL DEFAULT public.shop_today(),
  note                   text NULL,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at           timestamptz NULL,
  cancel_reason          text NULL,
  idempotency_key        uuid NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cp_cash_customer_origin_check CHECK (
    customer_id IS NOT NULL OR payment_origin = 'bill_sale'
  ),
  CONSTRAINT cp_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX customer_payments_idempotency_uidx
  ON public.customer_payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX customer_payments_date_status_mode_idx
  ON public.customer_payments (payment_date, status, mode);

CREATE INDEX customer_payments_customer_status_idx
  ON public.customer_payments (customer_id, status)
  WHERE customer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Customer refunds (audit record when a paid bill is cancelled & refunded)
-- ----------------------------------------------------------------------------
CREATE TABLE public.customer_refunds (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id                uuid NOT NULL UNIQUE REFERENCES public.bills(id),
  customer_id            uuid NULL REFERENCES public.customers(id),
  customer_name_snapshot text NOT NULL CHECK (btrim(customer_name_snapshot) <> ''),
  amount                 numeric(12,2) NOT NULL CHECK (amount > 0),
  mode                   text NOT NULL CHECK (mode IN ('cash', 'upi')),
  refund_date            date NOT NULL DEFAULT public.shop_today(),
  note                   text NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_refunds_date_mode_idx
  ON public.customer_refunds (refund_date, mode);

CREATE INDEX customer_refunds_customer_idx
  ON public.customer_refunds (customer_id)
  WHERE customer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Explicit customer payment allocations (bill XOR opening_balance)
-- ----------------------------------------------------------------------------
CREATE TABLE public.customer_payment_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_payment_id uuid NOT NULL REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  bill_id             uuid NULL REFERENCES public.bills(id),
  opening_balance_id  uuid NULL REFERENCES public.customer_opening_balances(id),
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'cancelled', 'refunded')),
  refund_id           uuid NULL REFERENCES public.customer_refunds(id),
  reversed_at         timestamptz NULL,
  reversal_reason     text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpa_single_target_xor_check CHECK (
    (bill_id IS NOT NULL)::integer + (opening_balance_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT cpa_status_consistency_check CHECK (
    (status = 'active'    AND reversed_at IS NULL     AND refund_id IS NULL)
    OR (status = 'cancelled' AND reversed_at IS NOT NULL AND refund_id IS NULL)
    OR (status = 'refunded'  AND reversed_at IS NOT NULL AND refund_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX cpa_active_payment_bill_uidx
  ON public.customer_payment_allocations (customer_payment_id, bill_id)
  WHERE bill_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX cpa_active_payment_ob_uidx
  ON public.customer_payment_allocations (customer_payment_id, opening_balance_id)
  WHERE opening_balance_id IS NOT NULL AND status = 'active';

CREATE INDEX cpa_bill_status_idx
  ON public.customer_payment_allocations (bill_id, status)
  WHERE bill_id IS NOT NULL;

CREATE INDEX cpa_ob_status_idx
  ON public.customer_payment_allocations (opening_balance_id, status)
  WHERE opening_balance_id IS NOT NULL;

CREATE INDEX cpa_payment_status_idx
  ON public.customer_payment_allocations (customer_payment_id, status);

-- Belt-and-suspenders trigger: avoids PostgreSQL MATCH SIMPLE NULL-bypass pitfall
CREATE OR REPLACE FUNCTION public.validate_customer_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pay_customer uuid;
  v_target_customer uuid;
BEGIN
  SELECT customer_id INTO v_pay_customer
    FROM public.customer_payments
   WHERE id = NEW.customer_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer payment not found.';
  END IF;

  IF NEW.bill_id IS NOT NULL THEN
    SELECT customer_id INTO v_target_customer
      FROM public.bills
     WHERE id = NEW.bill_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target bill not found.';
    END IF;
    IF v_pay_customer IS DISTINCT FROM v_target_customer THEN
      RAISE EXCEPTION 'Payment customer does not match target bill customer.';
    END IF;
  ELSE
    SELECT customer_id INTO v_target_customer
      FROM public.customer_opening_balances
     WHERE id = NEW.opening_balance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target customer opening balance not found.';
    END IF;
    IF v_pay_customer IS NULL OR v_pay_customer <> v_target_customer THEN
      RAISE EXCEPTION 'Payment customer does not match opening balance customer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_customer_payment_allocation
  BEFORE INSERT ON public.customer_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_payment_allocation();

-- ----------------------------------------------------------------------------
-- 4. Supplier payments (immediate delivery_receipt + later settlement)
-- ----------------------------------------------------------------------------
CREATE TABLE public.supplier_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid NOT NULL REFERENCES public.suppliers(id),
  payment_origin  text NOT NULL DEFAULT 'settlement'
                  CHECK (payment_origin IN ('delivery_receipt', 'settlement')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  mode            text NOT NULL CHECK (mode IN ('cash', 'upi')),
  payment_date    date NOT NULL DEFAULT public.shop_today(),
  note            text NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at    timestamptz NULL,
  cancel_reason   text NULL,
  idempotency_key uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sp_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX supplier_payments_idempotency_uidx
  ON public.supplier_payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX supplier_payments_supplier_status_idx
  ON public.supplier_payments (supplier_id, status);

CREATE INDEX supplier_payments_date_status_mode_idx
  ON public.supplier_payments (payment_date, status, mode);

-- ----------------------------------------------------------------------------
-- 5. Supplier refunds (when a paid delivery is cancelled & supplier refunds money)
-- ----------------------------------------------------------------------------
CREATE TABLE public.supplier_refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE REFERENCES public.stock_deliveries(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  mode        text NOT NULL CHECK (mode IN ('cash', 'upi')),
  refund_date date NOT NULL DEFAULT public.shop_today(),
  note        text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supplier_refunds_supplier_idx
  ON public.supplier_refunds (supplier_id);

CREATE INDEX supplier_refunds_date_mode_idx
  ON public.supplier_refunds (refund_date, mode);

-- ----------------------------------------------------------------------------
-- 6. Explicit supplier payment allocations (delivery XOR opening_balance)
--    Supports safe reallocation onto another unpaid delivery (even if the same
--    payment already has an active allocation there) without cancelling other rows.
-- ----------------------------------------------------------------------------
CREATE TABLE public.supplier_payment_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id uuid NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  delivery_id         uuid NULL REFERENCES public.stock_deliveries(id),
  opening_balance_id  uuid NULL REFERENCES public.supplier_opening_balances(id),
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'reallocated', 'refunded', 'cancelled')),
  refund_id           uuid NULL REFERENCES public.supplier_refunds(id),
  reallocated_from_id uuid NULL REFERENCES public.supplier_payment_allocations(id),
  reversed_at         timestamptz NULL,
  reversal_reason     text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_single_target_xor_check CHECK (
    (delivery_id IS NOT NULL)::integer + (opening_balance_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT spa_status_consistency_check CHECK (
    (status = 'active'                   AND reversed_at IS NULL     AND refund_id IS NULL)
    OR (status IN ('reallocated', 'cancelled') AND reversed_at IS NOT NULL AND refund_id IS NULL)
    OR (status = 'refunded'              AND reversed_at IS NOT NULL AND refund_id IS NOT NULL)
  )
);

CREATE INDEX spa_delivery_status_idx
  ON public.supplier_payment_allocations (delivery_id, status)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX spa_ob_status_idx
  ON public.supplier_payment_allocations (opening_balance_id, status)
  WHERE opening_balance_id IS NOT NULL;

CREATE INDEX spa_payment_status_idx
  ON public.supplier_payment_allocations (supplier_payment_id, status);

CREATE INDEX spa_reallocated_from_idx
  ON public.supplier_payment_allocations (reallocated_from_id)
  WHERE reallocated_from_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_supplier_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pay_supplier uuid;
  v_target_supplier uuid;
BEGIN
  SELECT supplier_id INTO v_pay_supplier
    FROM public.supplier_payments
   WHERE id = NEW.supplier_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found.';
  END IF;

  IF NEW.delivery_id IS NOT NULL THEN
    SELECT supplier_id INTO v_target_supplier
      FROM public.stock_deliveries
     WHERE id = NEW.delivery_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target stock delivery not found.';
    END IF;
    IF v_pay_supplier <> v_target_supplier THEN
      RAISE EXCEPTION 'Cannot allocate supplier payment to another supplier''s delivery.';
    END IF;
  ELSE
    SELECT supplier_id INTO v_target_supplier
      FROM public.supplier_opening_balances
     WHERE id = NEW.opening_balance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target supplier opening balance not found.';
    END IF;
    IF v_pay_supplier <> v_target_supplier THEN
      RAISE EXCEPTION 'Cannot allocate supplier payment to another supplier''s opening balance.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_supplier_payment_allocation
  BEFORE INSERT ON public.supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_supplier_payment_allocation();

COMMIT;

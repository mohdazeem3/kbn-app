-- ============================================================================
-- Migration 010: Multi-Fruit Suppliers & Mixed-Fruit Deliveries Support
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create junction table for supplier fruits (supports 1 or many fruits)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_fruits (
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  fruit_id    uuid NOT NULL REFERENCES public.fruits(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, fruit_id)
);

CREATE INDEX IF NOT EXISTS supplier_fruits_fruit_idx 
  ON public.supplier_fruits (fruit_id);

-- ----------------------------------------------------------------------------
-- 2. Migrate existing single-fruit suppliers (100% data preservation)
-- ----------------------------------------------------------------------------
INSERT INTO public.supplier_fruits (supplier_id, fruit_id, created_at)
SELECT id, fruit_id, created_at 
FROM public.suppliers
WHERE fruit_id IS NOT NULL
ON CONFLICT (supplier_id, fruit_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security on supplier_fruits (SELECT ONLY for authenticated)
--    Direct INSERT, UPDATE, DELETE revoked. All modifications are channeled
--    strictly through the atomic SECURITY DEFINER create/update RPCs.
-- ----------------------------------------------------------------------------
ALTER TABLE public.supplier_fruits ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_fruits_select ON public.supplier_fruits
  FOR SELECT TO authenticated USING (public.is_authorized_user());

REVOKE ALL ON TABLE public.supplier_fruits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_fruits TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Constraint Updates (Bottom-Up: stock_batches -> stock_deliveries -> suppliers)
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_batches
  DROP CONSTRAINT IF EXISTS stock_batches_delivery_fruit_fkey;

ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_delivery_fkey
  FOREIGN KEY (delivery_id) REFERENCES public.stock_deliveries(id) ON DELETE CASCADE;

ALTER TABLE public.stock_deliveries
  DROP CONSTRAINT IF EXISTS stock_deliveries_id_fruit_uidx;

ALTER TABLE public.stock_deliveries
  DROP CONSTRAINT IF EXISTS stock_deliveries_supplier_fruit_fkey;

ALTER TABLE public.stock_deliveries
  ADD CONSTRAINT stock_deliveries_supplier_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;

ALTER TABLE public.stock_deliveries
  ALTER COLUMN fruit_id DROP NOT NULL;

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_id_fruit_uidx;

ALTER TABLE public.suppliers
  ALTER COLUMN fruit_id DROP NOT NULL;

DROP INDEX IF EXISTS public.suppliers_fruit_active_idx;
CREATE INDEX IF NOT EXISTS suppliers_active_idx 
  ON public.suppliers (active);

-- ----------------------------------------------------------------------------
-- 5. Database-Level Minimum Fruit Enforcement (Deferred Constraint Triggers)
-- ----------------------------------------------------------------------------

-- Tier 1: Prevent mutating supplier_id on existing junction rows
CREATE OR REPLACE FUNCTION public.prevent_supplier_fruits_supplier_id_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supplier_id <> OLD.supplier_id THEN
    RAISE EXCEPTION 'Cannot reassign supplier_id on an existing supplier_fruits record. Delete the link and insert a new record instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_supplier_fruits_supplier_id_mutation ON public.supplier_fruits;
CREATE TRIGGER trg_prevent_supplier_fruits_supplier_id_mutation
  BEFORE UPDATE ON public.supplier_fruits
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_supplier_fruits_supplier_id_mutation();

-- Internal helper function evaluated at transaction COMMIT
CREATE OR REPLACE FUNCTION public.check_supplier_active_fruits(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active boolean;
  v_count  integer;
BEGIN
  IF p_supplier_id IS NULL THEN
    RETURN;
  END IF;

  SELECT active INTO v_active
    FROM public.suppliers
   WHERE id = p_supplier_id;

  -- If the supplier was deleted or is inactive, check passes
  IF NOT FOUND OR v_active IS FALSE THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::integer INTO v_count
    FROM public.supplier_fruits
   WHERE supplier_id = p_supplier_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Active supplier % must have at least one fruit category linked in supplier_fruits.', p_supplier_id;
  END IF;
END;
$$;

-- Tier 2: Deferred trigger function checking both OLD and NEW supplier IDs
CREATE OR REPLACE FUNCTION public.enforce_supplier_has_fruits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_TABLE_NAME = 'suppliers' THEN
    PERFORM public.check_supplier_active_fruits(NEW.id);
  ELSIF TG_TABLE_NAME = 'supplier_fruits' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.check_supplier_active_fruits(NEW.supplier_id);
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM public.check_supplier_active_fruits(OLD.supplier_id);
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.supplier_id <> NEW.supplier_id THEN
        PERFORM public.check_supplier_active_fruits(OLD.supplier_id);
      END IF;
      PERFORM public.check_supplier_active_fruits(NEW.supplier_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_must_have_fruits_suppliers ON public.suppliers;
CREATE CONSTRAINT TRIGGER trg_supplier_must_have_fruits_suppliers
  AFTER INSERT OR UPDATE ON public.suppliers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_supplier_has_fruits();

DROP TRIGGER IF EXISTS trg_supplier_must_have_fruits_junction ON public.supplier_fruits;
CREATE CONSTRAINT TRIGGER trg_supplier_must_have_fruits_junction
  AFTER DELETE OR UPDATE ON public.supplier_fruits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_supplier_has_fruits();

-- Strict least-privilege security: revoke all execute on internal trigger/helper functions
REVOKE ALL ON FUNCTION public.prevent_supplier_fruits_supplier_id_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_supplier_active_fruits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_supplier_has_fruits() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Atomic Supplier RPCs (create_supplier & update_supplier)
--    Uses deterministic array_agg(f.id ORDER BY f.name) to establish
--    the legacy suppliers.fruit_id pointer consistently.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_supplier(
  p_name      text,
  p_fruit_ids uuid[],
  p_phone     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name               text := btrim(COALESCE(p_name, ''));
  v_phone              text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_requested_count    integer;
  v_deduped_fruit_ids  uuid[];
  v_supplier_id        uuid;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Supplier name is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE lower(btrim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A supplier with name "%" already exists.', v_name;
  END IF;

  IF p_fruit_ids IS NULL OR cardinality(p_fruit_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one fruit category for this supplier.';
  END IF;

  SELECT COUNT(DISTINCT f_id)::integer
    INTO v_requested_count
    FROM unnest(p_fruit_ids) AS f_id
   WHERE f_id IS NOT NULL;

  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Select at least one valid fruit category for this supplier.';
  END IF;

  -- Validate active fruits and order deterministically by name
  SELECT array_agg(f.id ORDER BY f.name)
    INTO v_deduped_fruit_ids
    FROM public.fruits f
   WHERE f.id = ANY(p_fruit_ids)
     AND f.active = true;

  IF v_deduped_fruit_ids IS NULL OR cardinality(v_deduped_fruit_ids) <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected fruit categories are inactive or do not exist.';
  END IF;

  BEGIN
    INSERT INTO public.suppliers (name, phone, fruit_id)
    VALUES (v_name, v_phone, v_deduped_fruit_ids[1])
    RETURNING id INTO v_supplier_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A supplier with name "%" already exists.', v_name;
  END;

  INSERT INTO public.supplier_fruits (supplier_id, fruit_id)
  SELECT v_supplier_id, f_id
    FROM unnest(v_deduped_fruit_ids) AS f_id;

  RETURN v_supplier_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supplier(
  p_id        uuid,
  p_name      text,
  p_fruit_ids uuid[],
  p_phone     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name               text := btrim(COALESCE(p_name, ''));
  v_phone              text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_supplier           record;
  v_requested_count    integer;
  v_deduped_fruit_ids  uuid[];
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT id, active INTO v_supplier
    FROM public.suppliers
   WHERE id = p_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found.';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Supplier name is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE lower(btrim(name)) = lower(v_name)
       AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'Another supplier with name "%" already exists.', v_name;
  END IF;

  IF p_fruit_ids IS NULL OR cardinality(p_fruit_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one fruit category for this supplier.';
  END IF;

  SELECT COUNT(DISTINCT f_id)::integer
    INTO v_requested_count
    FROM unnest(p_fruit_ids) AS f_id
   WHERE f_id IS NOT NULL;

  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Select at least one valid fruit category for this supplier.';
  END IF;

  SELECT array_agg(f.id ORDER BY f.name)
    INTO v_deduped_fruit_ids
    FROM public.fruits f
   WHERE f.id = ANY(p_fruit_ids)
     AND (
       f.active = true OR EXISTS (
         SELECT 1 FROM public.supplier_fruits sf
          WHERE sf.supplier_id = p_id AND sf.fruit_id = f.id
       )
     );

  IF v_deduped_fruit_ids IS NULL OR cardinality(v_deduped_fruit_ids) <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected fruit categories are inactive or do not exist.';
  END IF;

  BEGIN
    UPDATE public.suppliers
       SET name       = v_name,
           phone      = v_phone,
           fruit_id   = v_deduped_fruit_ids[1],
           updated_at = now()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another supplier with name "%" already exists.', v_name;
  END;

  DELETE FROM public.supplier_fruits
   WHERE supplier_id = p_id
     AND fruit_id <> ALL(v_deduped_fruit_ids);

  INSERT INTO public.supplier_fruits (supplier_id, fruit_id)
  SELECT p_id, f_id
    FROM unnest(v_deduped_fruit_ids) AS f_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.supplier_fruits sf
      WHERE sf.supplier_id = p_id AND sf.fruit_id = f_id
   );
END;
$$;

REVOKE ALL ON FUNCTION public.create_supplier(text, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier(text, uuid[], text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_supplier(uuid, text, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier(uuid, text, uuid[], text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Drop Views in Reverse-Dependency Order
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.dashboard_overview;
DROP VIEW IF EXISTS public.supplier_balances;
DROP VIEW IF EXISTS public.delivery_balances;

-- ----------------------------------------------------------------------------
-- 8. Recreate public.delivery_balances (Level 1)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.delivery_balances
WITH (security_invoker = true) AS
WITH delivery_paid AS (
  SELECT
    spa.delivery_id,
    COALESCE(SUM(spa.amount), 0)::numeric(12,2) AS amount_paid
  FROM public.supplier_payment_allocations spa
  JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
  WHERE spa.delivery_id IS NOT NULL
    AND spa.status = 'active'
    AND sp.status = 'active'
  GROUP BY spa.delivery_id
),
delivery_stock AS (
  SELECT
    delivery_id,
    COALESCE(SUM(boxes_remaining), 0)::integer AS boxes_remaining
  FROM public.stock_batches
  GROUP BY delivery_id
),
delivery_fruits_raw AS (
  SELECT sb.delivery_id, sb.fruit_id, f.name AS fruit_name
  FROM public.stock_batches sb
  JOIN public.fruits f ON f.id = sb.fruit_id
  UNION
  SELECT sd.id AS delivery_id, sd.fruit_id, f.name AS fruit_name
  FROM public.stock_deliveries sd
  JOIN public.fruits f ON f.id = sd.fruit_id
  WHERE sd.fruit_id IS NOT NULL
),
delivery_fruits AS (
  SELECT
    dfr.delivery_id,
    (array_agg(dfr.fruit_id ORDER BY dfr.fruit_name))[1] AS primary_fruit_id,
    array_agg(dfr.fruit_id ORDER BY dfr.fruit_name)      AS fruit_ids,
    string_agg(dfr.fruit_name, ', ' ORDER BY dfr.fruit_name) AS fruit_names,
    COUNT(dfr.fruit_id)::integer                        AS fruit_count
  FROM delivery_fruits_raw dfr
  GROUP BY dfr.delivery_id
)
SELECT
  sd.id                                                                 AS delivery_id,
  sd.delivery_no,
  sd.supplier_id,
  s.name                                                                AS supplier_name,
  s.active                                                              AS supplier_active,
  CASE
    WHEN COALESCE(df.fruit_count, 0) = 1 THEN df.primary_fruit_id
    ELSE NULL
  END                                                                   AS fruit_id,
  COALESCE(df.fruit_names, 'Unknown fruit')                             AS fruit_name,
  sd.received_date,
  sd.total_boxes                                                        AS boxes_received,
  COALESCE(ds.boxes_remaining, 0)                                       AS boxes_remaining,
  sd.total_amount                                                       AS purchase_amount,
  COALESCE(dp.amount_paid, 0)::numeric(12,2)                            AS amount_paid,
  CASE
    WHEN sd.status = 'active'
      THEN (sd.total_amount - COALESCE(dp.amount_paid, 0))::numeric(12,2)
    ELSE 0::numeric(12,2)
  END                                                                   AS outstanding_amount,
  CASE
    WHEN sd.status = 'cancelled'                            THEN 'cancelled'
    WHEN COALESCE(dp.amount_paid, 0) >= sd.total_amount     THEN 'paid'
    WHEN COALESCE(dp.amount_paid, 0) = 0                    THEN 'unpaid'
    ELSE 'partial'
  END                                                                   AS payment_status,
  sd.status,
  sd.cancelled_at,
  sd.cancel_reason,
  sd.note,
  sd.created_at,
  COALESCE(df.fruit_ids, ARRAY[]::uuid[])                              AS fruit_ids,
  COALESCE(df.fruit_count, 0)::integer                                  AS fruit_count
FROM public.stock_deliveries sd
JOIN public.suppliers s         ON s.id = sd.supplier_id
LEFT JOIN delivery_fruits df    ON df.delivery_id = sd.id
LEFT JOIN delivery_paid dp      ON dp.delivery_id = sd.id
LEFT JOIN delivery_stock ds     ON ds.delivery_id = sd.id;

-- ----------------------------------------------------------------------------
-- 9. Recreate public.supplier_balances (Level 2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.supplier_balances
WITH (security_invoker = true) AS
WITH ob_paid AS (
  SELECT
    spa.opening_balance_id,
    COALESCE(SUM(spa.amount), 0)::numeric(12,2) AS amount_paid
  FROM public.supplier_payment_allocations spa
  JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
  WHERE spa.opening_balance_id IS NOT NULL
    AND spa.status = 'active'
    AND sp.status = 'active'
  GROUP BY spa.opening_balance_id
),
ob_agg AS (
  SELECT
    sob.supplier_id,
    sob.id                                                 AS opening_balance_id,
    sob.amount                                             AS opening_balance,
    COALESCE(op.amount_paid, 0)::numeric(12,2)             AS opening_balance_paid
  FROM public.supplier_opening_balances sob
  LEFT JOIN ob_paid op ON op.opening_balance_id = sob.id
  WHERE sob.status = 'active'
),
del_agg AS (
  SELECT
    db.supplier_id,
    COUNT(*)::integer                                      AS active_deliveries_count,
    COALESCE(SUM(db.boxes_received), 0)::integer           AS total_boxes_received,
    COALESCE(SUM(db.purchase_amount), 0)::numeric(12,2)    AS deliveries_total,
    COALESCE(SUM(db.amount_paid), 0)::numeric(12,2)        AS deliveries_paid,
    COALESCE(SUM(db.outstanding_amount), 0)::numeric(12,2) AS deliveries_outstanding
  FROM public.delivery_balances db
  WHERE db.status = 'active'
  GROUP BY db.supplier_id
),
fruits_raw AS (
  SELECT sf.supplier_id, sf.fruit_id, f.name AS fruit_name
  FROM public.supplier_fruits sf
  JOIN public.fruits f ON f.id = sf.fruit_id
  UNION
  SELECT s.id AS supplier_id, s.fruit_id, f.name AS fruit_name
  FROM public.suppliers s
  JOIN public.fruits f ON f.id = s.fruit_id
  WHERE s.fruit_id IS NOT NULL
),
fruits_agg AS (
  SELECT
    fr.supplier_id,
    (array_agg(fr.fruit_id ORDER BY fr.fruit_name))[1] AS primary_fruit_id,
    array_agg(fr.fruit_id ORDER BY fr.fruit_name)      AS fruit_ids,
    string_agg(fr.fruit_name, ', ' ORDER BY fr.fruit_name) AS fruit_names,
    COUNT(fr.fruit_id)::integer                        AS fruit_count
  FROM fruits_raw fr
  GROUP BY fr.supplier_id
)
SELECT
  s.id                                                                             AS supplier_id,
  s.name,
  s.phone,
  CASE
    WHEN COALESCE(fa.fruit_count, 0) = 1 THEN fa.primary_fruit_id
    ELSE NULL
  END                                                                              AS fruit_id,
  COALESCE(fa.fruit_names, 'No fruits linked')                                     AS fruit_name,
  s.active,
  ob.opening_balance_id,
  COALESCE(ob.opening_balance, 0)::numeric(12,2)                                   AS opening_balance,
  COALESCE(ob.opening_balance_paid, 0)::numeric(12,2)                              AS opening_balance_paid,
  (COALESCE(ob.opening_balance, 0) - COALESCE(ob.opening_balance_paid, 0))::numeric(12,2) AS opening_balance_outstanding,
  COALESCE(da.active_deliveries_count, 0)                                          AS active_deliveries_count,
  COALESCE(da.total_boxes_received, 0)                                             AS total_boxes_received,
  COALESCE(da.deliveries_total, 0)::numeric(12,2)                                  AS deliveries_total,
  COALESCE(da.deliveries_paid, 0)::numeric(12,2)                                   AS deliveries_paid,
  COALESCE(da.deliveries_outstanding, 0)::numeric(12,2)                            AS deliveries_outstanding,
  (
    (COALESCE(ob.opening_balance, 0) - COALESCE(ob.opening_balance_paid, 0))
    + COALESCE(da.deliveries_outstanding, 0)
  )::numeric(12,2)                                                                 AS outstanding_balance,
  COALESCE(fa.fruit_ids, ARRAY[]::uuid[])                                          AS fruit_ids,
  COALESCE(fa.fruit_count, 0)::integer                                             AS fruit_count
FROM public.suppliers s
LEFT JOIN fruits_agg fa ON fa.supplier_id = s.id
LEFT JOIN ob_agg ob     ON ob.supplier_id = s.id
LEFT JOIN del_agg da    ON da.supplier_id = s.id;

-- ----------------------------------------------------------------------------
-- 10. Recreate public.dashboard_overview (Level 3)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.dashboard_overview
WITH (security_invoker = true) AS
WITH d AS (
  SELECT public.shop_today() AS today
),
sales_today AS (
  SELECT
    COUNT(*)::integer                           AS today_bills_count,
    COALESCE(SUM(b.subtotal), 0)::numeric(12,2) AS today_sales_total
  FROM public.bills b, d
  WHERE b.bill_date = d.today
    AND b.status = 'active'
),
receipts_today AS (
  SELECT
    COALESCE(SUM(cp.amount) FILTER (WHERE cp.mode = 'cash'), 0)::numeric(12,2) AS today_cash_received,
    COALESCE(SUM(cp.amount) FILTER (WHERE cp.mode = 'upi'),  0)::numeric(12,2) AS today_upi_received
  FROM public.customer_payments cp, d
  WHERE cp.payment_date = d.today
    AND cp.status = 'active'
),
refunds_today AS (
  SELECT
    COALESCE(SUM(cr.amount) FILTER (WHERE cr.mode = 'cash'), 0)::numeric(12,2) AS today_cash_refunded,
    COALESCE(SUM(cr.amount) FILTER (WHERE cr.mode = 'upi'),  0)::numeric(12,2) AS today_upi_refunded
  FROM public.customer_refunds cr, d
  WHERE cr.refund_date = d.today
),
cust_dues AS (
  SELECT COALESCE(SUM(outstanding_balance), 0)::numeric(12,2) AS total_customer_dues
  FROM public.customer_balances
),
supp_dues AS (
  SELECT COALESCE(SUM(outstanding_balance), 0)::numeric(12,2) AS total_supplier_dues
  FROM public.supplier_balances
)
SELECT
  d.today                                                                  AS summary_date,
  st.today_bills_count,
  st.today_sales_total,
  rt.today_cash_received,
  rt.today_upi_received,
  rf.today_cash_refunded,
  rf.today_upi_refunded,
  (rt.today_cash_received - rf.today_cash_refunded)::numeric(12,2)         AS today_net_cash_received,
  (rt.today_upi_received  - rf.today_upi_refunded)::numeric(12,2)          AS today_net_upi_received,
  cd.total_customer_dues,
  sd.total_supplier_dues
FROM d, sales_today st, receipts_today rt, refunds_today rf, cust_dues cd, supp_dues sd;

-- ----------------------------------------------------------------------------
-- 11. Re-grant Least-Privilege Permissions on Views
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.delivery_balances,
  public.supplier_balances,
  public.dashboard_overview
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.delivery_balances,
  public.supplier_balances,
  public.dashboard_overview
TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. Drop Old 9-Parameter receive_stock_delivery Overload
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_stock_delivery(uuid, uuid, date, jsonb, text, numeric, numeric, text, uuid);

-- ----------------------------------------------------------------------------
-- 13. Create Canonical receive_stock_delivery Function
--     Uses explicit column alias x(elem) in jsonb_array_elements pre-scan.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_stock_delivery(
  p_supplier_id     uuid,
  p_received_date   date,
  p_items           jsonb,         -- [{ fruit_id: uuid, variety_id: uuid, boxes: int, purchase_rate: numeric }]
  p_note            text DEFAULT NULL,
  p_paid_cash       numeric DEFAULT 0,
  p_paid_upi        numeric DEFAULT 0,
  p_payment_note    text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_fruit_id        uuid DEFAULT NULL -- Optional fallback parameter for legacy callers
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id        uuid;
  v_date               date := COALESCE(p_received_date, public.shop_today());
  v_year               integer;
  v_num                integer;
  v_prefix             text;
  v_delivery_no        text;
  v_delivery_id        uuid;
  v_total_boxes        integer := 0;
  v_total_amount       numeric(12,2) := 0;
  v_paid_cash          numeric(12,2) := ROUND(COALESCE(p_paid_cash, 0), 2);
  v_paid_upi           numeric(12,2) := ROUND(COALESCE(p_paid_upi, 0), 2);
  v_payment_id         uuid;
  v_line_amount        numeric(12,2);
  v_boxes_text         text;
  v_boxes              integer;
  v_rate               numeric(12,2);
  v_line_fruit_id      uuid;
  v_variety_id         uuid;
  v_first_fruit_id     uuid := NULL;
  v_distinct_fruits    integer := 0;
  v_header_fruit_id    uuid := NULL;
  r                    record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('receive_stock_delivery:' || p_idempotency_key::text, 0));
    SELECT id INTO v_existing_id
      FROM public.stock_deliveries
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one variety line to the delivery.';
  END IF;

  IF v_paid_cash < 0 OR v_paid_upi < 0 THEN
    RAISE EXCEPTION 'Paid cash and UPI amounts cannot be negative.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE id = p_supplier_id AND active = true
  ) THEN
    RAISE EXCEPTION 'Selected supplier is inactive or does not exist.';
  END IF;

  -- Genuine distinct fruit count with explicit column alias x(elem)
  BEGIN
    SELECT
      COUNT(DISTINCT resolved_fruit)::integer,
      (array_agg(DISTINCT resolved_fruit))[1]
    INTO
      v_distinct_fruits,
      v_first_fruit_id
    FROM (
      SELECT
        COALESCE(
          NULLIF(btrim(COALESCE(x.elem ->> 'fruit_id', '')), '')::uuid,
          p_fruit_id
        ) AS resolved_fruit
      FROM jsonb_array_elements(p_items) AS x(elem)
    ) sub
    WHERE resolved_fruit IS NOT NULL;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'One or more variety lines contain an invalid fruit ID.';
  END;

  IF v_distinct_fruits = 1 THEN
    v_header_fruit_id := v_first_fruit_id;
  ELSE
    v_header_fruit_id := NULL;
  END IF;

  v_year := EXTRACT(YEAR FROM v_date)::integer;
  SELECT COALESCE(delivery_prefix, 'DEL') INTO v_prefix
    FROM public.shop_profile WHERE id = true;
  v_prefix := COALESCE(v_prefix, 'DEL');

  INSERT INTO public.delivery_counters (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = public.delivery_counters.last_number + 1
  RETURNING last_number INTO v_num;

  v_delivery_no := v_prefix || '-' || v_year || '-' || lpad(v_num::text, 6, '0');

  INSERT INTO public.stock_deliveries (
    delivery_no, supplier_id, fruit_id, received_date, note, idempotency_key
  )
  VALUES (
    v_delivery_no, p_supplier_id, v_header_fruit_id, v_date, NULLIF(btrim(p_note), ''), p_idempotency_key
  )
  RETURNING id INTO v_delivery_id;

  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(r.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid item format on line %.', r.ord;
    END IF;

    BEGIN
      v_line_fruit_id := COALESCE(
        NULLIF(btrim(COALESCE(r.value ->> 'fruit_id', '')), '')::uuid,
        p_fruit_id
      );
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid fruit ID on line %.', r.ord;
    END;

    IF v_line_fruit_id IS NULL THEN
      RAISE EXCEPTION 'Fruit category is required for batch line %.', r.ord;
    END IF;

    BEGIN
      v_variety_id := (r.value ->> 'variety_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid variety selected on line %.', r.ord;
    END;

    IF v_variety_id IS NULL THEN
      RAISE EXCEPTION 'Variety is required on line %.', r.ord;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.fruits WHERE id = v_line_fruit_id AND active = true) THEN
      RAISE EXCEPTION 'Fruit category on line % is inactive or does not exist.', r.ord;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.fruit_varieties
       WHERE id = v_variety_id
         AND fruit_id = v_line_fruit_id
         AND active = true
    ) THEN
      RAISE EXCEPTION 'Variety on line % is inactive or does not belong to the selected fruit.', r.ord;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_fruits
       WHERE supplier_id = p_supplier_id
         AND fruit_id = v_line_fruit_id
    ) THEN
      RAISE EXCEPTION 'Selected supplier is not registered to supply this fruit category on line %.', r.ord;
    END IF;

    v_boxes_text := btrim(COALESCE(r.value ->> 'boxes', ''));
    IF v_boxes_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Boxes on line % must be a whole number greater than zero.', r.ord;
    END IF;
    BEGIN
      v_boxes := v_boxes_text::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Boxes on line % is too large.', r.ord;
    END;

    BEGIN
      v_rate := ROUND((r.value ->> 'purchase_rate')::numeric, 2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid purchase rate on line %.', r.ord;
    END;

    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'Purchase rate on line % is required and must be greater than zero.', r.ord;
    END IF;

    INSERT INTO public.stock_batches (
      delivery_id, line_no, fruit_id, variety_id,
      boxes_received, boxes_remaining, purchase_rate
    )
    VALUES (
      v_delivery_id, r.ord::integer, v_line_fruit_id, v_variety_id,
      v_boxes, v_boxes, v_rate
    )
    RETURNING purchase_amount INTO v_line_amount;

    v_total_boxes  := v_total_boxes + v_boxes;
    v_total_amount := v_total_amount + v_line_amount;
  END LOOP;

  UPDATE public.stock_deliveries
     SET total_boxes  = v_total_boxes,
         total_amount = v_total_amount
   WHERE id = v_delivery_id;

  IF (v_paid_cash + v_paid_upi) > v_total_amount THEN
    RAISE EXCEPTION 'Immediate payment (%) cannot exceed delivery purchase total (%).',
      (v_paid_cash + v_paid_upi), v_total_amount;
  END IF;

  IF v_paid_cash > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id, payment_origin, amount, mode, payment_date, note
    )
    VALUES (
      p_supplier_id, 'delivery_receipt', v_paid_cash, 'cash', v_date,
      COALESCE(NULLIF(btrim(p_payment_note), ''), 'Immediate payment for ' || v_delivery_no)
    )
    RETURNING id INTO v_payment_id;

    INSERT INTO public.supplier_payment_allocations (
      supplier_payment_id, delivery_id, amount
    )
    VALUES (
      v_payment_id, v_delivery_id, v_paid_cash
    );
  END IF;

  IF v_paid_upi > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id, payment_origin, amount, mode, payment_date, note
    )
    VALUES (
      p_supplier_id, 'delivery_receipt', v_paid_upi, 'upi', v_date,
      COALESCE(NULLIF(btrim(p_payment_note), ''), 'Immediate payment for ' || v_delivery_no)
    )
    RETURNING id INTO v_payment_id;

    INSERT INTO public.supplier_payment_allocations (
      supplier_payment_id, delivery_id, amount
    )
    VALUES (
      v_payment_id, v_delivery_id, v_paid_upi
    );
  END IF;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_delivery(uuid, date, jsonb, text, numeric, numeric, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_stock_delivery(uuid, date, jsonb, text, numeric, numeric, text, uuid, uuid) TO authenticated;

COMMIT;
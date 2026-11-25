-- ============================================================================
-- Migration 012: Bill Returns, Partial Stock Restoration & Customer Refunds (CORRECTED)
-- Target Project: KBN Fruits and Traders
-- ============================================================================

-- 1. Bill Return Counters for Clean Sequence Numbers (RET-YYYY-XXXXXX)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.return_counters (
  year integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.return_counters ENABLE ROW LEVEL SECURITY;
-- No client policies on return_counters (RPC-internal only)

-- 2. Drop UNIQUE (bill_id) on customer_refunds to Support Multiple Returns
-- ----------------------------------------------------------------------------
ALTER TABLE public.customer_refunds
  DROP CONSTRAINT IF EXISTS customer_refunds_bill_id_key;

-- 3. Bill Returns Header Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bill_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id),
  return_no text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id),
  customer_name_snapshot text NOT NULL,
  return_date date NOT NULL DEFAULT public.shop_today(),
  total_boxes integer NOT NULL CHECK (total_boxes > 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
  refund_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  refund_mode text CHECK (refund_mode IS NULL OR refund_mode IN ('cash', 'upi')),
  refund_id uuid REFERENCES public.customer_refunds(id),
  reason text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_returns_bill_id ON public.bill_returns(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_returns_customer_id ON public.bill_returns(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_returns_date ON public.bill_returns(return_date);

ALTER TABLE public.bill_returns ENABLE ROW LEVEL SECURITY;

-- Correction 5: SELECT only for authenticated users (no direct client INSERT)
DROP POLICY IF EXISTS "Allow authenticated read bill_returns" ON public.bill_returns;
DROP POLICY IF EXISTS "Allow authenticated insert bill_returns" ON public.bill_returns;
DROP POLICY IF EXISTS bill_returns_select ON public.bill_returns;

CREATE POLICY bill_returns_select ON public.bill_returns
  FOR SELECT TO authenticated
  USING (public.is_authorized_user());

-- 4. Bill Return Items (Line-by-Line Item & Batch Restoration Audit)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bill_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.bill_returns(id) ON DELETE CASCADE,
  bill_item_id uuid NOT NULL REFERENCES public.bill_items(id),
  batch_id uuid NOT NULL REFERENCES public.stock_batches(id),
  fruit_id uuid NOT NULL REFERENCES public.fruits(id),
  variety_id uuid NOT NULL REFERENCES public.fruit_varieties(id),
  fruit_name_snapshot text NOT NULL,
  variety_name_snapshot text NOT NULL,
  boxes integer NOT NULL CHECK (boxes > 0),
  sell_rate numeric(12,2) NOT NULL CHECK (sell_rate > 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_return_items_return_id ON public.bill_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_bill_return_items_item_id ON public.bill_return_items(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_bill_return_items_batch_id ON public.bill_return_items(batch_id);

ALTER TABLE public.bill_return_items ENABLE ROW LEVEL SECURITY;

-- Correction 5: SELECT only for authenticated users (no direct client INSERT)
DROP POLICY IF EXISTS "Allow authenticated read bill_return_items" ON public.bill_return_items;
DROP POLICY IF EXISTS "Allow authenticated insert bill_return_items" ON public.bill_return_items;
DROP POLICY IF EXISTS bill_return_items_select ON public.bill_return_items;

CREATE POLICY bill_return_items_select ON public.bill_return_items
  FOR SELECT TO authenticated
  USING (public.is_authorized_user());

-- 5. Updated Reporting Views: bill_balances & customer_balances (Correction 2)
-- ----------------------------------------------------------------------------
-- Accounting for bill returns: net subtotal, amount paid & accurate outstanding balance
CREATE OR REPLACE VIEW public.bill_balances
WITH (security_invoker = true) AS
WITH bill_paid AS (
  SELECT
    cpa.bill_id,
    COALESCE(SUM(cpa.amount), 0)::numeric(12,2) AS amount_paid
  FROM public.customer_payment_allocations cpa
  JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
  WHERE cpa.bill_id IS NOT NULL
    AND cpa.status = 'active'
    AND cp.status = 'active'
  GROUP BY cpa.bill_id
),
bill_returned AS (
  SELECT
    br.bill_id,
    COALESCE(SUM(br.total_amount), 0)::numeric(12,2) AS total_returned,
    COALESCE(SUM(br.total_boxes), 0)::integer        AS total_returned_boxes
  FROM public.bill_returns br
  GROUP BY br.bill_id
)
SELECT
  b.id                                                               AS bill_id,
  b.bill_no,
  b.customer_id,
  (b.customer_id IS NULL)                                            AS is_cash_customer,
  b.customer_name_snapshot,
  b.bill_date,
  b.subtotal,
  COALESCE(br.total_returned, 0)::numeric(12,2)                      AS total_returned,
  (b.subtotal - COALESCE(br.total_returned, 0))::numeric(12,2)       AS net_subtotal,
  COALESCE(bp.amount_paid, 0)::numeric(12,2)                         AS amount_paid,
  CASE
    WHEN b.status = 'active'
      THEN GREATEST(0, (b.subtotal - COALESCE(br.total_returned, 0)) - COALESCE(bp.amount_paid, 0))::numeric(12,2)
    ELSE 0::numeric(12,2)
  END                                                                AS outstanding_amount,
  CASE
    WHEN b.status = 'cancelled'                                                     THEN 'cancelled'
    WHEN COALESCE(bp.amount_paid, 0) >= (b.subtotal - COALESCE(br.total_returned, 0)) THEN 'paid'
    WHEN COALESCE(bp.amount_paid, 0) = 0                                            THEN 'unpaid'
    ELSE 'partial'
  END                                                                AS payment_status,
  b.status,
  b.cancelled_at,
  b.cancel_reason,
  b.note,
  b.created_at
FROM public.bills b
LEFT JOIN bill_paid bp ON bp.bill_id = b.id
LEFT JOIN bill_returned br ON br.bill_id = b.id;

CREATE OR REPLACE VIEW public.customer_balances
WITH (security_invoker = true) AS
WITH ob_paid AS (
  SELECT
    cpa.opening_balance_id,
    COALESCE(SUM(cpa.amount), 0)::numeric(12,2) AS amount_paid
  FROM public.customer_payment_allocations cpa
  JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
  WHERE cpa.opening_balance_id IS NOT NULL
    AND cpa.status = 'active'
    AND cp.status = 'active'
  GROUP BY cpa.opening_balance_id
),
ob_agg AS (
  SELECT
    cob.customer_id,
    cob.id                                                 AS opening_balance_id,
    cob.amount                                             AS opening_balance,
    COALESCE(op.amount_paid, 0)::numeric(12,2)             AS opening_balance_paid
  FROM public.customer_opening_balances cob
  LEFT JOIN ob_paid op ON op.opening_balance_id = cob.id
  WHERE cob.status = 'active'
),
bill_agg AS (
  SELECT
    bb.customer_id,
    COUNT(*)::integer                                      AS active_bills_count,
    COALESCE(SUM(bb.net_subtotal), 0)::numeric(12,2)       AS bills_total,
    COALESCE(SUM(bb.amount_paid), 0)::numeric(12,2)        AS bills_paid,
    COALESCE(SUM(bb.outstanding_amount), 0)::numeric(12,2) AS bills_outstanding
  FROM public.bill_balances bb
  WHERE bb.customer_id IS NOT NULL
    AND bb.status = 'active'
  GROUP BY bb.customer_id
)
SELECT
  c.id                                                                            AS customer_id,
  c.name,
  c.phone,
  c.active,
  ob.opening_balance_id,
  COALESCE(ob.opening_balance, 0)::numeric(12,2)                                  AS opening_balance,
  COALESCE(ob.opening_balance_paid, 0)::numeric(12,2)                             AS opening_balance_paid,
  (COALESCE(ob.opening_balance, 0) - COALESCE(ob.opening_balance_paid, 0))::numeric(12,2) AS opening_balance_outstanding,
  COALESCE(ba.active_bills_count, 0)                                              AS active_bills_count,
  COALESCE(ba.bills_total, 0)::numeric(12,2)                                      AS bills_total,
  COALESCE(ba.bills_paid, 0)::numeric(12,2)                                       AS bills_paid,
  COALESCE(ba.bills_outstanding, 0)::numeric(12,2)                                AS bills_outstanding,
  (
    (COALESCE(ob.opening_balance, 0) - COALESCE(ob.opening_balance_paid, 0))
    + COALESCE(ba.bills_outstanding, 0)
  )::numeric(12,2)                                                                AS outstanding_balance
FROM public.customers c
LEFT JOIN ob_agg ob   ON ob.customer_id = c.id
LEFT JOIN bill_agg ba ON ba.customer_id = c.id;

-- 6. Guard cancel_bill Against Bills With Returns (Correction 6 & Correction 3 Lock Order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_bill(
  p_bill_id     uuid,
  p_reason      text DEFAULT NULL,
  p_refund_mode text DEFAULT NULL,
  p_refund_date date DEFAULT NULL,
  p_refund_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bill        record;
  v_active_paid numeric(12,2);
  v_refund_id   uuid;
  v_reason      text := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT id, bill_no, customer_id, customer_name_snapshot, status
    INTO v_bill
    FROM public.bills
   WHERE id = p_bill_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'This bill is already cancelled.';
  END IF;

  -- Protection: bills with recorded returns cannot be cancelled via cancel_bill
  IF EXISTS (SELECT 1 FROM public.bill_returns WHERE bill_id = p_bill_id) THEN
    RAISE EXCEPTION 'Cannot cancel bill % because returns have already been recorded on it. Use Return / Refund to process any further item returns.', v_bill.bill_no;
  END IF;

  -- Harmonized Lock Order: 1. Bill (above), 2. Customer Payments, 3. Stock Batches
  PERFORM 1
    FROM public.customer_payments cp
   WHERE cp.id IN (
     SELECT DISTINCT cpa.customer_payment_id
       FROM public.customer_payment_allocations cpa
      WHERE cpa.bill_id = p_bill_id
        AND cpa.status = 'active'
   )
   ORDER BY cp.id
     FOR UPDATE;

  PERFORM 1
    FROM public.stock_batches sb
   WHERE sb.id IN (
     SELECT DISTINCT biba.batch_id
       FROM public.bill_item_batch_allocations biba
       JOIN public.bill_items bi ON bi.id = biba.bill_item_id
      WHERE bi.bill_id = p_bill_id
   )
   ORDER BY sb.id
     FOR UPDATE;

  -- Check active customer receipts allocated to this bill
  SELECT COALESCE(SUM(cpa.amount), 0)::numeric(12,2)
    INTO v_active_paid
    FROM public.customer_payment_allocations cpa
    JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
   WHERE cpa.bill_id = p_bill_id
     AND cpa.status = 'active'
     AND cp.status = 'active';

  IF v_active_paid > 0 THEN
    IF p_refund_mode IS NULL OR p_refund_mode NOT IN ('cash', 'upi') THEN
      RAISE EXCEPTION 'This bill has % received. Provide refund mode (cash/upi) to record the refund, or cancel a mistaken payment first if no money was actually received.', v_active_paid;
    END IF;

    INSERT INTO public.customer_refunds (
      bill_id, customer_id, customer_name_snapshot, amount, mode, refund_date, note
    )
    VALUES (
      p_bill_id, v_bill.customer_id, v_bill.customer_name_snapshot,
      v_active_paid, p_refund_mode,
      COALESCE(p_refund_date, public.shop_today()),
      COALESCE(NULLIF(btrim(p_refund_note), ''), v_reason)
    )
    RETURNING id INTO v_refund_id;

    -- Mark ONLY this bill's active allocations refunded; original customer_payments stay intact
    UPDATE public.customer_payment_allocations cpa
       SET status          = 'refunded',
           refund_id       = v_refund_id,
           reversed_at     = now(),
           reversal_reason = COALESCE(v_reason, 'Bill cancelled with customer refund')
      FROM public.customer_payments cp
     WHERE cpa.customer_payment_id = cp.id
       AND cpa.bill_id = p_bill_id
       AND cpa.status = 'active'
       AND cp.status = 'active';
  END IF;

  -- Restore exact boxes to batches
  UPDATE public.stock_batches sb
     SET boxes_remaining = sb.boxes_remaining + x.total_boxes
    FROM (
      SELECT biba.batch_id, SUM(biba.boxes)::integer AS total_boxes
        FROM public.bill_item_batch_allocations biba
        JOIN public.bill_items bi ON bi.id = biba.bill_item_id
       WHERE bi.bill_id = p_bill_id
       GROUP BY biba.batch_id
    ) x
   WHERE sb.id = x.batch_id;

  UPDATE public.bills
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   WHERE id = p_bill_id;
END;
$$;

-- 7. Update add_customer_payment to Respect Returns
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_customer_payment(
  p_customer_id     uuid,
  p_amount          numeric,
  p_mode            text,
  p_payment_date    date,
  p_allocations     jsonb,  -- [{ bill_id?: uuid, opening_balance_id?: uuid, amount: numeric }]
  p_note            text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id    uuid;
  v_date           date := COALESCE(p_payment_date, public.shop_today());
  v_amount         numeric(12,2) := ROUND(COALESCE(p_amount, 0), 2);
  v_cust_name      text;
  v_payment_id     uuid;
  v_alloc_sum      numeric(12,2) := 0;
  v_bill_ids       uuid[] := ARRAY[]::uuid[];
  v_ob_ids         uuid[] := ARRAY[]::uuid[];
  v_bill_id        uuid;
  v_ob_id          uuid;
  v_alloc_amt      numeric(12,2);
  v_target_tot     numeric(12,2);
  v_target_returns numeric(12,2);
  v_net_target_tot numeric(12,2);
  v_target_paid    numeric(12,2);
  v_target_stat    text;
  v_target_cust    uuid;
  r                record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('add_customer_payment:' || p_idempotency_key::text, 0));
    SELECT id INTO v_existing_id
      FROM public.customer_payments
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Select a registered customer for payment collection.';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('cash', 'upi') THEN
    RAISE EXCEPTION 'Choose Cash or UPI.';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Allocate this payment to at least one bill or opening balance.';
  END IF;

  SELECT name INTO v_cust_name
    FROM public.customers
   WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_allocations) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(r.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid allocation format on line %.', r.ord;
    END IF;

    BEGIN
      v_bill_id := NULLIF(btrim(COALESCE(r.value ->> 'bill_id', '')), '')::uuid;
      v_ob_id   := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid bill or opening balance ID on allocation line %.', r.ord;
    END;

    BEGIN
      v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid allocation amount on line %.', r.ord;
    END;

    IF ((v_bill_id IS NOT NULL)::integer + (v_ob_id IS NOT NULL)::integer) <> 1 THEN
      RAISE EXCEPTION 'Allocation line % must specify either bill_id or opening_balance_id (not both).', r.ord;
    END IF;
    IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
      RAISE EXCEPTION 'Allocation amount on line % must be greater than zero.', r.ord;
    END IF;

    IF v_bill_id IS NOT NULL THEN
      IF v_bill_id = ANY(v_bill_ids) THEN
        RAISE EXCEPTION 'Duplicate bill in payment allocations.';
      END IF;
      v_bill_ids := array_append(v_bill_ids, v_bill_id);
    ELSE
      IF v_ob_id = ANY(v_ob_ids) THEN
        RAISE EXCEPTION 'Duplicate opening balance in payment allocations.';
      END IF;
      v_ob_ids := array_append(v_ob_ids, v_ob_id);
    END IF;

    v_alloc_sum := v_alloc_sum + v_alloc_amt;
  END LOOP;

  IF v_alloc_sum <> v_amount THEN
    RAISE EXCEPTION 'Allocated total (%) must exactly match payment amount (%).', v_alloc_sum, v_amount;
  END IF;

  -- Lock targets in global deterministic order
  IF cardinality(v_ob_ids) > 0 THEN
    PERFORM 1 FROM public.customer_opening_balances WHERE id = ANY(v_ob_ids) ORDER BY id FOR UPDATE;
  END IF;
  IF cardinality(v_bill_ids) > 0 THEN
    PERFORM 1 FROM public.bills WHERE id = ANY(v_bill_ids) ORDER BY id FOR UPDATE;
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, customer_name_snapshot, payment_origin,
    amount, mode, payment_date, note, idempotency_key
  )
  VALUES (
    p_customer_id, v_cust_name, 'collection',
    v_amount, p_mode, v_date, NULLIF(btrim(p_note), ''), p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  FOR r IN
    SELECT e.value FROM jsonb_array_elements(p_allocations) AS e(value)
  LOOP
    v_bill_id   := NULLIF(btrim(COALESCE(r.value ->> 'bill_id', '')), '')::uuid;
    v_ob_id     := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);

    IF v_bill_id IS NOT NULL THEN
      SELECT customer_id, subtotal, status
        INTO v_target_cust, v_target_tot, v_target_stat
        FROM public.bills WHERE id = v_bill_id;
      IF NOT FOUND OR v_target_cust IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Target bill does not belong to this customer.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot allocate payment to a cancelled bill.';
      END IF;

      -- Subtract existing returns from bill total
      SELECT COALESCE(SUM(br.total_amount), 0)::numeric(12,2)
        INTO v_target_returns
        FROM public.bill_returns br
       WHERE br.bill_id = v_bill_id;

      v_net_target_tot := GREATEST(0, v_target_tot - v_target_returns);

      SELECT COALESCE(SUM(cpa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.customer_payment_allocations cpa
        JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
       WHERE cpa.bill_id = v_bill_id
         AND cpa.status = 'active'
         AND cp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_net_target_tot THEN
        RAISE EXCEPTION 'Allocation (%) exceeds remaining bill balance (%).',
          v_alloc_amt, (v_net_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.customer_payment_allocations (
        customer_payment_id, bill_id, amount
      )
      VALUES (v_payment_id, v_bill_id, v_alloc_amt);

    ELSE
      SELECT customer_id, amount, status
        INTO v_target_cust, v_target_tot, v_target_stat
        FROM public.customer_opening_balances WHERE id = v_ob_id;
      IF NOT FOUND OR v_target_cust IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Target opening balance does not belong to this customer.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot allocate payment to a cancelled opening balance.';
      END IF;

      SELECT COALESCE(SUM(cpa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.customer_payment_allocations cpa
        JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
       WHERE cpa.opening_balance_id = v_ob_id
         AND cpa.status = 'active'
         AND cp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Allocation (%) exceeds remaining opening balance (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.customer_payment_allocations (
        customer_payment_id, opening_balance_id, amount
      )
      VALUES (v_payment_id, v_ob_id, v_alloc_amt);
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$;

-- 8. Atomic Concurrency-Safe RPC Function: process_bill_return
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_bill_return(
  p_bill_id         uuid,
  p_items           jsonb,
  p_refund_mode     text DEFAULT NULL,
  p_refund_date     date DEFAULT NULL,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bill                         record;
  v_existing_return              record;
  v_existing_bill_status         text;
  v_return_id                    uuid;
  v_return_no                    text;
  v_year                         integer;
  v_num                          integer;
  v_date                         date := COALESCE(p_refund_date, public.shop_today());
  v_reason                       text := NULLIF(btrim(p_reason), '');
  v_total_returned_boxes         integer := 0;
  v_total_return_amount          numeric(12,2) := 0;
  v_item_elem                    jsonb;
  v_bill_item_id                 uuid;
  v_req_boxes                    integer;
  v_item                         record;
  v_already_returned             integer;
  v_returnable_boxes             integer;
  v_line_return_amount           numeric(12,2);
  v_remaining_to_restore         integer;
  v_alloc                        record;
  v_restore_for_alloc            integer;
  v_alloc_already_returned       integer;
  v_alloc_avail_to_return        integer;
  v_active_paid                  numeric(12,2) := 0;
  v_prev_returns_amount          numeric(12,2) := 0;
  v_new_net_subtotal             numeric(12,2) := 0;
  v_eligible_refund              numeric(12,2) := 0;
  v_actual_refund                numeric(12,2) := 0;
  v_refund_id                    uuid := NULL;
  v_total_original_boxes         integer := 0;
  v_all_returned_boxes           integer := 0;
  v_cpa                          record;
  v_remaining_refund_to_allocate numeric(12,2);
  v_alloc_refund_amount          numeric(12,2);
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Correction 4: Full-fidelity Idempotency Replay
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('process_bill_return:' || p_idempotency_key, 0));
    SELECT id, return_no, total_boxes, total_amount, refund_amount, refund_mode, bill_id
      INTO v_existing_return
      FROM public.bill_returns
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT status INTO v_existing_bill_status
        FROM public.bills
       WHERE id = v_existing_return.bill_id;

      RETURN jsonb_build_object(
        'success', true,
        'return_id', v_existing_return.id,
        'return_no', v_existing_return.return_no,
        'returned_boxes', v_existing_return.total_boxes,
        'return_amount', v_existing_return.total_amount,
        'refund_amount', v_existing_return.refund_amount,
        'refund_mode', v_existing_return.refund_mode,
        'is_full_return', (v_existing_bill_status = 'cancelled'),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Correction 3: Harmonized Global Lock Order (Bills -> Customer Payments -> Stock Batches)
  -- 1. Lock bill
  SELECT id, bill_no, customer_id, customer_name_snapshot, subtotal, status
    INTO v_bill
    FROM public.bills
   WHERE id = p_bill_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot process returns on an already cancelled bill.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item and quantity to return.';
  END IF;

  -- 2. Lock active customer payments allocated to this bill in deterministic order
  PERFORM 1
    FROM public.customer_payments cp
   WHERE cp.id IN (
     SELECT DISTINCT cpa.customer_payment_id
       FROM public.customer_payment_allocations cpa
      WHERE cpa.bill_id = p_bill_id
        AND cpa.status = 'active'
   )
   ORDER BY cp.id
     FOR UPDATE;

  -- 3. Lock referenced stock batches in deterministic order
  PERFORM 1
    FROM public.stock_batches sb
   WHERE sb.id IN (
     SELECT DISTINCT biba.batch_id
       FROM public.bill_item_batch_allocations biba
       JOIN public.bill_items bi ON bi.id = biba.bill_item_id
      WHERE bi.bill_id = p_bill_id
   )
   ORDER BY sb.id
     FOR UPDATE;

  -- Generate return sequence number: RET-YYYY-XXXXXX
  v_year := EXTRACT(YEAR FROM v_date)::integer;
  INSERT INTO public.return_counters (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = public.return_counters.last_number + 1
  RETURNING last_number INTO v_num;

  v_return_no := 'RET-' || v_year || '-' || lpad(v_num::text, 6, '0');

  -- Pre-scan items and compute total returned amounts
  FOR v_item_elem IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_bill_item_id := (v_item_elem ->> 'bill_item_id')::uuid;
    v_req_boxes := (v_item_elem ->> 'boxes')::integer;

    IF v_req_boxes <= 0 THEN
      CONTINUE;
    END IF;

    SELECT bi.id, bi.fruit_id, bi.variety_id, bi.fruit_name_snapshot,
           bi.variety_name_snapshot, bi.boxes, bi.sell_rate
      INTO v_item
      FROM public.bill_items bi
     WHERE bi.id = v_bill_item_id
       AND bi.bill_id = p_bill_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % does not belong to bill %.', v_bill_item_id, v_bill.bill_no;
    END IF;

    SELECT COALESCE(SUM(bri.boxes), 0)::integer
      INTO v_already_returned
      FROM public.bill_return_items bri
     WHERE bri.bill_item_id = v_bill_item_id;

    v_returnable_boxes := v_item.boxes - v_already_returned;
    IF v_req_boxes > v_returnable_boxes THEN
      RAISE EXCEPTION 'Cannot return % boxes of % (%). Only % box(es) remain returnable.',
        v_req_boxes, v_item.fruit_name_snapshot, v_item.variety_name_snapshot, v_returnable_boxes;
    END IF;

    v_line_return_amount := ROUND(v_req_boxes * v_item.sell_rate, 2);
    v_total_returned_boxes := v_total_returned_boxes + v_req_boxes;
    v_total_return_amount := v_total_return_amount + v_line_return_amount;
  END LOOP;

  IF v_total_returned_boxes <= 0 THEN
    RAISE EXCEPTION 'No boxes selected for return.';
  END IF;

  -- Correction 1: Accurate Refund Calculation (No Double Deduction)
  -- Active unrefunded payment currently allocated to this bill
  SELECT COALESCE(SUM(cpa.amount), 0)::numeric(12,2)
    INTO v_active_paid
    FROM public.customer_payment_allocations cpa
    JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
   WHERE cpa.bill_id = p_bill_id
     AND cpa.status = 'active'
     AND cp.status = 'active';

  -- Previous returns total amount on this bill
  SELECT COALESCE(SUM(br.total_amount), 0)::numeric(12,2)
    INTO v_prev_returns_amount
    FROM public.bill_returns br
   WHERE br.bill_id = p_bill_id;

  -- New net bill value after applying this return
  v_new_net_subtotal := GREATEST(0, v_bill.subtotal - (v_prev_returns_amount + v_total_return_amount));

  -- Surplus cash held above new net bill value is the refund eligible to customer
  v_eligible_refund := GREATEST(0, v_active_paid - v_new_net_subtotal);

  IF v_eligible_refund > 0 THEN
    IF p_refund_mode IS NULL OR p_refund_mode NOT IN ('cash', 'upi') THEN
      RAISE EXCEPTION 'This return creates an eligible refund of ₹%. Please choose refund method: Cash or UPI.', v_eligible_refund;
    END IF;

    v_actual_refund := v_eligible_refund;

    -- Record customer refund transaction
    INSERT INTO public.customer_refunds (
      bill_id, customer_id, customer_name_snapshot, amount, mode, refund_date, note
    )
    VALUES (
      p_bill_id, v_bill.customer_id, v_bill.customer_name_snapshot,
      v_actual_refund, p_refund_mode, v_date,
      COALESCE(v_reason, 'Refund for bill return ' || v_return_no)
    )
    RETURNING id INTO v_refund_id;

    -- Adjust active payment allocations for this bill
    v_remaining_refund_to_allocate := v_actual_refund;
    FOR v_cpa IN
      SELECT cpa.id, cpa.amount
        FROM public.customer_payment_allocations cpa
        JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
       WHERE cpa.bill_id = p_bill_id
         AND cpa.status = 'active'
         AND cp.status = 'active'
       ORDER BY cpa.created_at DESC
         FOR UPDATE
    LOOP
      IF v_remaining_refund_to_allocate <= 0 THEN
        EXIT;
      END IF;

      IF v_cpa.amount <= v_remaining_refund_to_allocate THEN
        v_alloc_refund_amount := v_cpa.amount;
        UPDATE public.customer_payment_allocations
           SET status          = 'refunded',
               refund_id       = v_refund_id,
               reversed_at     = now(),
               reversal_reason = COALESCE(v_reason, 'Refunded on return ' || v_return_no)
         WHERE id = v_cpa.id;
        v_remaining_refund_to_allocate := v_remaining_refund_to_allocate - v_alloc_refund_amount;
      ELSE
        -- Partial allocation split
        v_alloc_refund_amount := v_remaining_refund_to_allocate;
        UPDATE public.customer_payment_allocations
           SET amount = amount - v_alloc_refund_amount
         WHERE id = v_cpa.id;

        INSERT INTO public.customer_payment_allocations (
          customer_payment_id, bill_id, amount, status, refund_id, reversed_at, reversal_reason
        )
        SELECT customer_payment_id, bill_id, v_alloc_refund_amount, 'refunded', v_refund_id, now(), COALESCE(v_reason, 'Refunded on return ' || v_return_no)
          FROM public.customer_payment_allocations
         WHERE id = v_cpa.id;

        v_remaining_refund_to_allocate := 0;
      END IF;
    END LOOP;
  ELSE
    v_actual_refund := 0;
  END IF;

  -- Create bill_returns record
  INSERT INTO public.bill_returns (
    bill_id, return_no, customer_id, customer_name_snapshot,
    return_date, total_boxes, total_amount, refund_amount,
    refund_mode, refund_id, reason, idempotency_key
  )
  VALUES (
    p_bill_id, v_return_no, v_bill.customer_id, v_bill.customer_name_snapshot,
    v_date, v_total_returned_boxes, v_total_return_amount, v_actual_refund,
    CASE WHEN v_actual_refund > 0 THEN p_refund_mode ELSE NULL END,
    v_refund_id, v_reason, p_idempotency_key
  )
  RETURNING id INTO v_return_id;

  -- Process line items & restore stock to original batch allocations
  FOR v_item_elem IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_bill_item_id := (v_item_elem ->> 'bill_item_id')::uuid;
    v_req_boxes := (v_item_elem ->> 'boxes')::integer;

    IF v_req_boxes <= 0 THEN
      CONTINUE;
    END IF;

    SELECT bi.id, bi.fruit_id, bi.variety_id, bi.fruit_name_snapshot,
           bi.variety_name_snapshot, bi.boxes, bi.sell_rate
      INTO v_item
      FROM public.bill_items bi
     WHERE bi.id = v_bill_item_id;

    v_remaining_to_restore := v_req_boxes;

    FOR v_alloc IN
      SELECT biba.batch_id, biba.boxes AS original_alloc_boxes
        FROM public.bill_item_batch_allocations biba
       WHERE biba.bill_item_id = v_bill_item_id
       ORDER BY biba.boxes DESC
    LOOP
      IF v_remaining_to_restore <= 0 THEN
        EXIT;
      END IF;

      SELECT COALESCE(SUM(bri.boxes), 0)::integer
        INTO v_alloc_already_returned
        FROM public.bill_return_items bri
       WHERE bri.bill_item_id = v_bill_item_id
         AND bri.batch_id = v_alloc.batch_id;

      v_alloc_avail_to_return := v_alloc.original_alloc_boxes - v_alloc_already_returned;
      IF v_alloc_avail_to_return <= 0 THEN
        CONTINUE;
      END IF;

      v_restore_for_alloc := LEAST(v_remaining_to_restore, v_alloc_avail_to_return);

      UPDATE public.stock_batches
         SET boxes_remaining = boxes_remaining + v_restore_for_alloc
       WHERE id = v_alloc.batch_id;

      INSERT INTO public.bill_return_items (
        return_id, bill_item_id, batch_id, fruit_id, variety_id,
        fruit_name_snapshot, variety_name_snapshot, boxes, sell_rate, line_total
      )
      VALUES (
        v_return_id, v_bill_item_id, v_alloc.batch_id, v_item.fruit_id, v_item.variety_id,
        v_item.fruit_name_snapshot, v_item.variety_name_snapshot,
        v_restore_for_alloc, v_item.sell_rate,
        ROUND(v_restore_for_alloc * v_item.sell_rate, 2)
      );

      v_remaining_to_restore := v_remaining_to_restore - v_restore_for_alloc;
    END LOOP;

    IF v_remaining_to_restore > 0 THEN
      RAISE EXCEPTION 'Could not allocate restored boxes to original batches for item %.', v_item.fruit_name_snapshot;
    END IF;
  END LOOP;

  -- Check if ALL items and boxes on the bill have now been returned
  SELECT COALESCE(SUM(boxes), 0)::integer INTO v_total_original_boxes
    FROM public.bill_items
   WHERE bill_id = p_bill_id;

  SELECT COALESCE(SUM(bri.boxes), 0)::integer INTO v_all_returned_boxes
    FROM public.bill_return_items bri
    JOIN public.bill_returns br ON br.id = bri.return_id
   WHERE br.bill_id = p_bill_id;

  IF v_all_returned_boxes >= v_total_original_boxes THEN
    UPDATE public.bills
       SET status        = 'cancelled',
           cancelled_at  = now(),
           cancel_reason = COALESCE(v_reason, 'All items returned (' || v_return_no || ')')
     WHERE id = p_bill_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_no', v_return_no,
    'returned_boxes', v_total_returned_boxes,
    'return_amount', v_total_return_amount,
    'refund_amount', v_actual_refund,
    'refund_mode', CASE WHEN v_actual_refund > 0 THEN p_refund_mode ELSE NULL END,
    'is_full_return', (v_all_returned_boxes >= v_total_original_boxes)
  );
END;
$$;

-- 9. Explicit Least-Privilege Grants (Correction 5)
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.return_counters,
  public.bill_returns,
  public.bill_return_items
FROM PUBLIC, anon, authenticated;

-- Authenticated users: Read-only access to returns audit history
GRANT SELECT ON TABLE
  public.bill_returns,
  public.bill_return_items,
  public.bill_balances,
  public.customer_balances
TO authenticated;

-- Authenticated users: Execute access to validated RPCs
GRANT EXECUTE ON FUNCTION public.process_bill_return(uuid, jsonb, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_customer_payment(uuid, numeric, text, date, jsonb, text, uuid) TO authenticated;

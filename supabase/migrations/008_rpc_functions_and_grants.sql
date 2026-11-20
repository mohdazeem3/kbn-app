-- ============================================================================
-- Migration 008: Transactional RPC Functions & Least-Privilege Grants
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================
-- All state-changing financial/inventory operations execute inside SECURITY
-- DEFINER functions with SET search_path TO 'public', explicit authorization
-- checks, deterministic FOR UPDATE / FOR SHARE lock ordering, and optional
-- idempotency_key protection against double-clicks and network retries.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. RECEIVE STOCK DELIVERY (with optional atomic Cash/UPI/split supplier payment)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.receive_stock_delivery(
  p_supplier_id     uuid,
  p_fruit_id        uuid,
  p_received_date   date,
  p_items           jsonb,
  p_note            text DEFAULT NULL,
  p_paid_cash       numeric DEFAULT 0,
  p_paid_upi        numeric DEFAULT 0,
  p_payment_note    text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id   uuid;
  v_date          date := COALESCE(p_received_date, public.shop_today());
  v_year          integer;
  v_num           integer;
  v_prefix        text;
  v_delivery_no   text;
  v_delivery_id   uuid;
  v_total_boxes   integer := 0;
  v_total_amount  numeric(12,2) := 0;
  v_paid_cash     numeric(12,2) := ROUND(COALESCE(p_paid_cash, 0), 2);
  v_paid_upi      numeric(12,2) := ROUND(COALESCE(p_paid_upi, 0), 2);
  v_payment_id    uuid;
  v_line_amount   numeric(12,2);
  v_boxes_text    text;
  v_boxes         integer;
  v_rate          numeric(12,2);
  v_variety_id    uuid;
  r               record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Idempotency check (advisory lock serializes concurrent retries; unique index is second guard)
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

  -- Validate fruit is active
  IF NOT EXISTS (SELECT 1 FROM public.fruits WHERE id = p_fruit_id AND active = true) THEN
    RAISE EXCEPTION 'Selected fruit category is not active or does not exist.';
  END IF;

  -- Validate supplier is active and supplies this fruit category
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE id = p_supplier_id
       AND fruit_id = p_fruit_id
       AND active = true
  ) THEN
    RAISE EXCEPTION 'Selected supplier is inactive or does not supply this fruit category.';
  END IF;

  -- Generate concurrency-safe delivery number
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
    v_delivery_no, p_supplier_id, p_fruit_id, v_date, NULLIF(btrim(p_note), ''), p_idempotency_key
  )
  RETURNING id INTO v_delivery_id;

  -- Insert variety batch lines
  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(r.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid item format on line %.', r.ord;
    END IF;

    BEGIN
      v_variety_id := (r.value ->> 'variety_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid variety selected on line %.', r.ord;
    END;

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

    IF NOT EXISTS (
      SELECT 1 FROM public.fruit_varieties
       WHERE id = v_variety_id
         AND fruit_id = p_fruit_id
         AND active = true
    ) THEN
      RAISE EXCEPTION 'Variety on line % is inactive or does not belong to the selected fruit.', r.ord;
    END IF;

    INSERT INTO public.stock_batches (
      delivery_id, line_no, fruit_id, variety_id,
      boxes_received, boxes_remaining, purchase_rate
    )
    VALUES (
      v_delivery_id, r.ord::integer, p_fruit_id, v_variety_id,
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

  -- Optional immediate supplier payment (Cash, UPI, or split of both) in same transaction
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

-- ============================================================================
-- 2. CANCEL STOCK DELIVERY (blocks if stock sold; supports refund if paid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_stock_delivery(
  p_delivery_id uuid,
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
  v_delivery    record;
  v_sold_boxes  integer;
  v_active_paid numeric(12,2);
  v_refund_id   uuid;
  v_reason      text := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Lock delivery first, then child batches in deterministic id order
  SELECT id, supplier_id, status
    INTO v_delivery
    FROM public.stock_deliveries
   WHERE id = p_delivery_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock delivery not found.';
  END IF;
  IF v_delivery.status = 'cancelled' THEN
    RAISE EXCEPTION 'This delivery is already cancelled.';
  END IF;

  PERFORM 1
    FROM public.stock_batches
   WHERE delivery_id = p_delivery_id
   ORDER BY id
     FOR UPDATE;

  SELECT COALESCE(SUM(boxes_received - boxes_remaining), 0)::integer
    INTO v_sold_boxes
    FROM public.stock_batches
   WHERE delivery_id = p_delivery_id;

  IF v_sold_boxes > 0 THEN
    RAISE EXCEPTION 'Cannot cancel delivery: % box(es) have already been sold on active bill(s). Cancel the affected bill(s) first.', v_sold_boxes;
  END IF;

  -- Lock any parent supplier_payments with active allocations to this delivery (prevents race with cancel_supplier_payment)
  PERFORM 1
    FROM public.supplier_payments sp
   WHERE sp.id IN (
     SELECT DISTINCT spa.supplier_payment_id
       FROM public.supplier_payment_allocations spa
      WHERE spa.delivery_id = p_delivery_id
        AND spa.status = 'active'
   )
   ORDER BY sp.id
     FOR UPDATE;

  -- Check active supplier payment allocations pointing to this delivery
  SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
    INTO v_active_paid
    FROM public.supplier_payment_allocations spa
    JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
   WHERE spa.delivery_id = p_delivery_id
     AND spa.status = 'active'
     AND sp.status = 'active';

  IF v_active_paid > 0 THEN
    IF p_refund_mode IS NULL OR p_refund_mode NOT IN ('cash', 'upi') THEN
      RAISE EXCEPTION 'This delivery has % paid via supplier payment(s). Either reallocate those allocations to another delivery, cancel a mistaken single-delivery payment, or provide refund mode (cash/upi) to record a supplier refund.', v_active_paid;
    END IF;

    INSERT INTO public.supplier_refunds (
      delivery_id, supplier_id, amount, mode, refund_date, note
    )
    VALUES (
      p_delivery_id, v_delivery.supplier_id, v_active_paid, p_refund_mode,
      COALESCE(p_refund_date, public.shop_today()),
      COALESCE(NULLIF(btrim(p_refund_note), ''), v_reason)
    )
    RETURNING id INTO v_refund_id;

    UPDATE public.supplier_payment_allocations spa
       SET status          = 'refunded',
           refund_id       = v_refund_id,
           reversed_at     = now(),
           reversal_reason = COALESCE(v_reason, 'Delivery cancelled with supplier refund')
      FROM public.supplier_payments sp
     WHERE spa.supplier_payment_id = sp.id
       AND spa.delivery_id = p_delivery_id
       AND spa.status = 'active'
       AND sp.status = 'active';
  END IF;

  UPDATE public.stock_batches
     SET boxes_remaining = 0
   WHERE delivery_id = p_delivery_id;

  UPDATE public.stock_deliveries
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   WHERE id = p_delivery_id;
END;
$$;

-- ============================================================================
-- 3. CREATE SALE BILL (manual batch allocation + unified Cash/UPI receipts)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_bill(
  p_customer_id     uuid,          -- NULL = walk-in Cash Customer
  p_bill_date       date,
  p_items           jsonb,         -- [{ fruit_id, variety_id, boxes, sell_rate, allocations: [{ batch_id, boxes }] }]
  p_paid_cash       numeric DEFAULT 0,
  p_paid_upi        numeric DEFAULT 0,
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
  v_date           date := COALESCE(p_bill_date, public.shop_today());
  v_paid_cash      numeric(12,2) := ROUND(COALESCE(p_paid_cash, 0), 2);
  v_paid_upi       numeric(12,2) := ROUND(COALESCE(p_paid_upi, 0), 2);
  v_cust_name      text := 'Cash Customer';
  v_cust_active    boolean;
  v_year           integer;
  v_num            integer;
  v_prefix         text;
  v_bill_no        text;
  v_bill_id        uuid;
  v_subtotal       numeric(12,2) := 0;
  v_line_total     numeric(12,2);
  v_bill_item_id   uuid;
  v_payment_id     uuid;
  v_fruit_id       uuid;
  v_variety_id     uuid;
  v_fruit_name     text;
  v_variety_name   text;
  v_line_boxes     integer;
  v_alloc_sum      integer;
  v_sell_rate      numeric(12,2);
  v_batch_id       uuid;
  v_alloc_boxes    integer;
  v_batch_rec      record;
  v_item_rec       record;
  v_alloc_rec      record;
  v_batch_ids      uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Idempotency check (advisory lock serializes concurrent retries; unique index is second guard)
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('create_bill:' || p_idempotency_key::text, 0));
    SELECT id INTO v_existing_id
      FROM public.bills
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one item to the bill.';
  END IF;

  IF v_paid_cash < 0 OR v_paid_upi < 0 THEN
    RAISE EXCEPTION 'Paid cash and UPI amounts cannot be negative.';
  END IF;

  -- Pre-validate JSON structure and collect all batch_ids for deterministic locking
  FOR v_item_rec IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(v_item_rec.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid item format on line %.', v_item_rec.ord;
    END IF;
    IF v_item_rec.value -> 'allocations' IS NULL
       OR jsonb_typeof(v_item_rec.value -> 'allocations') <> 'array'
       OR jsonb_array_length(v_item_rec.value -> 'allocations') = 0 THEN
      RAISE EXCEPTION 'Select stock batch allocation(s) for line %.', v_item_rec.ord;
    END IF;

    FOR v_alloc_rec IN
      SELECT a.value
        FROM jsonb_array_elements(v_item_rec.value -> 'allocations') AS a(value)
    LOOP
      IF jsonb_typeof(v_alloc_rec.value) <> 'object' THEN
        RAISE EXCEPTION 'Invalid batch allocation format on line %.', v_item_rec.ord;
      END IF;
      BEGIN
        v_batch_id := (v_alloc_rec.value ->> 'batch_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid batch ID in line %.', v_item_rec.ord;
      END;
      IF v_batch_id IS NULL THEN
        RAISE EXCEPTION 'Batch ID is required in line %.', v_item_rec.ord;
      END IF;
      v_batch_ids := array_append(v_batch_ids, v_batch_id);
    END LOOP;
  END LOOP;

  -- Global Lock Order Step 1: Lock parent deliveries FOR SHARE (blocks concurrent cancel_stock_delivery)
  PERFORM 1
    FROM public.stock_deliveries sd
   WHERE sd.id IN (
     SELECT DISTINCT sb.delivery_id
       FROM public.stock_batches sb
      WHERE sb.id = ANY(v_batch_ids)
   )
   ORDER BY sd.id
     FOR SHARE;

  -- Global Lock Order Step 2: Lock all referenced stock_batches FOR UPDATE in deterministic id order
  PERFORM 1
    FROM public.stock_batches sb
   WHERE sb.id = ANY(v_batch_ids)
   ORDER BY sb.id
     FOR UPDATE;

  -- Global Lock Order Step 3: Validate customer (if registered)
  IF p_customer_id IS NOT NULL THEN
    SELECT name, active
      INTO v_cust_name, v_cust_active
      FROM public.customers
     WHERE id = p_customer_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF NOT v_cust_active THEN
      RAISE EXCEPTION 'Cannot create a bill for an inactive customer.';
    END IF;
  END IF;

  -- Generate concurrency-safe bill number
  v_year := EXTRACT(YEAR FROM v_date)::integer;
  SELECT COALESCE(bill_prefix, 'INV') INTO v_prefix
    FROM public.shop_profile WHERE id = true;
  v_prefix := COALESCE(v_prefix, 'INV');

  INSERT INTO public.bill_counters (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = public.bill_counters.last_number + 1
  RETURNING last_number INTO v_num;

  v_bill_no := v_prefix || '-' || v_year || '-' || lpad(v_num::text, 6, '0');

  INSERT INTO public.bills (
    bill_no, customer_id, customer_name_snapshot, bill_date, note, idempotency_key
  )
  VALUES (
    v_bill_no, p_customer_id, v_cust_name, v_date, NULLIF(btrim(p_note), ''), p_idempotency_key
  )
  RETURNING id INTO v_bill_id;

  -- Process each bill line and its manual batch allocations
  FOR v_item_rec IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    BEGIN
      v_fruit_id   := (v_item_rec.value ->> 'fruit_id')::uuid;
      v_variety_id := (v_item_rec.value ->> 'variety_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid fruit or variety selected on line %.', v_item_rec.ord;
    END;

    IF btrim(COALESCE(v_item_rec.value ->> 'boxes', '')) !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Boxes on line % must be a whole number greater than zero.', v_item_rec.ord;
    END IF;
    BEGIN
      v_line_boxes := btrim(v_item_rec.value ->> 'boxes')::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Boxes on line % is too large.', v_item_rec.ord;
    END;

    BEGIN
      v_sell_rate := ROUND((v_item_rec.value ->> 'sell_rate')::numeric, 2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid selling rate on line %.', v_item_rec.ord;
    END;
    IF v_sell_rate IS NULL OR v_sell_rate <= 0 THEN
      RAISE EXCEPTION 'Selling rate on line % must be greater than zero.', v_item_rec.ord;
    END IF;

    SELECT f.name, fv.name
      INTO v_fruit_name, v_variety_name
      FROM public.fruit_varieties fv
      JOIN public.fruits f ON f.id = fv.fruit_id
     WHERE fv.id = v_variety_id
       AND fv.fruit_id = v_fruit_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fruit/variety mismatch on line %.', v_item_rec.ord;
    END IF;

    INSERT INTO public.bill_items (
      bill_id, line_no, fruit_id, variety_id,
      fruit_name_snapshot, variety_name_snapshot, boxes, sell_rate
    )
    VALUES (
      v_bill_id, v_item_rec.ord::integer, v_fruit_id, v_variety_id,
      v_fruit_name, v_variety_name, v_line_boxes, v_sell_rate
    )
    RETURNING id, line_total INTO v_bill_item_id, v_line_total;

    v_alloc_sum := 0;
    FOR v_alloc_rec IN
      SELECT a.value
        FROM jsonb_array_elements(v_item_rec.value -> 'allocations') AS a(value)
    LOOP
      v_batch_id := (v_alloc_rec.value ->> 'batch_id')::uuid;
      IF btrim(COALESCE(v_alloc_rec.value ->> 'boxes', '')) !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'Allocated batch boxes on line % must be a whole number greater than zero.', v_item_rec.ord;
      END IF;
      BEGIN
        v_alloc_boxes := btrim(v_alloc_rec.value ->> 'boxes')::integer;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Allocated batch boxes on line % is too large.', v_item_rec.ord;
      END;

      SELECT sb.id, sb.fruit_id, sb.variety_id, sb.boxes_remaining, sd.status AS delivery_status
        INTO v_batch_rec
        FROM public.stock_batches sb
        JOIN public.stock_deliveries sd ON sd.id = sb.delivery_id
       WHERE sb.id = v_batch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock batch not found on line %.', v_item_rec.ord;
      END IF;
      IF v_batch_rec.delivery_status <> 'active' THEN
        RAISE EXCEPTION 'Cannot allocate stock from a cancelled delivery on line %.', v_item_rec.ord;
      END IF;
      IF v_batch_rec.fruit_id <> v_fruit_id OR v_batch_rec.variety_id <> v_variety_id THEN
        RAISE EXCEPTION 'Selected batch does not match % (%) on line %.', v_fruit_name, v_variety_name, v_item_rec.ord;
      END IF;
      IF v_alloc_boxes > v_batch_rec.boxes_remaining THEN
        RAISE EXCEPTION 'Not enough stock in selected batch for % (%): only % box(es) remaining, requested %.',
          v_fruit_name, v_variety_name, v_batch_rec.boxes_remaining, v_alloc_boxes;
      END IF;

      UPDATE public.stock_batches
         SET boxes_remaining = boxes_remaining - v_alloc_boxes
       WHERE id = v_batch_id;

      INSERT INTO public.bill_item_batch_allocations (
        bill_item_id, batch_id, fruit_id, variety_id, boxes
      )
      VALUES (
        v_bill_item_id, v_batch_id, v_fruit_id, v_variety_id, v_alloc_boxes
      );

      v_alloc_sum := v_alloc_sum + v_alloc_boxes;
    END LOOP;

    IF v_alloc_sum <> v_line_boxes THEN
      RAISE EXCEPTION 'Batch allocations (% boxes) must equal line quantity (% boxes) on line %.',
        v_alloc_sum, v_line_boxes, v_item_rec.ord;
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  -- Validate immediate payment amounts
  IF (v_paid_cash + v_paid_upi) > v_subtotal THEN
    RAISE EXCEPTION 'Paid amount (%) exceeds bill total (%). Record collections for older bills separately.',
      (v_paid_cash + v_paid_upi), v_subtotal;
  END IF;

  IF p_customer_id IS NULL AND (v_paid_cash + v_paid_upi) <> v_subtotal THEN
    RAISE EXCEPTION 'Cash Customer bills must be paid in full (%). Select a registered customer to allow credit.', v_subtotal;
  END IF;

  UPDATE public.bills
     SET subtotal = v_subtotal
   WHERE id = v_bill_id;

  -- Unified Customer Payment Ledger: record immediate Cash and/or UPI receipts
  IF v_paid_cash > 0 THEN
    INSERT INTO public.customer_payments (
      customer_id, customer_name_snapshot, payment_origin, amount, mode, payment_date, note
    )
    VALUES (
      p_customer_id, v_cust_name, 'bill_sale', v_paid_cash, 'cash', v_date,
      'Immediate payment for ' || v_bill_no
    )
    RETURNING id INTO v_payment_id;

    INSERT INTO public.customer_payment_allocations (
      customer_payment_id, bill_id, amount
    )
    VALUES (
      v_payment_id, v_bill_id, v_paid_cash
    );
  END IF;

  IF v_paid_upi > 0 THEN
    INSERT INTO public.customer_payments (
      customer_id, customer_name_snapshot, payment_origin, amount, mode, payment_date, note
    )
    VALUES (
      p_customer_id, v_cust_name, 'bill_sale', v_paid_upi, 'upi', v_date,
      'Immediate payment for ' || v_bill_no
    )
    RETURNING id INTO v_payment_id;

    INSERT INTO public.customer_payment_allocations (
      customer_payment_id, bill_id, amount
    )
    VALUES (
      v_payment_id, v_bill_id, v_paid_upi
    );
  END IF;

  RETURN v_bill_id;
END;
$$;

-- ============================================================================
-- 4. CANCEL SALE BILL (restores exact batches + explicit refund if money received)
-- ============================================================================
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

  SELECT id, customer_id, customer_name_snapshot, status
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

  -- Lock any parent customer_payments with active allocations to this bill (prevents race with cancel_customer_payment)
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

  -- Lock affected stock_batches in deterministic order and restore exact boxes
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

-- ============================================================================
-- 5. ADD CUSTOMER PAYMENT (explicit allocation to bills and/or opening balance)
-- ============================================================================
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
  v_existing_id uuid;
  v_date        date := COALESCE(p_payment_date, public.shop_today());
  v_amount      numeric(12,2) := ROUND(COALESCE(p_amount, 0), 2);
  v_cust_name   text;
  v_payment_id  uuid;
  v_alloc_sum   numeric(12,2) := 0;
  v_bill_ids    uuid[] := ARRAY[]::uuid[];
  v_ob_ids      uuid[] := ARRAY[]::uuid[];
  v_bill_id     uuid;
  v_ob_id       uuid;
  v_alloc_amt   numeric(12,2);
  v_target_tot  numeric(12,2);
  v_target_paid numeric(12,2);
  v_target_stat text;
  v_target_cust uuid;
  r             record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Idempotency check (advisory lock serializes concurrent retries; unique index is second guard)
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

  -- Allows collecting dues even if customer is inactive
  SELECT name INTO v_cust_name
    FROM public.customers
   WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  -- Validate allocation array and collect IDs for deterministic locking
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

      SELECT COALESCE(SUM(cpa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.customer_payment_allocations cpa
        JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
       WHERE cpa.bill_id = v_bill_id
         AND cpa.status = 'active'
         AND cp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Allocation (%) exceeds remaining bill balance (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.customer_payment_allocations (
        customer_payment_id, bill_id, amount
      )
      VALUES (v_payment_id, v_bill_id, v_alloc_amt);
    ELSE
      SELECT customer_id, amount, status
        INTO v_target_cust, v_target_tot, v_target_stat
        FROM public.customer_opening_balances WHERE id = v_ob_id;
      IF NOT FOUND OR v_target_cust <> p_customer_id THEN
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

-- ============================================================================
-- 6. CANCEL CUSTOMER PAYMENT (for mistaken payment entries; preserves audit)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_customer_payment(
  p_payment_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pay    record;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT id, customer_id, status
    INTO v_pay
    FROM public.customer_payments
   WHERE id = p_payment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer payment not found.';
  END IF;
  IF v_pay.status = 'cancelled' THEN
    RAISE EXCEPTION 'This payment is already cancelled.';
  END IF;

  -- Cash Customer bills cannot carry unpaid credit
  IF v_pay.customer_id IS NULL THEN
    RAISE EXCEPTION 'Cash Customer receipts cannot be cancelled independently while the bill is active. Cancel the Cash Customer bill instead.';
  END IF;

  -- Cannot cancel a payment after part/all of it was already refunded
  IF EXISTS (
    SELECT 1
      FROM public.customer_payment_allocations
     WHERE customer_payment_id = p_payment_id
       AND status = 'refunded'
  ) THEN
    RAISE EXCEPTION 'Cannot cancel this payment because a refund has already been issued against one of its allocated bills.';
  END IF;

  UPDATE public.customer_payment_allocations
     SET status          = 'cancelled',
         reversed_at     = now(),
         reversal_reason = COALESCE(v_reason, 'Customer payment cancelled')
   WHERE customer_payment_id = p_payment_id
     AND status = 'active';

  UPDATE public.customer_payments
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   WHERE id = p_payment_id;
END;
$$;

-- ============================================================================
-- 7. ADD SUPPLIER PAYMENT (strict explicit allocations; zero unallocated advance)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_supplier_payment(
  p_supplier_id     uuid,
  p_amount          numeric,
  p_mode            text,
  p_payment_date    date,
  p_allocations     jsonb,  -- [{ delivery_id?: uuid, opening_balance_id?: uuid, amount: numeric }]
  p_note            text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_date        date := COALESCE(p_payment_date, public.shop_today());
  v_amount      numeric(12,2) := ROUND(COALESCE(p_amount, 0), 2);
  v_payment_id  uuid;
  v_alloc_sum   numeric(12,2) := 0;
  v_del_ids     uuid[] := ARRAY[]::uuid[];
  v_ob_ids      uuid[] := ARRAY[]::uuid[];
  v_del_id      uuid;
  v_ob_id       uuid;
  v_alloc_amt   numeric(12,2);
  v_target_tot  numeric(12,2);
  v_target_paid numeric(12,2);
  v_target_stat text;
  v_target_supp uuid;
  r             record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Idempotency check (advisory lock serializes concurrent retries; unique index is second guard)
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('add_supplier_payment:' || p_idempotency_key::text, 0));
    SELECT id INTO v_existing_id
      FROM public.supplier_payments
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'Supplier not found.';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('cash', 'upi') THEN
    RAISE EXCEPTION 'Choose Cash or UPI.';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Explicitly allocate this supplier payment to at least one delivery or opening balance.';
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
      v_del_id := NULLIF(btrim(COALESCE(r.value ->> 'delivery_id', '')), '')::uuid;
      v_ob_id  := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid delivery or opening balance ID on allocation line %.', r.ord;
    END;

    BEGIN
      v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid allocation amount on line %.', r.ord;
    END;

    IF ((v_del_id IS NOT NULL)::integer + (v_ob_id IS NOT NULL)::integer) <> 1 THEN
      RAISE EXCEPTION 'Allocation line % must specify either delivery_id or opening_balance_id (not both).', r.ord;
    END IF;
    IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
      RAISE EXCEPTION 'Allocation amount on line % must be greater than zero.', r.ord;
    END IF;

    IF v_del_id IS NOT NULL THEN
      IF v_del_id = ANY(v_del_ids) THEN
        RAISE EXCEPTION 'Duplicate delivery in supplier payment allocations.';
      END IF;
      v_del_ids := array_append(v_del_ids, v_del_id);
    ELSE
      IF v_ob_id = ANY(v_ob_ids) THEN
        RAISE EXCEPTION 'Duplicate opening balance in supplier payment allocations.';
      END IF;
      v_ob_ids := array_append(v_ob_ids, v_ob_id);
    END IF;

    v_alloc_sum := v_alloc_sum + v_alloc_amt;
  END LOOP;

  -- Strictly forbids unallocated supplier advances and over-allocation
  IF v_alloc_sum <> v_amount THEN
    RAISE EXCEPTION 'Allocated total (%) must exactly match supplier payment amount (%). Unallocated advances are not allowed.', v_alloc_sum, v_amount;
  END IF;

  -- Lock targets in global deterministic order
  IF cardinality(v_del_ids) > 0 THEN
    PERFORM 1 FROM public.stock_deliveries WHERE id = ANY(v_del_ids) ORDER BY id FOR UPDATE;
  END IF;
  IF cardinality(v_ob_ids) > 0 THEN
    PERFORM 1 FROM public.supplier_opening_balances WHERE id = ANY(v_ob_ids) ORDER BY id FOR UPDATE;
  END IF;

  INSERT INTO public.supplier_payments (
    supplier_id, payment_origin, amount, mode, payment_date, note, idempotency_key
  )
  VALUES (
    p_supplier_id, 'settlement', v_amount, p_mode, v_date,
    NULLIF(btrim(p_note), ''), p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  FOR r IN
    SELECT e.value FROM jsonb_array_elements(p_allocations) AS e(value)
  LOOP
    v_del_id    := NULLIF(btrim(COALESCE(r.value ->> 'delivery_id', '')), '')::uuid;
    v_ob_id     := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);

    IF v_del_id IS NOT NULL THEN
      SELECT supplier_id, total_amount, status
        INTO v_target_supp, v_target_tot, v_target_stat
        FROM public.stock_deliveries WHERE id = v_del_id;
      IF NOT FOUND OR v_target_supp <> p_supplier_id THEN
        RAISE EXCEPTION 'Target delivery does not belong to this supplier.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot allocate payment to a cancelled delivery.';
      END IF;

      SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.supplier_payment_allocations spa
        JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
       WHERE spa.delivery_id = v_del_id
         AND spa.status = 'active'
         AND sp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Allocation (%) exceeds delivery outstanding balance (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.supplier_payment_allocations (
        supplier_payment_id, delivery_id, amount
      )
      VALUES (v_payment_id, v_del_id, v_alloc_amt);
    ELSE
      SELECT supplier_id, amount, status
        INTO v_target_supp, v_target_tot, v_target_stat
        FROM public.supplier_opening_balances WHERE id = v_ob_id;
      IF NOT FOUND OR v_target_supp <> p_supplier_id THEN
        RAISE EXCEPTION 'Target opening balance does not belong to this supplier.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot allocate payment to a cancelled opening balance.';
      END IF;

      SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.supplier_payment_allocations spa
        JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
       WHERE spa.opening_balance_id = v_ob_id
         AND spa.status = 'active'
         AND sp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Allocation (%) exceeds supplier opening balance remaining (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.supplier_payment_allocations (
        supplier_payment_id, opening_balance_id, amount
      )
      VALUES (v_payment_id, v_ob_id, v_alloc_amt);
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$;

-- ============================================================================
-- 8. REALLOCATE SUPPLIER PAYMENT ALLOCATION
--    Moves one delivery's slice to other unpaid deliveries of the same supplier
--    WITHOUT cancelling the parent payment or disturbing unrelated deliveries.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reallocate_supplier_payment_allocation(
  p_allocation_id   uuid,
  p_new_allocations jsonb,  -- [{ delivery_id?: uuid, opening_balance_id?: uuid, amount: numeric }]
  p_reason          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old         record;
  v_pay_supp    uuid;
  v_pay_status  text;
  v_del_ids     uuid[] := ARRAY[]::uuid[];
  v_ob_ids      uuid[] := ARRAY[]::uuid[];
  v_new_sum     numeric(12,2) := 0;
  v_del_id      uuid;
  v_ob_id       uuid;
  v_alloc_amt   numeric(12,2);
  v_target_tot  numeric(12,2);
  v_target_paid numeric(12,2);
  v_target_stat text;
  v_target_supp uuid;
  v_reason      text := COALESCE(NULLIF(btrim(p_reason), ''), 'Reallocated to other delivery/balance');
  r             record;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  IF p_new_allocations IS NULL OR jsonb_typeof(p_new_allocations) <> 'array' OR jsonb_array_length(p_new_allocations) = 0 THEN
    RAISE EXCEPTION 'Provide at least one replacement allocation target.';
  END IF;

  -- Peek source allocation to assemble full lock list in global order
  SELECT spa.id, spa.supplier_payment_id, spa.delivery_id, spa.opening_balance_id, spa.amount, spa.status, sp.supplier_id
    INTO v_old
    FROM public.supplier_payment_allocations spa
    JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
   WHERE spa.id = p_allocation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment allocation not found.';
  END IF;

  IF v_old.delivery_id IS NOT NULL THEN
    v_del_ids := array_append(v_del_ids, v_old.delivery_id);
  END IF;
  IF v_old.opening_balance_id IS NOT NULL THEN
    v_ob_ids := array_append(v_ob_ids, v_old.opening_balance_id);
  END IF;

  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_new_allocations) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(r.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid replacement allocation format on line %.', r.ord;
    END IF;

    BEGIN
      v_del_id := NULLIF(btrim(COALESCE(r.value ->> 'delivery_id', '')), '')::uuid;
      v_ob_id  := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid delivery or opening balance ID on replacement line %.', r.ord;
    END;

    BEGIN
      v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid replacement allocation amount on line %.', r.ord;
    END;

    IF ((v_del_id IS NOT NULL)::integer + (v_ob_id IS NOT NULL)::integer) <> 1 THEN
      RAISE EXCEPTION 'Replacement allocation line % must specify either delivery_id or opening_balance_id.', r.ord;
    END IF;
    IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
      RAISE EXCEPTION 'Replacement allocation amount on line % must be greater than zero.', r.ord;
    END IF;
    IF v_del_id IS NOT NULL AND v_del_id = v_old.delivery_id THEN
      RAISE EXCEPTION 'Replacement target cannot be the same delivery being reversed.';
    END IF;
    IF v_ob_id IS NOT NULL AND v_ob_id = v_old.opening_balance_id THEN
      RAISE EXCEPTION 'Replacement target cannot be the same opening balance being reversed.';
    END IF;

    IF v_del_id IS NOT NULL THEN
      IF v_del_id = ANY(v_del_ids) THEN
        RAISE EXCEPTION 'Duplicate delivery in replacement allocations.';
      END IF;
      v_del_ids := array_append(v_del_ids, v_del_id);
    ELSE
      IF v_ob_id = ANY(v_ob_ids) THEN
        RAISE EXCEPTION 'Duplicate opening balance in replacement allocations.';
      END IF;
      v_ob_ids := array_append(v_ob_ids, v_ob_id);
    END IF;

    v_new_sum := v_new_sum + v_alloc_amt;
  END LOOP;

  -- Global Lock Order: deliveries -> opening_balances -> supplier_payments -> allocation
  IF cardinality(v_del_ids) > 0 THEN
    PERFORM 1 FROM public.stock_deliveries WHERE id = ANY(v_del_ids) ORDER BY id FOR UPDATE;
  END IF;
  IF cardinality(v_ob_ids) > 0 THEN
    PERFORM 1 FROM public.supplier_opening_balances WHERE id = ANY(v_ob_ids) ORDER BY id FOR UPDATE;
  END IF;

  SELECT supplier_id, status
    INTO v_pay_supp, v_pay_status
    FROM public.supplier_payments
   WHERE id = v_old.supplier_payment_id
     FOR UPDATE;

  IF v_pay_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot reallocate from a cancelled supplier payment.';
  END IF;

  -- Re-read & lock allocation row to guard against concurrent reallocation/cancel
  SELECT status, amount
    INTO v_old.status, v_old.amount
    FROM public.supplier_payment_allocations
   WHERE id = p_allocation_id
     FOR UPDATE;

  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'This allocation is no longer active and cannot be reallocated.';
  END IF;

  IF v_new_sum <> v_old.amount THEN
    RAISE EXCEPTION 'Replacement allocations total (%) must exactly equal original allocation amount (%).',
      v_new_sum, v_old.amount;
  END IF;

  -- Mark original allocation reversed (preserving complete audit trail)
  UPDATE public.supplier_payment_allocations
     SET status          = 'reallocated',
         reversed_at     = now(),
         reversal_reason = v_reason
   WHERE id = p_allocation_id;

  -- Insert replacement active allocations under the same parent payment
  FOR r IN
    SELECT e.value FROM jsonb_array_elements(p_new_allocations) AS e(value)
  LOOP
    v_del_id    := NULLIF(btrim(COALESCE(r.value ->> 'delivery_id', '')), '')::uuid;
    v_ob_id     := NULLIF(btrim(COALESCE(r.value ->> 'opening_balance_id', '')), '')::uuid;
    v_alloc_amt := ROUND((r.value ->> 'amount')::numeric, 2);

    IF v_del_id IS NOT NULL THEN
      SELECT supplier_id, total_amount, status
        INTO v_target_supp, v_target_tot, v_target_stat
        FROM public.stock_deliveries WHERE id = v_del_id;
      IF NOT FOUND OR v_target_supp <> v_pay_supp THEN
        RAISE EXCEPTION 'Replacement delivery does not belong to this supplier.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot reallocate to a cancelled delivery.';
      END IF;

      SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.supplier_payment_allocations spa
        JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
       WHERE spa.delivery_id = v_del_id
         AND spa.status = 'active'
         AND sp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Reallocation (%) exceeds target delivery outstanding balance (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.supplier_payment_allocations (
        supplier_payment_id, delivery_id, amount, reallocated_from_id
      )
      VALUES (v_old.supplier_payment_id, v_del_id, v_alloc_amt, p_allocation_id);
    ELSE
      SELECT supplier_id, amount, status
        INTO v_target_supp, v_target_tot, v_target_stat
        FROM public.supplier_opening_balances WHERE id = v_ob_id;
      IF NOT FOUND OR v_target_supp <> v_pay_supp THEN
        RAISE EXCEPTION 'Replacement opening balance does not belong to this supplier.';
      END IF;
      IF v_target_stat <> 'active' THEN
        RAISE EXCEPTION 'Cannot reallocate to a cancelled opening balance.';
      END IF;

      SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
        INTO v_target_paid
        FROM public.supplier_payment_allocations spa
        JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
       WHERE spa.opening_balance_id = v_ob_id
         AND spa.status = 'active'
         AND sp.status = 'active';

      IF (v_target_paid + v_alloc_amt) > v_target_tot THEN
        RAISE EXCEPTION 'Reallocation (%) exceeds supplier opening balance remaining (%).',
          v_alloc_amt, (v_target_tot - v_target_paid);
      END IF;

      INSERT INTO public.supplier_payment_allocations (
        supplier_payment_id, opening_balance_id, amount, reallocated_from_id
      )
      VALUES (v_old.supplier_payment_id, v_ob_id, v_alloc_amt, p_allocation_id);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- 9. CANCEL SUPPLIER PAYMENT (for mistaken payment entries; preserves audit)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_supplier_payment(
  p_supplier_payment_id uuid,
  p_reason              text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT status INTO v_status
    FROM public.supplier_payments
   WHERE id = p_supplier_payment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found.';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'This supplier payment is already cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.supplier_payment_allocations
     WHERE supplier_payment_id = p_supplier_payment_id
       AND status = 'refunded'
  ) THEN
    RAISE EXCEPTION 'Cannot cancel this supplier payment because a supplier refund has already been recorded against one of its deliveries.';
  END IF;

  UPDATE public.supplier_payment_allocations
     SET status          = 'cancelled',
         reversed_at     = now(),
         reversal_reason = COALESCE(v_reason, 'Supplier payment cancelled')
   WHERE supplier_payment_id = p_supplier_payment_id
     AND status = 'active';

  UPDATE public.supplier_payments
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   WHERE id = p_supplier_payment_id;
END;
$$;

-- ============================================================================
-- 10. OPENING BALANCE RPCs (Customers & Suppliers)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_customer_opening_balance(
  p_customer_id uuid,
  p_amount      numeric,
  p_as_of_date  date DEFAULT NULL,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active boolean;
  v_amount numeric(12,2) := ROUND(COALESCE(p_amount, 0), 2);
  v_id     uuid;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Lock parent customer row to serialize concurrent opening-balance creation
  SELECT active INTO v_active
    FROM public.customers
   WHERE id = p_customer_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'Cannot set an opening balance for an inactive customer.';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Opening balance must be greater than zero.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_opening_balances
     WHERE customer_id = p_customer_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'This customer already has an active opening balance. Cancel it first to replace.';
  END IF;

  INSERT INTO public.customer_opening_balances (customer_id, amount, as_of_date, note)
  VALUES (p_customer_id, v_amount, COALESCE(p_as_of_date, public.shop_today()), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_customer_opening_balance(
  p_opening_balance_id uuid,
  p_reason             text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT status INTO v_status
    FROM public.customer_opening_balances
   WHERE id = p_opening_balance_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer opening balance not found.';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'This opening balance is already cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.customer_payment_allocations cpa
      JOIN public.customer_payments cp ON cp.id = cpa.customer_payment_id
     WHERE cpa.opening_balance_id = p_opening_balance_id
       AND cpa.status = 'active'
       AND cp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot cancel opening balance while active customer payments are allocated to it. Cancel those payment(s) first.';
  END IF;

  UPDATE public.customer_opening_balances
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_opening_balance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_supplier_opening_balance(
  p_supplier_id uuid,
  p_amount      numeric,
  p_as_of_date  date DEFAULT NULL,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active boolean;
  v_amount numeric(12,2) := ROUND(COALESCE(p_amount, 0), 2);
  v_id     uuid;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  -- Lock parent supplier row to serialize concurrent opening-balance creation
  SELECT active INTO v_active
    FROM public.suppliers
   WHERE id = p_supplier_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found.';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'Cannot set an opening balance for an inactive supplier.';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Opening balance must be greater than zero.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_opening_balances
     WHERE supplier_id = p_supplier_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'This supplier already has an active opening balance. Cancel it first to replace.';
  END IF;

  INSERT INTO public.supplier_opening_balances (supplier_id, amount, as_of_date, note)
  VALUES (p_supplier_id, v_amount, COALESCE(p_as_of_date, public.shop_today()), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_supplier_opening_balance(
  p_opening_balance_id uuid,
  p_reason             text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  SELECT status INTO v_status
    FROM public.supplier_opening_balances
   WHERE id = p_opening_balance_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier opening balance not found.';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'This opening balance is already cancelled.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.supplier_payment_allocations spa
      JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
     WHERE spa.opening_balance_id = p_opening_balance_id
       AND spa.status = 'active'
       AND sp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot cancel opening balance while active supplier payments are allocated to it. Reallocate or cancel those payment(s) first.';
  END IF;

  UPDATE public.supplier_opening_balances
     SET status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_opening_balance_id;
END;
$$;

-- ============================================================================
-- 11. Least-Privilege Function Permissions (zero PUBLIC/anon access)
-- ============================================================================
REVOKE ALL ON FUNCTION public.is_authorized_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shop_today() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_customer_payment_allocation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_supplier_payment_allocation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_stock_delivery(uuid, uuid, date, jsonb, text, numeric, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_stock_delivery(uuid, text, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bill(uuid, date, jsonb, numeric, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_bill(uuid, text, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_customer_payment(uuid, numeric, text, date, jsonb, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_customer_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_supplier_payment(uuid, numeric, text, date, jsonb, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reallocate_supplier_payment_allocation(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_supplier_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_opening_balance(uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_customer_opening_balance(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_supplier_opening_balance(uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_supplier_opening_balance(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_authorized_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_stock_delivery(uuid, uuid, date, jsonb, text, numeric, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_delivery(uuid, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill(uuid, date, jsonb, numeric, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_customer_payment(uuid, numeric, text, date, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_supplier_payment(uuid, numeric, text, date, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reallocate_supplier_payment_allocation(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_opening_balance(uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_opening_balance(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_supplier_opening_balance(uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_opening_balance(uuid, text) TO authenticated;

COMMIT;

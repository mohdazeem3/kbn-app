-- ============================================================================
-- Migration 011: Edit Stock Delivery & Correction Audit Logging
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create stock_delivery_corrections audit table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_delivery_corrections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id           uuid NOT NULL REFERENCES public.stock_deliveries(id) ON DELETE RESTRICT,
  delivery_no           text NOT NULL CHECK (btrim(delivery_no) <> ''),
  corrected_by          uuid NOT NULL REFERENCES auth.users(id),
  correction_reason     text NOT NULL CHECK (btrim(correction_reason) <> ''),
  previous_items        jsonb NOT NULL,
  new_items             jsonb NOT NULL,
  previous_total_boxes  integer NOT NULL CHECK (previous_total_boxes >= 0),
  new_total_boxes       integer NOT NULL CHECK (new_total_boxes >= 0),
  previous_total_amount numeric(12,2) NOT NULL CHECK (previous_total_amount >= 0),
  new_total_amount      numeric(12,2) NOT NULL CHECK (new_total_amount >= 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_delivery_corrections_delivery_idx
  ON public.stock_delivery_corrections (delivery_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Row-Level Security on stock_delivery_corrections (SELECT ONLY for authenticated)
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_delivery_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_delivery_corrections_select ON public.stock_delivery_corrections;
CREATE POLICY stock_delivery_corrections_select ON public.stock_delivery_corrections
  FOR SELECT TO authenticated USING (public.is_authorized_user());

REVOKE ALL ON TABLE public.stock_delivery_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_delivery_corrections TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Atomic edit_stock_delivery RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_stock_delivery(
  p_delivery_id        uuid,
  p_items              jsonb,
  p_note               text DEFAULT NULL,
  p_correction_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_delivery            record;
  v_corrected_by        uuid;
  v_reason              text := NULLIF(btrim(p_correction_reason), '');
  v_previous_items      jsonb;
  v_new_items           jsonb;
  v_active_paid         numeric(12,2) := 0;

  -- Item parsing vars
  r                     record;
  v_item_batch_id       uuid;
  v_line_fruit_id       uuid;
  v_variety_id          uuid;
  v_boxes_text          text;
  v_boxes               integer;
  v_rate                numeric(12,2);

  -- Validation & recalculation vars
  v_submitted_batch_ids uuid[] := ARRAY[]::uuid[];
  v_existing_batch      record;
  v_sold_boxes          integer;
  v_has_allocations     boolean;
  v_new_total_boxes     integer := 0;
  v_new_total_amount    numeric(12,2) := 0;
  v_distinct_fruits     integer;
  v_first_fruit_id      uuid;
  v_header_fruit_id     uuid;
BEGIN
  -- 1. Authorization check
  IF NOT public.is_authorized_user() THEN
    RAISE EXCEPTION 'Not authorized. Please log in again.';
  END IF;

  v_corrected_by := COALESCE(auth.uid(), (SELECT user_id FROM public.profiles WHERE active = true LIMIT 1));
  IF v_corrected_by IS NULL THEN
    RAISE EXCEPTION 'Active user session required for audit logging.';
  END IF;

  -- 2. Input validation
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Delivery ID is required.';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Correction reason is required.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Delivery must contain at least one batch item.';
  END IF;

  -- 3. Concurrency advisory lock per delivery
  PERFORM pg_advisory_xact_lock(hashtextextended('stock_delivery:' || p_delivery_id::text, 0));

  -- Lock delivery row
  SELECT id, delivery_no, supplier_id, fruit_id, received_date, total_boxes, total_amount, note, status
    INTO v_delivery
    FROM public.stock_deliveries
   WHERE id = p_delivery_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock delivery not found.';
  END IF;

  IF v_delivery.status = 'cancelled' THEN
    RAISE EXCEPTION 'Delivery % is cancelled and cannot be edited.', v_delivery.delivery_no;
  END IF;

  IF v_delivery.status <> 'active' THEN
    RAISE EXCEPTION 'Delivery % is not active and cannot be edited.', v_delivery.delivery_no;
  END IF;

  -- Lock existing child batches in deterministic order
  PERFORM 1
    FROM public.stock_batches
   WHERE delivery_id = p_delivery_id
   ORDER BY id
     FOR UPDATE;

  -- Lock parent supplier payments associated with this delivery
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

  -- 4. Capture previous_items snapshot
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'batch_id', sb.id,
      'line_no', sb.line_no,
      'fruit_id', sb.fruit_id,
      'fruit_name', f.name,
      'variety_id', sb.variety_id,
      'variety_name', fv.name,
      'boxes_received', sb.boxes_received,
      'boxes_remaining', sb.boxes_remaining,
      'boxes_sold', (sb.boxes_received - sb.boxes_remaining),
      'purchase_rate', sb.purchase_rate,
      'purchase_amount', sb.purchase_amount
    ) ORDER BY sb.line_no
  ), '[]'::jsonb)
  INTO v_previous_items
  FROM public.stock_batches sb
  JOIN public.fruits f ON f.id = sb.fruit_id
  JOIN public.fruit_varieties fv ON fv.id = sb.variety_id
  WHERE sb.delivery_id = p_delivery_id;

  -- 5. Scan submitted items and build list of submitted batch IDs
  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
  LOOP
    IF jsonb_typeof(r.value) <> 'object' THEN
      RAISE EXCEPTION 'Invalid item format on line %.', r.ord;
    END IF;

    BEGIN
      v_item_batch_id := NULLIF(btrim(COALESCE(r.value ->> 'batch_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid batch ID on line %.', r.ord;
    END;

    IF v_item_batch_id IS NOT NULL THEN
      -- Verify this batch belongs to this delivery
      IF NOT EXISTS (
        SELECT 1 FROM public.stock_batches
         WHERE id = v_item_batch_id AND delivery_id = p_delivery_id
      ) THEN
        RAISE EXCEPTION 'Batch % on line % does not belong to delivery %.',
          v_item_batch_id, r.ord, v_delivery.delivery_no;
      END IF;

      -- Check for duplicates
      IF v_item_batch_id = ANY(v_submitted_batch_ids) THEN
        RAISE EXCEPTION 'Duplicate batch % submitted on line %.', v_item_batch_id, r.ord;
      END IF;

      v_submitted_batch_ids := array_append(v_submitted_batch_ids, v_item_batch_id);
    END IF;
  END LOOP;

  -- 6. Check existing batches: handle any removed batches
  FOR v_existing_batch IN
    SELECT sb.id, sb.line_no, sb.fruit_id, sb.variety_id, sb.boxes_received, sb.boxes_remaining,
           fv.name AS variety_name
      FROM public.stock_batches sb
      JOIN public.fruit_varieties fv ON fv.id = sb.variety_id
     WHERE sb.delivery_id = p_delivery_id
  LOOP
    IF NOT (v_existing_batch.id = ANY(v_submitted_batch_ids)) THEN
      -- Batch is omitted in p_items => User wants to delete this batch line
      -- Critical Historical Allocation Protection: check ANY allocation history
      IF EXISTS (
        SELECT 1 FROM public.bill_item_batch_allocations
         WHERE batch_id = v_existing_batch.id
      ) THEN
        RAISE EXCEPTION 'Cannot remove batch (line %, %) because historical sales allocations exist for it (even if the bill was later cancelled). Quantities may be corrected, but this batch cannot be deleted.',
          v_existing_batch.line_no, v_existing_batch.variety_name;
      END IF;

      -- Safe to delete since ZERO allocation history exists
      DELETE FROM public.stock_batches WHERE id = v_existing_batch.id;
    END IF;
  END LOOP;

  -- 7. Shift remaining existing batches to temporary line_no (10000 + line_no) to prevent unique constraint collisions
  UPDATE public.stock_batches
     SET line_no = 10000 + line_no
   WHERE delivery_id = p_delivery_id;

  -- 8. Process submitted items (updates for existing, inserts for new)
  FOR r IN
    SELECT e.ord, e.value
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    BEGIN
      v_item_batch_id := NULLIF(btrim(COALESCE(r.value ->> 'batch_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid batch ID on line %.', r.ord;
    END;

    BEGIN
      v_line_fruit_id := NULLIF(btrim(COALESCE(r.value ->> 'fruit_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid fruit ID on line %.', r.ord;
    END;

    IF v_line_fruit_id IS NULL THEN
      RAISE EXCEPTION 'Fruit category is required on line %.', r.ord;
    END IF;

    BEGIN
      v_variety_id := NULLIF(btrim(COALESCE(r.value ->> 'variety_id', '')), '')::uuid;
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

    -- Supplier registration validation (supplier_id is immutable)
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_fruits
       WHERE supplier_id = v_delivery.supplier_id
         AND fruit_id = v_line_fruit_id
    ) THEN
      RAISE EXCEPTION 'Supplier is not registered to supply % on line %.',
        (SELECT name FROM public.fruits WHERE id = v_line_fruit_id), r.ord;
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

    IF v_item_batch_id IS NOT NULL THEN
      -- Existing batch update
      SELECT sb.fruit_id, sb.variety_id, sb.boxes_received, sb.boxes_remaining, fv.name AS variety_name
        INTO v_existing_batch
        FROM public.stock_batches sb
        JOIN public.fruit_varieties fv ON fv.id = sb.variety_id
       WHERE sb.id = v_item_batch_id;

      v_sold_boxes := v_existing_batch.boxes_received - v_existing_batch.boxes_remaining;

      -- Check historical allocation protection for fruit/variety change
      SELECT EXISTS (
        SELECT 1 FROM public.bill_item_batch_allocations
         WHERE batch_id = v_item_batch_id
      ) INTO v_has_allocations;

      IF v_has_allocations THEN
        IF v_line_fruit_id <> v_existing_batch.fruit_id OR v_variety_id <> v_existing_batch.variety_id THEN
          RAISE EXCEPTION 'Cannot change fruit or variety for batch % (%) because historical bill allocations exist for it.',
            v_existing_batch.variety_name, v_item_batch_id;
        END IF;
      END IF;

      -- Quantity check: cannot reduce below active sold boxes
      IF v_boxes < v_sold_boxes THEN
        RAISE EXCEPTION 'Cannot reduce boxes received (% boxes) below active sold boxes (% boxes) for % (batch %).',
          v_boxes, v_sold_boxes, v_existing_batch.variety_name, v_item_batch_id;
      END IF;

      -- Update existing batch
      UPDATE public.stock_batches
         SET line_no = r.ord::integer,
             fruit_id = v_line_fruit_id,
             variety_id = v_variety_id,
             boxes_received = v_boxes,
             boxes_remaining = (v_boxes - v_sold_boxes),
             purchase_rate = v_rate
       WHERE id = v_item_batch_id;

    ELSE
      -- New batch line
      INSERT INTO public.stock_batches (
        delivery_id, line_no, fruit_id, variety_id,
        boxes_received, boxes_remaining, purchase_rate
      )
      VALUES (
        p_delivery_id, r.ord::integer, v_line_fruit_id, v_variety_id,
        v_boxes, v_boxes, v_rate
      );
    END IF;
  END LOOP;

  -- 9. Recalculate totals and header fruit_id
  SELECT
    COALESCE(SUM(boxes_received), 0)::integer,
    COALESCE(SUM(purchase_amount), 0)::numeric(12,2),
    COUNT(DISTINCT fruit_id)::integer,
    (array_agg(DISTINCT fruit_id))[1]
  INTO
    v_new_total_boxes,
    v_new_total_amount,
    v_distinct_fruits,
    v_first_fruit_id
  FROM public.stock_batches
  WHERE delivery_id = p_delivery_id;

  IF v_distinct_fruits = 1 THEN
    v_header_fruit_id := v_first_fruit_id;
  ELSE
    v_header_fruit_id := NULL;
  END IF;

  -- 10. Supplier Payment Protection
  SELECT COALESCE(SUM(spa.amount), 0)::numeric(12,2)
    INTO v_active_paid
    FROM public.supplier_payment_allocations spa
    JOIN public.supplier_payments sp ON sp.id = spa.supplier_payment_id
   WHERE spa.delivery_id = p_delivery_id
     AND spa.status = 'active'
     AND sp.status = 'active';

  IF v_new_total_amount < v_active_paid THEN
    RAISE EXCEPTION 'Corrected delivery purchase total (₹%) cannot be less than the amount already paid against this delivery (₹%). Please reallocate the excess payment or cancel the payment in the Payments tab before editing.',
      v_new_total_amount, v_active_paid;
  END IF;

  -- 11. Update delivery header
  UPDATE public.stock_deliveries
     SET total_boxes = v_new_total_boxes,
         total_amount = v_new_total_amount,
         fruit_id = v_header_fruit_id,
         note = NULLIF(btrim(p_note), '')
   WHERE id = p_delivery_id;

  -- 12. Capture new_items snapshot and insert audit log
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'batch_id', sb.id,
      'line_no', sb.line_no,
      'fruit_id', sb.fruit_id,
      'fruit_name', f.name,
      'variety_id', sb.variety_id,
      'variety_name', fv.name,
      'boxes_received', sb.boxes_received,
      'boxes_remaining', sb.boxes_remaining,
      'boxes_sold', (sb.boxes_received - sb.boxes_remaining),
      'purchase_rate', sb.purchase_rate,
      'purchase_amount', sb.purchase_amount
    ) ORDER BY sb.line_no
  ), '[]'::jsonb)
  INTO v_new_items
  FROM public.stock_batches sb
  JOIN public.fruits f ON f.id = sb.fruit_id
  JOIN public.fruit_varieties fv ON fv.id = sb.variety_id
  WHERE sb.delivery_id = p_delivery_id;

  INSERT INTO public.stock_delivery_corrections (
    delivery_id,
    delivery_no,
    corrected_by,
    correction_reason,
    previous_items,
    new_items,
    previous_total_boxes,
    new_total_boxes,
    previous_total_amount,
    new_total_amount
  )
  VALUES (
    p_delivery_id,
    v_delivery.delivery_no,
    v_corrected_by,
    v_reason,
    v_previous_items,
    v_new_items,
    v_delivery.total_boxes,
    v_new_total_boxes,
    v_delivery.total_amount,
    v_new_total_amount
  );

  RETURN jsonb_build_object(
    'delivery_id', p_delivery_id,
    'delivery_no', v_delivery.delivery_no,
    'total_boxes', v_new_total_boxes,
    'total_amount', v_new_total_amount,
    'amount_paid', v_active_paid,
    'outstanding_amount', (v_new_total_amount - v_active_paid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_stock_delivery(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_stock_delivery(uuid, jsonb, text, text) TO authenticated;

COMMIT;

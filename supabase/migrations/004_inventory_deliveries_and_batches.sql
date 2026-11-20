-- ============================================================================
-- Migration 004: Stock Deliveries & Delivery Variety Batches (Boxes Only)
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Yearly concurrency-safe delivery counter
-- ----------------------------------------------------------------------------
CREATE TABLE public.delivery_counters (
  year        integer PRIMARY KEY CHECK (year >= 2000),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

-- ----------------------------------------------------------------------------
-- 2. Stock deliveries (1 delivery = 1 supplier + 1 fruit category)
-- ----------------------------------------------------------------------------
CREATE TABLE public.stock_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_no     text NOT NULL UNIQUE CHECK (btrim(delivery_no) <> ''),
  supplier_id     uuid NOT NULL,
  fruit_id        uuid NOT NULL REFERENCES public.fruits(id),
  received_date   date NOT NULL DEFAULT public.shop_today(),
  total_boxes     integer NOT NULL DEFAULT 0 CHECK (total_boxes >= 0),
  total_amount    numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note            text NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at    timestamptz NULL,
  cancel_reason   text NULL,
  idempotency_key uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_deliveries_supplier_fruit_fkey
    FOREIGN KEY (supplier_id, fruit_id) REFERENCES public.suppliers(id, fruit_id),
  CONSTRAINT stock_deliveries_id_fruit_uidx UNIQUE (id, fruit_id),
  CONSTRAINT stock_deliveries_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX stock_deliveries_idempotency_uidx
  ON public.stock_deliveries (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX stock_deliveries_supplier_status_date_idx
  ON public.stock_deliveries (supplier_id, status, received_date);

CREATE INDEX stock_deliveries_date_status_idx
  ON public.stock_deliveries (received_date, status);

-- ----------------------------------------------------------------------------
-- 3. Stock batches (variety lines within a delivery — integer boxes only)
-- ----------------------------------------------------------------------------
CREATE TABLE public.stock_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid NOT NULL,
  line_no         integer NOT NULL CHECK (line_no > 0),
  fruit_id        uuid NOT NULL REFERENCES public.fruits(id),
  variety_id      uuid NOT NULL,
  boxes_received  integer NOT NULL CHECK (boxes_received > 0),
  boxes_remaining integer NOT NULL CHECK (boxes_remaining >= 0 AND boxes_remaining <= boxes_received),
  purchase_rate   numeric(12,2) NOT NULL CHECK (purchase_rate > 0),
  purchase_amount numeric(12,2) GENERATED ALWAYS AS (ROUND(boxes_received * purchase_rate, 2)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_batches_delivery_fruit_fkey
    FOREIGN KEY (delivery_id, fruit_id) REFERENCES public.stock_deliveries(id, fruit_id) ON DELETE CASCADE,
  CONSTRAINT stock_batches_variety_fruit_fkey
    FOREIGN KEY (variety_id, fruit_id) REFERENCES public.fruit_varieties(id, fruit_id),
  CONSTRAINT stock_batches_delivery_line_uidx UNIQUE (delivery_id, line_no),
  CONSTRAINT stock_batches_id_fruit_variety_uidx UNIQUE (id, fruit_id, variety_id)
);

CREATE INDEX stock_batches_delivery_idx
  ON public.stock_batches (delivery_id);

CREATE INDEX stock_batches_available_idx
  ON public.stock_batches (fruit_id, variety_id)
  WHERE boxes_remaining > 0;

COMMIT;

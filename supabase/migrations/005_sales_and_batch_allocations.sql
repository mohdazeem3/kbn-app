-- ============================================================================
-- Migration 005: Sales Bills, Commercial Bill Items & Manual Batch Allocations
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Yearly concurrency-safe bill counter
-- ----------------------------------------------------------------------------
CREATE TABLE public.bill_counters (
  year        integer PRIMARY KEY CHECK (year >= 2000),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

-- ----------------------------------------------------------------------------
-- 2. Bills (pure commercial invoice — all receipts live in customer_payments)
--    customer_id IS NULL represents the special walk-in Cash Customer.
-- ----------------------------------------------------------------------------
CREATE TABLE public.bills (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no                text NOT NULL UNIQUE CHECK (btrim(bill_no) <> ''),
  customer_id            uuid NULL REFERENCES public.customers(id),
  customer_name_snapshot text NOT NULL CHECK (btrim(customer_name_snapshot) <> ''),
  bill_date              date NOT NULL DEFAULT public.shop_today(),
  subtotal               numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  note                   text NULL,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at           timestamptz NULL,
  cancel_reason          text NULL,
  idempotency_key        uuid NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bills_cancel_consistency_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX bills_idempotency_uidx
  ON public.bills (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX bills_date_status_idx
  ON public.bills (bill_date, status);

CREATE INDEX bills_customer_status_idx
  ON public.bills (customer_id, status)
  WHERE customer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Bill items (commercial fruit+variety lines printed on the bill)
-- ----------------------------------------------------------------------------
CREATE TABLE public.bill_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id               uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  line_no               integer NOT NULL CHECK (line_no > 0),
  fruit_id              uuid NOT NULL REFERENCES public.fruits(id),
  variety_id            uuid NOT NULL,
  fruit_name_snapshot   text NOT NULL CHECK (btrim(fruit_name_snapshot) <> ''),
  variety_name_snapshot text NOT NULL CHECK (btrim(variety_name_snapshot) <> ''),
  boxes                 integer NOT NULL CHECK (boxes > 0),
  sell_rate             numeric(12,2) NOT NULL CHECK (sell_rate > 0),
  line_total            numeric(12,2) GENERATED ALWAYS AS (ROUND(boxes * sell_rate, 2)) STORED,
  CONSTRAINT bill_items_variety_fruit_fkey
    FOREIGN KEY (variety_id, fruit_id) REFERENCES public.fruit_varieties(id, fruit_id),
  CONSTRAINT bill_items_bill_line_uidx UNIQUE (bill_id, line_no),
  CONSTRAINT bill_items_id_fruit_variety_uidx UNIQUE (id, fruit_id, variety_id)
);

CREATE INDEX bill_items_bill_idx
  ON public.bill_items (bill_id);

CREATE INDEX bill_items_fruit_variety_idx
  ON public.bill_items (fruit_id, variety_id);

-- ----------------------------------------------------------------------------
-- 4. Manual stock batch allocations per sale line (no automatic FIFO)
-- ----------------------------------------------------------------------------
CREATE TABLE public.bill_item_batch_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_item_id uuid NOT NULL,
  batch_id     uuid NOT NULL,
  fruit_id     uuid NOT NULL,
  variety_id   uuid NOT NULL,
  boxes        integer NOT NULL CHECK (boxes > 0),
  CONSTRAINT biba_item_fkey
    FOREIGN KEY (bill_item_id, fruit_id, variety_id)
    REFERENCES public.bill_items(id, fruit_id, variety_id) ON DELETE CASCADE,
  CONSTRAINT biba_batch_fkey
    FOREIGN KEY (batch_id, fruit_id, variety_id)
    REFERENCES public.stock_batches(id, fruit_id, variety_id),
  CONSTRAINT biba_item_batch_uidx UNIQUE (bill_item_id, batch_id)
);

CREATE INDEX biba_batch_idx
  ON public.bill_item_batch_allocations (batch_id);

COMMIT;

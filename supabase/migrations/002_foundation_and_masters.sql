-- ============================================================================
-- Migration 002: Shop Foundation, Auth Helper & Master Catalog Tables
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Single-row shop profile (standalone single-shop architecture)
-- ----------------------------------------------------------------------------
CREATE TABLE public.shop_profile (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  name            text NOT NULL DEFAULT 'FruitWholesale Manager' CHECK (btrim(name) <> ''),
  phone           text NULL,
  address         text NULL,
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (btrim(timezone) <> ''),
  bill_prefix     text NOT NULL DEFAULT 'INV' CHECK (btrim(bill_prefix) <> ''),
  delivery_prefix text NOT NULL DEFAULT 'DEL' CHECK (btrim(delivery_prefix) <> ''),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Authorized user whitelist (compatible with existing Supabase Auth login)
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Core helper functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_authorized_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid()
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.shop_today()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    now() AT TIME ZONE COALESCE(
      (SELECT timezone FROM public.shop_profile WHERE id = true),
      'Asia/Kolkata'
    )
  )::date;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Master table: fruits (dynamic fruit categories — zero hardcoded fruits)
-- ----------------------------------------------------------------------------
CREATE TABLE public.fruits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fruits_name_lower_uidx
  ON public.fruits (lower(btrim(name)));

CREATE INDEX fruits_active_idx
  ON public.fruits (active);

-- ----------------------------------------------------------------------------
-- 5. Master table: fruit_varieties (varieties/grades belonging to one fruit)
-- ----------------------------------------------------------------------------
CREATE TABLE public.fruit_varieties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fruit_id          uuid NOT NULL REFERENCES public.fruits(id),
  name              text NOT NULL CHECK (btrim(name) <> ''),
  default_sell_rate numeric(12,2) NULL CHECK (default_sell_rate IS NULL OR default_sell_rate > 0),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fruit_varieties_id_fruit_uidx UNIQUE (id, fruit_id)
);

CREATE UNIQUE INDEX fruit_varieties_fruit_name_lower_uidx
  ON public.fruit_varieties (fruit_id, lower(btrim(name)));

CREATE INDEX fruit_varieties_fruit_active_idx
  ON public.fruit_varieties (fruit_id, active);

-- ----------------------------------------------------------------------------
-- 6. Master table: suppliers (each supplier supplies one fruit category)
-- ----------------------------------------------------------------------------
CREATE TABLE public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  fruit_id   uuid NOT NULL REFERENCES public.fruits(id),
  phone      text NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_id_fruit_uidx UNIQUE (id, fruit_id)
);

CREATE UNIQUE INDEX suppliers_name_lower_uidx
  ON public.suppliers (lower(btrim(name)));

CREATE INDEX suppliers_fruit_active_idx
  ON public.suppliers (fruit_id, active);

-- ----------------------------------------------------------------------------
-- 7. Master table: customers (registered buyers; Cash Customer uses NULL FK)
-- ----------------------------------------------------------------------------
CREATE TABLE public.customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  phone      text NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customers_name_lower_uidx
  ON public.customers (lower(btrim(name)));

CREATE INDEX customers_active_idx
  ON public.customers (active);

-- ----------------------------------------------------------------------------
-- 8. updated_at triggers on master tables
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_shop_profile_updated_at
  BEFORE UPDATE ON public.shop_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_fruits_updated_at
  BEFORE UPDATE ON public.fruits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_fruit_varieties_updated_at
  BEFORE UPDATE ON public.fruit_varieties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- ============================================================================
-- Migration 001: Reset Legacy Public Schema (DESTRUCTIVE — REVIEW BEFORE RUNNING)
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================
-- CONFIRMED DATA MIGRATION POLICY:
-- - NEVER drops, deletes, or modifies auth.users or any Supabase Auth object.
--   (Dropping child table public.profiles NEVER cascades to parent auth.users.)
-- - Legacy shops, suppliers, products, and customers are intentionally NOT migrated.
--
-- IMPORTANT PRE-EXECUTION STEP:
-- Before running this script, capture ONLY the existing admin user_id:
--   SELECT p.user_id, u.email
--     FROM public.profiles p
--     JOIN auth.users u ON u.id = p.user_id;
-- Paste that exact user_id into Migration 009 so your existing Supabase Auth
-- login is immediately re-authorized in the new public.profiles table.
-- ============================================================================

BEGIN;

-- 1. Drop legacy views
DROP VIEW IF EXISTS public.customer_balances CASCADE;

-- 2. Drop legacy triggers
DROP TRIGGER IF EXISTS trg_set_batch_remaining ON public.stock_batches;

-- 3. Drop legacy functions (exact signatures)
DROP FUNCTION IF EXISTS public.create_bill(uuid, date, jsonb, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_bill(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.add_payment(uuid, numeric, text, date, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_batch_remaining() CASCADE;
DROP FUNCTION IF EXISTS public.current_shop_id() CASCADE;

-- 4. Drop legacy tables in reverse dependency order
DROP TABLE IF EXISTS public.bill_items CASCADE;
DROP TABLE IF EXISTS public.bills CASCADE;
DROP TABLE IF EXISTS public.bill_counters CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.stock_batches CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.shops CASCADE;

COMMIT;

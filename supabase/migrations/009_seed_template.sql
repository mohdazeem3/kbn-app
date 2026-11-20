-- ============================================================================
-- Migration 009: Post-Rebuild Bootstrap Seed (REVIEW & FILL ADMIN UUID BEFORE RUN)
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================
-- CONFIRMED DATA MIGRATION POLICY:
-- 1. Initializes ONE fresh public.shop_profile row using schema defaults only
--    (does NOT copy legacy public.shops data).
-- 2. Re-authorizes ONLY the existing Supabase Auth admin user_id in
--    public.profiles without creating, deleting, or modifying auth.users.
-- 3. Leaves all new master tables (fruits, fruit_varieties, suppliers,
--    customers) completely empty.
--
-- BEFORE RUNNING:
-- Replace <EXISTING_ADMIN_USER_ID> below with the exact UUID captured from
-- public.profiles / auth.users prior to running Migration 001.
-- ============================================================================

BEGIN;

-- 1. Create fresh single-row shop_profile strictly from new schema defaults
INSERT INTO public.shop_profile DEFAULT VALUES
ON CONFLICT (id) DO NOTHING;

-- 2. Link existing Supabase Auth admin user_id into new public.profiles
DO $$
DECLARE
  v_admin_user_id uuid := '58cc5c05-d1ab-4baa-84e0-99d6946dcf70'::uuid;
BEGIN
  -- Safety guard: verify the existing auth.users account is present and untouched
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin_user_id) THEN
    RAISE EXCEPTION 'Existing Supabase Auth user % not found in auth.users. Aborting bootstrap.', v_admin_user_id;
  END IF;

  INSERT INTO public.profiles (user_id, full_name, active)
  VALUES (v_admin_user_id, 'Admin', true)
  ON CONFLICT (user_id) DO UPDATE
    SET active = true;
END;
$$;

COMMIT;

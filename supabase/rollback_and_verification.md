# Rollback Strategy & Pre/Post-Execution Verification Checklist
**Target Project:** FruitWholesale Manager (`xqtzcuydgsmadcauuiee`)  
**Status:** Reviewable documentation only — **do not execute until explicitly approved**.

---

## 1. Pre-Execution Backup & Safety Steps (Before Running Migration 001)

> **Confirmed Data Migration Decision:**  
> Preserve **ONLY** the existing admin's Supabase Auth account (`auth.users.id`). Do **not** migrate legacy `shops`, `suppliers`, `products`, or `customers`. Create a fresh `shop_profile` row using schema defaults, and start all new master tables completely empty.

1. **Verify Target Project**:
   - Confirm MCP / SQL Editor is connected strictly to **`https://xqtzcuydgsmadcauuiee.supabase.co`** (NEVER Taha Media CRM `eoxqivrmoecbfzyygryb`).
2. **Take an External Backup / Check Backup Availability**:
   - **Important:** Supabase Free-tier projects do **not** include automated daily Dashboard backups or Point-in-Time Recovery (PITR). Automated backups require a Pro or higher plan, and PITR requires the PITR add-on.
   - If you want the ability to restore the legacy schema/rows after running `001_reset_legacy_schema.sql`, take a manual external `pg_dump` (or verify a paid Supabase backup/PITR snapshot exists) **before** running `001`.
3. **Capture ONLY the Existing Admin `user_id`** *(needed for `009_seed_template.sql`; do NOT modify `auth.users`)*:
   ```sql
   SELECT p.user_id, u.email, u.created_at
     FROM public.profiles p
     JOIN auth.users u ON u.id = p.user_id;
   ```
   - Verify there is an exact match in `auth.users` and substitute that exact UUID into `009_seed_template.sql` (line 27) **before** starting `001`–`009`.
4. **Verify Zero Legacy Transactions Exist** *(previously inspected as 0 rows in `stock_batches`, `bills`, `bill_items`, `payments`)*:
   ```sql
   SELECT
     (SELECT count(*) FROM public.stock_batches) AS stock_batches,
     (SELECT count(*) FROM public.bills)         AS bills,
     (SELECT count(*) FROM public.payments)      AS payments;
   ```
   If any count is `> 0`, STOP and archive those records before running `001_reset_legacy_schema.sql`.
5. **Confirm Migration 001 Safety**:
   - Confirm `001_reset_legacy_schema.sql` only drops objects in the `public` schema and never drops, deletes, or alters `auth.users`.
   - Execute `001` through `009` consecutively so the admin's `public.profiles` authorization row is restored immediately after `001`.

---

## 2. Rollback Strategy (What Can vs. Cannot Be Restored)

### What CAN Be Restored
- **Existing Supabase Auth Account (`auth.users`)**: Never dropped or modified by `001`–`009` or by Option B teardown; your admin email, password, and UUID remain intact throughout.
- **Clean Rebuild of the New Schema (`002`–`009`)**: If an issue is discovered during initial setup (before live business entries are recorded), running **Option B** below cleanly removes all 21 new tables, 6 views, and 18 functions so migrations `002`–`009` can be adjusted and re-run from a clean `public` schema.
- **Pre-Rebuild Legacy State (ONLY if backed up externally or on a paid backup plan)**: Restorable **only** if you took a manual `pg_dump` before running `001`, or if your Supabase project is on a paid plan with a verified pre-migration Dashboard backup / PITR snapshot.

### What CANNOT Be Restored Without a Prior Backup
- **Dropped Legacy `public.*` Tables (`001_reset_legacy_schema.sql`)**: Once `001` commits without a prior `pg_dump` or paid Supabase backup, the legacy `shops`, `profiles`, `suppliers` (3 rows), `products` (6 rows), `customers` (5 rows), and legacy schema definitions **cannot** be recovered. Option B does **not** bring back legacy tables — it resets `public` to an empty schema.
- **Post-Go-Live Business Data**: Never run Option B after real deliveries, bills, or payments have been entered unless you intend to wipe all business data or have an external backup.

### Option A: Restore From External `pg_dump` or Paid Supabase Backup *(Only Way to Recover Legacy Tables After `001`)*
- Restore using your pre-migration `pg_dump` file, or (on Pro+ / PITR-enabled Supabase plans only) restore from **Supabase Dashboard → Database → Backups**.

### Option B: Clean Teardown of the New Schema *(Pre-Go-Live Rollback of `002`–`009` Only)*
Run inside a single transaction to drop all new views, functions, triggers, and tables cleanly in reverse dependency order:

```sql
BEGIN;

-- 1. Drop views
DROP VIEW IF EXISTS public.dashboard_overview CASCADE;
DROP VIEW IF EXISTS public.supplier_balances CASCADE;
DROP VIEW IF EXISTS public.delivery_balances CASCADE;
DROP VIEW IF EXISTS public.customer_balances CASCADE;
DROP VIEW IF EXISTS public.bill_balances CASCADE;
DROP VIEW IF EXISTS public.available_stock_batches CASCADE;

-- 2. Drop RPCs & helper functions
DROP FUNCTION IF EXISTS public.cancel_supplier_opening_balance(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_supplier_opening_balance(uuid, numeric, date, text) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_customer_opening_balance(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_customer_opening_balance(uuid, numeric, date, text) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_supplier_payment(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.reallocate_supplier_payment_allocation(uuid, jsonb, text) CASCADE;
DROP FUNCTION IF EXISTS public.add_supplier_payment(uuid, numeric, text, date, jsonb, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_customer_payment(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.add_customer_payment(uuid, numeric, text, date, jsonb, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_bill(uuid, text, text, date, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_bill(uuid, date, jsonb, numeric, numeric, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_stock_delivery(uuid, text, text, date, text) CASCADE;
DROP FUNCTION IF EXISTS public.receive_stock_delivery(uuid, uuid, date, jsonb, text, numeric, numeric, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.validate_supplier_payment_allocation() CASCADE;
DROP FUNCTION IF EXISTS public.validate_customer_payment_allocation() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.shop_today() CASCADE;
DROP FUNCTION IF EXISTS public.is_authorized_user() CASCADE;

-- 3. Drop tables in reverse dependency order
DROP TABLE IF EXISTS public.supplier_payment_allocations CASCADE;
DROP TABLE IF EXISTS public.supplier_refunds CASCADE;
DROP TABLE IF EXISTS public.supplier_payments CASCADE;
DROP TABLE IF EXISTS public.customer_payment_allocations CASCADE;
DROP TABLE IF EXISTS public.customer_refunds CASCADE;
DROP TABLE IF EXISTS public.customer_payments CASCADE;
DROP TABLE IF EXISTS public.bill_item_batch_allocations CASCADE;
DROP TABLE IF EXISTS public.bill_items CASCADE;
DROP TABLE IF EXISTS public.bills CASCADE;
DROP TABLE IF EXISTS public.bill_counters CASCADE;
DROP TABLE IF EXISTS public.stock_batches CASCADE;
DROP TABLE IF EXISTS public.stock_deliveries CASCADE;
DROP TABLE IF EXISTS public.delivery_counters CASCADE;
DROP TABLE IF EXISTS public.supplier_opening_balances CASCADE;
DROP TABLE IF EXISTS public.customer_opening_balances CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.fruit_varieties CASCADE;
DROP TABLE IF EXISTS public.fruits CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.shop_profile CASCADE;

COMMIT;
```

### Partial Failure Safety
- Every migration file (`001` through `009`) is wrapped in an explicit `BEGIN; ... COMMIT;` transaction block, so if any single migration fails mid-way, PostgreSQL rolls back that entire file automatically without leaving half-applied state.

---

## 3. Post-Execution Verification Checklist

Run these checks after executing migrations `001`–`009` (when approved):

### A. Schema & Security Verification
- [ ] **Table count**: Exactly 21 tables exist in `public`, and `relrowsecurity = true` on all 21.
- [ ] **View security**: All 6 views (`available_stock_batches`, `bill_balances`, `customer_balances`, `delivery_balances`, `supplier_balances`, `dashboard_overview`) have `security_invoker = true`.
- [ ] **Function security**: All 13 RPCs + `is_authorized_user()` + `shop_today()` have `SET search_path = 'public'`, zero `PUBLIC`/`anon` `EXECUTE` grants, and `authenticated` `EXECUTE` only.
- [ ] **Supabase Security Advisor**: `get_advisors(type: 'security')` reports zero mutable `search_path` warnings (`0011`) and zero `anon` executable `SECURITY DEFINER` warnings (`0028`).
- [ ] **No `DELETE` RLS policies**: Confirmed zero `DELETE` policies across all 21 tables.
- [ ] **Existing Admin Auth Preserved**: Confirm the existing admin row in `auth.users` is completely unchanged (same `id`, `email`, `created_at`) and `public.profiles` contains exactly 1 row matching that `user_id` with `active = true`.
- [ ] **Fresh `shop_profile` Defaults**: Confirm `public.shop_profile` contains exactly 1 row with schema defaults (`name = 'FruitWholesale Manager'`, `phone IS NULL`, `address IS NULL`, `timezone = 'Asia/Kolkata'`, `bill_prefix = 'INV'`, `delivery_prefix = 'DEL'`).
- [ ] **Clean Empty Master Tables**: Confirm `fruits`, `fruit_varieties`, `suppliers`, and `customers` each have **0 rows** (no legacy data migrated).
- [ ] **Admin Login Verification**: Existing admin signs in through `LoginPage.tsx`; `is_authorized_user()` returns `true` and `shop_profile` loads.

### B. Functional & Data-Integrity Smoke Tests (In a Rollback Transaction or Test Seed)
- [ ] **Dynamic Catalogs & Supplier-Fruit Constraint**: Adding a variety to Fruit A and a supplier to Fruit B cannot be combined into a delivery for Fruit A (rejected by RPC and composite FK).
- [ ] **Boxes-Only Validation**: Passing decimal `"2.5"` boxes or `0` purchase rate to `receive_stock_delivery()` is rejected cleanly.
- [ ] **Manual Multi-Batch Sale**: Selling 15 boxes across Batch 1 (10) + Batch 2 (5) deducts both batches atomically; attempting to sell 1 box over remaining stock rolls back the entire bill & bill counter.
- [ ] **Cash Customer Enforcement**: Creating a `customer_id = NULL` bill with partial payment is rejected; creating one paid in full records `customer_payments (payment_origin = 'bill_sale')` and shows `0` outstanding.
- [ ] **Unified Dashboard Zero Double-Counting**:
  - Cash bill of ₹1,000 + credit bill of ₹2,000 + ₹500 UPI collection on an older bill → `today_sales_total = ₹3,000`, `today_cash_received = ₹1,000`, `today_upi_received = ₹500`.
- [ ] **Bill Cancellation & Refund**: Cancelling a paid bill without `p_refund_mode` is blocked; cancelling with `p_refund_mode = 'cash'` restores stock, creates `customer_refunds`, preserves original `customer_payments`, marks only that bill's allocation `'refunded'`, and leaves unrelated bills in a multi-bill payment untouched.
- [ ] **Delivery Cancellation & Supplier Payment Reallocation**:
  - Delivery with sold stock cannot be cancelled until affected bill is cancelled.
  - Multi-delivery supplier payment (`DEL-1` + `DEL-2`): calling `reallocate_supplier_payment_allocation()` moves `DEL-1`'s slice to `DEL-3` while keeping `DEL-2` active, allowing `DEL-1` to cancel cleanly.
  - Calling `cancel_stock_delivery()` with `p_refund_mode` on a paid unsold delivery records `supplier_refunds`, marks only that delivery's allocation `'refunded'`, and reconciles `supplier_balances` to the exact rupee.
- [ ] **Opening Balances**: Recording opening balances for a customer and supplier appears in `customer_balances` / `supplier_balances` and `dashboard_overview` (`total_customer_dues` / `total_supplier_dues`) WITHOUT affecting `today_sales_total` or `deliveries_total`, and accepts explicit partial/full payment allocations.
- [ ] **Idempotency & Double-Cancellation**: Re-submitting the same `p_idempotency_key` returns the existing ID without creating duplicates; calling any `cancel_*` RPC twice rejects the second call cleanly.

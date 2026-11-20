-- ============================================================================
-- Migration 007: Row Level Security (All 21 Tables) & Reporting Views
-- Target Project: FruitWholesale Manager (xqtzcuydgsmadcauuiee)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Enable RLS on all 21 public tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.shop_profile                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fruits                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fruit_varieties              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_opening_balances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_opening_balances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_counters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_deliveries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_counters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_item_batch_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_refunds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_refunds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. RLS Policies (authenticated authorized user ONLY; anon has ZERO access)
--    No DELETE policies exist on any table to protect historical audit trails.
-- ----------------------------------------------------------------------------

-- profiles: read own active row only
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND active = true);

-- shop_profile: read & update only (single-row enforced by PK CHECK)
CREATE POLICY shop_profile_select ON public.shop_profile
  FOR SELECT TO authenticated
  USING (public.is_authorized_user());

CREATE POLICY shop_profile_update ON public.shop_profile
  FOR UPDATE TO authenticated
  USING (public.is_authorized_user())
  WITH CHECK (public.is_authorized_user());

-- Master catalogs & parties: SELECT, INSERT, UPDATE only (soft-deactivate via active=false)
CREATE POLICY fruits_select ON public.fruits
  FOR SELECT TO authenticated USING (public.is_authorized_user());
CREATE POLICY fruits_insert ON public.fruits
  FOR INSERT TO authenticated WITH CHECK (public.is_authorized_user());
CREATE POLICY fruits_update ON public.fruits
  FOR UPDATE TO authenticated USING (public.is_authorized_user()) WITH CHECK (public.is_authorized_user());

CREATE POLICY fruit_varieties_select ON public.fruit_varieties
  FOR SELECT TO authenticated USING (public.is_authorized_user());
CREATE POLICY fruit_varieties_insert ON public.fruit_varieties
  FOR INSERT TO authenticated WITH CHECK (public.is_authorized_user());
CREATE POLICY fruit_varieties_update ON public.fruit_varieties
  FOR UPDATE TO authenticated USING (public.is_authorized_user()) WITH CHECK (public.is_authorized_user());

CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT TO authenticated USING (public.is_authorized_user());
CREATE POLICY suppliers_insert ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (public.is_authorized_user());
CREATE POLICY suppliers_update ON public.suppliers
  FOR UPDATE TO authenticated USING (public.is_authorized_user()) WITH CHECK (public.is_authorized_user());

CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated USING (public.is_authorized_user());
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.is_authorized_user());
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated USING (public.is_authorized_user()) WITH CHECK (public.is_authorized_user());

-- Transactional & financial tables: SELECT only (all writes strictly via RPCs)
CREATE POLICY cob_select ON public.customer_opening_balances
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY sob_select ON public.supplier_opening_balances
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY stock_deliveries_select ON public.stock_deliveries
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY stock_batches_select ON public.stock_batches
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY bills_select ON public.bills
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY bill_items_select ON public.bill_items
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY biba_select ON public.bill_item_batch_allocations
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY customer_payments_select ON public.customer_payments
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY customer_refunds_select ON public.customer_refunds
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY cpa_select ON public.customer_payment_allocations
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY supplier_payments_select ON public.supplier_payments
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY supplier_refunds_select ON public.supplier_refunds
  FOR SELECT TO authenticated USING (public.is_authorized_user());

CREATE POLICY spa_select ON public.supplier_payment_allocations
  FOR SELECT TO authenticated USING (public.is_authorized_user());

-- delivery_counters & bill_counters intentionally have ZERO policies (RPC-internal only)

-- ----------------------------------------------------------------------------
-- 3. Views (all WITH (security_invoker = true) — anti-Cartesian CTE aggregation)
-- ----------------------------------------------------------------------------

-- 3.1 Stock batches (active deliveries) for Stock screen & New Sale manual batch picker
CREATE OR REPLACE VIEW public.available_stock_batches
WITH (security_invoker = true) AS
SELECT
  sb.id                                        AS batch_id,
  sb.delivery_id,
  sd.delivery_no,
  sd.received_date,
  sb.line_no,
  sb.fruit_id,
  f.name                                       AS fruit_name,
  sb.variety_id,
  fv.name                                      AS variety_name,
  fv.default_sell_rate,
  sd.supplier_id,
  s.name                                       AS supplier_name,
  s.active                                     AS supplier_active,
  sb.boxes_received,
  sb.boxes_remaining,
  (sb.boxes_received - sb.boxes_remaining)     AS boxes_sold,
  sb.purchase_rate,
  sb.purchase_amount,
  ROUND(sb.boxes_remaining * sb.purchase_rate, 2) AS remaining_stock_value,
  sd.note                                      AS delivery_note,
  sb.created_at
FROM public.stock_batches sb
JOIN public.stock_deliveries sd ON sd.id = sb.delivery_id
JOIN public.fruits f            ON f.id  = sb.fruit_id
JOIN public.fruit_varieties fv  ON fv.id = sb.variety_id
JOIN public.suppliers s         ON s.id  = sd.supplier_id
WHERE sd.status = 'active';

-- 3.2 Bill-wise balances (paid & outstanding derived strictly from active allocations)
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
)
SELECT
  b.id                                                               AS bill_id,
  b.bill_no,
  b.customer_id,
  (b.customer_id IS NULL)                                            AS is_cash_customer,
  b.customer_name_snapshot,
  b.bill_date,
  b.subtotal,
  COALESCE(bp.amount_paid, 0)::numeric(12,2)                         AS amount_paid,
  CASE
    WHEN b.status = 'active'
      THEN (b.subtotal - COALESCE(bp.amount_paid, 0))::numeric(12,2)
    ELSE 0::numeric(12,2)
  END                                                                AS outstanding_amount,
  CASE
    WHEN b.status = 'cancelled'                          THEN 'cancelled'
    WHEN COALESCE(bp.amount_paid, 0) >= b.subtotal       THEN 'paid'
    WHEN COALESCE(bp.amount_paid, 0) = 0                 THEN 'unpaid'
    ELSE 'partial'
  END                                                                AS payment_status,
  b.status,
  b.cancelled_at,
  b.cancel_reason,
  b.note,
  b.created_at
FROM public.bills b
LEFT JOIN bill_paid bp ON bp.bill_id = b.id;

-- 3.3 Customer-wise balances (opening balances & bills cleanly separated)
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
    COALESCE(SUM(bb.subtotal), 0)::numeric(12,2)           AS bills_total,
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

-- 3.4 Delivery-wise balances (purchase amount, paid & outstanding per delivery)
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
)
SELECT
  sd.id                                                                 AS delivery_id,
  sd.delivery_no,
  sd.supplier_id,
  s.name                                                                AS supplier_name,
  s.active                                                              AS supplier_active,
  sd.fruit_id,
  f.name                                                                AS fruit_name,
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
  sd.created_at
FROM public.stock_deliveries sd
JOIN public.suppliers s       ON s.id = sd.supplier_id
JOIN public.fruits f          ON f.id = sd.fruit_id
LEFT JOIN delivery_paid dp    ON dp.delivery_id = sd.id
LEFT JOIN delivery_stock ds   ON ds.delivery_id = sd.id;

-- 3.5 Supplier-wise balances (opening balances & deliveries cleanly separated)
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
)
SELECT
  s.id                                                                             AS supplier_id,
  s.name,
  s.phone,
  s.fruit_id,
  f.name                                                                           AS fruit_name,
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
  )::numeric(12,2)                                                                 AS outstanding_balance
FROM public.suppliers s
JOIN public.fruits f        ON f.id = s.fruit_id
LEFT JOIN ob_agg ob         ON ob.supplier_id = s.id
LEFT JOIN del_agg da        ON da.supplier_id = s.id;

-- 3.6 Dashboard overview (strictly aligned to confirmed 2-card design + shop timezone)
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
  -- Card 1: Today's Sales + click breakdown (all active receipts today)
  st.today_bills_count,
  st.today_sales_total,
  rt.today_cash_received,
  rt.today_upi_received,
  rf.today_cash_refunded,
  rf.today_upi_refunded,
  (rt.today_cash_received - rf.today_cash_refunded)::numeric(12,2)         AS today_net_cash_received,
  (rt.today_upi_received  - rf.today_upi_refunded)::numeric(12,2)          AS today_net_upi_received,
  -- Card 2: Outstanding Dues (Customer Dues & Supplier Dues)
  cd.total_customer_dues,
  sd.total_supplier_dues
FROM d, sales_today st, receipts_today rt, refunds_today rf, cust_dues cd, supp_dues sd;

-- ----------------------------------------------------------------------------
-- 4. Explicit Least-Privilege Table & View Grants (overrides Supabase defaults)
--    PUBLIC and anon receive ZERO privileges on any table or view.
--    authenticated receives strictly the privileges matching the RLS matrix.
--    SECURITY DEFINER RPCs (owned by postgres) retain full internal write access.
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.shop_profile,
  public.profiles,
  public.fruits,
  public.fruit_varieties,
  public.suppliers,
  public.customers,
  public.customer_opening_balances,
  public.supplier_opening_balances,
  public.delivery_counters,
  public.stock_deliveries,
  public.stock_batches,
  public.bill_counters,
  public.bills,
  public.bill_items,
  public.bill_item_batch_allocations,
  public.customer_payments,
  public.customer_refunds,
  public.customer_payment_allocations,
  public.supplier_payments,
  public.supplier_refunds,
  public.supplier_payment_allocations,
  public.available_stock_batches,
  public.bill_balances,
  public.customer_balances,
  public.delivery_balances,
  public.supplier_balances,
  public.dashboard_overview
FROM PUBLIC, anon, authenticated;

-- Admin profile: read-only
GRANT SELECT ON TABLE
  public.profiles
TO authenticated;

-- Shop profile: read & update only
GRANT SELECT, UPDATE ON TABLE
  public.shop_profile
TO authenticated;

-- Master tables: read, insert, update only (no DELETE)
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.fruits,
  public.fruit_varieties,
  public.suppliers,
  public.customers
TO authenticated;

-- Financial/transactional tables & reporting views: read-only (writes via RPCs)
-- Note: delivery_counters and bill_counters intentionally receive ZERO grants.
GRANT SELECT ON TABLE
  public.customer_opening_balances,
  public.supplier_opening_balances,
  public.stock_deliveries,
  public.stock_batches,
  public.bills,
  public.bill_items,
  public.bill_item_batch_allocations,
  public.customer_payments,
  public.customer_refunds,
  public.customer_payment_allocations,
  public.supplier_payments,
  public.supplier_refunds,
  public.supplier_payment_allocations,
  public.available_stock_batches,
  public.bill_balances,
  public.customer_balances,
  public.delivery_balances,
  public.supplier_balances,
  public.dashboard_overview
TO authenticated;

COMMIT;

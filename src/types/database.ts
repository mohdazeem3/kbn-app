export interface Fruit {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FruitInput {
  name: string;
}

export interface FruitVariety {
  id: string;
  fruit_id: string;
  name: string;
  default_sell_rate: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FruitVarietyInput {
  fruit_id: string;
  name: string;
  default_sell_rate: number | null;
}

export interface Supplier {
  id: string;
  name: string;
  fruit_id: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierFruitLink {
  fruit_id: string;
  fruit_name: string;
  fruit_active: boolean;
}

export interface SupplierWithFruit extends Supplier {
  fruit_name: string;
  fruit_active: boolean;
  fruit_ids: string[];
  fruits?: SupplierFruitLink[];
}

export interface SupplierInput {
  name: string;
  fruit_ids: string[];
  fruit_id?: string | null;
  phone: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'cancelled';

export interface ReceiveStockItemInput {
  fruit_id: string;
  variety_id: string;
  boxes: number;
  purchase_rate: number;
}

export interface ReceiveStockDeliveryInput {
  supplier_id: string;
  fruit_id?: string | null;
  received_date: string;
  items: ReceiveStockItemInput[];
  note: string | null;
  paid_cash: number;
  paid_upi: number;
  payment_note: string | null;
  idempotency_key: string;
}

export interface EditStockBatchItemInput {
  batch_id?: string | null;
  fruit_id: string;
  variety_id: string;
  boxes: number;
  purchase_rate: number;
}

export interface EditStockDeliveryInput {
  delivery_id: string;
  items: EditStockBatchItemInput[];
  note?: string | null;
  correction_reason: string;
}

export interface EditStockDeliveryResult {
  delivery_id: string;
  delivery_no: string;
  total_boxes: number;
  total_amount: number;
  amount_paid: number;
  outstanding_amount: number;
}

export interface DeliveryBatchDetail {
  id: string;
  delivery_id: string;
  line_no: number;
  fruit_id: string;
  fruit_name: string;
  variety_id: string;
  variety_name: string;
  boxes_received: number;
  boxes_remaining: number;
  boxes_sold: number;
  purchase_rate: number;
  purchase_amount: number;
  has_allocations: boolean;
}

export interface DeliveryDetailWithBatches {
  delivery: DeliveryBalance;
  batches: DeliveryBatchDetail[];
  amount_paid: number;
}

export interface StockDeliveryCorrection {
  id: string;
  delivery_id: string;
  delivery_no: string;
  corrected_by: string;
  correction_reason: string;
  previous_items: unknown[];
  new_items: unknown[];
  previous_total_boxes: number;
  new_total_boxes: number;
  previous_total_amount: number;
  new_total_amount: number;
  created_at: string;
}

export interface AvailableStockBatch {
  batch_id: string;
  delivery_id: string;
  delivery_no: string;
  received_date: string;
  line_no: number;
  fruit_id: string;
  fruit_name: string;
  variety_id: string;
  variety_name: string;
  default_sell_rate: number | null;
  supplier_id: string;
  supplier_name: string;
  supplier_active: boolean;
  boxes_received: number;
  boxes_remaining: number;
  boxes_sold: number;
  purchase_rate: number;
  purchase_amount: number;
  remaining_stock_value: number;
  delivery_note: string | null;
  created_at: string;
}

export interface DeliveryBalance {
  delivery_id: string;
  delivery_no: string;
  supplier_id: string;
  supplier_name: string;
  supplier_active: boolean;
  fruit_id: string | null;
  fruit_name: string;
  received_date: string;
  boxes_received: number;
  boxes_remaining: number;
  purchase_amount: number;
  amount_paid: number;
  outstanding_amount: number;
  payment_status: PaymentStatus;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  created_at: string;
  fruit_ids?: string[];
  fruit_count?: number;
}

export interface StockBatchView extends AvailableStockBatch {
  delivery_payment_status: PaymentStatus;
  delivery_purchase_amount: number;
  delivery_amount_paid: number;
  delivery_outstanding_amount: number;
}

export type PaymentMode = 'cash' | 'upi';

export interface CreateBillBatchAllocationInput {
  batch_id: string;
  boxes: number;
}

export interface CreateBillItemInput {
  fruit_id: string;
  variety_id: string;
  boxes: number;
  sell_rate: number;
  allocations: CreateBillBatchAllocationInput[];
}

export interface CreateBillInput {
  customer_id: string | null;
  bill_date: string;
  items: CreateBillItemInput[];
  paid_cash: number;
  paid_upi: number;
  note: string | null;
  idempotency_key: string;
}

export interface CancelBillInput {
  bill_id: string;
  reason: string | null;
  refund_mode: PaymentMode | null;
  refund_date: string | null;
  refund_note: string | null;
}

export interface BillBalance {
  bill_id: string;
  bill_no: string;
  customer_id: string | null;
  is_cash_customer: boolean;
  customer_name_snapshot: string;
  bill_date: string;
  subtotal: number;
  amount_paid: number;
  outstanding_amount: number;
  payment_status: PaymentStatus;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  created_at: string;
}

export interface BillBatchAllocationDetail {
  id: string;
  bill_item_id: string;
  batch_id: string;
  boxes: number;
  delivery_no: string;
  received_date: string;
  supplier_name: string;
  purchase_rate: number;
}

export interface BillItemDetail {
  id: string;
  bill_id: string;
  line_no: number;
  fruit_id: string;
  variety_id: string;
  fruit_name_snapshot: string;
  variety_name_snapshot: string;
  boxes: number;
  sell_rate: number;
  line_total: number;
  allocations: BillBatchAllocationDetail[];
}

export interface BillPaymentAllocationDetail {
  id: string;
  customer_payment_id: string;
  amount: number;
  status: 'active' | 'cancelled' | 'refunded';
  refund_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  payment_origin: 'bill_sale' | 'collection';
  mode: PaymentMode;
  payment_date: string;
  payment_note: string | null;
  payment_status: 'active' | 'cancelled';
}

export interface CustomerRefundRecord {
  id: string;
  bill_id: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  amount: number;
  mode: PaymentMode;
  refund_date: string;
  note: string | null;
  created_at: string;
}

export interface BillDetail {
  bill: BillBalance;
  items: BillItemDetail[];
  paymentAllocations: BillPaymentAllocationDetail[];
  refund: CustomerRefundRecord | null;
}

// ----------------------------------------------------------------------------
// Customer & Supplier Accounts, Balances, Opening Balances & Payments
// ----------------------------------------------------------------------------

export interface CustomerBalance {
  customer_id: string;
  name: string;
  phone: string | null;
  active: boolean;
  opening_balance_id: string | null;
  opening_balance: number;
  opening_balance_paid: number;
  opening_balance_outstanding: number;
  active_bills_count: number;
  bills_total: number;
  bills_paid: number;
  bills_outstanding: number;
  outstanding_balance: number;
}

export interface CustomerOpeningBalance {
  id: string;
  customer_id: string;
  amount: number;
  as_of_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface CustomerPaymentAllocationItem {
  id: string;
  customer_payment_id: string;
  bill_id: string | null;
  opening_balance_id: string | null;
  target_label: string;
  target_date: string | null;
  amount: number;
  status: 'active' | 'cancelled' | 'refunded';
  refund_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface CustomerPaymentRecord {
  id: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  payment_origin: 'bill_sale' | 'collection';
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  allocations: CustomerPaymentAllocationItem[];
}

export interface CustomerRefundWithBill extends CustomerRefundRecord {
  bill_no: string;
}

export interface CustomerAccountDetail {
  balance: CustomerBalance;
  openingBalances: CustomerOpeningBalance[];
  bills: BillBalance[];
  payments: CustomerPaymentRecord[];
  refunds: CustomerRefundWithBill[];
}

export interface CustomerPaymentAllocationInput {
  bill_id?: string;
  opening_balance_id?: string;
  amount: number;
}

export interface AddCustomerPaymentInput {
  customer_id: string;
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  allocations: CustomerPaymentAllocationInput[];
  note: string | null;
  idempotency_key: string;
}

export interface SupplierBalance {
  supplier_id: string;
  name: string;
  phone: string | null;
  fruit_id: string | null;
  fruit_name: string;
  active: boolean;
  opening_balance_id: string | null;
  opening_balance: number;
  opening_balance_paid: number;
  opening_balance_outstanding: number;
  active_deliveries_count: number;
  total_boxes_received: number;
  deliveries_total: number;
  deliveries_paid: number;
  deliveries_outstanding: number;
  outstanding_balance: number;
  fruit_ids: string[];
  fruit_count: number;
}

export interface SupplierOpeningBalance {
  id: string;
  supplier_id: string;
  amount: number;
  as_of_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface SupplierPaymentAllocationItem {
  id: string;
  supplier_payment_id: string;
  delivery_id: string | null;
  opening_balance_id: string | null;
  target_label: string;
  target_date: string | null;
  amount: number;
  status: 'active' | 'reallocated' | 'refunded' | 'cancelled';
  refund_id: string | null;
  reallocated_from_id: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface SupplierPaymentRecord {
  id: string;
  supplier_id: string;
  payment_origin: 'delivery_receipt' | 'settlement';
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  allocations: SupplierPaymentAllocationItem[];
}

export interface SupplierRefundRecord {
  id: string;
  delivery_id: string;
  delivery_no: string;
  supplier_id: string;
  amount: number;
  mode: PaymentMode;
  refund_date: string;
  note: string | null;
  created_at: string;
}

export interface SupplierAccountDetail {
  balance: SupplierBalance;
  openingBalances: SupplierOpeningBalance[];
  deliveries: DeliveryBalance[];
  payments: SupplierPaymentRecord[];
  refunds: SupplierRefundRecord[];
}

export interface SupplierPaymentAllocationInput {
  delivery_id?: string;
  opening_balance_id?: string;
  amount: number;
}

export interface AddSupplierPaymentInput {
  supplier_id: string;
  amount: number;
  mode: PaymentMode;
  payment_date: string;
  allocations: SupplierPaymentAllocationInput[];
  note: string | null;
  idempotency_key: string;
}

export interface ReallocateSupplierAllocationInput {
  allocation_id: string;
  new_allocations: SupplierPaymentAllocationInput[];
  reason: string | null;
}

export interface CancelDeliveryInput {
  delivery_id: string;
  reason: string | null;
  refund_mode: PaymentMode | null;
  refund_date: string | null;
  refund_note: string | null;
}

// ----------------------------------------------------------------------------
// Dashboard Overview (from public.dashboard_overview view)
// ----------------------------------------------------------------------------

export interface DashboardOverview {
  summary_date: string;
  today_bills_count: number;
  today_sales_total: number;
  today_cash_received: number;
  today_upi_received: number;
  today_cash_refunded: number;
  today_upi_refunded: number;
  today_net_cash_received: number;
  today_net_upi_received: number;
  total_customer_dues: number;
  total_supplier_dues: number;
}

export interface DashboardData {
  overview: DashboardOverview;
  latestBills: BillBalance[];
}

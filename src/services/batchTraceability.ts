import { supabase } from '@/lib/supabase';
import type { PaymentStatus } from '@/types/database';

export interface BatchTraceabilitySale {
  allocationId: string;
  billId: string;
  billItemId: string;
  billNo: string;
  billDate: string; // YYYY-MM-DD
  customerId: string | null;
  customerName: string;
  boxesAllocated: number;
  boxesReturned: number;
  netBoxesSold: number;
  sellRate: number;
  grossLineAmount: number; // boxesAllocated * sellRate
  netLineAmount: number;   // netBoxesSold * sellRate
  billSubtotal: number;
  billStatus: 'active' | 'cancelled';
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  outstandingAmount: number;
  createdAt: string;
}

export interface BatchTraceabilityReturn {
  id: string;
  returnId: string;
  billItemId: string;
  billId: string;
  billNo: string;
  returnNo: string;
  returnDate: string;
  customerId: string | null;
  customerName: string;
  boxes: number;
  sellRate: number;
  lineTotal: number;
  reason: string | null;
  createdAt: string;
}

export interface BatchTraceabilitySummary {
  batchId: string;
  deliveryId: string;
  deliveryNo: string;
  receivedDate: string;
  fruitId: string;
  fruitName: string;
  varietyId: string;
  varietyName: string;
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  deliveryNote: string | null;
  deliveryStatus: 'active' | 'cancelled';
  boxesReceived: number;
  boxesRemaining: number;
  purchaseRate: number;
  purchaseAmount: number;
  remainingStockValue: number;
  // Reconciled metrics
  grossBoxesSold: number;
  totalBoxesReturned: number;
  netBoxesSold: number;
  cancelledBoxes: number;
  unallocatedBoxes: number;
  isReconciled: boolean;
  reconciliationMessage: string;
  // Historical context
  asOfDate?: string | null;
  isHistorical?: boolean;
}

export interface BatchTraceabilityResult {
  summary: BatchTraceabilitySummary;
  activeSales: BatchTraceabilitySale[];
  cancelledSales: BatchTraceabilitySale[];
  returns: BatchTraceabilityReturn[];
}

interface RawAvailableBatch {
  batch_id: string;
  delivery_id: string;
  delivery_no: string;
  received_date: string;
  line_no: number;
  fruit_id: string;
  fruit_name: string;
  variety_id: string;
  variety_name: string;
  supplier_id: string;
  supplier_name: string;
  supplier_active: boolean;
  boxes_received: number;
  boxes_remaining: number;
  purchase_rate: number;
  purchase_amount: number;
  delivery_note: string | null;
}

interface RawAllocation {
  id: string;
  batch_id: string;
  bill_item_id: string;
  boxes: number;
}

interface RawBillItem {
  id: string;
  bill_id: string;
  line_no: number;
  fruit_name_snapshot: string;
  variety_name_snapshot: string;
  boxes: number;
  sell_rate: number;
  line_total: number;
  bills: {
    id: string;
    bill_no: string;
    customer_id: string | null;
    customer_name_snapshot: string;
    bill_date: string;
    subtotal: number;
    status: 'active' | 'cancelled';
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_at: string;
  } | null;
}

interface RawBillBalance {
  bill_id: string;
  payment_status: PaymentStatus;
  amount_paid: number;
  outstanding_amount: number;
  total_returned: number;
  net_subtotal: number;
}

interface RawReturnItem {
  id: string;
  return_id: string;
  bill_item_id: string;
  batch_id: string;
  boxes: number;
  sell_rate: number;
  line_total: number;
  created_at: string;
  bill_returns: {
    id: string;
    bill_id: string;
    return_no: string;
    customer_id: string | null;
    customer_name_snapshot: string;
    return_date: string;
    reason: string | null;
    refund_amount: number;
    created_at: string;
    bills: {
      bill_no: string;
    } | null;
  } | null;
}

/**
 * Loads complete traceability data for a single stock batch:
 * - Batch summary and purchase details
 * - Every sale allocation that consumed stock from this batch
 * - Exact quantity, selling rate, line amount, and payment status
 * - Returns restored to this batch
 * - Cancelled sales (restored to godown)
 * - Complete mathematical reconciliation
 */
export async function getBatchSalesTraceability(
  batchId: string,
  asOfDate?: string | null
): Promise<BatchTraceabilityResult> {
  const isHistorical = Boolean(asOfDate && asOfDate < new Date().toISOString().slice(0, 10));
  // Phase 1: Parallel fetch of batch view, allocations, and returns for this batch
  const [batchRes, allocRes, returnsRes] = await Promise.all([
    supabase
      .from('available_stock_batches')
      .select(
        'batch_id, delivery_id, delivery_no, received_date, line_no, fruit_id, fruit_name, variety_id, variety_name, supplier_id, supplier_name, supplier_active, boxes_received, boxes_remaining, purchase_rate, purchase_amount, delivery_note'
      )
      .eq('batch_id', batchId)
      .maybeSingle(),
    supabase
      .from('bill_item_batch_allocations')
      .select('id, batch_id, bill_item_id, boxes')
      .eq('batch_id', batchId),
    supabase
      .from('bill_return_items')
      .select(`
        id,
        return_id,
        bill_item_id,
        batch_id,
        boxes,
        sell_rate,
        line_total,
        created_at,
        bill_returns (
          id,
          bill_id,
          return_no,
          customer_id,
          customer_name_snapshot,
          return_date,
          reason,
          refund_amount,
          created_at,
          bills (
            bill_no
          )
        )
      `)
      .eq('batch_id', batchId),
  ]);

  if (batchRes.error) {
    throw new Error(`Failed to load stock batch details: ${batchRes.error.message}`);
  }
  if (!batchRes.data) {
    throw new Error('Stock batch not found or delivery is not active.');
  }
  if (allocRes.error) {
    throw new Error(`Failed to load batch allocations: ${allocRes.error.message}`);
  }
  if (returnsRes.error) {
    throw new Error(`Failed to load batch returns: ${returnsRes.error.message}`);
  }

  const rawBatch = batchRes.data as RawAvailableBatch;
  const rawAllocs = (allocRes.data || []) as RawAllocation[];
  const rawReturns = (returnsRes.data || []) as unknown as RawReturnItem[];

  // Phase 2: If allocations exist, fetch corresponding bill_items and bills
  const billItemIds = Array.from(new Set(rawAllocs.map((a) => a.bill_item_id)));

  let rawBillItems: RawBillItem[] = [];
  let rawBillBalances: RawBillBalance[] = [];

  if (billItemIds.length > 0) {
    const itemsRes = await supabase
      .from('bill_items')
      .select(`
        id,
        bill_id,
        line_no,
        fruit_name_snapshot,
        variety_name_snapshot,
        boxes,
        sell_rate,
        line_total,
        bills (
          id,
          bill_no,
          customer_id,
          customer_name_snapshot,
          bill_date,
          subtotal,
          status,
          cancelled_at,
          cancel_reason,
          created_at
        )
      `)
      .in('id', billItemIds);

    if (itemsRes.error) {
      throw new Error(`Failed to load bill item details: ${itemsRes.error.message}`);
    }
    rawBillItems = (itemsRes.data || []) as unknown as RawBillItem[];

    const billIds = Array.from(
      new Set(
        rawBillItems
          .map((i) => i.bills?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    if (billIds.length > 0) {
      const balancesRes = await supabase
        .from('bill_balances')
        .select('bill_id, payment_status, amount_paid, outstanding_amount, total_returned, net_subtotal')
        .in('bill_id', billIds);

      if (balancesRes.error) {
        throw new Error(`Failed to load bill balances: ${balancesRes.error.message}`);
      }
      rawBillBalances = (balancesRes.data || []) as RawBillBalance[];
    }
  }

  // Index references for fast O(1) lookup
  const billItemMap = new Map<string, RawBillItem>();
  for (const item of rawBillItems) {
    billItemMap.set(item.id, item);
  }

  const balanceMap = new Map<string, RawBillBalance>();
  for (const bal of rawBillBalances) {
    balanceMap.set(bal.bill_id, bal);
  }

  // Index returns by bill_item_id for this batch (filtering by asOfDate if provided)
  const returnsByItem = new Map<string, number>();
  const returnList: BatchTraceabilityReturn[] = [];

  for (const ret of rawReturns) {
    const br = ret.bill_returns;
    const retDate = br?.return_date || '';
    if (asOfDate && retDate && retDate > asOfDate) {
      // Return occurred after the historical date
      continue;
    }

    const boxes = Number(ret.boxes) || 0;
    const cur = returnsByItem.get(ret.bill_item_id) || 0;
    returnsByItem.set(ret.bill_item_id, cur + boxes);

    returnList.push({
      id: ret.id,
      returnId: ret.return_id,
      billItemId: ret.bill_item_id,
      billId: br?.bill_id || '',
      billNo: br?.bills?.bill_no || 'Return',
      returnNo: br?.return_no || 'RET',
      returnDate: retDate,
      customerId: br?.customer_id || null,
      customerName: br?.customer_name_snapshot || 'Customer',
      boxes,
      sellRate: Number(ret.sell_rate) || 0,
      lineTotal: Number(ret.line_total) || 0,
      reason: br?.reason || null,
      createdAt: ret.created_at,
    });
  }

  // Sort returns descending by date
  returnList.sort((a, b) => b.returnDate.localeCompare(a.returnDate));

  // Build sales list (filtering by asOfDate if provided)
  const activeSales: BatchTraceabilitySale[] = [];
  const cancelledSales: BatchTraceabilitySale[] = [];

  for (const alloc of rawAllocs) {
    const item = billItemMap.get(alloc.bill_item_id);
    const bill = item?.bills;
    const billDate = bill?.bill_date || rawBatch.received_date;

    if (asOfDate && billDate > asOfDate) {
      // Sale occurred after the historical date
      continue;
    }

    const billBalance = bill ? balanceMap.get(bill.id) : null;
    const boxesAllocated = Number(alloc.boxes) || 0;
    const sellRate = item ? Number(item.sell_rate) || 0 : 0;
    const boxesReturned = returnsByItem.get(alloc.bill_item_id) || 0;
    const netBoxesSold = Math.max(0, boxesAllocated - boxesReturned);

    const grossLineAmount = Math.round(boxesAllocated * sellRate * 100) / 100;
    const netLineAmount = Math.round(netBoxesSold * sellRate * 100) / 100;

    const isCancelled = bill?.status === 'cancelled';
    const paymentStatus: PaymentStatus = isCancelled
      ? 'cancelled'
      : billBalance?.payment_status || 'unpaid';

    const sale: BatchTraceabilitySale = {
      allocationId: alloc.id,
      billId: bill?.id || '',
      billItemId: alloc.bill_item_id,
      billNo: bill?.bill_no || (item ? 'INV-UNKNOWN' : 'Unallocated / Historical movement'),
      billDate,
      customerId: bill?.customer_id || null,
      customerName:
        bill?.customer_name_snapshot ||
        (bill?.customer_id ? 'Customer' : item ? 'Walk-in Cash Customer' : 'Unallocated / Historical movement'),
      boxesAllocated,
      boxesReturned,
      netBoxesSold: isCancelled ? 0 : netBoxesSold,
      sellRate,
      grossLineAmount,
      netLineAmount: isCancelled ? 0 : netLineAmount,
      billSubtotal: bill ? Number(bill.subtotal) || 0 : 0,
      billStatus: isCancelled ? 'cancelled' : 'active',
      cancelledAt: bill?.cancelled_at || null,
      cancelReason: bill?.cancel_reason || null,
      paymentStatus,
      amountPaid: billBalance ? Number(billBalance.amount_paid) || 0 : 0,
      outstandingAmount: billBalance ? Number(billBalance.outstanding_amount) || 0 : 0,
      createdAt: bill?.created_at || rawBatch.received_date,
    };

    if (isCancelled) {
      cancelledSales.push(sale);
    } else {
      activeSales.push(sale);
    }
  }

  // Sort sales: latest bill date first, then creation time descending
  activeSales.sort((a, b) => {
    if (a.billDate !== b.billDate) return b.billDate.localeCompare(a.billDate);
    return b.createdAt.localeCompare(a.createdAt);
  });
  cancelledSales.sort((a, b) => {
    if (a.billDate !== b.billDate) return b.billDate.localeCompare(a.billDate);
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Calculate reconciliation totals
  const isDeliveryAfterDate = Boolean(asOfDate && rawBatch.received_date > asOfDate);
  const purchaseRate = Number(rawBatch.purchase_rate) || 0;
  const purchaseAmount = Number(rawBatch.purchase_amount) || 0;

  const rawReceived = Number(rawBatch.boxes_received) || 0;
  const boxesReceived = isDeliveryAfterDate ? 0 : rawReceived;

  let grossBoxesSold = 0;
  for (const s of activeSales) {
    grossBoxesSold += s.boxesAllocated;
  }

  let totalBoxesReturned = 0;
  for (const r of returnList) {
    totalBoxesReturned += r.boxes;
  }

  let cancelledBoxes = 0;
  for (const cs of cancelledSales) {
    cancelledBoxes += cs.boxesAllocated;
  }

  const netBoxesSold = Math.max(0, grossBoxesSold - totalBoxesReturned);

  // If historical mode, remaining is derived from historical received minus net sold
  let boxesRemaining: number;
  let unallocatedBoxes: number;
  let isReconciled: boolean;
  let reconciliationMessage: string;

  if (isHistorical) {
    if (isDeliveryAfterDate) {
      boxesRemaining = 0;
      unallocatedBoxes = 0;
      isReconciled = true;
      reconciliationMessage = `Delivery was received on ${rawBatch.received_date}, after the selected historical date (${asOfDate}).`;
    } else {
      boxesRemaining = Math.max(0, boxesReceived - netBoxesSold);
      unallocatedBoxes = 0;
      isReconciled = true;
      if (totalBoxesReturned > 0) {
        reconciliationMessage = `As of ${asOfDate}: ${boxesReceived} received − ${netBoxesSold} net sold (${grossBoxesSold} gross − ${totalBoxesReturned} returned) = ${boxesRemaining} boxes remaining in godown.`;
      } else {
        reconciliationMessage = `As of ${asOfDate}: ${boxesReceived} received − ${netBoxesSold} sold = ${boxesRemaining} boxes remaining in godown.`;
      }
    }
  } else {
    // Live mode (Today)
    const liveRemaining = Number(rawBatch.boxes_remaining) || 0;
    boxesRemaining = liveRemaining;
    const expectedNetSold = Math.max(0, boxesReceived - liveRemaining);
    unallocatedBoxes = expectedNetSold - netBoxesSold;
    isReconciled = unallocatedBoxes === 0;

    if (isReconciled) {
      if (totalBoxesReturned > 0) {
        reconciliationMessage = `All ${boxesReceived} boxes fully accounted for (${grossBoxesSold} sold − ${totalBoxesReturned} returned = ${netBoxesSold} net sold + ${boxesRemaining} remaining in godown).`;
      } else {
        reconciliationMessage = `All ${boxesReceived} boxes fully accounted for (${netBoxesSold} sold + ${boxesRemaining} remaining in godown).`;
      }
    } else if (unallocatedBoxes > 0) {
      reconciliationMessage = `Unallocated difference of ${unallocatedBoxes} box(es). These represent historical sales recorded before batch tracking or inventory adjustments.`;
    } else {
      reconciliationMessage = `Recorded sales exceed expected stock deduction by ${Math.abs(unallocatedBoxes)} box(es). Please verify batch allocations.`;
    }
  }

  const remainingStockValue = Math.round(boxesRemaining * purchaseRate * 100) / 100;

  return {
    summary: {
      batchId: rawBatch.batch_id,
      deliveryId: rawBatch.delivery_id,
      deliveryNo: rawBatch.delivery_no,
      receivedDate: rawBatch.received_date,
      fruitId: rawBatch.fruit_id,
      fruitName: rawBatch.fruit_name,
      varietyId: rawBatch.variety_id,
      varietyName: rawBatch.variety_name,
      supplierId: rawBatch.supplier_id,
      supplierName: rawBatch.supplier_name,
      supplierActive: rawBatch.supplier_active,
      deliveryNote: rawBatch.delivery_note,
      deliveryStatus: 'active',
      boxesReceived,
      boxesRemaining,
      purchaseRate,
      purchaseAmount,
      remainingStockValue,
      grossBoxesSold,
      totalBoxesReturned,
      netBoxesSold,
      cancelledBoxes,
      unallocatedBoxes,
      isReconciled,
      reconciliationMessage,
      asOfDate: asOfDate || null,
      isHistorical,
    },
    activeSales,
    cancelledSales,
    returns: returnList,
  };
}

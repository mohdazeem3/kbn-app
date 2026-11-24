import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Calendar,
  CheckCircle2,
  Loader2,
  MessageCircle,
  PackageOpen,
  Plus,
  Printer,
  ReceiptText,
  Trash2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  AlertBanner,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  MoneyInput,
  SearchSelect,
  TextInput,
} from '@/components/ui';
import type { SearchOption } from '@/components/ui';
import { listCustomers } from '@/services/masterData';
import {
  generateIdempotencyKey,
  getLocalIsoDate,
  listStockBatches,
} from '@/services/inventory';
import { createBill, getBillDetail } from '@/services/sales';
import { listCustomerBalances } from '@/services/accounts';
import { useCacheInvalidation } from '@/services/cache';
import {
  PrintableBillModal,
  type CustomerBalanceSummary,
} from '@/components/sales/PrintableBillModal';
import { WhatsAppShareModal } from '@/components/sales/WhatsAppShareModal';
import {
  generateWhatsAppInvoiceMessage,
  normalizeIndianMobile,
  openWhatsAppChat,
} from '@/services/whatsapp';
import type {
  BillBalance,
  Customer,
  CustomerBalance,
  StockBatchView,
} from '@/types/database';
import type { Page } from './pageTypes';

interface LastSavedSaleState {
  billId: string;
  billNo: string;
  customerName: string;
  phone: string;
  closingBalance: number;
  paymentChoice: PaymentChoice;
}

interface SaleLine {
  key: number;
  fruitId: string | null;
  varietyId: string | null;
  sellRate: string;
  /** Map of batch_id -> string box count typed manually by the user */
  allocations: Record<string, string>;
}

type BuyerKind = 'cash_customer' | 'registered';
type PaymentChoice = 'cash' | 'upi' | 'credit' | 'split';

let nextSaleLineKey = 1;
const createEmptySaleLine = (): SaleLine => ({
  key: nextSaleLineKey++,
  fruitId: null,
  varietyId: null,
  sellRate: '',
  allocations: {},
});

const isSaleLineBlank = (line: SaleLine): boolean => {
  const hasAllocations = Object.values(line.allocations).some(
    (v) => v.trim() !== '' && v.trim() !== '0'
  );
  return !line.fruitId && !line.varietyId && !line.sellRate.trim() && !hasAllocations;
};

const ensureTrailingEmptySaleLine = (currentLines: SaleLine[]): SaleLine[] => {
  const result = [...currentLines];
  while (
    result.length > 1 &&
    isSaleLineBlank(result[result.length - 1]) &&
    isSaleLineBlank(result[result.length - 2])
  ) {
    result.pop();
  }
  if (result.length === 0 || !isSaleLineBlank(result[result.length - 1])) {
    result.push(createEmptySaleLine());
  }
  return result;
};

const WHOLE_POSITIVE_INT = /^[1-9]\d*$/;
const WHOLE_NON_NEGATIVE_INT = /^\d+$/;

function parseNonNegativeInt(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 0;
  if (!WHOLE_NON_NEGATIVE_INT.test(trimmed)) return NaN;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : NaN;
}

function parseNonNegativeMoney(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return NaN;
  return Math.round(num * 100) / 100;
}

interface NewSaleProps {
  onNavigate?: (p: Page) => void;
  isActive?: boolean;
}

export function NewSale({ onNavigate, isActive = true }: NewSaleProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerBalances, setCustomerBalances] = useState<CustomerBalance[]>([]);
  const [availableBatches, setAvailableBatches] = useState<StockBatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [buyerKind, setBuyerKind] = useState<BuyerKind>('registered');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPhone, setCustomerPhone] = useState('');
  const [billDate, setBillDate] = useState<string>(() => getLocalIsoDate());
  const [billNote, setBillNote] = useState('');
  const [lines, setLines] = useState<SaleLine[]>([createEmptySaleLine()]);

  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('cash');
  const [paidCash, setPaidCash] = useState('');
  const [paidUpi, setPaidUpi] = useState('');

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateIdempotencyKey());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBill, setSavedBill] = useState<BillBalance | null>(null);
  const [lastSavedSale, setLastSavedSale] = useState<LastSavedSaleState | null>(null);
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);

  // Printing State
  const [printBillId, setPrintBillId] = useState<string | null>(null);
  const [printBalanceSummary, setPrintBalanceSummary] = useState<CustomerBalanceSummary | null>(null);
  const [printCustomerPhone, setPrintCustomerPhone] = useState<string>('');
  const [printPaymentMode, setPrintPaymentMode] = useState<string | null>(null);
  const [autoPrintTrigger, setAutoPrintTrigger] = useState(false);

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setLoadError(null);
    try {
      const [custList, batchList, balList] = await Promise.all([
        listCustomers(),
        listStockBatches(),
        listCustomerBalances(),
      ]);
      setCustomers(custList.filter((c) => c.active));
      setAvailableBatches(batchList.filter((b) => b.boxes_remaining > 0));
      setCustomerBalances(balList);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load customers and available stock.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useCacheInvalidation(['stock', 'customers', 'customer_balances'], () => void loadData(true), { isActive });

  const customerOptions: SearchOption[] = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.phone ?? 'No phone saved',
      })),
    [customers]
  );

  const selectedCustomer = useMemo(
    () => (customerId ? customers.find((c) => c.id === customerId) ?? null : null),
    [customers, customerId]
  );

  // Live customer balance from ledger
  const customerBalanceRecord = useMemo(
    () => (customerId ? customerBalances.find((b) => b.customer_id === customerId) ?? null : null),
    [customerBalances, customerId]
  );

  // Actual Opening Balance from customer record/ledger
  const customerOpeningBalance = useMemo(() => {
    if (buyerKind === 'cash_customer' || !customerId || !customerBalanceRecord) return 0;
    return customerBalanceRecord.opening_balance;
  }, [buyerKind, customerId, customerBalanceRecord]);

  // 1. Opening Balance before this new bill (ledger outstanding before bill, for closing balance calculation)
  const openingBalance = useMemo(() => {
    if (buyerKind === 'cash_customer' || !customerId || !customerBalanceRecord) return 0;
    return customerBalanceRecord.outstanding_balance;
  }, [buyerKind, customerId, customerBalanceRecord]);

  // Fruits that currently have available stock boxes
  const fruitOptions: SearchOption[] = useMemo(() => {
    const map = new Map<string, { name: string; boxes: number; batches: number }>();
    for (const b of availableBatches) {
      const entry = map.get(b.fruit_id) ?? { name: b.fruit_name, boxes: 0, batches: 0 };
      entry.boxes += b.boxes_remaining;
      entry.batches += 1;
      map.set(b.fruit_id, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, info]) => ({
        id,
        label: info.name,
        sublabel: `${info.boxes} boxes left across ${info.batches} ${info.batches === 1 ? 'batch' : 'batches'}`,
      }));
  }, [availableBatches]);

  // Global allocated boxes per batch across ALL lines (for cross-line over-allocation guard)
  const totalAllocatedByBatch = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const parsed = parseNonNegativeInt(raw);
        if (!Number.isNaN(parsed) && parsed > 0) {
          totals.set(batchId, (totals.get(batchId) ?? 0) + parsed);
        }
      }
    }
    return totals;
  }, [lines]);

  const getVarietyOptionsForFruit = (fruitId: string | null): SearchOption[] => {
    if (!fruitId) return [];
    const map = new Map<
      string,
      { name: string; boxes: number; batches: number; defaultRate: number | null }
    >();
    for (const b of availableBatches) {
      if (b.fruit_id !== fruitId) continue;
      const entry = map.get(b.variety_id) ?? {
        name: b.variety_name,
        boxes: 0,
        batches: 0,
        defaultRate: b.default_sell_rate,
      };
      entry.boxes += b.boxes_remaining;
      entry.batches += 1;
      map.set(b.variety_id, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, info]) => ({
        id,
        label: info.name,
        sublabel: `${info.boxes} boxes in ${info.batches} ${info.batches === 1 ? 'batch' : 'batches'}${info.defaultRate !== null ? ` • Sugg ₹${info.defaultRate}/box` : ''}`,
      }));
  };

  const getBatchesForLine = (fruitId: string | null, varietyId: string | null): StockBatchView[] => {
    if (!fruitId || !varietyId) return [];
    return availableBatches.filter(
      (b) => b.fruit_id === fruitId && b.variety_id === varietyId && b.boxes_remaining > 0
    );
  };

  const updateLine = (key: number, patch: Partial<SaleLine>) => {
    setLines((prev) => {
      const updated = prev.map((l) => (l.key === key ? { ...l, ...patch } : l));
      return ensureTrailingEmptySaleLine(updated);
    });
    setFormError(null);
  };

  const handleFruitChange = (key: number, nextFruitId: string) => {
    setLines((prev) => {
      const updated = prev.map((l) =>
        l.key === key
          ? {
              ...l,
              fruitId: nextFruitId,
              varietyId: null,
              allocations: {},
            }
          : l
      );
      return ensureTrailingEmptySaleLine(updated);
    });
    setFormError(null);
  };

  const handleVarietyChange = (key: number, fruitId: string | null, nextVarietyId: string) => {
    const matchingBatch = availableBatches.find(
      (b) => b.fruit_id === fruitId && b.variety_id === nextVarietyId
    );
    setLines((prev) => {
      const updated = prev.map((l) => {
        if (l.key !== key) return l;
        const suggested =
          !l.sellRate.trim() && matchingBatch?.default_sell_rate
            ? String(matchingBatch.default_sell_rate)
            : l.sellRate;
        return {
          ...l,
          varietyId: nextVarietyId,
          sellRate: suggested,
          allocations: {},
        };
      });
      return ensureTrailingEmptySaleLine(updated);
    });
    setFormError(null);
  };

  const handleBatchAllocationChange = (lineKey: number, batchId: string, rawValue: string) => {
    setLines((prev) => {
      const updated = prev.map((l) =>
        l.key === lineKey ? { ...l, allocations: { ...l.allocations, [batchId]: rawValue } } : l
      );
      return ensureTrailingEmptySaleLine(updated);
    });
    setFormError(null);
  };

  const addLine = () => {
    setLines((prev) => {
      if (prev.length > 0 && isSaleLineBlank(prev[prev.length - 1])) {
        return prev;
      }
      return [...prev, createEmptySaleLine()];
    });
    setFormError(null);
  };

  const removeLine = (key: number) => {
    setLines((prev) => {
      const filtered = prev.filter((l) => l.key !== key);
      return ensureTrailingEmptySaleLine(filtered);
    });
    setFormError(null);
  };

  const lineSummaries = useMemo(() => {
    return lines.map((line) => {
      if (isSaleLineBlank(line)) {
        return {
          key: line.key,
          fruitName: '',
          varietyName: '',
          totalBoxes: 0,
          lineTotal: 0,
          hasInvalidBox: false,
          hasOverAlloc: false,
        };
      }

      let totalBoxes = 0;
      let hasInvalidBox = false;
      let hasOverAlloc = false;

      const lineBatches = availableBatches.filter(
        (b) => b.fruit_id === line.fruitId && b.variety_id === line.varietyId
      );
      const batchMap = new Map(lineBatches.map((b) => [b.batch_id, b]));

      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (!WHOLE_NON_NEGATIVE_INT.test(trimmed)) {
          hasInvalidBox = true;
          continue;
        }
        const qty = Number(trimmed);
        if (qty === 0) continue;
        totalBoxes += qty;
        const batch = batchMap.get(batchId);
        const globalQty = totalAllocatedByBatch.get(batchId) ?? qty;
        if (!batch || globalQty > batch.boxes_remaining) {
          hasOverAlloc = true;
        }
      }

      const rate = Number(line.sellRate);
      const validRate = line.sellRate.trim() !== '' && Number.isFinite(rate) && rate > 0;
      const lineTotal =
        totalBoxes > 0 && validRate ? Math.round(totalBoxes * rate * 100) / 100 : 0;

      const firstBatch = lineBatches[0];
      return {
        key: line.key,
        fruitName: firstBatch?.fruit_name ?? '',
        varietyName: firstBatch?.variety_name ?? '',
        totalBoxes,
        lineTotal,
        hasInvalidBox,
        hasOverAlloc,
      };
    });
  }, [lines, availableBatches, totalAllocatedByBatch]);

  // 2. Bill Amount (Subtotal)
  const { totalBoxes, subtotal, hasAnyStockIssue } = useMemo(() => {
    let boxes = 0;
    let sum = 0;
    let stockIssue = false;
    for (let i = 0; i < lines.length; i++) {
      if (isSaleLineBlank(lines[i])) continue;
      const s = lineSummaries[i];
      boxes += s.totalBoxes;
      sum += s.lineTotal;
      if (s.hasInvalidBox || s.hasOverAlloc) stockIssue = true;
    }
    return {
      totalBoxes: boxes,
      subtotal: Math.round(sum * 100) / 100,
      hasAnyStockIssue: stockIssue,
    };
  }, [lines, lineSummaries]);

  // Payment Calculations
  const cashNum = parseNonNegativeMoney(paidCash);
  const upiNum = parseNonNegativeMoney(paidUpi);
  const paymentNumbersValid = !Number.isNaN(cashNum) && !Number.isNaN(upiNum);

  // 3. Paid Amount
  const totalPaid = paymentNumbersValid ? Math.round((cashNum + upiNum) * 100) / 100 : 0;

  // 4. Closing Balance Calculation
  // For Registered: Closing Balance = Opening Balance + Bill Amount - Paid Amount
  // For Cash Customer: Closing Balance = 0 (Must pay full in cash/upi)
  const closingBalance = useMemo(() => {
    if (buyerKind === 'cash_customer') return 0;
    return Math.round((openingBalance + subtotal - totalPaid) * 100) / 100;
  }, [buyerKind, openingBalance, subtotal, totalPaid]);

  const creditAmount = Math.round((subtotal - totalPaid) * 100) / 100;
  const isOverpaid = paymentNumbersValid && Math.round(totalPaid * 100) > Math.round(subtotal * 100);
  const isCashCustomerWithCredit =
    buyerKind === 'cash_customer' && subtotal > 0 && Math.round(creditAmount * 100) > 0;

  // Payment mode button handlers
  const handleSelectPaymentChoice = (choice: PaymentChoice) => {
    setPaymentChoice(choice);
    setFormError(null);
    if (choice === 'cash') {
      setPaidCash(subtotal > 0 ? String(subtotal) : '');
      setPaidUpi('');
    } else if (choice === 'upi') {
      setPaidCash('');
      setPaidUpi(subtotal > 0 ? String(subtotal) : '');
    } else if (choice === 'credit') {
      if (buyerKind === 'cash_customer') return;
      setPaidCash('');
      setPaidUpi('');
    }
  };

  const handleBuyerKindChange = (next: BuyerKind) => {
    setBuyerKind(next);
    setFormError(null);
    if (next === 'cash_customer') {
      setCustomerId(null);
      setCustomerPhone('');
      if (paymentChoice === 'credit') {
        setPaymentChoice('cash');
      }
      if (subtotal > 0) {
        setPaidCash(String(subtotal));
        setPaidUpi('');
      }
    }
  };

  const handleCustomerChange = (id: string | null) => {
    setCustomerId(id);
    setFormError(null);
    if (!id) {
      setCustomerPhone('');
      return;
    }
    const cust = customers.find((c) => c.id === id);
    setCustomerPhone(cust?.phone ?? '');
  };

  const validateAndBuildPayload = () => {
    if (buyerKind === 'registered' && !customerId) {
      throw new Error('Select a registered customer, or switch to Cash Customer for a walk-in sale.');
    }
    if (!billDate) {
      throw new Error('Choose the bill date.');
    }

    const activeLines = lines.filter((l) => !isSaleLineBlank(l));
    if (activeLines.length === 0) {
      throw new Error('Add at least one sale item.');
    }

    const batchMap = new Map(availableBatches.map((b) => [b.batch_id, b]));
    const globalBatchUsage = new Map<string, number>();

    const items = activeLines.map((line, idx) => {
      const lineNum = idx + 1;
      if (!line.fruitId || !line.varietyId) {
        throw new Error(`Item ${lineNum}: select both a fruit category and variety/grade.`);
      }

      const rate = Number(line.sellRate);
      if (!line.sellRate.trim() || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Item ${lineNum}: enter a selling rate per box greater than zero.`);
      }

      const cleanAllocs: { batch_id: string; boxes: number }[] = [];
      let lineBoxes = 0;

      for (const [batchId, raw] of Object.entries(line.allocations)) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '0') continue;
        if (!WHOLE_POSITIVE_INT.test(trimmed)) {
          throw new Error(`Item ${lineNum}: allocated boxes must be whole numbers (1 or more).`);
        }
        const qty = Number(trimmed);
        const batch = batchMap.get(batchId);
        if (!batch || batch.fruit_id !== line.fruitId || batch.variety_id !== line.varietyId) {
          throw new Error(`Item ${lineNum}: selected batch does not match the chosen fruit/variety.`);
        }
        const newGlobal = (globalBatchUsage.get(batchId) ?? 0) + qty;
        if (newGlobal > batch.boxes_remaining) {
          throw new Error(
            `Item ${lineNum}: cannot allocate ${newGlobal} boxes from ${batch.delivery_no} (only ${batch.boxes_remaining} remaining).`
          );
        }
        globalBatchUsage.set(batchId, newGlobal);
        cleanAllocs.push({ batch_id: batchId, boxes: qty });
        lineBoxes += qty;
      }

      if (cleanAllocs.length === 0 || lineBoxes <= 0) {
        throw new Error(`Item ${lineNum}: allocate at least 1 box from an available stock batch.`);
      }

      return {
        fruit_id: line.fruitId,
        variety_id: line.varietyId,
        boxes: lineBoxes,
        sell_rate: Math.round(rate * 100) / 100,
        allocations: cleanAllocs,
      };
    });

    if (!paymentNumbersValid) {
      throw new Error('Enter valid non-negative Cash and UPI amounts.');
    }
    if (isOverpaid) {
      throw new Error(
        `Total payment (₹${totalPaid.toLocaleString('en-IN')}) cannot exceed bill total (₹${subtotal.toLocaleString('en-IN')}).`
      );
    }
    if (buyerKind === 'cash_customer' && Math.round(totalPaid * 100) !== Math.round(subtotal * 100)) {
      throw new Error(
        `Cash Customer bills cannot have credit. Collect the full ₹${subtotal.toLocaleString('en-IN')} in Cash and/or UPI.`
      );
    }

    return {
      customer_id: buyerKind === 'cash_customer' ? null : customerId,
      bill_date: billDate,
      items,
      paid_cash: cashNum,
      paid_upi: upiNum,
      note: billNote.trim() || null,
      idempotency_key: idempotencyKey,
    };
  };

  const handleSaveBill = async (shouldPrint: boolean) => {
    setFormError(null);
    setSavedBill(null);

    let payload;
    try {
      payload = validateAndBuildPayload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Please review the bill before saving.');
      return;
    }

    // Preserve snapshot of balance for printing before resetting state
    const balanceSnapshot: CustomerBalanceSummary = {
      openingBalance,
      billAmount: subtotal,
      paidAmount: totalPaid,
      closingBalance,
    };

    const targetCustomerPhone = customerPhone.trim() || (selectedCustomer?.phone ?? '');
    const currentPaymentChoice = paymentChoice;

    setSaving(true);
    try {
      const created = await createBill(payload);
      setSavedBill(created);
      setLastSavedSale({
        billId: created.bill_id,
        billNo: created.bill_no,
        customerName: created.customer_name_snapshot,
        phone: targetCustomerPhone,
        closingBalance: balanceSnapshot.closingBalance,
        paymentChoice: currentPaymentChoice,
      });

      setLines([createEmptySaleLine()]);
      setPaidCash('');
      setPaidUpi('');
      setBillNote('');
      setCustomerPhone('');
      setIdempotencyKey(generateIdempotencyKey());

      // If "Save & Print" was triggered, open the print modal immediately
      if (shouldPrint) {
        setPrintBalanceSummary(balanceSnapshot);
        setPrintCustomerPhone(targetCustomerPhone);
        setPrintPaymentMode(currentPaymentChoice.toUpperCase());
        setPrintBillId(created.bill_id);
        setAutoPrintTrigger(true);
      }

      // Refresh stock and balances
      void loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save bill.');
    } finally {
      setSaving(false);
    }
  };

  const handleShareOnWhatsApp = async () => {
    if (!lastSavedSale) return;
    const normalized = normalizeIndianMobile(lastSavedSale.phone);
    if (normalized) {
      try {
        const detail = await getBillDetail(lastSavedSale.billId);
        const text = generateWhatsAppInvoiceMessage({
          bill: detail.bill,
          items: detail.items,
          closingBalance: lastSavedSale.closingBalance,
          paymentMode: lastSavedSale.paymentChoice.toUpperCase(),
        });
        openWhatsAppChat(normalized, text);
      } catch (err) {
        console.error('Error opening WhatsApp chat:', err);
      }
    }
    setWhatsAppModalOpen(true);
  };

  return (
    <div className="space-y-3">
      {/* Success Banner */}
      {savedBill && (
        <AlertBanner
          tone="success"
          message={`Saved Bill ${savedBill.bill_no} for ${savedBill.customer_name_snapshot} — Total ₹${savedBill.subtotal.toLocaleString('en-IN')} (Paid ₹${savedBill.amount_paid.toLocaleString('en-IN')}, Balance ₹${savedBill.outstanding_amount.toLocaleString('en-IN')}).`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                className="!bg-[#25D366] hover:!bg-[#1EBE5D] text-white border-0 shadow-sm"
                icon={MessageCircle}
                onClick={handleShareOnWhatsApp}
              >
                Share on WhatsApp
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={Printer}
                onClick={() => {
                  setPrintBillId(savedBill.bill_id);
                  setPrintCustomerPhone(lastSavedSale?.phone ?? '');
                  setPrintPaymentMode(lastSavedSale?.paymentChoice.toUpperCase() ?? null);
                  setAutoPrintTrigger(false);
                }}
              >
                Print Bill
              </Button>
              {onNavigate && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ReceiptText}
                  onClick={() => onNavigate('bills')}
                >
                  Sales History
                </Button>
              )}
            </div>
          }
        />
      )}

      {formError && <AlertBanner tone="error" message={formError} />}
      {loadError && (
        <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />
      )}

      {loading ? (
        <LoadingCard label="Loading customers and available stock batches…" />
      ) : !loadError && availableBatches.length === 0 ? (
        <EmptyState
          emoji="📦"
          title="No stock available to sell"
          description="Receive stock from a supplier first so you can allocate available boxes to a customer bill."
          action={
            onNavigate ? (
              <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
                Receive Stock
              </Button>
            ) : undefined
          }
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveBill(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.target as HTMLElement;
              if (target.tagName === 'INPUT' && target.getAttribute('type') !== 'submit') {
                e.preventDefault();
              }
            }
          }}
          className="space-y-3 pb-8"
          noValidate
        >
          {/* SECTION 1: TWO COMPACT BOXES SIDE BY SIDE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
            {/* LEFT BOX — Customer Details */}
            <div className="rounded-xl border border-leaf-200 bg-white p-3 shadow-xs flex flex-col justify-between">
              <div className="space-y-2.5">
                {/* Top Row: Customer Type Toggle + Due Pill */}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="inline-flex rounded-xl border border-leaf-200 bg-cream-100 p-1 shrink-0"
                    role="group"
                    aria-label="Customer type"
                  >
                    <button
                      type="button"
                      onClick={() => handleBuyerKindChange('registered')}
                      aria-pressed={buyerKind === 'registered'}
                      disabled={saving}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1 ${
                        buyerKind === 'registered'
                          ? 'bg-leaf-600 text-white shadow-xs'
                          : 'text-leaf-800 hover:bg-leaf-50'
                      }`}
                    >
                      <UserCheck className="inline h-3.5 w-3.5 mr-1" aria-hidden /> Registered
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBuyerKindChange('cash_customer')}
                      aria-pressed={buyerKind === 'cash_customer'}
                      disabled={saving}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1 ${
                        buyerKind === 'cash_customer'
                          ? 'bg-mango-600 text-white shadow-xs'
                          : 'text-leaf-800 hover:bg-leaf-50'
                      }`}
                    >
                      <Wallet className="inline h-3.5 w-3.5 mr-1" aria-hidden /> Cash (Walk-in)
                    </button>
                  </div>

                  {buyerKind === 'registered' && customerId && (
                    <div
                      className={`rounded-lg px-2.5 py-1 text-xs font-black tabular-nums border ${
                        customerOpeningBalance > 0
                          ? 'bg-mango-50 text-mango-900 border-mango-300'
                          : 'bg-leaf-50 text-leaf-900 border-leaf-200'
                      }`}
                      title="Customer's Opening Balance from ledger"
                    >
                      Opening Balance: ₹{customerOpeningBalance.toLocaleString('en-IN')}
                    </div>
                  )}
                </div>

                {/* Input Fields Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  {/* Customer Name Selector / Walk-in Indicator */}
                  <div className="sm:col-span-12">
                    {buyerKind === 'registered' ? (
                      <SearchSelect
                        placeholder="Select customer *"
                        options={customerOptions}
                        value={customerId}
                        onChange={handleCustomerChange}
                        icon={false}
                        compact
                        className="!h-10 !py-2 !px-3 !text-sm font-semibold"
                      />
                    ) : (
                      <div className="flex h-10 items-center justify-between rounded-lg border border-mango-300 bg-mango-50/70 px-3 text-sm font-bold text-mango-950">
                        <span>Walk-in Cash Customer</span>
                        <span className="text-2xs uppercase text-mango-800 font-black">
                          Immediate Pay
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Customer Mobile (autofilled from customer, editable for this sale) */}
                  <div className="sm:col-span-6">
                    <TextInput
                      type="tel"
                      placeholder={buyerKind === 'registered' ? 'Customer Mobile Number' : 'Mobile Number (optional)'}
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      disabled={saving}
                      compact
                      className="!h-10 !py-2 !px-3 !text-sm font-semibold"
                    />
                  </div>

                  {/* Bill Date */}
                  <div className="sm:col-span-6">
                    <div className="relative">
                      <Calendar
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-leaf-500"
                        aria-hidden
                      />
                      <TextInput
                        type="date"
                        value={billDate}
                        onChange={(e) => setBillDate(e.target.value)}
                        disabled={saving}
                        compact
                        className="!h-10 !py-2 !pl-9 !pr-3 !text-sm font-semibold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT BOX — Bill Summary and Payment */}
            <div className="rounded-xl border border-leaf-200 bg-white p-3 shadow-xs flex flex-col justify-between gap-2">
              {/* Row 1: Bill Number */}
              <div className="flex h-10 items-center px-3 rounded-lg border border-leaf-200 bg-cream-100/90 text-sm font-bold text-leaf-950">
                <span className="text-leaf-600 font-semibold mr-1.5 text-xs uppercase tracking-wider">Bill No</span>
                <span className="truncate">Auto on Save</span>
              </div>

              {/* Row 2: Metrics Summary */}
              <div className="grid grid-cols-4 gap-2 py-1.5 px-2 rounded-lg bg-cream-50/80 border border-leaf-100 text-center">
                <div>
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Total</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-950 block truncate">
                    ₹{subtotal.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Boxes</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-950 block truncate">
                    {totalBoxes}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Paid</span>
                  <span className="tabular-nums text-sm sm:text-base font-black text-leaf-700 block truncate">
                    ₹{totalPaid.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="border-l border-leaf-200">
                  <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600 block">Closing</span>
                  <span
                    className={`tabular-nums text-sm sm:text-base font-black block truncate ${
                      closingBalance > 0 ? 'text-mango-900' : 'text-leaf-900'
                    }`}
                  >
                    ₹{closingBalance.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Row 3: Payment Amount Input & Mode Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                {/* 1. Payment Amount Input at the beginning */}
                <div className="flex items-center gap-2">
                  {paymentChoice === 'cash' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        min="0"
                        step="0.01"
                        placeholder="Cash Amount"
                        value={paidCash}
                        onChange={(e) => {
                          setPaidCash(e.target.value);
                          setFormError(null);
                        }}
                        disabled={saving}
                        aria-label="Cash amount paid"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                      />
                    </div>
                  )}

                  {paymentChoice === 'credit' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        placeholder="0.00"
                        value=""
                        disabled
                        aria-label="Credit amount (pay later)"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg bg-cream-100/60 opacity-60 cursor-not-allowed"
                      />
                    </div>
                  )}

                  {paymentChoice === 'upi' && (
                    <div className="w-32 sm:w-36">
                      <MoneyInput
                        compact
                        min="0"
                        step="0.01"
                        placeholder="UPI Amount"
                        value={paidUpi}
                        onChange={(e) => {
                          setPaidUpi(e.target.value);
                          setFormError(null);
                        }}
                        disabled={saving}
                        aria-label="UPI amount paid"
                        className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                      />
                    </div>
                  )}

                  {paymentChoice === 'split' && (
                    <div className="flex items-center gap-2">
                      <div className="w-24 sm:w-28">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="Cash"
                          value={paidCash}
                          onChange={(e) => {
                            setPaidCash(e.target.value);
                            setFormError(null);
                          }}
                          disabled={saving}
                          aria-label="Cash split amount"
                          className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                        />
                      </div>
                      <div className="w-24 sm:w-28">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="UPI"
                          value={paidUpi}
                          onChange={(e) => {
                            setPaidUpi(e.target.value);
                            setFormError(null);
                          }}
                          disabled={saving}
                          aria-label="UPI split amount"
                          className="!h-9 !py-1.5 !text-sm font-bold rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Mode Buttons: 1. CASH, 2. CREDIT, 3. UPI, 4. SPLIT */}
                <div className="inline-flex rounded-xl border border-leaf-200 bg-cream-100 p-1 shrink-0">
                  {(['cash', 'credit', 'upi', 'split'] as const).map((opt) => {
                    const isDisabled = saving || (opt === 'credit' && buyerKind === 'cash_customer');
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleSelectPaymentChoice(opt)}
                        disabled={isDisabled}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1 ${
                          paymentChoice === opt
                            ? opt === 'credit'
                              ? 'bg-mango-600 text-white shadow-xs'
                              : 'bg-leaf-600 text-white shadow-xs'
                            : 'text-leaf-800 hover:bg-leaf-50 disabled:opacity-40'
                        }`}
                      >
                        {opt.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: PRODUCT ENTRY TABLE (MAIN FOCUS) */}
          <div className="hidden md:block rounded-xl border border-leaf-200 bg-white shadow-xs">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-leaf-200 bg-cream-100 text-2xs font-extrabold uppercase tracking-wider text-leaf-800">
                  <th className="py-2 px-2.5 text-center w-10 rounded-tl-xl">#</th>
                  <th className="py-2 px-2.5 min-w-[160px]">Fruit Category *</th>
                  <th className="py-2 px-2.5 min-w-[180px]">Variety / Grade *</th>
                  <th className="py-2 px-2.5 w-28 text-right">Selling Rate *</th>
                  <th className="py-2 px-2.5 min-w-[260px]">
                    Available Stock &amp; Batch Allocation *
                  </th>
                  <th className="py-2 px-2.5 w-24 text-center">Allocated</th>
                  <th className="py-2 px-2.5 w-28 text-right">Line Total</th>
                  <th className="py-2 px-2 text-center w-10 rounded-tr-xl"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-leaf-100">
                {lines.map((line, idx) => {
                  const varietyOpts = getVarietyOptionsForFruit(line.fruitId);
                  const lineBatches = getBatchesForLine(line.fruitId, line.varietyId);
                  const summary = lineSummaries[idx];
                  const isBlank = isSaleLineBlank(line);

                  return (
                    <tr
                      key={line.key}
                      className={`transition-colors ${
                        isBlank ? 'bg-cream-50/20' : 'hover:bg-leaf-50/30'
                      }`}
                    >
                      {/* 1. Row Number */}
                      <td className="py-1 px-2.5 text-center font-bold text-xs text-leaf-500">
                        {idx + 1}
                      </td>

                      {/* 2. Fruit Category */}
                      <td className="py-1 px-2.5">
                        <SearchSelect
                          compact
                          placeholder="Select fruit"
                          options={fruitOptions}
                          value={line.fruitId}
                          onChange={(id) => handleFruitChange(line.key, id)}
                          disabled={saving}
                          icon={false}
                        />
                      </td>

                      {/* 3. Variety / Grade */}
                      <td className="py-1 px-2.5">
                        <SearchSelect
                          compact
                          placeholder={
                            line.fruitId ? 'Select variety' : 'Select fruit first'
                          }
                          options={varietyOpts}
                          value={line.varietyId}
                          onChange={(id) => handleVarietyChange(line.key, line.fruitId, id)}
                          disabled={!line.fruitId || saving}
                          icon={false}
                        />
                      </td>

                      {/* 4. Selling Rate / Box */}
                      <td className="py-1 px-2.5">
                        <MoneyInput
                          compact
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="font-bold text-right"
                          value={line.sellRate}
                          onChange={(e) => updateLine(line.key, { sellRate: e.target.value })}
                          disabled={saving}
                        />
                      </td>

                      {/* 5. Available Stock & Batch Allocation (Single-Row Inline Integration) */}
                      <td className="py-1 px-2.5">
                        {!line.fruitId || !line.varietyId ? (
                          <span className="text-2xs text-stone-400 italic">
                            Select variety to view available batches
                          </span>
                        ) : lineBatches.length === 0 ? (
                          <span className="text-2xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                            No batches available
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {lineBatches.map((batch) => {
                              const rawVal = line.allocations[batch.batch_id] ?? '';
                              const thisLineQty = parseNonNegativeInt(rawVal);
                              const safeThisLine = Number.isNaN(thisLineQty) ? 0 : thisLineQty;
                              const globalQty = totalAllocatedByBatch.get(batch.batch_id) ?? 0;
                              const allocatedElsewhere = Math.max(0, globalQty - safeThisLine);
                              const maxForThisLine = Math.max(
                                0,
                                batch.boxes_remaining - allocatedElsewhere
                              );
                              const exceeds =
                                !Number.isNaN(thisLineQty) && thisLineQty > maxForThisLine;
                              const invalidInt =
                                rawVal.trim() !== '' && !WHOLE_NON_NEGATIVE_INT.test(rawVal.trim());

                              return (
                                <div
                                  key={batch.batch_id}
                                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs transition-colors ${
                                    exceeds || invalidInt
                                      ? 'border-red-300 bg-red-50 text-red-900'
                                      : safeThisLine > 0
                                      ? 'border-leaf-600 bg-leaf-50/80 font-bold text-leaf-950'
                                      : 'border-leaf-200 bg-white text-leaf-800'
                                  }`}
                                >
                                  <span className="font-extrabold">{batch.delivery_no}</span>
                                  <span className="text-leaf-600 text-[10px]">
                                    ({maxForThisLine} left)
                                  </span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    max={maxForThisLine}
                                    step="1"
                                    placeholder="0"
                                    value={rawVal}
                                    onChange={(e) =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        e.target.value
                                      )
                                    }
                                    disabled={saving}
                                    aria-label={`Boxes from ${batch.delivery_no}`}
                                    className="tabular-nums w-12 rounded border border-leaf-300 bg-white px-1 py-0.5 text-right text-xs font-bold text-leaf-950 focus:border-leaf-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500/30"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving || maxForThisLine === 0}
                                    onClick={() =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        String(maxForThisLine)
                                      )
                                    }
                                    className="rounded bg-leaf-200 hover:bg-leaf-300 px-1 py-0.5 text-[9px] font-black uppercase text-leaf-900 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1"
                                    title="Allocate maximum available boxes from this batch"
                                  >
                                    Max
                                  </button>
                                  {(exceeds || invalidInt) && (
                                    <span className="text-[10px] font-bold text-red-700">
                                      {invalidInt ? 'Invalid' : `Max ${maxForThisLine}`}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      {/* 6. Allocated Boxes */}
                      <td className="py-1 px-2.5 text-center">
                        {summary.totalBoxes > 0 ? (
                          <span className="inline-flex rounded-full bg-leaf-100 px-2 py-0.5 text-xs font-black text-leaf-800 tabular-nums">
                            {summary.totalBoxes} bx
                          </span>
                        ) : (
                          <span className="text-2xs font-semibold text-stone-400">0</span>
                        )}
                      </td>

                      {/* 7. Line Total */}
                      <td className="py-1 px-2.5 text-right tabular-nums text-xs font-extrabold text-leaf-950">
                        {summary.lineTotal > 0 ? `₹${summary.lineTotal.toLocaleString('en-IN')}` : '—'}
                      </td>

                      {/* 8. Remove Action */}
                      <td className="py-1 px-2 text-center">
                        {lines.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            disabled={saving}
                            className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            title={`Remove item ${idx + 1}`}
                            aria-label={`Remove item ${idx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="inline-block w-3.5" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Layout (md:hidden) — Readable compact cards */}
          <div className="space-y-2.5 md:hidden">
            {lines.map((line, idx) => {
              const varietyOpts = getVarietyOptionsForFruit(line.fruitId);
              const lineBatches = getBatchesForLine(line.fruitId, line.varietyId);
              const summary = lineSummaries[idx];
              const isBlank = isSaleLineBlank(line);

              return (
                <Card
                  key={line.key}
                  className={`p-3.5 space-y-2.5 border transition-colors ${
                    isBlank ? 'border-dashed border-leaf-200 bg-cream-50/50' : 'border-leaf-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-leaf-100 text-2xs font-bold text-leaf-800">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-extrabold text-leaf-950">
                        {summary.fruitName
                          ? `${summary.fruitName} (${summary.varietyName})`
                          : 'New Sale Item'}
                      </span>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={saving}
                        className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        aria-label={`Remove item ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <SearchSelect
                      compact
                      label="Fruit"
                      placeholder="Select fruit"
                      options={fruitOptions}
                      value={line.fruitId}
                      onChange={(id) => handleFruitChange(line.key, id)}
                      icon={false}
                    />

                    <SearchSelect
                      compact
                      label="Variety / Grade"
                      placeholder={line.fruitId ? 'Select variety' : 'Select fruit first'}
                      options={varietyOpts}
                      value={line.varietyId}
                      onChange={(id) => handleVarietyChange(line.key, line.fruitId, id)}
                      icon={false}
                    />
                  </div>

                  <div>
                    <span className="mb-1 block text-xs font-bold text-leaf-900">
                      Selling Rate / Box
                    </span>
                    <MoneyInput
                      compact
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={line.sellRate}
                      onChange={(e) => updateLine(line.key, { sellRate: e.target.value })}
                      disabled={saving}
                    />
                  </div>

                  {/* Batch Allocation */}
                  {line.fruitId && line.varietyId && (
                    <div className="space-y-1.5 pt-1 border-t border-leaf-100">
                      <p className="inline-flex items-center gap-1 text-2xs font-bold text-leaf-900">
                        <Boxes className="h-3.5 w-3.5 text-leaf-600" />
                        Batch Allocation
                      </p>
                      {lineBatches.length === 0 ? (
                        <p className="rounded bg-cream-100 px-2 py-1 text-2xs font-semibold text-leaf-700">
                          No available batches.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {lineBatches.map((batch) => {
                            const rawVal = line.allocations[batch.batch_id] ?? '';
                            const thisLineQty = parseNonNegativeInt(rawVal);
                            const safeThisLine = Number.isNaN(thisLineQty) ? 0 : thisLineQty;
                            const globalQty = totalAllocatedByBatch.get(batch.batch_id) ?? 0;
                            const allocatedElsewhere = Math.max(0, globalQty - safeThisLine);
                            const maxForThisLine = Math.max(
                              0,
                              batch.boxes_remaining - allocatedElsewhere
                            );
                            const exceeds =
                              !Number.isNaN(thisLineQty) && thisLineQty > maxForThisLine;
                            const invalidInt =
                              rawVal.trim() !== '' && !WHOLE_NON_NEGATIVE_INT.test(rawVal.trim());

                            return (
                              <div
                                key={batch.batch_id}
                                className={`flex items-center justify-between gap-2 rounded-lg border p-2 text-2xs ${
                                  exceeds || invalidInt
                                    ? 'border-red-300 bg-red-50'
                                    : safeThisLine > 0
                                    ? 'border-leaf-500 bg-leaf-50/60'
                                    : 'border-leaf-100 bg-cream-50'
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-extrabold text-leaf-950">
                                    {batch.delivery_no}
                                  </p>
                                  <p className="text-leaf-600 text-[10px]">
                                    {batch.supplier_name} • {maxForThisLine} avail
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    max={maxForThisLine}
                                    step="1"
                                    placeholder="0"
                                    value={rawVal}
                                    onChange={(e) =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        e.target.value
                                      )
                                    }
                                    disabled={saving}
                                    className="tabular-nums w-14 rounded border border-leaf-300 bg-white px-1.5 py-0.5 text-right text-xs font-bold text-leaf-950 focus:border-leaf-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500/30"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving || maxForThisLine === 0}
                                    onClick={() =>
                                      handleBatchAllocationChange(
                                        line.key,
                                        batch.batch_id,
                                        String(maxForThisLine)
                                      )
                                    }
                                    className="rounded bg-leaf-100 hover:bg-leaf-200 px-1.5 py-0.5 text-2xs font-bold text-leaf-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-1"
                                  >
                                    Max
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Line Total */}
                  <div className="flex items-center justify-between rounded-lg bg-cream-100 px-3 py-1.5 text-xs">
                    <span className="font-bold text-leaf-700">Item Total:</span>
                    <span className="tabular-nums font-display font-extrabold text-leaf-950">
                      ₹{summary.lineTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                </Card>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              icon={Plus}
              onClick={addLine}
              disabled={saving}
            >
              Add Row
            </Button>
          </div>

          {/* SECTION 3: SAVE & PRINT ACTION AT THE BOTTOM */}
          <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 py-2.5 bg-white/95 backdrop-blur border-t border-leaf-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              {onNavigate && (
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  icon={ReceiptText}
                  onClick={() => onNavigate('bills')}
                >
                  Sales History
                </Button>
              )}
              {isOverpaid && (
                <span className="text-xs font-bold text-red-600">
                  Paid exceeds bill by ₹{(totalPaid - subtotal).toLocaleString('en-IN')}
                </span>
              )}
              {isCashCustomerWithCredit && (
                <span className="text-xs font-bold text-mango-700">
                  Walk-in cannot take credit (collect full amount)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="md"
                variant="secondary"
                icon={saving ? Loader2 : CheckCircle2}
                disabled={saving || hasAnyStockIssue || isOverpaid || isCashCustomerWithCredit || subtotal <= 0}
                onClick={() => void handleSaveBill(false)}
              >
                {saving ? 'Saving…' : 'Save Bill'}
              </Button>

              <Button
                type="button"
                size="md"
                variant="primary"
                icon={saving ? Loader2 : Printer}
                disabled={saving || hasAnyStockIssue || isOverpaid || isCashCustomerWithCredit || subtotal <= 0}
                onClick={() => void handleSaveBill(true)}
              >
                {saving ? 'Saving…' : 'Save & Print'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Printable Receipt Modal */}
      {printBillId && (
        <PrintableBillModal
          billId={printBillId}
          balanceSummary={printBalanceSummary}
          customerPhone={printCustomerPhone}
          paymentMode={printPaymentMode}
          autoPrint={autoPrintTrigger}
          onAutoPrintDone={() => setAutoPrintTrigger(false)}
          onClose={() => {
            setPrintBillId(null);
            setPrintBalanceSummary(null);
            setAutoPrintTrigger(false);
          }}
        />
      )}

      {/* WhatsApp Share Modal */}
      {whatsAppModalOpen && lastSavedSale && (
        <WhatsAppShareModal
          open={whatsAppModalOpen}
          billId={lastSavedSale.billId}
          customerPhone={lastSavedSale.phone}
          closingBalance={lastSavedSale.closingBalance}
          paymentMode={lastSavedSale.paymentChoice.toUpperCase()}
          onClose={() => setWhatsAppModalOpen(false)}
        />
      )}
    </div>
  );
}

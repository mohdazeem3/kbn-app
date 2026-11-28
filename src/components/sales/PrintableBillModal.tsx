import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { formatDisplayDate } from '@/services/inventory';
import { getBillDetail } from '@/services/sales';
import { listCustomerBalances } from '@/services/accounts';
import { WhatsAppShareModal } from '@/components/sales/WhatsAppShareModal';
import { normalizeIndianMobile } from '@/services/whatsapp';
import { ThermalPrintBar } from '@/components/common/ThermalPrintBar';
import { useQzThermalPrinter } from '@/services/qzService';
import { KBN_LOGO_DATA_URL } from '@/assets/kbnLogoBase64';
import { downloadBillReceiptPdf } from '@/services/receiptPdfService';
import type { BillDetail } from '@/types/database';

export interface CustomerBalanceSummary {
  openingBalance: number;
  billAmount: number;
  paidAmount: number;
  closingBalance: number;
}

interface PrintableBillModalProps {
  billId: string | null;
  initialBillDetail?: BillDetail | null;
  balanceSummary?: CustomerBalanceSummary | null;
  customerPhone?: string | null;
  paymentMode?: string | null;
  autoPrint?: boolean;
  onAutoPrintDone?: () => void;
  onClose: () => void;
}

export function PrintableBillModal({
  billId,
  initialBillDetail = null,
  balanceSummary = null,
  customerPhone = null,
  paymentMode = null,
  autoPrint = false,
  onAutoPrintDone,
  onClose,
}: PrintableBillModalProps) {
  const [detail, setDetail] = useState<BillDetail | null>(initialBillDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedBalance, setResolvedBalance] = useState<CustomerBalanceSummary | null>(
    balanceSummary
  );
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const autoPrintedBillIdRef = useRef<string | null>(null);

  useEffect(() => {
    setResolvedBalance(balanceSummary);
  }, [balanceSummary]);

  useEffect(() => {
    if (initialBillDetail) {
      setDetail(initialBillDetail);
      return;
    }
    if (!billId) {
      setDetail(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    async function fetchDetail() {
      try {
        const data = await getBillDetail(billId!);
        if (!isMounted) return;
        setDetail(data);

        // If balanceSummary was not provided, fetch customer balance to compute ledger summary
        if (!balanceSummary) {
          if (data.bill.is_cash_customer || !data.bill.customer_id) {
            setResolvedBalance({
              openingBalance: 0,
              billAmount: data.bill.subtotal,
              paidAmount: data.bill.amount_paid,
              closingBalance: 0,
            });
          } else {
            try {
              const balances = await listCustomerBalances();
              const custBal = balances.find((b) => b.customer_id === data.bill.customer_id);
              if (custBal && isMounted) {
                // The current ledger outstanding balance already includes this active bill (if it's active)
                // Outstanding before this bill:
                const currentOutstanding = custBal.outstanding_balance;
                const billUnpaid = data.bill.outstanding_amount;
                const openingBal = Math.max(0, currentOutstanding - billUnpaid);
                setResolvedBalance({
                  openingBalance: openingBal,
                  billAmount: data.bill.subtotal,
                  paidAmount: data.bill.amount_paid,
                  closingBalance: openingBal + data.bill.subtotal - data.bill.amount_paid,
                });
              }
            } catch {
              // Non-critical fallback
              if (isMounted) {
                setResolvedBalance({
                  openingBalance: 0,
                  billAmount: data.bill.subtotal,
                  paidAmount: data.bill.amount_paid,
                  closingBalance: data.bill.outstanding_amount,
                });
              }
            }
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Could not load bill details for printing.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void fetchDetail();

    return () => {
      isMounted = false;
    };
  }, [billId, initialBillDetail, balanceSummary]);

  // Total boxes calculation
  const totalBoxes = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce((sum, item) => sum + item.boxes, 0);
  }, [detail]);

  // Payment breakdown (Cash / UPI)
  const paymentBreakdown = useMemo(() => {
    if (!detail) return { cash: 0, upi: 0 };
    let cash = 0;
    let upi = 0;
    for (const pa of detail.paymentAllocations) {
      if (pa.status === 'active') {
        if (pa.mode === 'cash') cash += pa.amount;
        if (pa.mode === 'upi') upi += pa.amount;
      }
    }
    return {
      cash: Math.round(cash * 100) / 100,
      upi: Math.round(upi * 100) / 100,
    };
  }, [detail]);

  // QZ Tray thermal printer hook
  const qz = useQzThermalPrinter({ receiptContainerId: 'printable-thermal-receipt' });

  // Reset auto-print lock when autoPrint is disabled or billId changes
  useEffect(() => {
    if (!autoPrint) {
      autoPrintedBillIdRef.current = null;
    }
  }, [autoPrint, billId]);

  // Handle autoPrint if requested - with single-print ref guard
  useEffect(() => {
    if (!autoPrint || !detail || loading) return;

    const currentBillId = detail.bill.bill_id;
    if (autoPrintedBillIdRef.current === currentBillId) {
      return;
    }

    const timer = setTimeout(() => {
      if (autoPrintedBillIdRef.current !== currentBillId) {
        autoPrintedBillIdRef.current = currentBillId;
        onAutoPrintDone?.();
        if (qz.confirmedPrinter) {
          void qz.printDirect();
        } else {
          qz.setShowConfig(true);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [autoPrint, detail, loading, qz, onAutoPrintDone]);

  if (!billId && !initialBillDetail) return null;

  const bill = detail?.bill;
  const items = detail?.items ?? [];

  // Effective ledger figures
  const openingBal = resolvedBalance?.openingBalance ?? 0;
  const billAmt = resolvedBalance?.billAmount ?? (bill ? bill.subtotal : 0);
  const paidAmt = resolvedBalance?.paidAmount ?? (bill ? bill.amount_paid : 0);
  const closingBal =
    resolvedBalance?.closingBalance ??
    (bill?.is_cash_customer ? 0 : openingBal + billAmt - paidAmt);

  return (
    <Modal
      open={Boolean(billId || initialBillDetail)}
      title="Print Tax Receipt"
      subtitle={bill ? `Receipt preview for ${bill.bill_no}` : undefined}
      onClose={onClose}
    >
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-8 text-leaf-700">
            <Loader2 className="h-8 w-8 animate-spin text-leaf-600 mb-2" />
            <p className="text-sm font-semibold">Preparing receipt for printing…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : bill ? (
          <>
            {/* Top Action & Printer Bar */}
            <ThermalPrintBar
              qz={qz}
              onClose={onClose}
              onDownloadPdf={() => {
                if (detail) {
                  downloadBillReceiptPdf(detail, {
                    balanceSummary: resolvedBalance,
                    paymentBreakdown,
                  });
                }
              }}
              whatsappAction={
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="!bg-[#25D366] hover:!bg-[#1EBE5D] text-white border-0 shadow-sm"
                  icon={MessageCircle}
                  onClick={() => setShowWhatsApp(true)}
                >
                  Share on WhatsApp
                </Button>
              }
            />

            {/* Thermal Receipt Visual Preview Box */}
            <div className="flex justify-center bg-stone-200/60 p-4 sm:p-6 rounded-2xl overflow-x-auto">
              <div
                id="printable-thermal-receipt"
                className="w-full max-w-[320px] bg-white p-5 shadow-md border border-stone-300 font-mono text-xs leading-relaxed text-black"
                style={{
                  fontFamily: 'Consolas, "Segoe UI Mono", "Courier New", Courier, monospace',
                  letterSpacing: '-0.02em',
                }}
              >
                {/* Shop Header with Official Logo */}
                <div className="text-center space-y-1 pb-2">
                  <div className="flex justify-center pb-1">
                    <img
                      src={KBN_LOGO_DATA_URL}
                      alt="KBN Fruits & Traders Logo"
                      className="h-20 w-20 object-contain rounded-full shadow-sm"
                      style={{
                        display: 'block',
                        margin: '0 auto',
                        maxWidth: '80px',
                        maxHeight: '80px',
                        aspectRatio: '1 / 1',
                        objectFit: 'contain',
                      }}
                    />
                  </div>

                  <h1 className="text-2xl font-black uppercase tracking-wider text-black">
                    KBN FRUITS
                  </h1>

                  <p className="text-[12px] font-semibold text-black">
                    T/B 43, ANNA FRUITS MARKET, KOYAMBEDU, CHENNAI - 600092
                  </p>
                  <p className="text-[12px] font-semibold text-black">
                    Phone: +91-6383842405
                  </p>
                </div>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Bill Meta */}
                <div className="space-y-0.5 text-[11px] font-semibold text-black">
                  <div className="flex justify-between">
                    <span className="font-bold">Bill No:</span>
                    <span className="font-black uppercase">{bill.bill_no}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span className="font-bold">{formatDisplayDate(bill.bill_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span className="font-bold truncate max-w-[170px] text-right">
                      {bill.customer_name_snapshot}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment Mode:</span>
                    <span className="font-bold uppercase">
                      {bill.is_cash_customer ? 'Walk-in Cash' : bill.payment_status}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Items Table */}
                <table className="w-full text-left text-[11px] border-collapse font-semibold text-black">
                  <thead>
                    <tr className="border-b border-stone-800 font-bold">
                      <th className="py-1 text-left w-6">#</th>
                      <th className="py-1 text-left">Item</th>
                      <th className="py-1 text-center w-10">Bx</th>
                      <th className="py-1 text-right w-12">Rate</th>
                      <th className="py-1 text-right w-14">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-stone-400">
                    {items.map((item, idx) => (
                      <tr key={item.id} className="align-top">
                        <td className="py-1 font-bold">{idx + 1}</td>
                        <td className="py-1 font-bold pr-1">
                          <div>{item.fruit_name_snapshot}</div>
                          <div className="text-[10px] font-semibold text-black">
                            {item.variety_name_snapshot}
                          </div>
                        </td>
                        <td className="py-1 text-center font-black">{item.boxes}</td>
                        <td className="py-1 text-right font-bold tabular-nums">
                          {item.sell_rate}
                        </td>
                        <td className="py-1 text-right font-black tabular-nums">
                          {item.line_total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Subtotals */}
                <div className="space-y-0.5 text-[11px] font-semibold text-black">
                  <div className="flex justify-between font-bold">
                    <span>Total Boxes:</span>
                    <span className="font-black">{totalBoxes} boxes</span>
                  </div>
                  <div className="flex justify-between text-xs font-black">
                    <span>Bill Amount:</span>
                    <span className="tabular-nums">
                      ₹{bill.subtotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {paymentBreakdown.cash > 0 && (
                    <div className="flex justify-between font-bold text-black">
                      <span>• Paid Cash:</span>
                      <span className="tabular-nums font-black">
                        ₹{paymentBreakdown.cash.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}
                  {paymentBreakdown.upi > 0 && (
                    <div className="flex justify-between font-bold text-black">
                      <span>• Paid UPI:</span>
                      <span className="tabular-nums font-black">
                        ₹{paymentBreakdown.upi.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold">
                    <span>Total Paid Now:</span>
                    <span className="tabular-nums font-black">
                      ₹{bill.amount_paid.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                {/* Customer Balance Summary: 4 Mandatory Ledger Fields */}
                <div className="border-t-2 border-stone-800 my-2 pt-1 font-semibold text-black">
                  <p className="text-[10px] font-black uppercase tracking-wider text-center mb-1">
                    CUSTOMER BALANCE SUMMARY
                  </p>
                  {bill.is_cash_customer ? (
                    <div className="bg-stone-100 p-1.5 rounded text-[10px] space-y-0.5 text-center text-black">
                      <p className="font-bold">Walk-in Cash Customer</p>
                      <p className="font-semibold">Paid in Full • Closing Balance: ₹0.00</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5 text-[11px] font-semibold text-black">
                      <div className="flex justify-between">
                        <span>1. Opening Balance:</span>
                        <span className="tabular-nums font-bold">
                          ₹{openingBal.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>2. Bill Amount:</span>
                        <span className="tabular-nums font-bold">
                          ₹{billAmt.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>3. Paid Amount:</span>
                        <span className="tabular-nums font-bold">
                          ₹{paidAmt.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-stone-600 pt-0.5 font-bold text-xs">
                        <span>4. Closing Balance:</span>
                        <span className="tabular-nums font-black">
                          ₹{closingBal.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {bill.note && (
                  <div className="border-t border-dotted border-stone-500 my-1.5 pt-1 text-[10px] font-semibold text-black">
                    <span className="font-bold">Note: </span>
                    <span>{bill.note}</span>
                  </div>
                )}

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Footer Notes */}
                <div className="text-center text-[10px] space-y-0.5 text-black font-semibold">
                  <p className="font-bold text-black">Thank you for your business!</p>

                  <p className="text-[9px] font-bold text-black pt-1">
                    KBN FRUITS
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {showWhatsApp && bill && (
        <WhatsAppShareModal
          open={showWhatsApp}
          billId={bill.bill_id}
          initialBillDetail={detail}
          customerPhone={customerPhone}
          closingBalance={closingBal}
          paymentMode={paymentMode}
          autoOpenWhatsApp={Boolean(customerPhone && normalizeIndianMobile(customerPhone))}
          onClose={() => setShowWhatsApp(false)}
        />
      )}
    </Modal>
  );
}

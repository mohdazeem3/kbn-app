import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui';
import { formatDisplayDate, getDeliveryDetail } from '@/services/inventory';
import { ThermalPrintBar } from '@/components/common/ThermalPrintBar';
import { useQzThermalPrinter } from '@/services/qzService';
import type { DeliveryDetailWithBatches } from '@/types/database';

export interface DeliveryPrintSnapshot {
  supplier_name: string;
  supplier_phone?: string;
  received_date: string;
  challan_no?: string;
  delivery_no?: string;
  items: {
    fruit_name: string;
    variety_name: string;
    boxes: number;
    purchase_rate: number;
    line_total: number;
  }[];
  total_boxes: number;
  total_amount: number;
  amount_paid: number;
  outstanding_amount: number;
  payment_mode?: string;
  note?: string;
}

interface PrintableDeliveryModalProps {
  deliveryId: string | null;
  snapshot?: DeliveryPrintSnapshot | null;
  autoPrint?: boolean;
  onAutoPrintDone?: () => void;
  onClose: () => void;
}

export function PrintableDeliveryModal({
  deliveryId,
  snapshot = null,
  autoPrint = false,
  onAutoPrintDone,
  onClose,
}: PrintableDeliveryModalProps) {
  const [detail, setDetail] = useState<DeliveryDetailWithBatches | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoPrintedDeliveryIdRef = useRef<string | null>(null);
  const qz = useQzThermalPrinter({ receiptContainerId: 'printable-thermal-receipt' });

  useEffect(() => {
    if (!deliveryId) {
      setDetail(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    async function fetchDetail() {
      try {
        const data = await getDeliveryDetail(deliveryId!);
        if (isMounted) {
          setDetail(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Could not load delivery details for printing.');
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
  }, [deliveryId]);

  // Reset auto-print lock when autoPrint is disabled or deliveryId changes
  useEffect(() => {
    if (!autoPrint) {
      autoPrintedDeliveryIdRef.current = null;
    }
  }, [autoPrint, deliveryId]);

  // Handle autoPrint if requested - with single-print ref guard
  useEffect(() => {
    if (!autoPrint || (!detail && !snapshot) || loading) return;

    const currentId = detail?.delivery.delivery_id ?? snapshot?.delivery_no ?? deliveryId;
    if (!currentId || autoPrintedDeliveryIdRef.current === currentId) {
      return;
    }

    const timer = setTimeout(() => {
      if (autoPrintedDeliveryIdRef.current !== currentId) {
        autoPrintedDeliveryIdRef.current = currentId;
        onAutoPrintDone?.();
        if (qz.confirmedPrinter) {
          void qz.printDirect();
        } else {
          qz.setShowConfig(true);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [autoPrint, detail, snapshot, loading, deliveryId, qz, onAutoPrintDone]);

  if (!deliveryId && !snapshot) return null;

  // Resolve display values from loaded detail or snapshot
  const deliveryNo = detail?.delivery.delivery_no ?? snapshot?.delivery_no ?? 'DEL-NEW';
  const supplierName = detail?.delivery.supplier_name ?? snapshot?.supplier_name ?? 'Supplier';
  const supplierPhone = snapshot?.supplier_phone;
  const receivedDate = detail?.delivery.received_date ?? snapshot?.received_date ?? '';
  const challanNote = detail?.delivery.note ?? snapshot?.challan_no ?? snapshot?.note ?? '';
  const totalBoxes = detail?.delivery.boxes_received ?? snapshot?.total_boxes ?? 0;
  const grandTotal = detail?.delivery.purchase_amount ?? snapshot?.total_amount ?? 0;
  const amountPaid = detail?.amount_paid ?? snapshot?.amount_paid ?? 0;
  const balanceDue =
    detail?.delivery.outstanding_amount ??
    snapshot?.outstanding_amount ??
    Math.max(0, grandTotal - amountPaid);
  const paymentStatus = detail?.delivery.payment_status ?? (amountPaid >= grandTotal ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid');

  const items = detail?.batches
    ? detail.batches.map((b) => ({
        fruit_name: b.fruit_name,
        variety_name: b.variety_name,
        boxes: b.boxes_received,
        rate: b.purchase_rate,
        total: b.purchase_amount,
      }))
    : snapshot?.items.map((i) => ({
        fruit_name: i.fruit_name,
        variety_name: i.variety_name,
        boxes: i.boxes,
        rate: i.purchase_rate,
        total: i.line_total,
      })) ?? [];

  return (
    <Modal
      open={Boolean(deliveryId || snapshot)}
      title="Print Delivery Receipt"
      subtitle={`Inward delivery receipt for ${deliveryNo}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        {loading && !snapshot ? (
          <div className="flex flex-col items-center justify-center p-8 text-leaf-700">
            <Loader2 className="h-8 w-8 animate-spin text-leaf-600 mb-2" />
            <p className="text-sm font-semibold">Preparing delivery receipt for printing…</p>
          </div>
        ) : error && !snapshot ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            {/* Top Action & Printer Bar */}
            <ThermalPrintBar qz={qz} onClose={onClose} />

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
                {/* Store Header */}
                <div className="text-center space-y-0.5 pb-2">
                  <h1 className="text-sm font-black uppercase tracking-wider text-black">
                    FRUIT WHOLESALE MANAGER
                  </h1>
                  <p className="text-[10px] uppercase font-bold text-black">
                    Inward Stock Receipt / Delivery Challan
                  </p>
                  <p className="text-[10px] font-semibold text-black">
                    APMC Fruit Market Yard • Gate 2
                  </p>
                  <p className="text-[10px] font-semibold text-black">
                    Phone: +91 98765 43210
                  </p>
                </div>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Delivery Meta */}
                <div className="space-y-0.5 text-[11px] font-semibold text-black">
                  <div className="flex justify-between">
                    <span className="font-bold">Delivery No:</span>
                    <span className="font-black uppercase">{deliveryNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span className="font-bold">{receivedDate ? formatDisplayDate(receivedDate) : 'Today'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Supplier:</span>
                    <span className="font-bold truncate max-w-[170px] text-right">
                      {supplierName}
                    </span>
                  </div>
                  {supplierPhone && (
                    <div className="flex justify-between">
                      <span>Phone:</span>
                      <span className="font-bold">{supplierPhone}</span>
                    </div>
                  )}
                  {challanNote && (
                    <div className="flex justify-between">
                      <span>Challan/Lorry:</span>
                      <span className="font-bold">{challanNote}</span>
                    </div>
                  )}
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
                      <tr key={idx} className="align-top">
                        <td className="py-1 font-bold">{idx + 1}</td>
                        <td className="py-1 font-bold pr-1">
                          <div>{item.fruit_name}</div>
                          <div className="text-[10px] font-semibold text-black">
                            {item.variety_name}
                          </div>
                        </td>
                        <td className="py-1 text-center font-black">{item.boxes}</td>
                        <td className="py-1 text-right font-bold tabular-nums">
                          {item.rate}
                        </td>
                        <td className="py-1 text-right font-black tabular-nums">
                          {item.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Totals & Payments */}
                <div className="space-y-0.5 text-[11px] font-semibold text-black">
                  <div className="flex justify-between font-bold">
                    <span>Total Received:</span>
                    <span className="font-black">{totalBoxes} boxes</span>
                  </div>
                  <div className="flex justify-between text-xs font-black">
                    <span>Total Purchase:</span>
                    <span className="tabular-nums">
                      ₹{grandTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-black">
                    <span>Amount Paid Now:</span>
                    <span className="tabular-nums font-black">
                      ₹{amountPaid.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-xs pt-0.5 border-t border-stone-600">
                    <span>Balance Due:</span>
                    <span className="tabular-nums font-black">
                      ₹{balanceDue.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-black pt-0.5">
                    <span>Payment Status:</span>
                    <span className="uppercase font-black">{paymentStatus}</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-stone-800 my-2" />

                {/* Footer Notes */}
                <div className="text-center text-[10px] space-y-0.5 text-black font-semibold">
                  <p className="font-bold text-black">Stock Received In Good Condition</p>
                  <p className="text-[9px] font-bold text-black pt-1">
                    FruitWholesale Manager
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

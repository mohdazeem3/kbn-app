import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Phone,
  X,
} from 'lucide-react';
import { Button, Modal, TextInput } from '@/components/ui';
import { getBillDetail } from '@/services/sales';
import { listCustomerBalances } from '@/services/accounts';
import {
  buildWhatsAppChatUrl,
  copyToClipboard,
  formatDisplayPhone,
  generateWhatsAppInvoiceMessage,
  normalizeIndianMobile,
} from '@/services/whatsapp';
import type { BillDetail } from '@/types/database';

interface WhatsAppShareModalProps {
  open: boolean;
  onClose: () => void;
  billId: string | null;
  initialBillDetail?: BillDetail | null;
  customerPhone?: string | null;
  closingBalance?: number | null;
  paymentMode?: string | null;
  autoOpenWhatsApp?: boolean;
}

export function WhatsAppShareModal({
  open,
  onClose,
  billId,
  initialBillDetail = null,
  customerPhone = '',
  closingBalance = null,
  paymentMode = null,
  autoOpenWhatsApp = false,
}: WhatsAppShareModalProps) {
  const [detail, setDetail] = useState<BillDetail | null>(initialBillDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState<string>(customerPhone ?? '');
  const [resolvedClosingBalance, setResolvedClosingBalance] = useState<number>(closingBalance ?? 0);
  const [copied, setCopied] = useState(false);
  const [hasAttemptedAutoOpen, setHasAttemptedAutoOpen] = useState(false);

  // Sync phoneInput when customerPhone changes or when modal opens
  useEffect(() => {
    if (open) {
      setPhoneInput(customerPhone ?? '');
      setCopied(false);
      setHasAttemptedAutoOpen(false);
      if (closingBalance !== null && closingBalance !== undefined) {
        setResolvedClosingBalance(closingBalance);
      }
    }
  }, [open, customerPhone, closingBalance]);

  // Load bill detail if not supplied
  useEffect(() => {
    if (!open) return;
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

    async function fetchBill() {
      try {
        const data = await getBillDetail(billId!);
        if (!isMounted) return;
        setDetail(data);

        // If closing balance was not provided, compute it
        if (closingBalance === null || closingBalance === undefined) {
          if (data.bill.is_cash_customer || !data.bill.customer_id) {
            setResolvedClosingBalance(0);
          } else {
            try {
              const balances = await listCustomerBalances();
              const custBal = balances.find((b) => b.customer_id === data.bill.customer_id);
              if (custBal && isMounted) {
                setResolvedClosingBalance(custBal.outstanding_balance);
              }
            } catch {
              if (isMounted) {
                setResolvedClosingBalance(data.bill.outstanding_amount);
              }
            }
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Could not load bill details for WhatsApp.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void fetchBill();

    return () => {
      isMounted = false;
    };
  }, [open, billId, initialBillDetail, closingBalance]);

  // Normalization
  const normalizedPhone = useMemo(() => normalizeIndianMobile(phoneInput), [phoneInput]);

  // Invoice message
  const invoiceMessage = useMemo(() => {
    if (!detail) return '';
    return generateWhatsAppInvoiceMessage({
      bill: detail.bill,
      items: detail.items,
      closingBalance: resolvedClosingBalance,
      paymentMode,
    });
  }, [detail, resolvedClosingBalance, paymentMode]);

  // Handle auto-open once detail & phone are ready if requested
  useEffect(() => {
    if (open && autoOpenWhatsApp && !hasAttemptedAutoOpen && detail && normalizedPhone && invoiceMessage) {
      setHasAttemptedAutoOpen(true);
      const url = buildWhatsAppChatUrl(normalizedPhone, invoiceMessage);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [open, autoOpenWhatsApp, hasAttemptedAutoOpen, detail, normalizedPhone, invoiceMessage]);

  const handleOpenWhatsApp = () => {
    if (!normalizedPhone || !invoiceMessage) return;
    const url = buildWhatsAppChatUrl(normalizedPhone, invoiceMessage);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyMessage = async () => {
    if (!invoiceMessage) return;
    const success = await copyToClipboard(invoiceMessage);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (!open) return null;

  const bill = detail?.bill;

  return (
    <Modal
      open={open}
      title="Share on WhatsApp"
      subtitle={bill ? `Invoice #${bill.bill_no} • ${bill.customer_name_snapshot}` : undefined}
      onClose={onClose}
    >
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-8 text-leaf-700">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-2" />
            <p className="text-sm font-semibold">Preparing invoice message for WhatsApp…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : bill ? (
          <>
            {/* Phone Number Input & Validation Badge */}
            <div className="space-y-1.5 rounded-xl border border-leaf-200 bg-cream-50 p-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="whatsapp-recipient-phone"
                  className="flex items-center gap-1.5 text-xs font-bold text-leaf-950"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-700" />
                  Customer WhatsApp Mobile Number
                </label>
                {normalizedPhone ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-extrabold text-emerald-800">
                    <Check className="h-3 w-3" />
                    {formatDisplayPhone(normalizedPhone)}
                  </span>
                ) : (
                  <span className="text-2xs font-bold text-mango-800">10-digit number required</span>
                )}
              </div>

              <TextInput
                id="whatsapp-recipient-phone"
                type="tel"
                placeholder="Enter 10-digit mobile number (e.g. 9876543210)"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                compact
                className="!h-9 !py-1.5 !px-3 !text-sm font-semibold bg-white"
              />

              {!normalizedPhone && (
                <div className="flex items-start gap-1.5 pt-1 text-2xs font-semibold text-mango-800">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-mango-600 mt-0.5" />
                  <span>
                    No valid mobile number available. Enter a 10-digit mobile number above to open WhatsApp directly, or copy the message below to share manually.
                  </span>
                </div>
              )}
            </div>

            {/* Formatted Invoice Message Preview Bubble */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600">
                  Invoice Message Preview
                </span>
                <span className="text-2xs font-medium text-stone-500">
                  Exact message sent to WhatsApp
                </span>
              </div>
              <div className="relative rounded-xl border border-emerald-300 bg-emerald-50/40 p-3.5 font-mono text-xs leading-relaxed text-stone-900 shadow-inner max-h-64 overflow-y-auto select-all whitespace-pre-wrap">
                {invoiceMessage}
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-leaf-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={copied ? Check : Copy}
                onClick={() => void handleCopyMessage()}
                className={copied ? 'text-emerald-700 border-emerald-300 bg-emerald-50' : ''}
              >
                {copied ? 'Copied to Clipboard!' : 'Copy Message'}
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={X}
                  onClick={onClose}
                >
                  Close
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="!bg-[#25D366] hover:!bg-[#1EBE5D] text-white border-0 shadow-sm disabled:opacity-50"
                  icon={MessageCircle}
                  disabled={!normalizedPhone}
                  onClick={handleOpenWhatsApp}
                >
                  <span className="inline-flex items-center gap-1">
                    Open in WhatsApp
                    <ExternalLink className="h-3 w-3 ml-0.5 opacity-80" />
                  </span>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

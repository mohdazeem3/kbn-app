import { formatDisplayDate } from '@/services/inventory';
import type { BillBalance, BillDetail, BillItemDetail } from '@/types/database';

/**
 * Normalizes an Indian mobile number to E.164-compatible format without '+'
 * for WhatsApp wa.me links (e.g. 919876543210).
 * Handles numbers with or without +91, with spaces, hyphens, or leading 0.
 * Returns null if the number is invalid or cannot be normalized.
 */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // 10 digits (e.g. 9876543210): prepend 91
  if (digits.length === 10) {
    return `91${digits}`;
  }

  // 11 digits starting with 0 (e.g. 09876543210): strip 0 and prepend 91
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }

  // 12 digits starting with 91 (e.g. 919876543210): valid as-is
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  // 13 digits starting with 910 (e.g. 9109876543210): strip the 0
  if (digits.length === 13 && digits.startsWith('910')) {
    return `91${digits.slice(3)}`;
  }

  // Other standard international numbers between 11 and 15 digits
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }

  return null;
}

/**
 * Formats a normalized or raw phone number for friendly human display (e.g. +91 98765 43210)
 */
export function formatDisplayPhone(normalizedOrRaw: string | null | undefined): string {
  if (!normalizedOrRaw) return '';
  const digits = normalizedOrRaw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const main = digits.slice(2);
    return `+91 ${main.slice(0, 5)} ${main.slice(5)}`;
  }
  return normalizedOrRaw.trim().startsWith('+') ? normalizedOrRaw.trim() : `+${digits}`;
}

/**
 * Formats an amount with Indian comma grouping (e.g. 12,500 or 1,200.50)
 */
export function formatIndianAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  const isWhole = Math.round(amount) === amount;
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Derives the payment mode string (CASH, CREDIT, UPI, SPLIT)
 */
export function derivePaymentMode(
  bill: { subtotal: number; amount_paid: number; is_cash_customer?: boolean },
  allocations?: { mode: 'cash' | 'upi'; amount: number; status: string }[],
  explicitMode?: string | null
): string {
  if (explicitMode) {
    const upper = explicitMode.toUpperCase();
    if (['CASH', 'CREDIT', 'UPI', 'SPLIT'].includes(upper)) {
      return upper;
    }
  }

  if (bill.amount_paid <= 0) {
    return 'CREDIT';
  }

  const activeAllocs = (allocations ?? []).filter((a) => a.status === 'active' && a.amount > 0);
  const hasCash = activeAllocs.some((a) => a.mode === 'cash');
  const hasUpi = activeAllocs.some((a) => a.mode === 'upi');

  if (hasCash && hasUpi) return 'SPLIT';
  if (hasUpi && !hasCash) return 'UPI';
  if (hasCash && !hasUpi) return 'CASH';

  return 'CASH';
}

export interface GenerateInvoiceMessageParams {
  bill: BillBalance | BillDetail['bill'];
  items: BillItemDetail[];
  closingBalance: number;
  paymentMode?: string | null;
  coolyCharges?: number;
}

/**
 * Generates the WhatsApp invoice message in the exact format required:
 *
 * 🍍 KBN FRUITS AND TRADERS 🍍
 * T/A-18,19,25, ANNA FRUITS MARKET, KOYAMBEDU
 * --------------------------------
 * 🧾 INVOICE #[ACTUAL_INVOICE_NUMBER]
 * 📅 Date: [ACTUAL_BILL_DATE]
 * 👤 Customer: [CUSTOMER_NAME]
 * 💳 Mode: [PAYMENT_MODE]
 * --------------------------------
 * ITEMS PURCHASED:
 * [ITEM_NUMBER]. [FRUIT_NAME] ([VARIETY_OR_GRADE]) - [BOX_COUNT] BOX @ Rs.[RATE] = Rs.[LINE_TOTAL]
 * --------------------------------
 * Gross Amount: Rs. [GROSS_AMOUNT]
 * Cooly Charges: Rs. [COOLY_CHARGES]
 * NET TOTAL: Rs. [NET_TOTAL]
 * Paid Amount: Rs. [PAID_AMOUNT]
 * CLOSING BALANCE: Rs. [CLOSING_BALANCE]
 * --------------------------------
 * Thank you for your business!
 */
export function generateWhatsAppInvoiceMessage({
  bill,
  items,
  closingBalance,
  paymentMode,
  coolyCharges = 0,
}: GenerateInvoiceMessageParams): string {
  const separator = '--------------------------------';
  const cleanBillNo = bill.bill_no.replace(/^#/, '');
  const formattedDate = formatDisplayDate(bill.bill_date);
  const customerName = bill.customer_name_snapshot || (bill.is_cash_customer ? 'Cash Customer' : 'Customer');
  const mode = derivePaymentMode(bill, undefined, paymentMode);

  const itemLines = items.map((item, idx) => {
    const num = idx + 1;
    const fruit = item.fruit_name_snapshot || 'Fruit';
    const variety = item.variety_name_snapshot || 'Standard';
    const boxes = item.boxes;
    const rate = formatIndianAmount(item.sell_rate);
    const lineTotal = formatIndianAmount(item.line_total);
    return `${num}. ${fruit} (${variety}) - ${boxes} BOX @ Rs.${rate} = Rs.${lineTotal}`;
  });

  const grossAmount = formatIndianAmount(bill.subtotal);
  const cooly = formatIndianAmount(coolyCharges);
  const netTotal = formatIndianAmount(bill.subtotal + coolyCharges);
  const paidAmount = formatIndianAmount(bill.amount_paid);
  const closingBal = formatIndianAmount(Math.max(0, closingBalance));

  const lines = [
    '🍍 KBN FRUITS AND TRADERS 🍍',
    'T/A-18,19,25, ANNA FRUITS MARKET, KOYAMBEDU',
    separator,
    `🧾 INVOICE #${cleanBillNo}`,
    `📅 Date: ${formattedDate}`,
    `👤 Customer: ${customerName}`,
    `💳 Mode: ${mode}`,
    separator,
    'ITEMS PURCHASED:',
    ...itemLines,
    separator,
    `Gross Amount: Rs. ${grossAmount}`,
    `Cooly Charges: Rs. ${cooly}`,
    `NET TOTAL: Rs. ${netTotal}`,
    `Paid Amount: Rs. ${paidAmount}`,
    `CLOSING BALANCE: Rs. ${closingBal}`,
    separator,
    'Thank you for your business!',
  ];

  return lines.join('\n');
}

/**
 * Builds the WhatsApp Click-to-Chat URL
 */
export function buildWhatsAppChatUrl(phone: string, message: string): string {
  const normalized = normalizeIndianMobile(phone);
  const recipient = normalized ?? phone.replace(/\D/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${recipient}?text=${encoded}`;
}

/**
 * Opens WhatsApp chat in a new tab/window
 */
export function openWhatsAppChat(phone: string, message: string): Window | null {
  const url = buildWhatsAppChatUrl(phone, message);
  return window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Copies text to clipboard safely
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Clipboard API failed, trying document.execCommand', err);
  }

  // Fallback for older browsers
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-999999px';
    textarea.style.top = '-999999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    console.error('Fallback clipboard copy failed', err);
    return false;
  }
}

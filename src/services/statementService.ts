import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDisplayDate } from './inventory';
import { normalizeIndianMobile, buildWhatsAppChatUrl } from './whatsapp';
import type { BillBalance, CustomerAccountDetail } from '@/types/database';

export type StatementPeriodType = 'all_time' | 'this_month' | 'last_month' | 'custom';

export interface StatementPeriod {
  type: StatementPeriodType;
  fromDate: string | null; // YYYY-MM-DD
  toDate: string | null;   // YYYY-MM-DD
  label: string;
}

export interface StatementLineItem {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  kind: 'opening_balance' | 'bill' | 'payment' | 'return' | 'refund';
  refNo: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  status: 'active' | 'cancelled';
  note?: string | null;
}

export interface StatementData {
  customer: {
    id: string;
    name: string;
    phone: string | null;
  };
  shop: {
    name: string;
    tagline: string;
    address: string;
    phone: string;
  };
  period: StatementPeriod;
  generatedAt: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: StatementLineItem[];
}

export const KBN_SHOP_INFO = {
  name: 'KBN FRUITS AND TRADERS',
  tagline: 'Commission Agent & Wholesale Fruit Merchant',
  address: 'T/A-18, 19, 25, Anna Fruit Market, Koyambedu, Chennai - 600092',
  phone: '+91 98765 43210',
};

/**
 * Format a number to Indian currency representation (e.g. 1,23,456.00)
 */
export function formatIndianCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '0.00';
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Derives start and end date strings (YYYY-MM-DD) for presets
 */
export function resolveStatementPeriod(
  type: StatementPeriodType,
  customFrom?: string | null,
  customTo?: string | null
): StatementPeriod {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (type === 'all_time') {
    return {
      type: 'all_time',
      fromDate: null,
      toDate: null,
      label: `Complete History (as of ${formatDisplayDate(formatYmd(now))})`,
    };
  }

  if (type === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = formatYmd(start);
    const toDate = formatYmd(now);
    return {
      type: 'this_month',
      fromDate,
      toDate,
      label: `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`,
    };
  }

  if (type === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const fromDate = formatYmd(start);
    const toDate = formatYmd(end);
    return {
      type: 'last_month',
      fromDate,
      toDate,
      label: `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`,
    };
  }

  // Custom
  const fromDate = customFrom || formatYmd(now);
  const toDate = customTo || formatYmd(now);
  return {
    type: 'custom',
    fromDate,
    toDate,
    label: `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`,
  };
}

/**
 * Formats the actual stored bill items into a clean multi-line description.
 * Includes fruit name, variety/grade, quantity (Box/Boxes), rate, and line total.
 * Returns null if no stored items are available.
 */
export function formatBillItemDetails(bill: BillBalance): string | null {
  const items = bill.items;
  if (!items || items.length === 0) {
    return null;
  }

  const lines = items.map((item, idx) => {
    const numPrefix = `${idx + 1}. `;
    const fruit = (item.fruit_name_snapshot || '').trim() || 'Fruit';
    const varietyRaw = (item.variety_name_snapshot || '').trim();
    const variety =
      varietyRaw && varietyRaw.toLowerCase() !== fruit.toLowerCase()
        ? ` (${varietyRaw})`
        : '';
    const boxUnit = item.boxes === 1 ? 'Box' : 'Boxes';
    const qty = `${item.boxes} ${boxUnit}`;
    const rateVal = Number(item.sell_rate);
    const totalVal = Number(item.line_total);
    const rateStr = `Rs. ${rateVal.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
    const totalStr = `Rs. ${totalVal.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;

    return `${numPrefix}${fruit}${variety} — ${qty} × ${rateStr} = ${totalStr}`;
  });

  return lines.join('\n');
}

/**
 * Builds the complete chronological statement data from customer ledger detail.
 * - Accurately computes opening balance as of FromDate.
 * - Computes running balance across all chronological entries.
 * - Prevents double counting of payment allocations and refunds.
 */
export function buildCustomerStatementData(
  detail: CustomerAccountDetail,
  periodType: StatementPeriodType = 'all_time',
  customFrom?: string | null,
  customTo?: string | null
): StatementData {
  const period = resolveStatementPeriod(periodType, customFrom, customTo);
  const rawTimeline: StatementLineItem[] = [];

  // 1. Opening Balances
  for (const ob of detail.openingBalances) {
    if (ob.status === 'active') {
      rawTimeline.push({
        id: `ob:${ob.id}`,
        date: ob.as_of_date,
        createdAt: ob.created_at,
        kind: 'opening_balance',
        refNo: 'OPENING',
        description: 'Starting balance carried forward',
        debit: ob.amount,
        credit: 0,
        runningBalance: 0,
        status: 'active',
        note: ob.note,
      });
    } else {
      rawTimeline.push({
        id: `ob:${ob.id}`,
        date: ob.as_of_date,
        createdAt: ob.created_at,
        kind: 'opening_balance',
        refNo: 'OPENING',
        description: `Cancelled opening balance${ob.cancel_reason ? ` (${ob.cancel_reason})` : ''}`,
        debit: 0,
        credit: 0,
        runningBalance: 0,
        status: 'cancelled',
        note: ob.note,
      });
    }
  }

  // 2. Bills (Sales)
  for (const b of detail.bills) {
    const itemDetails = formatBillItemDetails(b);

    if (b.status === 'cancelled') {
      const cancelHeader = b.cancel_reason
        ? `[CANCELLED • Reason: ${b.cancel_reason}]`
        : '[CANCELLED]';
      const desc = itemDetails
        ? `${cancelHeader}\n${itemDetails}`
        : `${cancelHeader} Fruit Sale Invoice`;

      rawTimeline.push({
        id: `bill:${b.bill_id}`,
        date: b.bill_date,
        createdAt: b.created_at,
        kind: 'bill',
        refNo: b.bill_no,
        description: desc,
        debit: 0,
        credit: 0,
        runningBalance: 0,
        status: 'cancelled',
        note: b.note,
      });
    } else {
      const desc = itemDetails || `Fruit Sale Invoice (${b.payment_status.toUpperCase()})`;
      const fullDesc = b.note ? `${desc}\nNote: ${b.note}` : desc;

      rawTimeline.push({
        id: `bill:${b.bill_id}`,
        date: b.bill_date,
        createdAt: b.created_at,
        kind: 'bill',
        refNo: b.bill_no,
        description: fullDesc,
        debit: b.subtotal,
        credit: 0,
        runningBalance: 0,
        status: 'active',
        note: b.note,
      });
    }
  }

  // 3. Customer Payments
  for (const p of detail.payments) {
    if (p.status === 'cancelled') {
      rawTimeline.push({
        id: `pay:${p.id}`,
        date: p.payment_date,
        createdAt: p.created_at,
        kind: 'payment',
        refNo: `PAY-${p.mode.toUpperCase()}`,
        description: `Cancelled Payment${p.cancel_reason ? `: ${p.cancel_reason}` : ''}`,
        debit: 0,
        credit: 0,
        runningBalance: 0,
        status: 'cancelled',
        note: p.note,
      });
    } else {
      const originDesc =
        p.payment_origin === 'bill_sale' ? 'Paid at sale time' : 'Collection payment';
      rawTimeline.push({
        id: `pay:${p.id}`,
        date: p.payment_date,
        createdAt: p.created_at,
        kind: 'payment',
        refNo: `PAY-${p.mode.toUpperCase()}`,
        description: `${p.mode.toUpperCase()} Received (${originDesc})`,
        debit: 0,
        credit: p.amount,
        runningBalance: 0,
        status: 'active',
        note: p.note,
      });
    }
  }

  // 4. Bill Returns (Credits)
  for (const ret of detail.returns ?? []) {
    const isRefunded = ret.refund_amount > 0;
    const desc = isRefunded
      ? `Goods returned for ${ret.bill_no} (${ret.total_boxes} bxs) • Cash refunded`
      : `Goods returned for ${ret.bill_no} (${ret.total_boxes} bxs) • Credited to bill`;

    rawTimeline.push({
      id: `ret:${ret.id}`,
      date: ret.return_date,
      createdAt: ret.created_at,
      kind: 'return',
      refNo: ret.return_no,
      description: desc,
      debit: 0,
      credit: ret.total_amount,
      runningBalance: 0,
      status: 'active',
      note: ret.reason,
    });
  }

  // 5. Customer Refunds (Debit: Cash handed to customer)
  for (const ref of detail.refunds) {
    rawTimeline.push({
      id: `ref:${ref.id}`,
      date: ref.refund_date,
      createdAt: ref.created_at,
      kind: 'refund',
      refNo: `REFUND-${ref.mode.toUpperCase()}`,
      description: `Refund paid for ${ref.bill_no} via ${ref.mode.toUpperCase()}`,
      debit: ref.amount,
      credit: 0,
      runningBalance: 0,
      status: 'active',
      note: ref.note,
    });
  }

  // Priority for intra-day sequencing:
  // 1. opening_balance
  // 2. bill
  // 3. payment
  // 4. return
  // 5. refund
  const kindPriority: Record<StatementLineItem['kind'], number> = {
    opening_balance: 1,
    bill: 2,
    payment: 3,
    return: 4,
    refund: 5,
  };

  // Sort chronological ascending (oldest first)
  rawTimeline.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const prioDiff = (kindPriority[a.kind] ?? 99) - (kindPriority[b.kind] ?? 99);
    if (prioDiff !== 0) return prioDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });

  // Calculate opening balance before FromDate and running balances during period
  let running = 0;
  let openingBalForPeriod = 0;
  let hasSetPeriodOpening = false;
  const filteredLines: StatementLineItem[] = [];

  for (const item of rawTimeline) {
    const isBeforePeriod = period.fromDate && item.date < period.fromDate;
    const isAfterPeriod = period.toDate && item.date > period.toDate;

    if (isBeforePeriod) {
      running += item.debit - item.credit;
      running = Math.round(running * 100) / 100;
    } else if (!isAfterPeriod) {
      if (!hasSetPeriodOpening) {
        openingBalForPeriod = running;
        hasSetPeriodOpening = true;
      }
      running += item.debit - item.credit;
      running = Math.round(running * 100) / 100;
      item.runningBalance = running;
      filteredLines.push(item);
    }
  }

  if (!hasSetPeriodOpening) {
    openingBalForPeriod = running;
  }

  const totalDebit = filteredLines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = filteredLines.reduce((sum, l) => sum + l.credit, 0);
  const closingBalance = Math.round((openingBalForPeriod + totalDebit - totalCredit) * 100) / 100;

  return {
    customer: {
      id: detail.balance.customer_id,
      name: detail.balance.name,
      phone: detail.balance.phone,
    },
    shop: KBN_SHOP_INFO,
    period,
    generatedAt: new Date().toISOString(),
    openingBalance: Math.round(openingBalForPeriod * 100) / 100,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    closingBalance,
    lines: filteredLines,
  };
}

/**
 * Generates an A4 portrait PDF document using jsPDF & jspdf-autotable
 */
export function generateCustomerStatementPdf(statement: StatementData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  // Colors
  const primaryGreen: [number, number, number] = [27, 77, 62]; // Forest Green #1B4D3E
  const darkText: [number, number, number] = [26, 32, 44];     // Slate 900
  const mutedText: [number, number, number] = [100, 116, 139]; // Slate 500
  const headerBg: [number, number, number] = [244, 247, 244];  // Soft Sage Cream
  const cardBorder: [number, number, number] = [203, 213, 225];// Slate 300

  // 1. Header: Shop Name & Details (Left) and Statement Title (Right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...primaryGreen);
  doc.text(statement.shop.name, marginX, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...mutedText);
  doc.text(statement.shop.tagline, marginX, 21);
  doc.text(statement.shop.address, marginX, 25.5);
  doc.text(`Phone: ${statement.shop.phone}`, marginX, 30);

  // Statement Header (Right aligned)
  const rightX = pageWidth - marginX;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...primaryGreen);
  doc.text('ACCOUNT STATEMENT', rightX, 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...darkText);
  doc.text(`Period: ${statement.period.label}`, rightX, 21, { align: 'right' });
  doc.setTextColor(...mutedText);
  doc.text(
    `Generated: ${formatDisplayDate(statement.generatedAt.slice(0, 10))}`,
    rightX,
    25.5,
    { align: 'right' }
  );

  // Top Divider
  doc.setDrawColor(...primaryGreen);
  doc.setLineWidth(0.6);
  doc.line(marginX, 34, rightX, 34);

  // 2. Customer & Financial Summary Box
  const summaryBoxY = 38;
  const summaryBoxH = 26;
  doc.setFillColor(...headerBg);
  doc.setDrawColor(...cardBorder);
  doc.setLineWidth(0.2);
  doc.roundedRect(marginX, summaryBoxY, pageWidth - marginX * 2, summaryBoxH, 2, 2, 'FD');

  // Customer Details (Left inside summary box)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...mutedText);
  doc.text('STATEMENT FOR:', marginX + 4, summaryBoxY + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...darkText);
  doc.text(statement.customer.name, marginX + 4, summaryBoxY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...mutedText);
  doc.text(
    `Mobile: ${statement.customer.phone || 'No phone recorded'}`,
    marginX + 4,
    summaryBoxY + 17
  );

  // Financial Metrics Grid (Right inside summary box)
  const colWidth = 32;
  const kpiStartX = pageWidth - marginX - colWidth * 4;

  const kpis = [
    { label: 'OPENING DUE', val: statement.openingBalance },
    { label: 'TOTAL DEBITS (+)', val: statement.totalDebit },
    { label: 'TOTAL CREDITS (−)', val: statement.totalCredit },
    { label: 'CLOSING DUE', val: statement.closingBalance, isClosing: true },
  ];

  kpis.forEach((kpi, idx) => {
    const kpiX = kpiStartX + idx * colWidth;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...mutedText);
    doc.text(kpi.label, kpiX + colWidth - 2, summaryBoxY + 6, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    if (kpi.isClosing) {
      doc.setTextColor(kpi.val > 0 ? 194 : 27, kpi.val > 0 ? 65 : 77, kpi.val > 0 ? 12 : 62); // Red or Forest
    } else {
      doc.setTextColor(...darkText);
    }
    doc.text(`Rs. ${formatIndianCurrency(kpi.val)}`, kpiX + colWidth - 2, summaryBoxY + 14, {
      align: 'right',
    });
  });

  // 3. Transactions Table (autoTable)
  const tableData: (string | number)[][] = [];

  // Opening balance row if non-zero or date filtered
  if (statement.period.fromDate || statement.openingBalance !== 0) {
    tableData.push([
      '-',
      statement.period.fromDate ? formatDisplayDate(statement.period.fromDate) : 'Start',
      'OPENING BALANCE',
      'Balance brought forward as of statement start',
      '-',
      '-',
      `Rs. ${formatIndianCurrency(statement.openingBalance)}`,
    ]);
  }

  // Line items
  statement.lines.forEach((l, idx) => {
    const num = idx + 1;
    const isCancelled = l.status === 'cancelled';
    const debitText = isCancelled
      ? '-'
      : l.debit > 0
        ? `Rs. ${formatIndianCurrency(l.debit)}`
        : '-';
    const creditText = isCancelled
      ? '-'
      : l.credit > 0
        ? `Rs. ${formatIndianCurrency(l.credit)}`
        : '-';
    const balanceText = isCancelled
      ? 'CANCELLED'
      : `Rs. ${formatIndianCurrency(l.runningBalance)}`;

    tableData.push([
      num,
      formatDisplayDate(l.date),
      l.refNo,
      l.description,
      debitText,
      creditText,
      balanceText,
    ]);
  });

  // If no transactions in period
  if (statement.lines.length === 0) {
    tableData.push([
      '',
      '',
      '',
      'No transactions recorded during this period.',
      '',
      '',
      `Rs. ${formatIndianCurrency(statement.closingBalance)}`,
    ]);
  }

  autoTable(doc, {
    startY: summaryBoxY + summaryBoxH + 4,
    margin: { left: marginX, right: marginX, top: 16, bottom: 14 },
    head: [['#', 'Date', 'Reference', 'Description', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)']],
    body: tableData,
    theme: 'grid',
    rowPageBreak: 'auto',
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
      textColor: darkText,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: primaryGreen,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [250, 252, 250],
    },
    columnStyles: {
      0: { cellWidth: 6, halign: 'center' },
      1: { cellWidth: 17, halign: 'center' },
      2: { cellWidth: 22, halign: 'left', fontStyle: 'bold' },
      3: { cellWidth: 'auto', halign: 'left' },
      4: { cellWidth: 19.5, halign: 'right' },
      5: { cellWidth: 19.5, halign: 'right' },
      6: { cellWidth: 21, halign: 'right', fontStyle: 'bold' },
    },
  });

  // Footer on every page with true total count: Page X of Y
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...mutedText);

    // Left footer
    doc.text(
      'KBN FRUITS AND TRADERS • Koyambedu Market • Computer Generated Statement',
      marginX,
      pageHeight - 8
    );

    // Right footer: Page X of Y
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  return doc;
}

/**
 * Returns formatted statement filename
 */
export function getStatementPdfFilename(statement: StatementData): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  const custName = sanitize(statement.customer.name.slice(0, 20));
  const from = statement.period.fromDate || 'all';
  const to = statement.period.toDate || 'time';
  return `Statement_${custName}_${from}_${to}.pdf`;
}

/**
 * Generates the WhatsApp summary message text matching the KBN standard
 */
export function generateStatementWhatsAppMessage(statement: StatementData): string {
  const separator = '--------------------------------';
  const custName = statement.customer.name;
  const periodLabel = statement.period.label;
  const opening = formatIndianCurrency(statement.openingBalance);
  const debit = formatIndianCurrency(statement.totalDebit);
  const credit = formatIndianCurrency(statement.totalCredit);
  const closing = formatIndianCurrency(statement.closingBalance);

  const lines = [
    '🍍 *KBN FRUITS AND TRADERS* 🍍',
    'T/A-18,19,25, Anna Fruit Market, Koyambedu',
    separator,
    '📋 *CUSTOMER ACCOUNT STATEMENT*',
    `👤 Customer: *${custName}*`,
    `📅 Period: ${periodLabel}`,
    separator,
    `Opening Due: Rs. ${opening}`,
    `Total Billed (+): Rs. ${debit}`,
    `Total Received (−): Rs. ${credit}`,
    separator,
    `*CURRENT OUTSTANDING DUE: Rs. ${closing}*`,
    separator,
    '📄 Detailed statement PDF attached.',
    'Thank you for your business!',
  ];

  return lines.join('\n');
}

/**
 * Export action:
 * - Downloads PDF on desktop.
 * - Invokes native PDF file share on supported mobile devices.
 */
export async function exportOrShareStatementPdf(
  statement: StatementData,
  mode: 'download' | 'whatsapp'
): Promise<{ success: boolean; sharedNatively: boolean; message?: string }> {
  const doc = generateCustomerStatementPdf(statement);
  const filename = getStatementPdfFilename(statement);

  if (mode === 'download') {
    doc.save(filename);
    return { success: true, sharedNatively: false };
  }

  // WhatsApp Mode
  const pdfBlob = doc.output('blob');
  const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
  const waMessage = generateStatementWhatsAppMessage(statement);
  const phone = statement.customer.phone || '';
  const normalizedPhone = normalizeIndianMobile(phone);

  // 1. Check if Web Share API with files is supported (Android Chrome / iOS Safari)
  if (
    typeof navigator !== 'undefined' &&
    navigator.canShare &&
    navigator.canShare({ files: [pdfFile] })
  ) {
    try {
      await navigator.share({
        title: `${statement.customer.name} - Account Statement`,
        text: waMessage,
        files: [pdfFile],
      });
      return { success: true, sharedNatively: true };
    } catch (err) {
      // User cancelled share or share failed; fallback to download + open WhatsApp
      if ((err as Error)?.name === 'AbortError') {
        return { success: false, sharedNatively: true, message: 'Share cancelled.' };
      }
    }
  }

  // 2. Fallback for desktop & unsupported browsers:
  // - Download PDF file directly
  doc.save(filename);

  // - Open WhatsApp click-to-chat with the summary message
  if (normalizedPhone) {
    const url = buildWhatsAppChatUrl(normalizedPhone, waMessage);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return {
    success: true,
    sharedNatively: false,
    message: normalizedPhone
      ? 'Statement downloaded. WhatsApp opened — attach the downloaded PDF file to your chat.'
      : 'Statement downloaded. Add a mobile number to share directly on WhatsApp.',
  };
}

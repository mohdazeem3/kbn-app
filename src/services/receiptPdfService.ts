import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { KBN_LOGO_DATA_URL } from '@/assets/kbnLogoBase64';
import { formatDisplayDate } from '@/services/inventory';
import type { BillDetail } from '@/types/database';
import type { CustomerBalanceSummary } from '@/components/sales/PrintableBillModal';

export interface ReceiptPdfOptions {
  balanceSummary?: CustomerBalanceSummary | null;
  paymentBreakdown?: { cash: number; upi: number };
}

/**
 * Generates a clean 80mm thermal receipt PDF matching the official receipt preview,
 * featuring the official KBN Fruits circular logo prominently at the top.
 */
export function generateBillReceiptPdf(
  detail: BillDetail,
  options?: ReceiptPdfOptions
): jsPDF {
  const { bill, items } = detail;
  const balanceSummary = options?.balanceSummary;
  const paymentBreakdown = options?.paymentBreakdown ?? { cash: 0, upi: 0 };

  const totalBoxes = items.reduce((sum, it) => sum + it.boxes, 0);

  const openingBal = balanceSummary?.openingBalance ?? 0;
  const billAmt = balanceSummary?.billAmount ?? bill.subtotal;
  const paidAmt = balanceSummary?.paidAmount ?? bill.amount_paid;
  const closingBal =
    balanceSummary?.closingBalance ??
    (bill.is_cash_customer ? 0 : openingBal + billAmt - paidAmt);

  // Dynamic receipt height based on content length
  const baseHeight = 118;
  const itemsHeight = Math.max(items.length * 8.5, 12);
  const paymentHeight =
    (paymentBreakdown.cash > 0 ? 4.5 : 0) + (paymentBreakdown.upi > 0 ? 4.5 : 0);
  const noteHeight = bill.note ? 8 : 0;
  const calculatedHeight = Math.max(170, baseHeight + itemsHeight + paymentHeight + noteHeight);

  const pageWidth = 80; // Standard 80mm receipt roll width
  const marginX = 5;
  const printableWidth = pageWidth - marginX * 2; // 70mm

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, calculatedHeight],
  });

  const centerX = pageWidth / 2;
  const rightX = pageWidth - marginX;

  // 1. Official Logo (Centered at top, 20mm x 20mm, preserving 1:1 original proportions)
  const logoSize = 20;
  const logoX = (pageWidth - logoSize) / 2;
  const logoY = 5;
  try {
    doc.addImage(KBN_LOGO_DATA_URL, 'JPEG', logoX, logoY, logoSize, logoSize);
  } catch (err) {
    console.warn('Could not add logo to receipt PDF:', err);
  }

  // 2. Shop Header
  let currentY = logoY + logoSize + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('KBN FRUITS', centerX, currentY, { align: 'center' });

  currentY += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('T/B 43, ANNA FRUITS MARKET, KOYAMBEDU, CHENNAI - 600092', centerX, currentY, {
    align: 'center',
  });

  currentY += 3.5;
  doc.text('Phone: +91-6383842405', centerX, currentY, { align: 'center' });

  // Dashed Divider
  currentY += 3;
  doc.setLineDashPattern([1, 1], 0);
  doc.setLineWidth(0.2);
  doc.line(marginX, currentY, rightX, currentY);

  // 3. Bill Metadata
  currentY += 4;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('Bill No:', marginX, currentY);
  doc.text(bill.bill_no, marginX + 13, currentY);

  doc.setFont('helvetica', 'normal');
  doc.text('Date:', rightX - 25, currentY);
  doc.setFont('helvetica', 'bold');
  doc.text(formatDisplayDate(bill.bill_date), rightX, currentY, { align: 'right' });

  currentY += 4;
  doc.setFont('helvetica', 'normal');
  doc.text('Customer:', marginX, currentY);
  doc.setFont('helvetica', 'bold');
  const custName =
    bill.customer_name_snapshot.length > 22
      ? bill.customer_name_snapshot.slice(0, 20) + '…'
      : bill.customer_name_snapshot;
  doc.text(custName, marginX + 13, currentY);

  doc.setFont('helvetica', 'normal');
  doc.text('Mode:', rightX - 25, currentY);
  doc.setFont('helvetica', 'bold');
  doc.text(
    bill.is_cash_customer ? 'Cash' : bill.payment_status.toUpperCase(),
    rightX,
    currentY,
    { align: 'right' }
  );

  currentY += 2.5;
  doc.line(marginX, currentY, rightX, currentY);

  // 4. Items Table
  const tableRows = items.map((item, idx) => [
    String(idx + 1),
    `${item.fruit_name_snapshot}\n${item.variety_name_snapshot}`,
    String(item.boxes),
    item.sell_rate.toLocaleString('en-IN'),
    item.line_total.toLocaleString('en-IN'),
  ]);

  autoTable(doc, {
    startY: currentY + 1.5,
    margin: { left: marginX, right: marginX },
    tableWidth: printableWidth,
    head: [['#', 'Item', 'Bx', 'Rate', 'Total']],
    body: tableRows,
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 6.5,
      textColor: [0, 0, 0],
      cellPadding: 1,
      overflow: 'linebreak',
    },
    headStyles: {
      fontStyle: 'bold',
      lineWidth: { bottom: 0.2 },
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 5 },
      1: { cellWidth: 28 },
      2: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 13, halign: 'right' },
      4: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
    },
  });

  const lastTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  currentY = (lastTable ? lastTable.finalY : currentY + itemsHeight) + 2;

  // Dashed Divider
  doc.line(marginX, currentY, rightX, currentY);

  // 5. Subtotals & Payment Details
  currentY += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('Total Boxes:', marginX, currentY);
  doc.text(`${totalBoxes} boxes`, rightX, currentY, { align: 'right' });

  currentY += 4;
  doc.setFontSize(7.5);
  doc.text('Bill Amount:', marginX, currentY);
  doc.text(`Rs. ${bill.subtotal.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });

  if (paymentBreakdown.cash > 0) {
    currentY += 4;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('• Paid Cash:', marginX + 2, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${paymentBreakdown.cash.toLocaleString('en-IN')}`, rightX, currentY, {
      align: 'right',
    });
  }

  if (paymentBreakdown.upi > 0) {
    currentY += 4;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('• Paid UPI:', marginX + 2, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${paymentBreakdown.upi.toLocaleString('en-IN')}`, rightX, currentY, {
      align: 'right',
    });
  }

  currentY += 4;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Total Paid Now:', marginX, currentY);
  doc.text(`Rs. ${bill.amount_paid.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });

  // 6. Customer Balance Summary (Double line top)
  currentY += 3;
  doc.setLineDashPattern([], 0); // Solid line
  doc.setLineWidth(0.4);
  doc.line(marginX, currentY, rightX, currentY);

  currentY += 3.5;
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('CUSTOMER BALANCE SUMMARY', centerX, currentY, { align: 'center' });

  if (bill.is_cash_customer) {
    currentY += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.text('Walk-in Cash Customer', centerX, currentY, { align: 'center' });
    currentY += 3;
    doc.text('Paid in Full • Closing Balance: Rs. 0.00', centerX, currentY, { align: 'center' });
  } else {
    currentY += 3.5;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('1. Opening Balance:', marginX, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${openingBal.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });

    currentY += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.text('2. Bill Amount:', marginX, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${billAmt.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });

    currentY += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.text('3. Paid Amount:', marginX, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${paidAmt.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });

    currentY += 3.5;
    doc.setFont('helvetica', 'bold');
    doc.text('4. Closing Balance:', marginX, currentY);
    doc.text(`Rs. ${closingBal.toLocaleString('en-IN')}`, rightX, currentY, { align: 'right' });
  }

  // 7. Optional Note
  if (bill.note) {
    currentY += 4;
    doc.setLineDashPattern([1, 1], 0);
    doc.setLineWidth(0.2);
    doc.line(marginX, currentY, rightX, currentY);
    currentY += 3.5;
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Note: ${bill.note}`, marginX, currentY);
  }

  // 8. Footer
  currentY += 4;
  doc.setLineDashPattern([1, 1], 0);
  doc.setLineWidth(0.2);
  doc.line(marginX, currentY, rightX, currentY);

  currentY += 4;
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Thank you for your business!', centerX, currentY, { align: 'center' });

  currentY += 3;
  doc.text('KBN FRUITS', centerX, currentY, { align: 'center' });

  return doc;
}

/**
 * Generates and triggers direct browser download of the bill receipt PDF.
 */
export function downloadBillReceiptPdf(
  detail: BillDetail,
  options?: ReceiptPdfOptions
): void {
  const doc = generateBillReceiptPdf(detail, options);
  const fileName = `Receipt_${detail.bill.bill_no || 'Bill'}.pdf`;
  doc.save(fileName);
}

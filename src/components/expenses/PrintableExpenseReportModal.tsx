import { useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Button, Modal } from '@/components/ui';
import { formatDisplayDate } from '@/services/inventory';
import type { ExpenseRecord, ExpenseSummary } from '@/types/database';

interface PrintableExpenseReportModalProps {
  open: boolean;
  onClose: () => void;
  expenses: ExpenseRecord[];
  summary: ExpenseSummary;
  dateFrom: string;
  dateTo: string;
}

export function PrintableExpenseReportModal({
  open,
  onClose,
  expenses,
  summary,
  dateFrom,
  dateTo,
}: PrintableExpenseReportModalProps) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const periodLabel =
    dateFrom && dateTo
      ? `${formatDisplayDate(dateFrom)} to ${formatDisplayDate(dateTo)}`
      : dateFrom
      ? `From ${formatDisplayDate(dateFrom)}`
      : dateTo
      ? `Up to ${formatDisplayDate(dateTo)}`
      : 'All Time Recorded Expenses';

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    setDownloading(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Header Banner
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(24, 48, 30);
      doc.text('KBN FRUITS AND TRADERS', 14, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(90, 100, 90);
      doc.text('Wholesale Fruit Commission Agent • Shop Expenses Report', 14, 24);
      doc.text(`Period: ${periodLabel}`, 14, 30);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 36);

      // Financial Summary Box
      autoTable(doc, {
        startY: 42,
        head: [['Total Expenses', 'Cash Expenses', 'UPI Expenses', 'Total Records']],
        body: [
          [
            `Rs. ${summary.total_expenses.toLocaleString('en-IN')}`,
            `Rs. ${summary.cash_expenses.toLocaleString('en-IN')}`,
            `Rs. ${summary.upi_expenses.toLocaleString('en-IN')}`,
            String(expenses.length),
          ],
        ],
        theme: 'grid',
        headStyles: {
          fillColor: [30, 80, 50],
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center',
        },
        bodyStyles: {
          fontSize: 11,
          fontStyle: 'bold',
          halign: 'center',
          textColor: [20, 20, 20],
        },
      });

      // Category Breakdown Table
      const categoryRows = Object.entries(summary.category_totals).map(([cat, amt]) => [
        cat,
        `Rs. ${amt.toLocaleString('en-IN')}`,
        `${summary.total_expenses > 0 ? Math.round((amt / summary.total_expenses) * 100) : 0}%`,
      ]);

      const lastY1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(30, 80, 50);
      doc.text('Category-wise Summary', 14, lastY1 + 10);

      autoTable(doc, {
        startY: lastY1 + 14,
        head: [['Category', 'Amount', 'Share']],
        body: categoryRows,
        theme: 'striped',
        headStyles: {
          fillColor: [60, 120, 80],
          textColor: 255,
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { cellWidth: 100 },
          1: { halign: 'right', fontStyle: 'bold' },
          2: { halign: 'right' },
        },
      });

      // Detailed Transactions
      const lastY2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(30, 80, 50);
      doc.text('Expense Transactions List', 14, lastY2 + 10);

      const expenseRows = expenses.map((exp) => [
        formatDisplayDate(exp.expense_date),
        exp.category === 'Other' && exp.custom_category ? `Other: ${exp.custom_category}` : exp.category,
        exp.paid_to || '-',
        exp.description || '-',
        exp.payment_method.toUpperCase(),
        `Rs. ${exp.amount.toLocaleString('en-IN')}`,
      ]);

      autoTable(doc, {
        startY: lastY2 + 14,
        head: [['Date', 'Category', 'Paid To', 'Description / Note', 'Mode', 'Amount']],
        body: expenseRows,
        theme: 'grid',
        headStyles: {
          fillColor: [30, 80, 50],
          textColor: 255,
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 34 },
          2: { cellWidth: 30 },
          3: { cellWidth: 46 },
          4: { cellWidth: 18, halign: 'center' },
          5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
        },
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
      });

      const fileName = `KBN-Expenses-${dateFrom || 'start'}-to-${dateTo || 'end'}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Expense Report"
      subtitle={periodLabel}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-5">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-100 p-3 print:hidden">
          <p className="text-xs font-semibold text-stone-600">
            Showing {expenses.length} expense record(s)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={handleDownloadPdf}
              disabled={downloading || expenses.length === 0}
            >
              {downloading ? 'Generating PDF…' : 'Download PDF'}
            </Button>
            <Button
              variant="accent"
              size="sm"
              icon={Printer}
              onClick={handlePrint}
              disabled={expenses.length === 0}
            >
              Print Report
            </Button>
          </div>
        </div>

        {/* Printable Document Area */}
        <div ref={printAreaRef} className="space-y-6 bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm print:border-0 print:shadow-none print:p-0">
          {/* Header */}
          <div className="border-b border-stone-200 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-leaf-950">
                  KBN FRUITS AND TRADERS
                </h1>
                <p className="text-xs font-semibold text-stone-500">
                  Wholesale Fruit Commission Agent • Expenses Statement
                </p>
              </div>
              <div className="text-right text-xs text-stone-600">
                <p className="font-bold text-leaf-900">{periodLabel}</p>
                <p>Report Date: {new Date().toLocaleDateString('en-IN')}</p>
              </div>
            </div>
          </div>

          {/* Top Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-xl bg-stone-50 p-3 border border-stone-100">
              <p className="text-xs font-bold uppercase text-stone-500">Total Expenses</p>
              <p className="mt-1 text-lg sm:text-xl font-extrabold text-leaf-950 tabular-nums">
                ₹{summary.total_expenses.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50/60 p-3 border border-emerald-100">
              <p className="text-xs font-bold uppercase text-emerald-800">Cash Expenses</p>
              <p className="mt-1 text-lg sm:text-xl font-extrabold text-emerald-950 tabular-nums">
                ₹{summary.cash_expenses.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="rounded-xl bg-orange-50/60 p-3 border border-orange-100">
              <p className="text-xs font-bold uppercase text-orange-800">UPI Expenses</p>
              <p className="mt-1 text-lg sm:text-xl font-extrabold text-orange-950 tabular-nums">
                ₹{summary.upi_expenses.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 p-3 border border-stone-100">
              <p className="text-xs font-bold uppercase text-stone-500">Total Records</p>
              <p className="mt-1 text-lg sm:text-xl font-extrabold text-stone-800 tabular-nums">
                {expenses.length}
              </p>
            </div>
          </div>

          {/* Category Breakdown */}
          {Object.keys(summary.category_totals).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-leaf-800">
                Category-wise Breakdown
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {Object.entries(summary.category_totals).map(([cat, amt]) => {
                  const pct =
                    summary.total_expenses > 0
                      ? Math.round((amt / summary.total_expenses) * 100)
                      : 0;
                  return (
                    <div
                      key={cat}
                      className="rounded-lg border border-stone-100 bg-stone-50/70 p-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-bold text-stone-700 truncate">{cat}</span>
                      <span className="font-extrabold text-leaf-950 tabular-nums shrink-0">
                        ₹{amt.toLocaleString('en-IN')}{' '}
                        <span className="text-[10px] font-medium text-stone-400">({pct}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transactions List */}
          <div className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-leaf-800">
              Transactions Details
            </h3>

            {expenses.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">No expenses recorded for this period.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-stone-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 text-stone-700 font-bold uppercase">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Paid To</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-center">Mode</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-stone-50/50">
                        <td className="py-2 px-3 font-semibold text-stone-700 whitespace-nowrap">
                          {formatDisplayDate(exp.expense_date)}
                        </td>
                        <td className="py-2 px-3 font-bold text-leaf-950">
                          {exp.category === 'Other' && exp.custom_category
                            ? `Other (${exp.custom_category})`
                            : exp.category}
                        </td>
                        <td className="py-2 px-3 text-stone-600">{exp.paid_to || '-'}</td>
                        <td className="py-2 px-3 text-stone-600">{exp.description || '-'}</td>
                        <td className="py-2 px-3 text-center font-bold uppercase text-[10px]">
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              exp.payment_method === 'cash'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {exp.payment_method}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-extrabold text-leaf-950 tabular-nums">
                          ₹{exp.amount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal close */}
        <div className="flex justify-end pt-2 border-t border-stone-100 print:hidden">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

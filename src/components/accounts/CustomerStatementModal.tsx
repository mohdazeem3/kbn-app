import { useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { Button, Modal, FieldWrap, TextInput, AlertBanner } from '@/components/ui';
import {
  buildCustomerStatementData,
  exportOrShareStatementPdf,
  formatIndianCurrency,
  type StatementPeriodType,
} from '@/services/statementService';
import { formatDisplayPhone } from '@/services/whatsapp';
import type { CustomerAccountDetail } from '@/types/database';

interface CustomerStatementModalProps {
  open: boolean;
  onClose: () => void;
  detail: CustomerAccountDetail | null;
}

export function CustomerStatementModal({
  open,
  onClose,
  detail,
}: CustomerStatementModalProps) {
  const todayYmd = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const firstOfMonthYmd = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const [periodType, setPeriodType] = useState<StatementPeriodType>('all_time');
  const [customFrom, setCustomFrom] = useState(firstOfMonthYmd);
  const [customTo, setCustomTo] = useState(todayYmd);

  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compute live statement preview whenever selections change
  const statement = useMemo(() => {
    if (!detail) return null;
    return buildCustomerStatementData(detail, periodType, customFrom, customTo);
  }, [detail, periodType, customFrom, customTo]);

  if (!open || !detail) return null;

  const handleAction = async (mode: 'download' | 'whatsapp') => {
    if (!statement) return;
    setError(null);
    setNotice(null);
    setIsExporting(true);

    try {
      const result = await exportOrShareStatementPdf(statement, mode);
      if (result.success) {
        if (mode === 'download') {
          setNotice('Statement PDF downloaded successfully.');
        } else if (result.sharedNatively) {
          setNotice('Statement shared via WhatsApp.');
        } else {
          setNotice(result.message || 'Statement PDF downloaded and WhatsApp opened.');
        }
      } else if (result.message) {
        setNotice(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate statement PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const periodOptions: { id: StatementPeriodType; label: string }[] = [
    { id: 'all_time', label: 'All Time' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'custom', label: 'Custom Range' },
  ];

  return (
    <Modal
      open={open}
      title="Download Account Statement"
      subtitle={`Customer: ${detail.balance.name} • ${
        detail.balance.phone ? formatDisplayPhone(detail.balance.phone) : 'No phone'
      }`}
      onClose={onClose}
    >
      <div className="space-y-5">
        {/* Date Period Presets */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-leaf-700">
            Select Statement Period
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {periodOptions.map((opt) => {
              const active = periodType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setPeriodType(opt.id);
                    setNotice(null);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                    active
                      ? 'bg-leaf-600 text-white shadow-sm ring-2 ring-leaf-600/30'
                      : 'border border-leaf-200 bg-cream-50 text-leaf-800 hover:bg-cream-100 hover:text-leaf-950'
                  }`}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Date Range Inputs */}
        {periodType === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-leaf-200 bg-cream-50 p-4">
            <FieldWrap label="From Date">
              <TextInput
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setNotice(null);
                }}
              />
            </FieldWrap>
            <FieldWrap label="To Date">
              <TextInput
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setNotice(null);
                }}
              />
            </FieldWrap>
          </div>
        )}

        {/* Live Statement Summary Preview */}
        {statement && (
          <div className="space-y-3 rounded-2xl border border-leaf-200 bg-gradient-to-br from-cream-50 to-cream-100 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-leaf-200/60 pb-3">
              <div>
                <span className="text-2xs font-extrabold uppercase tracking-wider text-leaf-600">
                  Statement Period
                </span>
                <p className="text-sm font-bold text-leaf-950">{statement.period.label}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-leaf-100 px-2.5 py-0.5 text-xs font-bold text-leaf-800">
                <FileText className="h-3.5 w-3.5 text-leaf-600" />
                {statement.lines.length} transaction{statement.lines.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-center">
              <div className="rounded-xl bg-white p-2.5 border border-leaf-100">
                <p className="text-2xs font-bold uppercase tracking-wider text-leaf-600">
                  Opening Due
                </p>
                <p className="tabular-nums mt-0.5 text-sm sm:text-base font-extrabold text-leaf-900">
                  ₹{formatIndianCurrency(statement.openingBalance)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-2.5 border border-leaf-100">
                <p className="text-2xs font-bold uppercase tracking-wider text-leaf-600">
                  Total Billed (+)
                </p>
                <p className="tabular-nums mt-0.5 text-sm sm:text-base font-extrabold text-leaf-900">
                  ₹{formatIndianCurrency(statement.totalDebit)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-2.5 border border-leaf-100">
                <p className="text-2xs font-bold uppercase tracking-wider text-leaf-600">
                  Total Paid (−)
                </p>
                <p className="tabular-nums mt-0.5 text-sm sm:text-base font-extrabold text-emerald-700">
                  ₹{formatIndianCurrency(statement.totalCredit)}
                </p>
              </div>

              <div className="rounded-xl bg-leaf-100/70 p-2.5 border border-leaf-200">
                <p className="text-2xs font-bold uppercase tracking-wider text-leaf-700">
                  Closing Due
                </p>
                <p
                  className={`tabular-nums mt-0.5 text-sm sm:text-base font-extrabold ${
                    statement.closingBalance > 0 ? 'text-mango-800' : 'text-leaf-900'
                  }`}
                >
                  ₹{formatIndianCurrency(statement.closingBalance)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Notices & Errors */}
        {notice && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {error && <AlertBanner tone="error" message={error} />}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>

          <Button
            variant="secondary"
            icon={isExporting ? Loader2 : Download}
            disabled={isExporting}
            onClick={() => void handleAction('download')}
          >
            {isExporting ? 'Generating…' : 'Download PDF'}
          </Button>

          <Button
            variant="primary"
            className="!bg-[#25D366] hover:!bg-[#1EBE5D] text-white border-0 shadow-sm"
            icon={isExporting ? Loader2 : MessageCircle}
            disabled={isExporting}
            onClick={() => void handleAction('whatsapp')}
          >
            {isExporting ? 'Preparing…' : 'Share on WhatsApp'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

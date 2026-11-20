import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, RotateCw } from 'lucide-react';
import { Button } from './Button';

interface AlertBannerProps {
  tone: 'error' | 'success' | 'info';
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
}

export function AlertBanner({ tone, message, onRetry, action }: AlertBannerProps) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-leaf-300 bg-leaf-50 text-leaf-900',
    info: 'border-mango-200 bg-mango-50 text-mango-900',
  };
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  const iconColor =
    tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-leaf-600' : 'text-mango-600';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 px-5 py-4 ${styles[tone]}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} aria-hidden />
        <p className="text-base font-semibold">{message}</p>
      </div>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="secondary" icon={RotateCw} onClick={onRetry}>
            Retry
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function LoadingCard({ label = 'Loading records…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-2xl border border-leaf-100 bg-white px-6 py-14 text-center shadow-card"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-leaf-200 border-t-leaf-600" />
      <p className="mt-4 text-base font-semibold text-leaf-700">{label}</p>
    </div>
  );
}

export type StatusFilterValue = 'all' | 'active' | 'inactive';

interface StatusFilterProps {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
  counts: { all: number; active: number; inactive: number };
}

export function StatusFilter({ value, onChange, counts }: StatusFilterProps) {
  const options: { id: StatusFilterValue; label: string; count: number }[] = [
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'inactive', label: 'Inactive', count: counts.inactive },
    { id: 'all', label: 'All', count: counts.all },
  ];

  return (
    <div className="inline-flex rounded-xl border-2 border-leaf-200 bg-white p-1" role="group" aria-label="Filter by status">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={`rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
              active
                ? 'bg-leaf-600 text-white shadow-sm'
                : 'text-leaf-700 hover:bg-leaf-50 hover:text-leaf-900'
            }`}
          >
            {opt.label}{' '}
            <span className={active ? 'text-leaf-100' : 'text-leaf-500'}>({opt.count})</span>
          </button>
        );
      })}
    </div>
  );
}

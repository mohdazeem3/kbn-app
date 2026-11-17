import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-leaf-100 bg-white shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-leaf-950">{title}</h1>
        {subtitle && <p className="mt-1 text-base text-leaf-700">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-leaf-200 bg-cream-100 px-6 py-14 text-center">
      <span className="text-5xl" aria-hidden>{emoji}</span>
      <h3 className="mt-4 text-xl font-bold text-leaf-900">{title}</h3>
      <p className="mt-1 max-w-sm text-base text-leaf-700">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Badge({
  tone = 'green',
  children,
}: {
  tone?: 'green' | 'orange' | 'red' | 'neutral';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    green: 'bg-leaf-100 text-leaf-800',
    orange: 'bg-mango-100 text-mango-800',
    red: 'bg-red-100 text-red-800',
    neutral: 'bg-stone-100 text-stone-700',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

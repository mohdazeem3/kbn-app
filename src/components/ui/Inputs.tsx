import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

interface FieldWrapProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function FieldWrap({ label, hint, children }: FieldWrapProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-leaf-900">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-leaf-600">{hint}</span>}
    </label>
  );
}

const inputClasses =
  'w-full rounded-xl border-2 border-leaf-200 bg-white px-4 py-3 text-base text-leaf-950 placeholder:text-stone-400 transition-colors focus:border-leaf-500 focus-visible:ring-2 focus-visible:ring-leaf-500/30 focus:outline-none';

const compactInputClasses =
  'w-full rounded-lg border-2 border-leaf-200 bg-white px-2.5 py-1.5 text-sm text-leaf-950 placeholder:text-stone-400 transition-colors focus:border-leaf-500 focus-visible:ring-2 focus-visible:ring-leaf-500/30 focus:outline-none';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
}

export function TextInput({ className = '', compact = false, ...rest }: TextInputProps) {
  const base = compact ? compactInputClasses : inputClasses;
  return <input className={`${base} ${className}`} {...rest} />;
}

export interface MoneyInputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
}

export function MoneyInput({ className = '', compact = false, ...rest }: MoneyInputProps) {
  return (
    <div className="relative">
      <span
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 font-semibold text-leaf-600 ${
          compact ? 'left-2.5 text-sm' : 'left-4 text-lg'
        }`}
      >
        ₹
      </span>
      <input
        type="number"
        inputMode="decimal"
        className={`${
          compact
            ? compactInputClasses + ' pl-6 pr-2'
            : inputClasses + ' pl-10'
        } tabular-nums no-spinner ${className}`}
        {...rest}
      />
    </div>
  );
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  compact?: boolean;
}

export function SelectInput({ className = '', compact = false, ...rest }: SelectInputProps) {
  const base = compact
    ? compactInputClasses + " appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%232e6f2a%22 stroke-width=%223%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')] bg-[position:right_0.6rem_center] bg-no-repeat pr-8"
    : inputClasses + " appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%232e6f2a%22 stroke-width=%223%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')] bg-[position:right_1rem_center] bg-no-repeat pr-12";
  return (
    <select
      className={`${base} ${className}`}
      {...rest}
    />
  );
}

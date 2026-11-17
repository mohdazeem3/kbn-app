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
  'w-full rounded-xl border-2 border-leaf-200 bg-white px-4 py-3 text-base text-leaf-950 placeholder:text-stone-400 transition-colors focus:border-leaf-500 focus:outline-none';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClasses} ${className}`} {...rest} />;
}

export function MoneyInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-leaf-600">
        ₹
      </span>
      <input
        type="number"
        inputMode="decimal"
        className={`${inputClasses} tabular-nums pl-10 ${className}`}
        {...rest}
      />
    </div>
  );
}

export function SelectInput({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${inputClasses} appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%232e6f2a%22 stroke-width=%223%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')] bg-[position:right_1rem_center] bg-no-repeat pr-12 ${className}`}
      {...rest}
    />
  );
}

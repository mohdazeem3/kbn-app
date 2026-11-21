import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const variants = {
    primary:
      'bg-leaf-600 text-white hover:bg-leaf-700 focus-visible:outline-leaf-600 shadow-sm',
    accent:
      'bg-mango-500 text-white hover:bg-mango-600 focus-visible:outline-mango-500 shadow-sm',
    secondary:
      'bg-white text-leaf-800 border-2 border-leaf-200 hover:border-leaf-400 hover:bg-leaf-50 focus-visible:outline-leaf-400',
    ghost: 'bg-transparent text-leaf-700 hover:bg-leaf-100 focus-visible:outline-leaf-400',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-5 py-2.5 text-base',
    lg: 'px-7 py-4 text-lg',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-bold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${size !== 'sm' ? 'rounded-xl' : ''} ${className}`}
      {...rest}
    >
      {Icon && (
        <Icon
          className={size === 'lg' ? 'h-5 w-5' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'}
          strokeWidth={2.25}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

function getFocusableElements(): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null && !el.closest('[data-portal-dropdown]')
  );
}

function focusNextElement(current: HTMLElement, reverse = false) {
  const focusables = getFocusableElements();
  const index = focusables.indexOf(current);
  if (index !== -1) {
    const nextIndex = reverse ? index - 1 : index + 1;
    if (nextIndex >= 0 && nextIndex < focusables.length) {
      focusables[nextIndex].focus();
      return;
    }
  }
  current.focus();
}

export interface SearchOption {
  id: string;
  label: string;
  sublabel?: string;
  emoji?: string;
}

interface SearchSelectProps {
  label?: string;
  placeholder: string;
  options: SearchOption[];
  value: string | null;
  onChange: (id: string) => void;
  icon?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function SearchSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  icon = true,
  disabled = false,
  compact = false,
  className = '',
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    placement: 'bottom' | 'top';
  }>({ left: 0, width: 220, placement: 'bottom' });

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (open) {
      const selectedIdx = filtered.findIndex((o) => o.id === value);
      setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }
  }, [open, filtered, value]);

  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    const placement = spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);

    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }

    if (placement === 'bottom') {
      setCoords({
        top: rect.bottom + 4,
        bottom: undefined,
        left,
        width,
        placement,
      });
    } else {
      setCoords({
        top: undefined,
        bottom: window.innerHeight - rect.top + 4,
        left,
        width,
        placement,
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocClick);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open, updatePosition]);

  const openList = () => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="relative">
      {label && <span className="mb-1.5 block text-sm font-bold text-leaf-900">{label}</span>}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openList();
          }
        }}
        className={`flex w-full items-center justify-between gap-2 border-2 border-leaf-200 bg-white text-left transition-colors hover:border-leaf-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-leaf-500 focus-visible:ring-2 focus-visible:ring-leaf-500/30 ${
          compact ? 'rounded-lg px-2.5 py-1.5 text-sm' : 'rounded-xl px-4 py-3 text-base'
        } ${
          disabled ? 'opacity-50 cursor-not-allowed bg-stone-50' : ''
        } ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            {icon && selected.emoji && (
              <span className={compact ? 'text-lg' : 'text-2xl'} aria-hidden>{selected.emoji}</span>
            )}
            <span className="min-w-0">
              <span className={`block truncate font-bold text-leaf-950 ${compact ? 'text-sm' : 'text-base'}`}>{selected.label}</span>
              {selected.sublabel && (
                <span className={`block truncate text-leaf-600 ${compact ? 'text-xs' : 'text-sm'}`}>{selected.sublabel}</span>
              )}
            </span>
          </span>
        ) : (
          <span className={`truncate text-stone-400 ${compact ? 'text-sm' : 'text-base'}`}>{placeholder}</span>
        )}
        <ChevronsUpDown className={`shrink-0 text-leaf-500 ${compact ? 'h-4 w-4' : 'h-5 w-5'}`} aria-hidden />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            data-portal-dropdown="true"
            style={{
              position: 'fixed',
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              zIndex: 9999,
            }}
            className="overflow-hidden rounded-xl border-2 border-leaf-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center gap-2 border-b border-leaf-100 px-3 py-2 bg-cream-50/70">
              <Search className="h-4 w-4 text-leaf-500 shrink-0" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filtered[highlightedIndex]) {
                      handleSelect(filtered[highlightedIndex].id);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                    buttonRef.current?.focus();
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    if (!e.shiftKey && filtered[highlightedIndex]) {
                      onChange(filtered[highlightedIndex].id);
                    }
                    setOpen(false);
                    if (buttonRef.current) {
                      focusNextElement(buttonRef.current, e.shiftKey);
                    }
                  }
                }}
                placeholder="Type to search…"
                className="w-full bg-transparent text-sm text-leaf-950 placeholder:text-stone-400 focus:outline-none"
              />
            </div>
            <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-stone-500">No match found</li>
              )}
              {filtered.map((o, idx) => {
                const isSelected = o.id === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <li key={o.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => handleSelect(o.id)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isHighlighted ? 'bg-leaf-100/90 text-leaf-950 font-bold' : 'hover:bg-leaf-50'
                      } ${isSelected ? 'font-extrabold text-leaf-950' : ''}`}
                    >
                      {icon && o.emoji && (
                        <span className="text-xl" aria-hidden>{o.emoji}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-leaf-950">{o.label}</span>
                        {o.sublabel && (
                          <span className="block truncate text-xs text-leaf-600">{o.sublabel}</span>
                        )}
                      </span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-leaf-600" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

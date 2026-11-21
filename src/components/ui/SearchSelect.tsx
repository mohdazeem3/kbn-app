import { useMemo, useRef, useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

export interface SearchOption {
  id: string;
  label: string;
  sublabel?: string;
  emoji?: string;
}

interface SearchSelectProps {
  label: string;
  placeholder: string;
  options: SearchOption[];
  value: string | null;
  onChange: (id: string) => void;
  icon?: boolean;
  disabled?: boolean;
}

export function SearchSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  icon = true,
  disabled = false,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div ref={wrapRef} className="relative">
      <span className="mb-1.5 block text-sm font-bold text-leaf-900">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openList();
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 border-leaf-200 bg-white px-4 py-3 text-left transition-colors hover:border-leaf-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-leaf-500 ${
          disabled ? 'opacity-50 cursor-not-allowed bg-stone-50' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-3">
            {icon && selected.emoji && (
              <span className="text-2xl" aria-hidden>{selected.emoji}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-base font-bold text-leaf-950">{selected.label}</span>
              {selected.sublabel && (
                <span className="block truncate text-sm text-leaf-600">{selected.sublabel}</span>
              )}
            </span>
          </span>
        ) : (
          <span className="text-base text-stone-400">{placeholder}</span>
        )}
        <ChevronsUpDown className="h-5 w-5 shrink-0 text-leaf-500" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border-2 border-leaf-200 bg-white shadow-lifted">
          <div className="flex items-center gap-2 border-b border-leaf-100 px-4 py-3">
            <Search className="h-5 w-5 text-leaf-500" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full bg-transparent text-base text-leaf-950 placeholder:text-stone-400 focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-4 py-4 text-center text-base text-stone-500">No match found</li>
            )}
            {filtered.map((o) => {
              const isSelected = o.id === value;
              return (
                <li key={o.id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-leaf-50 ${
                      isSelected ? 'bg-leaf-50' : ''
                    }`}
                  >
                    {icon && o.emoji && (
                      <span className="text-2xl" aria-hidden>{o.emoji}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-leaf-950">{o.label}</span>
                      {o.sublabel && (
                        <span className="block truncate text-sm text-leaf-600">{o.sublabel}</span>
                      )}
                    </span>
                    {isSelected && <Check className="h-5 w-5 shrink-0 text-leaf-600" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

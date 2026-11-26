import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Phone, Search, UserPlus } from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  SectionHeader,
  SelectInput,
  StatusFilter,
  TextInput,
} from '@/components/ui';
import type { StatusFilterValue } from '@/components/ui';
import { SupplierFormModal } from '@/components/master/SupplierFormModal';
import { SupplierAccountView } from '@/components/accounts/SupplierAccountView';
import { listSupplierBalances } from '@/services/accounts';
import {
  createSupplier,
  listFruits,
  updateSupplier,
} from '@/services/masterData';
import { useCacheInvalidation } from '@/services/cache';
import type {
  Fruit,
  SupplierBalance,
  SupplierInput,
  SupplierWithFruit,
} from '@/types/database';
import type { Page } from './pageTypes';

interface SuppliersPageProps {
  onNavigate?: (p: Page) => void;
  isActive?: boolean;
}

export function SuppliersPage({ onNavigate, isActive = true }: SuppliersPageProps) {
  const [suppliers, setSuppliers] = useState<SupplierBalance[]>([]);
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [fruitFilter, setFruitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [onlyWithDue, setOnlyWithDue] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierWithFruit | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setLoadError(null);
    try {
      const [supplierList, fruitList] = await Promise.all([
        listSupplierBalances(),
        listFruits(),
      ]);
      setSuppliers(supplierList);
      setFruits(fruitList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load suppliers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useCacheInvalidation(['supplier_balances', 'suppliers', 'fruits'], () => void loadData(true), { isActive });

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let totalDue = 0;
    let withDue = 0;
    for (const s of suppliers) {
      if (s.active) active++;
      else inactive++;
      totalDue += s.outstanding_balance;
      if (s.outstanding_balance > 0) withDue++;
    }
    return { all: suppliers.length, active, inactive, totalDue, withDue };
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter === 'active' && !s.active) return false;
      if (statusFilter === 'inactive' && s.active) return false;
      if (
        fruitFilter !== 'all' &&
        !s.fruit_ids?.includes(fruitFilter) &&
        s.fruit_id !== fruitFilter
      ) {
        return false;
      }
      if (onlyWithDue && s.outstanding_balance <= 0) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.fruit_name.toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, statusFilter, fruitFilter, onlyWithDue, query]);

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (supplier: SupplierBalance) => {
    const sFruitIds =
      supplier.fruit_ids && supplier.fruit_ids.length > 0
        ? supplier.fruit_ids
        : supplier.fruit_id
          ? [supplier.fruit_id]
          : [];
    setEditing({
      id: supplier.supplier_id,
      name: supplier.name,
      fruit_id: supplier.fruit_id ?? sFruitIds[0] ?? null,
      fruit_ids: sFruitIds,
      fruit_name: supplier.fruit_name,
      fruit_active: true,
      phone: supplier.phone,
      active: supplier.active,
      created_at: '',
      updated_at: '',
    });
    setModalOpen(true);
  };

  const handleSave = async (input: SupplierInput) => {
    setActionError(null);
    setNotice(null);
    if (editing) {
      const updated = await updateSupplier(editing.id, input);
      await loadData();
      setNotice(`Updated supplier "${updated.name}".`);
    } else {
      const created = await createSupplier(input);
      await loadData();
      setNotice(`Added supplier "${created.name}".`);
    }
  };

  if (selectedSupplierId) {
    return (
      <SupplierAccountView
        supplierId={selectedSupplierId}
        onBack={() => setSelectedSupplierId(null)}
        onDataChanged={() => void loadData()}
        isActive={isActive}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Suppliers"
        action={
          <Button size="lg" icon={UserPlus} onClick={openAdd}>
            Add Supplier
          </Button>
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {actionError && <AlertBanner tone="error" message={actionError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />}

      {loading ? (
        <LoadingCard label="Loading supplier accounts…" />
      ) : suppliers.length === 0 ? (
        <EmptyState
          emoji="🚛"
          title="No suppliers yet"
          description="Add the traders you buy from, so every arrival can be recorded against them and payments stay clear."
          action={
            <Button size="lg" icon={UserPlus} onClick={openAdd}>
              Add Supplier
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary KPI Strip */}
          <div className="grid gap-5 sm:grid-cols-3">
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Total Supplier Dues</p>
              <p
                className={`tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold tracking-tight ${
                  counts.totalDue > 0 ? 'text-mango-700' : 'text-leaf-950'
                }`}
              >
                ₹{counts.totalDue.toLocaleString('en-IN')}
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Suppliers with Due</p>
              <p className="tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {counts.withDue}
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Active Suppliers</p>
              <p className="tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {counts.active}
              </p>
            </Card>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative min-w-[220px] flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                aria-hidden
              />
              <TextInput
                className="pl-12 py-3.5 text-base md:text-lg"
                placeholder="Search supplier, fruit, or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search suppliers"
              />
            </div>

            <div className="w-full sm:w-52">
              <SelectInput
                className="py-3.5 text-base"
                value={fruitFilter}
                onChange={(e) => setFruitFilter(e.target.value)}
                aria-label="Filter by fruit category"
              >
                <option value="all">All fruits</option>
                {fruits.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.active ? '' : ' (Inactive)'}
                  </option>
                ))}
              </SelectInput>
            </div>

            <Button
              type="button"
              variant={onlyWithDue ? 'accent' : 'secondary'}
              onClick={() => setOnlyWithDue((v) => !v)}
            >
              {onlyWithDue ? 'Showing Due Only' : 'Only with Due'}
            </Button>

            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              counts={{ all: counts.all, active: counts.active, inactive: counts.inactive }}
            />
          </div>

          {/* Supplier Horizontal Row List (Mobile Contact Style) */}
          {filteredSuppliers.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching suppliers"
              description="Try clearing the search box or adjusting the fruit, due, or status filter."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredSuppliers.map((supplier) => {
                const hasDue = supplier.outstanding_balance > 0;
                const initial = supplier.name.trim().charAt(0).toUpperCase() || 'S';

                return (
                  <div
                    key={supplier.supplier_id}
                    onClick={() => setSelectedSupplierId(supplier.supplier_id)}
                    className="group relative flex items-center justify-between gap-4 rounded-xl border border-stone-200/90 bg-white px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-all duration-150 hover:border-leaf-300 hover:bg-stone-50/70 hover:shadow cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedSupplierId(supplier.supplier_id);
                      }
                    }}
                  >
                    {/* Left: Contact Avatar initial + Name + Fruit info + Phone */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-800 font-bold text-sm sm:text-base border border-orange-200/60 shadow-xs">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base sm:text-lg font-bold text-leaf-950 truncate group-hover:text-leaf-800 transition-colors">
                            {supplier.name}
                          </h2>
                          {supplier.fruit_name && (
                            <span className="text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200/60 rounded px-1.5 py-0.5">
                              {supplier.fruit_name}
                            </span>
                          )}
                          {!supplier.active && (
                            <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs sm:text-sm font-medium text-stone-500">
                          {supplier.phone ? (
                            <>
                              <Phone className="h-3.5 w-3.5 text-stone-400 shrink-0" aria-hidden />
                              <span className="font-mono">{supplier.phone}</span>
                            </>
                          ) : (
                            <span className="text-stone-400 italic">No phone</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: Balance Payable + Edit + Chevron */}
                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-400">
                          Payable
                        </p>
                        <p
                          className={`tabular-nums text-base sm:text-xl font-extrabold ${
                            hasDue ? 'text-mango-700' : 'text-leaf-800'
                          }`}
                        >
                          ₹{supplier.outstanding_balance.toLocaleString('en-IN')}
                        </p>
                      </div>

                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(supplier);
                        }}
                        className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
                        title="Edit supplier"
                        aria-label={`Edit ${supplier.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>

                      {/* Forward chevron */}
                      <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-leaf-600 transition-transform group-hover:translate-x-0.5 shrink-0" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <SupplierFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        fruits={fruits}
        onManageFruits={onNavigate ? () => onNavigate('fruits') : undefined}
        onSubmit={handleSave}
      />
    </div>
  );
}

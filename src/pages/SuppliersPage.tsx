import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Pencil, Phone, Power, Search, UserPlus } from 'lucide-react';
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
  setSupplierActive,
  updateSupplier,
} from '@/services/masterData';
import type {
  Fruit,
  SupplierBalance,
  SupplierInput,
  SupplierWithFruit,
} from '@/types/database';
import type { Page } from './pageTypes';

interface SuppliersPageProps {
  onNavigate?: (p: Page) => void;
}

export function SuppliersPage({ onNavigate }: SuppliersPageProps) {
  const [suppliers, setSuppliers] = useState<SupplierBalance[]>([]);
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [fruitFilter, setFruitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [onlyWithDue, setOnlyWithDue] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierWithFruit | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
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

  const handleToggleActive = async (supplier: SupplierBalance) => {
    setActionError(null);
    setNotice(null);
    setBusyId(supplier.supplier_id);
    try {
      const updated = await setSupplierActive(supplier.supplier_id, !supplier.active);
      setSuppliers((prev) =>
        prev.map((s) =>
          s.supplier_id === updated.id ? { ...s, active: updated.active } : s
        )
      );
      setNotice(
        updated.active
          ? `Activated "${updated.name}".`
          : `Deactivated "${updated.name}".`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update supplier status.');
    } finally {
      setBusyId(null);
    }
  };

  if (selectedSupplierId) {
    return (
      <SupplierAccountView
        supplierId={selectedSupplierId}
        onBack={() => setSelectedSupplierId(null)}
        onDataChanged={() => void loadData()}
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

          {/* Supplier Cards Grid */}
          {filteredSuppliers.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching suppliers"
              description="Try clearing the search box or adjusting the fruit, due, or status filter."
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {filteredSuppliers.map((supplier) => {
                const isBusy = busyId === supplier.supplier_id;
                const hasDue = supplier.outstanding_balance > 0;
                return (
                  <Card
                    key={supplier.supplier_id}
                    className="flex flex-col justify-between gap-5 p-6 sm:p-7"
                  >
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-bold text-leaf-950">{supplier.name}</h2>
                            {supplier.fruit_name ? (
                              supplier.fruit_name.split(', ').map((fname) => (
                                <Badge key={fname} tone="orange">
                                  {fname}
                                </Badge>
                              ))
                            ) : (
                              <Badge tone="neutral">No fruit linked</Badge>
                            )}
                          </div>
                          {supplier.phone ? (
                            <p className="mt-1 inline-flex items-center gap-1.5 text-base font-semibold text-leaf-700">
                              <Phone className="h-4 w-4 text-leaf-500" aria-hidden />
                              {supplier.phone}
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-leaf-400">No phone number</p>
                          )}
                        </div>
                        <Badge tone={supplier.active ? 'green' : 'neutral'}>
                          {supplier.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-cream-100 p-4 sm:p-5">
                        <div>
                          <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-leaf-600">
                            Balance Payable
                          </p>
                          <p
                            className={`tabular-nums mt-1 font-display text-3xl sm:text-4xl font-extrabold ${
                              hasDue ? 'text-mango-700' : 'text-leaf-800'
                            }`}
                          >
                            ₹{supplier.outstanding_balance.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="text-right text-sm font-semibold text-leaf-700">
                          <p>
                            {supplier.active_deliveries_count} deliver
                            {supplier.active_deliveries_count === 1 ? 'y' : 'ies'} •{' '}
                            {supplier.total_boxes_received.toLocaleString('en-IN')} boxes
                          </p>
                          {supplier.opening_balance_outstanding > 0 && (
                            <p className="text-mango-700">
                              Incl. ₹{supplier.opening_balance_outstanding.toLocaleString('en-IN')} opening
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-leaf-100 pt-4">
                      <Button
                        size="lg"
                        variant={hasDue ? 'primary' : 'secondary'}
                        icon={BookOpen}
                        onClick={() => setSelectedSupplierId(supplier.supplier_id)}
                      >
                        Open Account
                      </Button>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          icon={Pencil}
                          onClick={() => openEdit(supplier)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          icon={Power}
                          disabled={isBusy}
                          onClick={() => void handleToggleActive(supplier)}
                        >
                          {isBusy ? 'Updating…' : supplier.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  </Card>
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

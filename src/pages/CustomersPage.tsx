import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Phone, Search, UserPlus, Users } from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingCard,
  SectionHeader,
  StatusFilter,
  TextInput,
} from '@/components/ui';
import type { StatusFilterValue } from '@/components/ui';
import { CustomerFormModal } from '@/components/master/CustomerFormModal';
import { CustomerAccountView } from '@/components/accounts/CustomerAccountView';
import { listCustomerBalances } from '@/services/accounts';
import {
  createCustomer,
  updateCustomer,
} from '@/services/masterData';
import { useCacheInvalidation } from '@/services/cache';
import type { Customer, CustomerBalance, CustomerInput } from '@/types/database';

function toCustomerRecord(row: CustomerBalance): Customer {
  return {
    id: row.customer_id,
    name: row.name,
    phone: row.phone,
    active: row.active,
    created_at: '',
    updated_at: '',
  };
}

export function CustomersPage({ isActive = true }: { isActive?: boolean } = {}) {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [onlyWithDue, setOnlyWithDue] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setLoadError(null);
    try {
      const data = await listCustomerBalances();
      setCustomers(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useCacheInvalidation(['customer_balances', 'customers'], () => void loadData(true), { isActive });

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let totalDue = 0;
    let withDue = 0;
    for (const c of customers) {
      if (c.active) active++;
      else inactive++;
      totalDue += c.outstanding_balance;
      if (c.outstanding_balance > 0) withDue++;
    }
    return { all: customers.length, active, inactive, totalDue, withDue };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (statusFilter === 'active' && !c.active) return false;
      if (statusFilter === 'inactive' && c.active) return false;
      if (onlyWithDue && c.outstanding_balance <= 0) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
      );
    });
  }, [customers, statusFilter, onlyWithDue, query]);

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (customer: CustomerBalance) => {
    setEditing(toCustomerRecord(customer));
    setModalOpen(true);
  };

  const handleSave = async (input: CustomerInput) => {
    setActionError(null);
    setNotice(null);
    if (editing) {
      const updated = await updateCustomer(editing.id, input);
      setCustomers((prev) =>
        prev.map((c) =>
          c.customer_id === updated.id
            ? { ...c, name: updated.name, phone: updated.phone }
            : c
        )
      );
      setNotice(`Updated customer "${updated.name}".`);
    } else {
      const created = await createCustomer(input);
      const newBalance: CustomerBalance = {
        customer_id: created.id,
        name: created.name,
        phone: created.phone,
        active: created.active,
        opening_balance_id: null,
        opening_balance: 0,
        opening_balance_paid: 0,
        opening_balance_outstanding: 0,
        active_bills_count: 0,
        bills_total: 0,
        bills_paid: 0,
        bills_outstanding: 0,
        outstanding_balance: 0,
      };
      setCustomers((prev) =>
        [...prev, newBalance].sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            b.outstanding_balance - a.outstanding_balance ||
            a.name.localeCompare(b.name)
        )
      );
      setNotice(`Added customer "${created.name}".`);
    }
  };

  if (selectedCustomerId) {
    return (
      <CustomerAccountView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
        onDataChanged={() => void loadData()}
        isActive={isActive}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Customers"
        action={
          <Button size="lg" icon={UserPlus} onClick={openAdd}>
            Add Customer
          </Button>
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {actionError && <AlertBanner tone="error" message={actionError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />}

      {loading ? (
        <LoadingCard label="Loading customer accounts…" />
      ) : customers.length === 0 ? (
        <EmptyState
          emoji="🏪"
          title="No customers yet"
          description="Add the shops you supply and their bills, collections, and opening balances will be tracked here."
          action={
            <Button size="lg" icon={Users} onClick={openAdd}>
              Add Customer
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary KPI Strip */}
          <div className="grid gap-5 sm:grid-cols-3">
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Total Customer Dues</p>
              <p
                className={`tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold tracking-tight ${
                  counts.totalDue > 0 ? 'text-mango-700' : 'text-leaf-950'
                }`}
              >
                ₹{counts.totalDue.toLocaleString('en-IN')}
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Customers with Due</p>
              <p className="tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {counts.withDue}
              </p>
            </Card>
            <Card className="p-6 sm:p-7">
              <p className="text-base font-bold text-leaf-700">Active Customers</p>
              <p className="tabular-nums mt-2 font-display text-4xl sm:text-5xl font-extrabold text-leaf-950 tracking-tight">
                {counts.active}
              </p>
            </Card>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                aria-hidden
              />
              <TextInput
                className="pl-12 py-3.5 text-base md:text-lg"
                placeholder="Search customer by name or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search customers"
              />
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

          {/* Customer Horizontal Row List (Mobile Contact Style) */}
          {filteredCustomers.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching customers"
              description="Try clearing the search box or adjusting the status and due filters."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredCustomers.map((customer) => {
                const hasDue = customer.outstanding_balance > 0;
                const initial = customer.name.trim().charAt(0).toUpperCase() || 'C';

                return (
                  <div
                    key={customer.customer_id}
                    onClick={() => setSelectedCustomerId(customer.customer_id)}
                    className="group relative flex items-center justify-between gap-4 rounded-xl border border-stone-200/90 bg-white px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-all duration-150 hover:border-leaf-300 hover:bg-stone-50/70 hover:shadow cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCustomerId(customer.customer_id);
                      }
                    }}
                  >
                    {/* Left: Contact Avatar initial + Name + Phone */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-leaf-800 font-bold text-sm sm:text-base border border-leaf-200/60 shadow-xs">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base sm:text-lg font-bold text-leaf-950 truncate group-hover:text-leaf-800 transition-colors">
                            {customer.name}
                          </h2>
                          {!customer.active && (
                            <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs sm:text-sm font-medium text-stone-500">
                          {customer.phone ? (
                            <>
                              <Phone className="h-3.5 w-3.5 text-stone-400 shrink-0" aria-hidden />
                              <span className="font-mono">{customer.phone}</span>
                            </>
                          ) : (
                            <span className="text-stone-400 italic">No phone</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: Outstanding Due + Edit + Chevron */}
                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-400">
                          Due
                        </p>
                        <p
                          className={`tabular-nums text-base sm:text-xl font-extrabold ${
                            hasDue ? 'text-mango-700' : 'text-leaf-800'
                          }`}
                        >
                          ₹{customer.outstanding_balance.toLocaleString('en-IN')}
                        </p>
                      </div>

                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(customer);
                        }}
                        className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
                        title="Edit customer"
                        aria-label={`Edit ${customer.name}`}
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

      <CustomerFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSave}
      />
    </div>
  );
}

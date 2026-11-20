import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Pencil, Phone, Power, Search, UserPlus, Users } from 'lucide-react';
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
  setCustomerActive,
  updateCustomer,
} from '@/services/masterData';
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

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [onlyWithDue, setOnlyWithDue] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
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

  const handleToggleActive = async (customer: CustomerBalance) => {
    setActionError(null);
    setNotice(null);
    setBusyId(customer.customer_id);
    try {
      const updated = await setCustomerActive(customer.customer_id, !customer.active);
      setCustomers((prev) =>
        prev.map((c) =>
          c.customer_id === updated.id ? { ...c, active: updated.active } : c
        )
      );
      setNotice(
        updated.active
          ? `Activated "${updated.name}".`
          : `Deactivated "${updated.name}".`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update customer status.');
    } finally {
      setBusyId(null);
    }
  };

  if (selectedCustomerId) {
    return (
      <CustomerAccountView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
        onDataChanged={() => void loadData()}
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

          {/* Customer Cards Grid */}
          {filteredCustomers.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching customers"
              description="Try clearing the search box or adjusting the status and due filters."
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {filteredCustomers.map((customer) => {
                const isBusy = busyId === customer.customer_id;
                const hasDue = customer.outstanding_balance > 0;
                return (
                  <Card
                    key={customer.customer_id}
                    className="flex flex-col justify-between gap-5 p-6 sm:p-7"
                  >
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-2xl font-bold text-leaf-950">{customer.name}</h2>
                          {customer.phone ? (
                            <p className="mt-1 inline-flex items-center gap-1.5 text-base font-semibold text-leaf-700">
                              <Phone className="h-4 w-4 text-leaf-500" aria-hidden />
                              {customer.phone}
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-leaf-400">No phone number</p>
                          )}
                        </div>
                        <Badge tone={customer.active ? 'green' : 'neutral'}>
                          {customer.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-cream-100 p-4 sm:p-5">
                        <div>
                          <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-leaf-600">
                            Outstanding Due
                          </p>
                          <p
                            className={`tabular-nums mt-1 font-display text-3xl sm:text-4xl font-extrabold ${
                              hasDue ? 'text-mango-700' : 'text-leaf-800'
                            }`}
                          >
                            ₹{customer.outstanding_balance.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="text-right text-sm font-semibold text-leaf-700">
                          <p>
                            {customer.active_bills_count} active bill
                            {customer.active_bills_count === 1 ? '' : 's'}
                          </p>
                          {customer.opening_balance_outstanding > 0 && (
                            <p className="text-mango-700">
                              Incl. ₹{customer.opening_balance_outstanding.toLocaleString('en-IN')} opening
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
                        onClick={() => setSelectedCustomerId(customer.customer_id)}
                      >
                        Open Account
                      </Button>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          icon={Pencil}
                          onClick={() => openEdit(customer)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          icon={Power}
                          disabled={isBusy}
                          onClick={() => void handleToggleActive(customer)}
                        >
                          {isBusy ? 'Updating…' : customer.active ? 'Deactivate' : 'Activate'}
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

      <CustomerFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSave}
      />
    </div>
  );
}

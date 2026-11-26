import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { NewSale } from '@/pages/NewSale';
import { BillsPage } from '@/pages/BillsPage';
import { ExpensesPage } from '@/pages/ExpensesPage';
import { ReceiveStock } from '@/pages/ReceiveStock';
import { StockPage } from '@/pages/StockPage';
import { FruitsPage } from '@/pages/FruitsPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { SuppliersPage } from '@/pages/SuppliersPage';
import { LoginPage } from '@/pages/LoginPage';
import { AuthProvider, useAuth } from '@/lib/auth';
import type { Page } from '@/pages/pageTypes';

function AuthGate() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-50">
        <div
          className="h-12 w-12 animate-spin rounded-full border-4 border-leaf-200 border-t-leaf-600"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!session) return <LoginPage />;

  return <AppPages />;
}

function AppPages() {
  const [page, setPage] = useState<Page>('dashboard');
  const [visited, setVisited] = useState<Set<Page>>(() => new Set(['dashboard']));

  const handleNavigate = (p: Page) => {
    setVisited((prev) => {
      if (prev.has(p)) return prev;
      const next = new Set(prev);
      next.add(p);
      return next;
    });
    setPage(p);
  };

  return (
    <AppShell page={page} onNavigate={handleNavigate}>
      {visited.has('dashboard') && (
        <div className={page === 'dashboard' ? undefined : 'hidden'} aria-hidden={page !== 'dashboard'}>
          <Dashboard onNavigate={handleNavigate} isActive={page === 'dashboard'} />
        </div>
      )}
      {visited.has('receive') && (
        <div className={page === 'receive' ? undefined : 'hidden'} aria-hidden={page !== 'receive'}>
          <ReceiveStock onNavigate={handleNavigate} isActive={page === 'receive'} />
        </div>
      )}
      {visited.has('sale') && (
        <div className={page === 'sale' ? undefined : 'hidden'} aria-hidden={page !== 'sale'}>
          <NewSale onNavigate={handleNavigate} isActive={page === 'sale'} />
        </div>
      )}
      {visited.has('bills') && (
        <div className={page === 'bills' ? undefined : 'hidden'} aria-hidden={page !== 'bills'}>
          <BillsPage onNavigate={handleNavigate} isActive={page === 'bills'} />
        </div>
      )}
      {visited.has('expenses') && (
        <div className={page === 'expenses' ? undefined : 'hidden'} aria-hidden={page !== 'expenses'}>
          <ExpensesPage isActive={page === 'expenses'} />
        </div>
      )}
      {visited.has('stock') && (
        <div className={page === 'stock' ? undefined : 'hidden'} aria-hidden={page !== 'stock'}>
          <StockPage onNavigate={handleNavigate} isActive={page === 'stock'} />
        </div>
      )}
      {visited.has('fruits') && (
        <div className={page === 'fruits' ? undefined : 'hidden'} aria-hidden={page !== 'fruits'}>
          <FruitsPage isActive={page === 'fruits'} />
        </div>
      )}
      {visited.has('customers') && (
        <div className={page === 'customers' ? undefined : 'hidden'} aria-hidden={page !== 'customers'}>
          <CustomersPage isActive={page === 'customers'} />
        </div>
      )}
      {visited.has('suppliers') && (
        <div className={page === 'suppliers' ? undefined : 'hidden'} aria-hidden={page !== 'suppliers'}>
          <SuppliersPage onNavigate={handleNavigate} isActive={page === 'suppliers'} />
        </div>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { NewSale } from '@/pages/NewSale';
import { ReceiveStock } from '@/pages/ReceiveStock';
import { StockPage } from '@/pages/StockPage';
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

  return (
    <AppShell page={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
      {page === 'receive' && <ReceiveStock />}
      {page === 'sale' && <NewSale />}
      {page === 'stock' && <StockPage onNavigate={setPage} />}
      {page === 'customers' && <CustomersPage />}
      {page === 'suppliers' && <SuppliersPage />}
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

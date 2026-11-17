import { useState } from 'react';
import {
  BookUser,
  Boxes,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  ShoppingCart,
  Sprout,
  Truck,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { Page } from '@/pages/pageTypes';

interface NavItem {
  id: Page;
  label: string;
  icon: LucideIcon;
  desc: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: "Today's overview" },
  { id: 'receive', label: 'Receive Stock', icon: PackageOpen, desc: 'Record new arrivals' },
  { id: 'sale', label: 'New Sale', icon: ShoppingCart, desc: 'Bill a customer' },
  { id: 'stock', label: 'Stock', icon: Boxes, desc: 'What is in the godown' },
  { id: 'customers', label: 'Customers', icon: BookUser, desc: 'Shops you supply' },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, desc: 'Your mandi sources' },
];

interface ShellProps {
  page: Page;
  onNavigate: (p: Page) => void;
  children: React.ReactNode;
}

export function AppShell({ page, onNavigate, children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navList = (
    <nav className="flex flex-col gap-2" aria-label="Main">
      {navItems.map((item) => {
        const active = page === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              onNavigate(item.id);
              setMobileOpen(false);
            }}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-colors duration-150 ${
              active
                ? 'bg-leaf-600 text-white shadow-sm'
                : 'text-leaf-900 hover:bg-leaf-100'
            }`}
          >
            <item.icon
              className={`h-6 w-6 shrink-0 ${active ? 'text-white' : 'text-leaf-600'}`}
              strokeWidth={2.25}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight">{item.label}</span>
              <span
                className={`block text-sm leading-tight ${
                  active ? 'text-leaf-100' : 'text-leaf-600'
                }`}
              >
                {item.desc}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-leaf-100 bg-white px-5 py-6 lg:flex">
        <Brand />
        <div className="mt-8 flex-1">{navList}</div>
        <OwnerCard />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-leaf-100 bg-white px-4 py-3 lg:hidden">
        <Brand compact />
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-xl p-2 text-leaf-800 hover:bg-leaf-100"
          aria-label="Open menu"
        >
          <Menu className="h-7 w-7" aria-hidden />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-leaf-950/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white px-5 py-6 shadow-lifted">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-xl p-2 text-leaf-800 hover:bg-leaf-100"
                aria-label="Close menu"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>
            <div className="mt-8 flex-1 overflow-y-auto">{navList}</div>
            <OwnerCard />
          </aside>
        </div>
      )}

      <main className="px-4 py-6 sm:px-6 lg:ml-72 lg:px-10 lg:py-8">{children}</main>

      {/* Mobile quick action bar */}
      <div className="sticky bottom-0 z-20 flex border-t border-leaf-100 bg-white p-3 lg:hidden">
        <button
          onClick={() => onNavigate('receive')}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-leaf-600 py-3 text-base font-bold text-white active:bg-leaf-700"
        >
          <PackageOpen className="h-5 w-5" aria-hidden /> Receive Stock
        </button>
        <div className="w-3" />
        <button
          onClick={() => onNavigate('sale')}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mango-500 py-3 text-base font-bold text-white active:bg-mango-600"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden /> New Sale
        </button>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-600 text-white shadow-sm">
        <Sprout className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      </span>
      <div>
        <p className="font-display text-lg font-semibold leading-tight text-leaf-950">
          FruitWholesale
        </p>
        <p className={`text-sm font-semibold uppercase tracking-wide ${compact ? 'text-leaf-600' : 'text-leaf-500'}`}>
          Manager
        </p>
      </div>
    </div>
  );
}

function OwnerCard() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const email = user?.email ?? 'Signed in';
  const initials = email[0]?.toUpperCase() ?? '?';

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl bg-cream-100 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mango-200 text-base font-bold text-mango-800">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-bold leading-tight text-leaf-950">{email}</p>
          <p className="text-sm leading-tight text-leaf-600">Signed in</p>
        </div>
        <HandCoins className="ml-auto h-5 w-5 shrink-0 text-leaf-400" aria-hidden />
      </div>
      <button
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-leaf-200 bg-white px-4 py-2.5 text-base font-bold text-leaf-800 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOut className="h-5 w-5" aria-hidden /> {signingOut ? 'Signing out…' : 'Sign Out'}
      </button>
    </div>
  );
}

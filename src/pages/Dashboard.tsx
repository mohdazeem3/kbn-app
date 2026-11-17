import { ArrowDownCircle, ArrowUpCircle, ChevronRight, ClipboardList } from 'lucide-react';
import { Card } from '@/components/ui';
import type { Page } from './pageTypes';

interface DashboardProps {
  onNavigate: (p: Page) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-base font-semibold text-mango-600">
          {new Date().toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="font-display mt-1 text-4xl font-semibold text-leaf-950">
          Namaste, and welcome
        </h1>
        <p className="mt-2 text-lg text-leaf-700">Here is how business looks today.</p>
      </div>

      {/* Prominent daily actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => onNavigate('receive')}
          className="group flex items-center justify-between rounded-2xl bg-leaf-600 px-6 py-6 text-left shadow-card transition-all duration-150 hover:bg-leaf-700 hover:shadow-lifted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-leaf-500/50 text-white">
              <ArrowDownCircle className="h-8 w-8" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold text-white">Receive Stock</span>
              <span className="block text-base text-leaf-100">Record a new arrival</span>
            </span>
          </span>
          <ChevronRight className="h-7 w-7 text-leaf-200 transition-transform group-hover:translate-x-1" aria-hidden />
        </button>

        <button
          onClick={() => onNavigate('sale')}
          className="group flex items-center justify-between rounded-2xl bg-mango-500 px-6 py-6 text-left shadow-card transition-all duration-150 hover:bg-mango-600 hover:shadow-lifted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mango-600"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-mango-400/50 text-white">
              <ArrowUpCircle className="h-8 w-8" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold text-white">New Sale</span>
              <span className="block text-base text-mango-100">Bill a shop in under a minute</span>
            </span>
          </span>
          <ChevronRight className="h-7 w-7 text-mango-200 transition-transform group-hover:translate-x-1" aria-hidden />
        </button>
      </div>

      {/* Today's activity */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-leaf-950">Latest Sales</h2>
          <button
            onClick={() => onNavigate('sale')}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-base font-bold text-leaf-700 transition-colors hover:bg-leaf-100"
          >
            View all <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-leaf-200 bg-cream-100 px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-leaf-100">
            <ClipboardList className="h-7 w-7 text-leaf-600" aria-hidden />
          </span>
          <h3 className="mt-4 text-xl font-bold text-leaf-900">No sales recorded yet</h3>
          <p className="mt-1 max-w-md text-base text-leaf-700">
            When you bill a customer, their bill will appear here along with today's total sales.
          </p>
        </div>
      </Card>
    </div>
  );
}

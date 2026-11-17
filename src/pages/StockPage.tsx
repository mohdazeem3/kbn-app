import { PackageOpen, Search } from 'lucide-react';
import { Button, EmptyState, SectionHeader, TextInput } from '@/components/ui';
import type { Page } from './pageTypes';

export function StockPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Stock"
        subtitle="Everything in your godown right now, with what it cost you."
        action={
          <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
            Receive Stock
          </Button>
        }
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500" aria-hidden />
        <TextInput
          className="pl-12"
          placeholder="Search fruit by name…"
          disabled
          aria-label="Search stock"
        />
      </div>

      <EmptyState
        emoji="📦"
        title="Your godown is empty"
        description="Record your first arrival and every fruit you buy will be tracked here, with quantities and purchase prices."
        action={
          <Button size="lg" icon={PackageOpen} onClick={() => onNavigate('receive')}>
            Receive Stock
          </Button>
        }
      />
    </div>
  );
}

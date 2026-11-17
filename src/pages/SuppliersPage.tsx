import { UserPlus } from 'lucide-react';
import { Button, EmptyState, SectionHeader } from '@/components/ui';

export function SuppliersPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Suppliers"
        subtitle="Your mandi sources and what you owe them."
        action={
          <Button size="lg" icon={UserPlus}>
            Add Supplier
          </Button>
        }
      />

      <EmptyState
        emoji="🚛"
        title="No suppliers yet"
        description="Add the traders you buy from, so every arrival can be recorded against them and payments stay clear."
        action={
          <Button size="lg" icon={UserPlus}>
            Add Supplier
          </Button>
        }
      />
    </div>
  );
}

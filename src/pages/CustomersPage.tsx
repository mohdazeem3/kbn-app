import { UserPlus, Users } from 'lucide-react';
import { Button, EmptyState, SectionHeader } from '@/components/ui';

export function CustomersPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Customers"
        subtitle="The shops you supply, and who owes you money."
        action={
          <Button size="lg" icon={UserPlus}>
            Add Customer
          </Button>
        }
      />

      <EmptyState
        emoji="🏪"
        title="No customers yet"
        description="Add the shops you supply and their bills will be tracked here, including any money they owe you."
        action={
          <Button size="lg" icon={Users}>
            Add Customer
          </Button>
        }
      />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { CheckCircle2, IndianRupee, Plus, Trash2 } from 'lucide-react';
import { Button, Card, FieldWrap, MoneyInput, SectionHeader, TextInput } from '@/components/ui';

interface Line {
  key: number;
  name: string;
  quantity: string;
  rate: string;
  unit: string;
}

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, name: '', quantity: '', rate: '', unit: 'kg' });

const unitChoices = ['kg', 'crate', 'dozen', 'pethee', 'box'];

export function NewSale() {
  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [payment, setPayment] = useState<'paid' | 'credit'>('paid');
  const [saved, setSaved] = useState<string | null>(null);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0),
    [lines]
  );

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  const canSave = Boolean(customerName.trim()) && lines.some((l) => l.name.trim() && Number(l.quantity) > 0);

  const save = () => {
    setSaved(
      `Bill for ${customerName.trim()} noted. ${payment === 'paid' ? 'Marked as paid.' : 'Marked as on credit.'} Saving to your records is coming soon.`
    );
    setCustomerName('');
    setLines([emptyLine()]);
    setPayment('paid');
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="New Sale"
        subtitle="Write down who bought what. The bill total updates as you type."
      />

      {saved && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-leaf-300 bg-leaf-50 px-5 py-4" role="status">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-leaf-600" aria-hidden />
          <p className="text-base font-bold text-leaf-900">{saved}</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="p-6">
            <FieldWrap label="Customer" hint="The shop or person buying from you">
              <TextInput
                placeholder="For example: Patel Fruit Mart"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </FieldWrap>
          </Card>

          {lines.map((line, idx) => {
            const lineTotal = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
            return (
              <Card key={line.key} className="p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-extrabold text-leaf-900">Item {idx + 1}</h2>
                  {lines.length > 1 && (
                    <Button variant="ghost" onClick={() => removeLine(line.key)} aria-label="Remove this item">
                      <Trash2 className="h-5 w-5 text-red-600" aria-hidden /> Remove
                    </Button>
                  )}
                </div>

                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  <FieldWrap label="Fruit name">
                    <TextInput
                      placeholder="Which fruit did they take?"
                      value={line.name}
                      onChange={(e) => update(line.key, { name: e.target.value })}
                    />
                  </FieldWrap>
                  <FieldWrap label="Unit">
                    <div className="flex flex-wrap gap-2">
                      {unitChoices.map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => update(line.key, { unit: u })}
                          aria-pressed={line.unit === u}
                          className={`rounded-xl border-2 px-4 py-2.5 text-base font-bold transition-colors ${
                            line.unit === u
                              ? 'border-leaf-600 bg-leaf-50 text-leaf-800'
                              : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </FieldWrap>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldWrap label={`Quantity (${line.unit})`}>
                      <TextInput
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="0"
                        className="tabular-nums"
                        value={line.quantity}
                        onChange={(e) => update(line.key, { quantity: e.target.value })}
                      />
                    </FieldWrap>
                    <FieldWrap label={`Rate per ${line.unit}`}>
                      <MoneyInput
                        placeholder="0"
                        value={line.rate}
                        onChange={(e) => update(line.key, { rate: e.target.value })}
                      />
                    </FieldWrap>
                  </div>
                  <div className="flex items-end">
                    <div className="flex w-full items-center justify-between rounded-xl bg-cream-100 px-5 py-4">
                      <p className="text-sm font-bold text-leaf-600">Line total</p>
                      <p className="tabular-nums text-2xl font-extrabold text-leaf-950">
                        ₹{lineTotal.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          <Button variant="secondary" size="lg" icon={Plus} onClick={addLine}>
            Add another fruit
          </Button>
        </div>

        {/* Bill summary */}
        <div className="xl:sticky xl:top-8 xl:self-start">
          <Card className="overflow-hidden">
            <div className="bg-leaf-700 px-6 py-5">
              <p className="text-base font-bold text-leaf-100">Bill Summary</p>
              <p className="tabular-nums mt-1 text-4xl font-extrabold text-white">
                ₹{total.toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-sm text-leaf-200">
                {customerName.trim() || 'No customer entered yet'}
              </p>
            </div>
            <div className="space-y-5 p-6">
              <fieldset>
                <legend className="mb-2 text-sm font-bold text-leaf-900">Payment</legend>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPayment('paid')}
                    className={`rounded-xl border-2 px-4 py-3 text-base font-bold transition-colors ${
                      payment === 'paid'
                        ? 'border-leaf-600 bg-leaf-50 text-leaf-800'
                        : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                    }`}
                    aria-pressed={payment === 'paid'}
                  >
                    <IndianRupee className="mr-2 inline h-5 w-5" aria-hidden />
                    Paid now
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayment('credit')}
                    className={`rounded-xl border-2 px-4 py-3 text-base font-bold transition-colors ${
                      payment === 'credit'
                        ? 'border-mango-500 bg-mango-50 text-mango-800'
                        : 'border-leaf-200 bg-white text-leaf-700 hover:border-leaf-400'
                    }`}
                    aria-pressed={payment === 'credit'}
                  >
                    On credit
                  </button>
                </div>
              </fieldset>
              <ul className="space-y-2 border-t border-leaf-100 pt-4 text-base">
                {lines
                  .filter((l) => l.name.trim())
                  .map((l) => (
                    <li key={l.key} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-leaf-700">
                        {l.name} × {Number(l.quantity) || 0}
                      </span>
                      <span className="tabular-nums font-bold text-leaf-950">
                        ₹{((Number(l.quantity) || 0) * (Number(l.rate) || 0)).toLocaleString('en-IN')}
                      </span>
                    </li>
                  ))}
                {lines.every((l) => !l.name.trim()) && (
                  <li className="text-leaf-500">Added fruits will show here.</li>
                )}
              </ul>
              <Button size="lg" className="w-full" icon={CheckCircle2} onClick={save} disabled={!canSave}>
                {payment === 'paid' ? 'Save & Mark Paid' : 'Save to Credit Book'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

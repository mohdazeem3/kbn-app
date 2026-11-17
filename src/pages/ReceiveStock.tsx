import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
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

export function ReceiveStock() {
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saved, setSaved] = useState<string | null>(null);

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0),
    [lines]
  );

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  const canSave = lines.some((l) => l.name.trim() && Number(l.quantity) > 0);

  const save = () => {
    const count = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0).length;
    setSaved(`Noted ${count} item${count === 1 ? '' : 's'}. Saving to your records is coming soon.`);
    setLines([emptyLine()]);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Receive Stock"
        subtitle="Write down what arrived. Each entry will be added to your godown stock."
      />

      {saved && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-leaf-300 bg-leaf-50 px-5 py-4" role="status">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-leaf-600" aria-hidden />
          <p className="text-base font-bold text-leaf-900">{saved}</p>
        </div>
      )}

      <div className="space-y-4">
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
                <FieldWrap label="Fruit name" hint="For example: Alphonso Mango, Nagpur Orange">
                  <TextInput
                    placeholder="Which fruit arrived?"
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
                  <div className="w-full rounded-xl bg-cream-100 px-5 py-4">
                    <p className="text-sm font-bold text-leaf-600">Item total</p>
                    <p className="tabular-nums text-3xl font-extrabold text-leaf-950">
                      ₹{lineTotal.toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="secondary" size="lg" icon={Plus} onClick={addLine}>
          Add another item
        </Button>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-sm font-bold text-leaf-600">Total to pay supplier</p>
            <p className="tabular-nums text-3xl font-extrabold text-leaf-950">
              ₹{grandTotal.toLocaleString('en-IN')}
            </p>
          </div>
          <Button size="lg" icon={CheckCircle2} onClick={save} disabled={!canSave}>
            Save to Stock
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Pencil, Plus, Power, Search } from 'lucide-react';
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
import { FruitFormModal } from '@/components/master/FruitFormModal';
import { VarietyFormModal } from '@/components/master/VarietyFormModal';
import {
  createFruit,
  createFruitVariety,
  listFruits,
  listFruitVarieties,
  setFruitActive,
  setFruitVarietyActive,
  updateFruit,
  updateFruitVariety,
} from '@/services/masterData';
import type { Fruit, FruitInput, FruitVariety, FruitVarietyInput } from '@/types/database';

export function FruitsPage() {
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [varieties, setVarieties] = useState<FruitVariety[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [selectedFruitId, setSelectedFruitId] = useState<string | null>(null);

  const [fruitModalOpen, setFruitModalOpen] = useState(false);
  const [editingFruit, setEditingFruit] = useState<Fruit | null>(null);

  const [varietyModalOpen, setVarietyModalOpen] = useState(false);
  const [editingVariety, setEditingVariety] = useState<FruitVariety | null>(null);
  const [defaultVarietyFruitId, setDefaultVarietyFruitId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [fruitList, varietyList] = await Promise.all([listFruits(), listFruitVarieties()]);
      setFruits(fruitList);
      setVarieties(varietyList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load fruits and varieties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const varietiesByFruit = useMemo(() => {
    const map = new Map<string, FruitVariety[]>();
    for (const v of varieties) {
      const existing = map.get(v.fruit_id) ?? [];
      existing.push(v);
      map.set(v.fruit_id, existing);
    }
    return map;
  }, [varieties]);

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const f of fruits) {
      if (f.active) active++;
      else inactive++;
    }
    return { all: fruits.length, active, inactive };
  }, [fruits]);

  const filteredFruits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fruits.filter((fruit) => {
      if (statusFilter === 'active' && !fruit.active) return false;
      if (statusFilter === 'inactive' && fruit.active) return false;
      if (!q) return true;
      if (fruit.name.toLowerCase().includes(q)) return true;
      const fruitVars = varietiesByFruit.get(fruit.id) ?? [];
      return fruitVars.some((v) => v.name.toLowerCase().includes(q));
    });
  }, [fruits, statusFilter, query, varietiesByFruit]);

  const selectedFruit = useMemo(() => {
    if (!selectedFruitId) return null;
    return fruits.find((f) => f.id === selectedFruitId) ?? null;
  }, [fruits, selectedFruitId]);

  const selectedFruitVarieties = useMemo(() => {
    if (!selectedFruit) return [];
    return varietiesByFruit.get(selectedFruit.id) ?? [];
  }, [selectedFruit, varietiesByFruit]);

  const openAddFruit = () => {
    setEditingFruit(null);
    setFruitModalOpen(true);
  };

  const openEditFruit = (fruit: Fruit) => {
    setEditingFruit(fruit);
    setFruitModalOpen(true);
  };

  const openAddVariety = (fruitId: string | null) => {
    setEditingVariety(null);
    setDefaultVarietyFruitId(fruitId);
    setVarietyModalOpen(true);
  };

  const openEditVariety = (variety: FruitVariety) => {
    setEditingVariety(variety);
    setDefaultVarietyFruitId(variety.fruit_id);
    setVarietyModalOpen(true);
  };

  const handleSaveFruit = async (input: FruitInput) => {
    setActionError(null);
    setNotice(null);
    if (editingFruit) {
      const updated = await updateFruit(editingFruit.id, input);
      setFruits((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setNotice(`Updated fruit "${updated.name}".`);
    } else {
      const created = await createFruit(input);
      setFruits((prev) =>
        [...prev, created].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      );
      setNotice(`Added fruit "${created.name}".`);
    }
  };

  const handleToggleFruit = async (fruit: Fruit) => {
    setActionError(null);
    setNotice(null);
    setBusyId(fruit.id);
    try {
      const updated = await setFruitActive(fruit.id, !fruit.active);
      setFruits((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setNotice(
        updated.active
          ? `Activated "${updated.name}".`
          : `Deactivated "${updated.name}".`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update fruit status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveVariety = async (input: FruitVarietyInput) => {
    setActionError(null);
    setNotice(null);
    if (editingVariety) {
      const updated = await updateFruitVariety(editingVariety.id, input);
      setVarieties((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      setNotice(`Updated variety "${updated.name}".`);
    } else {
      const created = await createFruitVariety(input);
      setVarieties((prev) =>
        [...prev, created].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      );
      setNotice(`Added variety "${created.name}".`);
    }
  };

  const handleToggleVariety = async (variety: FruitVariety) => {
    setActionError(null);
    setNotice(null);
    setBusyId(variety.id);
    try {
      const updated = await setFruitVarietyActive(variety.id, !variety.active);
      setVarieties((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      setNotice(
        updated.active
          ? `Activated "${updated.name}".`
          : `Deactivated "${updated.name}".`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update variety status.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {notice && <AlertBanner tone="success" message={notice} />}
      {actionError && <AlertBanner tone="error" message={actionError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />}

      {loading ? (
        <LoadingCard label="Loading fruits and varieties…" />
      ) : selectedFruit ? (
        /* ================================================================= */
        /* 2. SELECTED FRUIT SCREEN                                          */
        /* ================================================================= */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Button
              variant="secondary"
              size="lg"
              icon={ArrowLeft}
              onClick={() => setSelectedFruitId(null)}
            >
              Back to Fruits
            </Button>

            {selectedFruit.active && (
              <Button
                size="lg"
                icon={Plus}
                onClick={() => openAddVariety(selectedFruit.id)}
              >
                Add Variety
              </Button>
            )}
          </div>

          {/* Fruit detail & management card */}
          <Card className="p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-leaf-950">
                  {selectedFruit.name}
                </h1>
                <Badge tone={selectedFruit.active ? 'green' : 'neutral'}>
                  {selectedFruit.active ? 'Active' : 'Inactive'}
                </Badge>
                <span className="text-base font-semibold text-leaf-600">
                  {selectedFruitVarieties.length}{' '}
                  {selectedFruitVarieties.length === 1 ? 'variety' : 'varieties'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  size="lg"
                  icon={Pencil}
                  onClick={() => openEditFruit(selectedFruit)}
                >
                  Edit Fruit
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  icon={Power}
                  disabled={busyId === selectedFruit.id}
                  onClick={() => void handleToggleFruit(selectedFruit)}
                >
                  {busyId === selectedFruit.id
                    ? 'Updating…'
                    : selectedFruit.active
                    ? 'Deactivate'
                    : 'Activate'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Varieties Cards Grid or Empty State */}
          {selectedFruitVarieties.length === 0 ? (
            <EmptyState
              emoji="📦"
              title="No varieties added yet."
              description="Add the first variety or grade for this fruit."
              action={
                selectedFruit.active ? (
                  <Button
                    size="lg"
                    icon={Plus}
                    onClick={() => openAddVariety(selectedFruit.id)}
                  >
                    Add Variety
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {selectedFruitVarieties.map((variety) => {
                const varBusy = busyId === variety.id;
                return (
                  <Card key={variety.id} className="flex flex-col justify-between p-6 sm:p-7">
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2 className="font-display text-2xl font-bold text-leaf-950">
                          {variety.name}
                        </h2>
                        <Badge tone={variety.active ? 'green' : 'neutral'}>
                          {variety.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>

                      <div className="mt-4 rounded-xl bg-cream-100 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-leaf-600">
                          Default Selling Rate
                        </p>
                        <p className="tabular-nums mt-1 text-2xl font-extrabold text-leaf-950">
                          {variety.default_sell_rate !== null
                            ? `₹${Number(variety.default_sell_rate).toLocaleString('en-IN')} / box`
                            : 'Not set'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-leaf-100 pt-4">
                      <Button
                        variant="secondary"
                        icon={Pencil}
                        onClick={() => openEditVariety(variety)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        icon={Power}
                        disabled={varBusy}
                        onClick={() => void handleToggleVariety(variety)}
                      >
                        {varBusy
                          ? 'Updating…'
                          : variety.active
                          ? 'Deactivate'
                          : 'Activate'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : fruits.length === 0 ? (
        /* ================================================================= */
        /* INITIAL ZERO FRUITS EMPTY STATE                                   */
        /* ================================================================= */
        <EmptyState
          emoji="🥭"
          title="No fruits yet"
          description="Add your first fruit to get started."
          action={
            <Button size="lg" icon={Plus} onClick={openAddFruit}>
              Add Fruit
            </Button>
          }
        />
      ) : (
        /* ================================================================= */
        /* 1. MAIN FRUITS SCREEN (Fruit Catalogue Cards)                     */
        /* ================================================================= */
        <div className="space-y-6">
          <SectionHeader
            title="Fruits"
            action={
              <Button size="lg" icon={Plus} onClick={openAddFruit}>
                Add Fruit
              </Button>
            }
          />

          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500"
                aria-hidden
              />
              <TextInput
                className="pl-12 py-3.5 text-base md:text-lg"
                placeholder="Search fruit or variety…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search fruits and varieties"
              />
            </div>
            <StatusFilter value={statusFilter} onChange={setStatusFilter} counts={counts} />
          </div>

          {filteredFruits.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching fruits"
              description="Try changing your search text or filter."
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredFruits.map((fruit) => {
                const fruitVars = varietiesByFruit.get(fruit.id) ?? [];
                return (
                  <div
                    key={fruit.id}
                    onClick={() => setSelectedFruitId(fruit.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedFruitId(fruit.id);
                      }
                    }}
                    className="group flex flex-col justify-between rounded-2xl border-2 border-leaf-200 bg-white p-6 sm:p-7 shadow-card transition-all duration-150 hover:border-leaf-500 hover:shadow-lifted cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-leaf-500"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="font-display text-2xl sm:text-3xl font-bold text-leaf-950 transition-colors group-hover:text-leaf-800">
                          {fruit.name}
                        </h2>
                        <Badge tone={fruit.active ? 'green' : 'neutral'}>
                          {fruit.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-leaf-100 pt-4">
                      <span className="text-base font-semibold text-leaf-700">
                        {fruitVars.length} {fruitVars.length === 1 ? 'variety' : 'varieties'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-sm font-bold text-leaf-600 transition-colors group-hover:text-leaf-900">
                        View Varieties
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <FruitFormModal
        open={fruitModalOpen}
        editing={editingFruit}
        onClose={() => setFruitModalOpen(false)}
        onSubmit={handleSaveFruit}
      />

      <VarietyFormModal
        open={varietyModalOpen}
        editing={editingVariety}
        defaultFruitId={defaultVarietyFruitId}
        fruits={fruits}
        onClose={() => setVarietyModalOpen(false)}
        onSubmit={handleSaveVariety}
      />
    </div>
  );
}

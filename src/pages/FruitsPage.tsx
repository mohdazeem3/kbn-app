import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Pencil, Plus, Search } from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Button,
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
  updateFruit,
  updateFruitVariety,
} from '@/services/masterData';
import { useCacheInvalidation } from '@/services/cache';
import type { Fruit, FruitInput, FruitVariety, FruitVarietyInput } from '@/types/database';

export function FruitsPage({ isActive = true }: { isActive?: boolean } = {}) {
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [varieties, setVarieties] = useState<FruitVariety[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [selectedFruitId, setSelectedFruitId] = useState<string | null>(null);

  const [fruitModalOpen, setFruitModalOpen] = useState(false);
  const [editingFruit, setEditingFruit] = useState<Fruit | null>(null);

  const [varietyModalOpen, setVarietyModalOpen] = useState(false);
  const [editingVariety, setEditingVariety] = useState<FruitVariety | null>(null);
  const [defaultVarietyFruitId, setDefaultVarietyFruitId] = useState<string | null>(null);

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
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

  useCacheInvalidation(['fruits', 'varieties'], () => void loadData(true), { isActive });

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

  return (
    <div className="space-y-6">
      {notice && <AlertBanner tone="success" message={notice} />}
      {actionError && <AlertBanner tone="error" message={actionError} />}
      {loadError && <AlertBanner tone="error" message={loadError} onRetry={() => void loadData()} />}

      {loading ? (
        <LoadingCard label="Loading fruits and varieties…" />
      ) : selectedFruit ? (
        /* ================================================================= */
        /* 2. SELECTED FRUIT SCREEN (Varieties Listing)                      */
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
          <div className="rounded-2xl border border-stone-200/80 bg-white p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold text-lg sm:text-xl border border-emerald-200/60 shadow-xs">
                {selectedFruit.name.trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-leaf-950 truncate">
                    {selectedFruit.name}
                  </h1>
                  <Badge tone={selectedFruit.active ? 'green' : 'neutral'}>
                    {selectedFruit.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs sm:text-sm font-medium text-stone-500">
                  {selectedFruitVarieties.length}{' '}
                  {selectedFruitVarieties.length === 1 ? 'variety' : 'varieties'} registered
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon={Pencil}
                onClick={() => openEditFruit(selectedFruit)}
              >
                Edit Fruit
              </Button>
            </div>
          </div>

          {/* Varieties Horizontal Row List (Mobile Contact Style) */}
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
            <div className="flex flex-col gap-2.5">
              {selectedFruitVarieties.map((variety) => {
                const initial = variety.name.trim().charAt(0).toUpperCase() || 'V';
                const hasRate =
                  variety.default_sell_rate !== null && Number(variety.default_sell_rate) > 0;

                return (
                  <div
                    key={variety.id}
                    className="group relative flex items-center justify-between gap-4 rounded-xl border border-stone-200/90 bg-white px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-all duration-150 hover:border-leaf-300 hover:bg-stone-50/70 hover:shadow"
                  >
                    {/* Left: Avatar initial + Variety Name + Parent Fruit Badge + Subtitle */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 font-bold text-sm sm:text-base border border-amber-200/60 shadow-xs">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base sm:text-lg font-bold text-leaf-950 truncate">
                            {variety.name}
                          </h2>
                          <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/60 rounded px-1.5 py-0.5">
                            {selectedFruit.name}
                          </span>
                          {!variety.active && (
                            <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs sm:text-sm font-medium text-stone-500">
                          Grade / Variety of {selectedFruit.name}
                        </p>
                      </div>
                    </div>

                    {/* Right: Default Selling Rate + Edit Button */}
                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-400">
                          Selling Rate
                        </p>
                        <p
                          className={`tabular-nums text-base sm:text-xl font-extrabold ${
                            hasRate ? 'text-leaf-950' : 'text-stone-400 text-sm font-medium'
                          }`}
                        >
                          {hasRate
                            ? `₹${Number(variety.default_sell_rate).toLocaleString('en-IN')}`
                            : 'Not set'}
                          {hasRate && (
                            <span className="text-xs font-semibold text-stone-500"> / box</span>
                          )}
                        </p>
                      </div>

                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={() => openEditVariety(variety)}
                        className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
                        title="Edit variety"
                        aria-label={`Edit ${variety.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
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
        /* 1. MAIN FRUITS SCREEN (Fruit Catalogue List)                      */
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

          {/* Fruits Horizontal Row List (Mobile Contact Style) */}
          {filteredFruits.length === 0 ? (
            <EmptyState
              emoji="🔎"
              title="No matching fruits"
              description="Try changing your search text or filter."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredFruits.map((fruit) => {
                const fruitVars = varietiesByFruit.get(fruit.id) ?? [];
                const initial = fruit.name.trim().charAt(0).toUpperCase() || 'F';

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
                    className="group relative flex items-center justify-between gap-4 rounded-xl border border-stone-200/90 bg-white px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-all duration-150 hover:border-leaf-300 hover:bg-stone-50/70 hover:shadow cursor-pointer"
                  >
                    {/* Left: Avatar initial + Name + Variety summary */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm sm:text-base border border-emerald-200/60 shadow-xs">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base sm:text-lg font-bold text-leaf-950 truncate group-hover:text-leaf-800 transition-colors">
                            {fruit.name}
                          </h2>
                          {!fruit.active && (
                            <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs sm:text-sm font-medium text-stone-500 truncate">
                          {fruitVars.length} {fruitVars.length === 1 ? 'variety' : 'varieties'}
                          {fruitVars.length > 0 && (
                            <span className="text-stone-400">
                              {' '}• {fruitVars.map((v) => v.name).slice(0, 4).join(', ')}
                              {fruitVars.length > 4 ? '…' : ''}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: Varieties Count + Edit + Chevron */}
                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-400">
                          Varieties
                        </p>
                        <p className="tabular-nums text-base sm:text-xl font-extrabold text-leaf-950">
                          {fruitVars.length}
                        </p>
                      </div>

                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditFruit(fruit);
                        }}
                        className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
                        title="Edit fruit"
                        aria-label={`Edit ${fruit.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>

                      {/* Forward chevron */}
                      <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-leaf-600 transition-transform group-hover:translate-x-0.5 shrink-0" />
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

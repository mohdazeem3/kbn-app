import { supabase } from '@/lib/supabase';
import type {
  Customer,
  CustomerInput,
  Fruit,
  FruitInput,
  FruitVariety,
  FruitVarietyInput,
  Supplier,
  SupplierFruitLink,
  SupplierInput,
  SupplierWithFruit,
} from '@/types/database';

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

function formatMasterError(error: PostgrestErrorLike | null, entityLabel: string): Error {
  if (!error) return new Error(`Could not complete ${entityLabel} request.`);

  const code = error.code ?? '';
  const msg = error.message ?? '';

  if (
    code === 'PGRST205' ||
    code === '42P01' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  ) {
    return new Error(
      `The ${entityLabel} database table is not ready yet. Run the prepared Supabase migrations first, then tap Retry.`
    );
  }

  if (code === '23505') {
    return new Error(`A ${entityLabel} with this name already exists.`);
  }

  if (code === '23503') {
    return new Error(
      `This ${entityLabel} is linked to existing historical records and cannot change its referenced category.`
    );
  }

  if (code === '23514') {
    return new Error(`Please check the ${entityLabel} values — one or more fields failed validation.`);
  }

  if (code === '42501') {
    return new Error('You do not have permission to perform this action. Please sign in again.');
  }

  return new Error(msg || `Could not save ${entityLabel}. Please try again.`);
}

function normalizeRequiredName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function normalizeOptionalPhone(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalRate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Default sell rate must be greater than zero.');
  }
  return Math.round(value * 100) / 100;
}

// ----------------------------------------------------------------------------
// Fruits (Dynamic Fruit Categories)
// ----------------------------------------------------------------------------

export async function listFruits(): Promise<Fruit[]> {
  const { data, error } = await supabase
    .from('fruits')
    .select('id, name, active, created_at, updated_at')
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw formatMasterError(error, 'fruit category');
  return (data ?? []) as Fruit[];
}

export async function createFruit(input: FruitInput): Promise<Fruit> {
  const name = normalizeRequiredName(input.name, 'Fruit name');
  const { data, error } = await supabase
    .from('fruits')
    .insert({ name })
    .select('id, name, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit category');
  return data as Fruit;
}

export async function updateFruit(id: string, input: FruitInput): Promise<Fruit> {
  const name = normalizeRequiredName(input.name, 'Fruit name');
  const { data, error } = await supabase
    .from('fruits')
    .update({ name })
    .eq('id', id)
    .select('id, name, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit category');
  return data as Fruit;
}

export async function setFruitActive(id: string, active: boolean): Promise<Fruit> {
  const { data, error } = await supabase
    .from('fruits')
    .update({ active })
    .eq('id', id)
    .select('id, name, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit category');
  return data as Fruit;
}

// ----------------------------------------------------------------------------
// Fruit Varieties / Grades (Linked to a Fruit Category)
// ----------------------------------------------------------------------------

export async function listFruitVarieties(fruitId?: string): Promise<FruitVariety[]> {
  let query = supabase
    .from('fruit_varieties')
    .select('id, fruit_id, name, default_sell_rate, active, created_at, updated_at')
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (fruitId) {
    query = query.eq('fruit_id', fruitId);
  }

  const { data, error } = await query;
  if (error) throw formatMasterError(error, 'fruit variety');
  return (data ?? []) as FruitVariety[];
}

export async function createFruitVariety(input: FruitVarietyInput): Promise<FruitVariety> {
  if (!input.fruit_id) {
    throw new Error('Please choose a fruit category.');
  }
  const name = normalizeRequiredName(input.name, 'Variety / grade name');
  const default_sell_rate = normalizeOptionalRate(input.default_sell_rate);

  const { data, error } = await supabase
    .from('fruit_varieties')
    .insert({
      fruit_id: input.fruit_id,
      name,
      default_sell_rate,
    })
    .select('id, fruit_id, name, default_sell_rate, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit variety');
  return data as FruitVariety;
}

export async function updateFruitVariety(
  id: string,
  input: FruitVarietyInput
): Promise<FruitVariety> {
  if (!input.fruit_id) {
    throw new Error('Please choose a fruit category.');
  }
  const name = normalizeRequiredName(input.name, 'Variety / grade name');
  const default_sell_rate = normalizeOptionalRate(input.default_sell_rate);

  const { data, error } = await supabase
    .from('fruit_varieties')
    .update({
      fruit_id: input.fruit_id,
      name,
      default_sell_rate,
    })
    .eq('id', id)
    .select('id, fruit_id, name, default_sell_rate, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit variety');
  return data as FruitVariety;
}

export async function setFruitVarietyActive(id: string, active: boolean): Promise<FruitVariety> {
  const { data, error } = await supabase
    .from('fruit_varieties')
    .update({ active })
    .eq('id', id)
    .select('id, fruit_id, name, default_sell_rate, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'fruit variety');
  return data as FruitVariety;
}

// ----------------------------------------------------------------------------
// Suppliers (Multi-Fruit & Single-Fruit Support via Migration 010 RPCs)
// ----------------------------------------------------------------------------

interface SupplierJoinRow extends Supplier {
  fruits?: { name: string; active: boolean } | { name: string; active: boolean }[] | null;
  supplier_fruits?: {
    fruit_id: string;
    fruits: { id?: string; name: string; active: boolean } | null;
  }[] | null;
}

function mapSupplierRow(row: SupplierJoinRow): SupplierWithFruit {
  const linkedList: SupplierFruitLink[] = (row.supplier_fruits ?? [])
    .map((sf) => ({
      fruit_id: sf.fruit_id,
      fruit_name: sf.fruits?.name ?? 'Unknown fruit',
      fruit_active: sf.fruits?.active ?? false,
    }))
    .filter((f) => Boolean(f.fruit_id));

  // If supplier_fruits join didn't yield anything, fallback to legacy fruits join
  if (linkedList.length === 0 && row.fruit_id) {
    const legacyFruit = Array.isArray(row.fruits) ? row.fruits[0] : row.fruits;
    linkedList.push({
      fruit_id: row.fruit_id,
      fruit_name: legacyFruit?.name ?? 'Unknown fruit',
      fruit_active: legacyFruit?.active ?? false,
    });
  }

  const fruitIds = linkedList.map((f) => f.fruit_id);
  const fruitNames = linkedList.map((f) => f.fruit_name).join(', ') || 'No fruits linked';
  const primaryFruit = linkedList[0];

  return {
    id: row.id,
    name: row.name,
    fruit_id: row.fruit_id ?? primaryFruit?.fruit_id ?? null,
    phone: row.phone,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    fruit_name: fruitNames,
    fruit_active: primaryFruit?.fruit_active ?? false,
    fruit_ids: fruitIds,
    fruits: linkedList,
  };
}

export async function listSuppliers(): Promise<SupplierWithFruit[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select(`
      id, name, fruit_id, phone, active, created_at, updated_at,
      supplier_fruits (
        fruit_id,
        fruits ( id, name, active )
      )
    `)
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw formatMasterError(error, 'supplier');
  return ((data ?? []) as unknown as SupplierJoinRow[]).map(mapSupplierRow);
}

export async function createSupplier(input: SupplierInput): Promise<SupplierWithFruit> {
  const name = normalizeRequiredName(input.name, 'Supplier name');
  const fruitIds = Array.isArray(input.fruit_ids)
    ? input.fruit_ids.filter(Boolean)
    : input.fruit_id
      ? [input.fruit_id]
      : [];

  if (fruitIds.length === 0) {
    throw new Error('Please select at least one fruit category for this supplier.');
  }
  const phone = normalizeOptionalPhone(input.phone);

  const { data: supplierId, error } = await supabase.rpc('create_supplier', {
    p_name: name,
    p_fruit_ids: fruitIds,
    p_phone: phone,
  });

  if (error) throw formatMasterError(error, 'supplier');

  const { data: row, error: fetchError } = await supabase
    .from('suppliers')
    .select(`
      id, name, fruit_id, phone, active, created_at, updated_at,
      supplier_fruits (
        fruit_id,
        fruits ( id, name, active )
      )
    `)
    .eq('id', supplierId as string)
    .single();

  if (fetchError) throw formatMasterError(fetchError, 'supplier');
  return mapSupplierRow(row as unknown as SupplierJoinRow);
}

export async function updateSupplier(
  id: string,
  input: SupplierInput
): Promise<SupplierWithFruit> {
  const name = normalizeRequiredName(input.name, 'Supplier name');
  const fruitIds = Array.isArray(input.fruit_ids)
    ? input.fruit_ids.filter(Boolean)
    : input.fruit_id
      ? [input.fruit_id]
      : [];

  if (fruitIds.length === 0) {
    throw new Error('Please select at least one fruit category for this supplier.');
  }
  const phone = normalizeOptionalPhone(input.phone);

  const { error } = await supabase.rpc('update_supplier', {
    p_id: id,
    p_name: name,
    p_fruit_ids: fruitIds,
    p_phone: phone,
  });

  if (error) throw formatMasterError(error, 'supplier');

  const { data: row, error: fetchError } = await supabase
    .from('suppliers')
    .select(`
      id, name, fruit_id, phone, active, created_at, updated_at,
      supplier_fruits (
        fruit_id,
        fruits ( id, name, active )
      )
    `)
    .eq('id', id)
    .single();

  if (fetchError) throw formatMasterError(fetchError, 'supplier');
  return mapSupplierRow(row as unknown as SupplierJoinRow);
}

export async function setSupplierActive(
  id: string,
  active: boolean
): Promise<SupplierWithFruit> {
  const { data, error } = await supabase
    .from('suppliers')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(`
      id, name, fruit_id, phone, active, created_at, updated_at,
      supplier_fruits (
        fruit_id,
        fruits ( id, name, active )
      )
    `)
    .single();

  if (error) throw formatMasterError(error, 'supplier');
  return mapSupplierRow(data as unknown as SupplierJoinRow);
}

// ----------------------------------------------------------------------------
// Customers (Registered Buyers; Walk-in Cash Customer Uses NULL on Bills)
// ----------------------------------------------------------------------------

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, active, created_at, updated_at')
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw formatMasterError(error, 'customer');
  return (data ?? []) as Customer[];
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const name = normalizeRequiredName(input.name, 'Customer name');
  const phone = normalizeOptionalPhone(input.phone);

  const { data, error } = await supabase
    .from('customers')
    .insert({ name, phone })
    .select('id, name, phone, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'customer');
  return data as Customer;
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Customer> {
  const name = normalizeRequiredName(input.name, 'Customer name');
  const phone = normalizeOptionalPhone(input.phone);

  const { data, error } = await supabase
    .from('customers')
    .update({ name, phone })
    .eq('id', id)
    .select('id, name, phone, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'customer');
  return data as Customer;
}

export async function setCustomerActive(id: string, active: boolean): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update({ active })
    .eq('id', id)
    .select('id, name, phone, active, created_at, updated_at')
    .single();

  if (error) throw formatMasterError(error, 'customer');
  return data as Customer;
}

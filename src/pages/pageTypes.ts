export type Page =
  | 'dashboard'
  | 'receive'
  | 'sale'
  | 'bills'
  | 'expenses'
  | 'stock'
  | 'fruits'
  | 'customers'
  | 'suppliers';

export const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  receive: 'Receive Stock',
  sale: 'New Sale',
  bills: 'Sales History',
  expenses: 'Expenses',
  stock: 'Stock',
  fruits: 'Fruits & Varieties',
  customers: 'Customers',
  suppliers: 'Suppliers',
};

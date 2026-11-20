export type Page =
  | 'dashboard'
  | 'receive'
  | 'sale'
  | 'bills'
  | 'stock'
  | 'fruits'
  | 'customers'
  | 'suppliers';

export const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  receive: 'Receive Stock',
  sale: 'New Sale',
  bills: 'Sales History',
  stock: 'Stock',
  fruits: 'Fruits & Varieties',
  customers: 'Customers',
  suppliers: 'Suppliers',
};

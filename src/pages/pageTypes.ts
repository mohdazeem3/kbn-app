export type Page = 'dashboard' | 'receive' | 'sale' | 'stock' | 'customers' | 'suppliers';

export const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  receive: 'Receive Stock',
  sale: 'New Sale',
  stock: 'Stock',
  customers: 'Customers',
  suppliers: 'Suppliers',
};

import { roundToCents } from "./money";
import { applyTax } from "./tax";

export interface LineItem {
  name: string;
  price: number;
  qty: number;
}

/**
 * Compute the final payable total for a cart: sum line items, apply tax,
 * round to cents.
 */
export function checkout(items: LineItem[], taxRate: number): number {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const withTax = applyTax(subtotal, taxRate);
  return roundToCents(withTax);
}

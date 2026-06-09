// Tax calculation for the checkout flow.

/**
 * Apply a tax rate (e.g. 0.1 for 10%) to a subtotal and return the taxed amount.
 * This is where the tax rate is applied to the subtotal.
 */
export function applyTax(subtotal: number, rate: number): number {
  return subtotal + subtotal * rate;
}

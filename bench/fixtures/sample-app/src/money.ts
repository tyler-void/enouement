// Money helpers. Amounts are plain numbers in whole currency units (e.g. dollars).

/**
 * Round a monetary amount to two decimal places (cents).
 */
export function roundToCents(amount: number): number {
  // BUG: this truncates toward zero instead of rounding to nearest cent.
  // e.g. roundToCents(1.999) returns 1.99 but should return 2.00.
  return Math.trunc(amount * 100) / 100;
}

/** Add two monetary amounts, rounded to cents. */
export function add(a: number, b: number): number {
  return roundToCents(a + b);
}

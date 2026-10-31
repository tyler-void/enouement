// Amounts are integer cents.
export type Cents = number;

export function toCents(input: string): Cents {
  const [whole, frac = ""] = input.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function formatMoney(c: Cents): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

export function addTax(c: Cents, ratePercent: number): Cents {
  return c + Math.round((c * ratePercent) / 100);
}

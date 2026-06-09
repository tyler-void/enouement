import { test, expect } from "bun:test";
// FAILS until src/discount.ts is created exporting applyDiscount.
import { applyDiscount } from "../src/discount";

test("applies a percentage discount", () => {
  expect(applyDiscount(100, 10)).toBe(90); // 10% off 100
  expect(applyDiscount(50, 0)).toBe(50); // 0% off
  expect(applyDiscount(200, 25)).toBe(150); // 25% off
});

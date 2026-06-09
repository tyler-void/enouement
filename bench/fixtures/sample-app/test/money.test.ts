import { test, expect } from "bun:test";
import { roundToCents } from "../src/money";

// FAILS until the rounding bug in src/money.ts is fixed.
test("rounds to nearest cent (half up)", () => {
  expect(roundToCents(1.999)).toBe(2.0); // truncation bug returns 1.99
  expect(roundToCents(1.991)).toBe(1.99);
  expect(roundToCents(0.005)).toBe(0.01); // truncation bug returns 0.0
});

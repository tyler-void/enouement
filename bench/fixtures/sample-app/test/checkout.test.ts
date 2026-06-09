import { test, expect } from "bun:test";
import { checkout } from "../src/checkout";

// Baseline test — passes out of the box. Keeps the suite realistic.
test("checkout sums line items and applies tax", () => {
  expect(checkout([{ name: "widget", price: 10, qty: 2 }], 0)).toBe(20);
  expect(checkout([{ name: "widget", price: 10, qty: 1 }], 0.1)).toBe(11);
});

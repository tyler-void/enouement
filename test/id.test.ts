// Identifiers (FR-029, research.md §5) — tasks.md T012, plan.md binding test #8.

import { describe, expect, test } from "bun:test";
import { createUlidFactory, isUlid, ulidTime } from "../src/knowledge/id";

const T0 = 1_761_868_800_000; // 2025-10-31T00:00:00Z
const bytes = (fill: number) => () => new Uint8Array(10).fill(fill);

describe("ULID", () => {
  test("is canonical: 26 characters, Crockford base32, timestamp first", () => {
    const id = createUlidFactory({ now: () => T0 })();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(id).not.toMatch(/[ILOU]/);
    expect(ulidTime(id)).toBe(T0);
  });

  test("string sort equals chronological sort, across timestamps a year apart", () => {
    const times = [T0 + 365 * 86_400_000, T0, T0 + 1, T0 + 86_400_000, T0 + 2];
    const ids = times.map((t) => createUlidFactory({ now: () => t })());
    const byString = [...ids].sort();
    const byTime = [...ids].sort((a, b) => ulidTime(a) - ulidTime(b));
    expect(byString).toEqual(byTime);
  });

  test("is monotonic within one millisecond: 10,000 ids at one timestamp are unique and increasing", () => {
    // A fixed random source proves the order comes from the increment, not from luck.
    const next = createUlidFactory({ now: () => T0, random: bytes(0x42) });
    const ids = Array.from({ length: 10_000 }, next);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  test("keeps increasing when the clock steps backwards", () => {
    const clock = [T0 + 10, T0 + 5, T0 + 5, T0 + 11];
    const next = createUlidFactory({ now: () => clock.shift()!, random: bytes(1) });
    const ids = [next(), next(), next(), next()];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(4);
  });

  test("throws rather than wrap when the random component overflows in one millisecond", () => {
    const next = createUlidFactory({ now: () => T0, random: bytes(0xff) });
    next();
    expect(() => next()).toThrow(/overflow/);
  });

  test("orders ids from different machines by their clocks, not by creation — so chains must follow `supersedes`", () => {
    // Machine B's clock is 5 s behind. It mints its id AFTER machine A, yet that id sorts first.
    // This is why data-model §2.2 orders a supersession chain by the graph, never by id.
    const onA = createUlidFactory({ now: () => T0 + 2_000 })();
    const onB = createUlidFactory({ now: () => T0 + 3_000 - 5_000 })();
    expect(onB < onA).toBe(true);
  });

  test("isUlid rejects lower case, I L O U, the wrong length, and an out-of-range timestamp", () => {
    const good = createUlidFactory({ now: () => T0 })();
    expect(isUlid(good.toLowerCase())).toBe(false);
    for (const bad of ["I", "L", "O", "U"]) expect(isUlid(good.slice(0, 25) + bad)).toBe(false);
    expect(isUlid(good.slice(0, 25))).toBe(false);
    expect(isUlid(good + "0")).toBe(false);
    expect(isUlid("8" + good.slice(1))).toBe(false);
    expect(isUlid(42)).toBe(false);
  });
});

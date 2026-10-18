import { expect, test } from "bun:test";
import { minimumTake } from "./book.ts";

const level = (order: string, available: string) => ({ order_id: order, supply: "1000000", receive: "1000000", available, min_fill: "1", valid_until: "9999-12-31T00:00:00Z" });

test("a book's least take counts no more parts than the take buys", () => {
  // Two levels of 3 each, and a receiving venue that takes 5 at least: two parts reach it, one never does.
  const levels = [level("a", "3000000"), level("b", "3000000")];
  expect(minimumTake(levels, 10n ** 12n, new Set(), 5_000_000n)).toBe(5_000_000n);
  expect(minimumTake(levels, 10n ** 12n, new Set(), 5_000_000n, Date.now(), 1)).toBeNull();
});

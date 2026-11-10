import { expect, test } from "bun:test";
import { bookLimits, checkQuote, slippageMinimum } from "./book.ts";
import { takeFee } from "./protocol/fees.ts";

const now = Date.parse("2026-11-09T12:00:00Z");
const level = (patch = {}) => ({ order_id: "maker", supply: "100000000", receive: "100000000", available: "100000000", min_fill: "1000000", valid_until: "2026-11-09T13:00:00Z", ...patch });
const book = (levels = [level()], max_fill = "100000000") => ({ levels, max_fill, taker_fee_bps: 0 });

test("book limits expose executable input and output endpoints, capped by the source budget", () => {
  const limits = bookLimits(book(), { now, budget: 7_500_000n, minimum: 5_000_000n });
  expect(limits).toEqual({ minimum: { pay: 5_000_000n, out: 5_000_000n, parts: 1 }, maximum: { pay: 7_500_000n, out: 7_500_000n, parts: 1 } });
  expect(bookLimits(book(), { now })?.maximum.pay).toBe(100_000_000n);
  expect(bookLimits(book(), { now, budget: 4_999_999n, minimum: 5_000_000n })).toBeNull();
  if (!limits) throw new Error("Expected executable limits");
  for (const endpoint of [limits.minimum, limits.maximum]) {
    expect(() => checkQuote(book(), new Set(), { amount_in: String(endpoint.pay), min_out: String(endpoint.out) }, 5_000_000n, now)).not.toThrow();
  }
});

test("limits exclude owned, expired, empty and undersized liquidity and enforce fill and part caps", () => {
  const levels = [level({ order_id: "mine" }), level({ valid_until: "2026-11-09T12:00:00Z" }), level({ available: "0" }), level({ min_fill: "50000001" }),
    ...["a", "b", "c"].map(order_id => level({ order_id }))];
  expect(bookLimits(book(levels, "50000000"), { now, own: new Set(["mine"]), maxParts: 2 })?.maximum).toEqual({ pay: 100_000_000n, out: 100_000_000n, parts: 2 });
  expect(bookLimits(book([]), { now })).toBeNull();
  expect(bookLimits(book(), { now, budget: 0n })).toBeNull();
  expect(bookLimits(book(), { now: Date.parse("2026-11-09T13:00:00Z") })).toBeNull();
});

test("payment fees fit the budget and wallet floors apply to every delivered part", () => {
  const options = { now, minimum: { total: 0n, part: 10_000n }, fee: takeFee("hyperliquid", 100, 100) };
  const quoted = book([level({ available: "9999", min_fill: "1" }), level({ order_id: "next", min_fill: "1" })]);
  expect(bookLimits(quoted, { ...options, budget: 20_200n })).toEqual({ minimum: { pay: 10_100n, out: 10_000n, parts: 1 }, maximum: { pay: 20_200n, out: 20_000n, parts: 1 } });
  expect(bookLimits(quoted, { ...options, budget: 10_099n })).toBeNull();
});

test("venue payments buy one fill and deduct the fee from delivery before the minimum", () => {
  const quoted = book([level({ available: "2000000" }), level({ order_id: "next" })]);
  const limits = bookLimits(quoted, { now, fee: takeFee("lighter", 100, 100), minimum: 1_000_000n });
  expect(limits?.maximum).toEqual({ pay: 2_000_000n, out: 1_980_000n, parts: 1 });
  expect(limits?.minimum).toEqual({ pay: 1_010_101n, out: 1_000_000n, parts: 1 });
});

test("6/18 decimal endpoints retain precision and spend only executable units", () => {
  const quoted = book([level({ receive: "100010000000000000000" })]);
  expect(bookLimits(quoted, { now, budget: 6_000_000_000_000_000_000n })?.maximum).toEqual({ pay: 5_999_999_940_000_000_000n, out: 5_999_400n, parts: 1 });
  expect(bookLimits(quoted, { now })?.minimum.pay).toBe(1_000_100_000_000_000_000n);
});

test("slippage is an explicit output floor, rounded down without changing book capacity", () => {
  expect(slippageMinimum(5_999_500n, 10)).toBe(5_993_500n);
  expect(slippageMinimum(10_000_000_000_000_000_001n, 0)).toBe(10_000_000_000_000_000_001n);
  expect(slippageMinimum(123n, 10_000)).toBe(0n);
  for (const value of [-1, 0.1, NaN, Infinity, 10_001]) expect(() => slippageMinimum(10n, value)).toThrow();
  expect(() => slippageMinimum(-1n, 10)).toThrow();
  expect(() => bookLimits(book(), { budget: -1n })).toThrow();
  expect(() => bookLimits(book(), { maxParts: 0 })).toThrow();
});

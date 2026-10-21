import { describe, expect, test } from "bun:test";
import { checkQuote, MAX_PARTS, minimumTake, sweep } from "./book.ts";

const level = (order_id: string, supply: number, receive: number, available: number, min_fill = 1) => ({
  order_id,
  valid_until: "2099-01-01T00:00:00Z",
  supply: String(supply),
  receive: String(receive),
  available: String(available),
  min_fill: String(min_fill),
});

const NO_CAP = 10n ** 18n;
const none = new Set<string>();

test("a book's least take counts no more parts than the take buys", () => {
  // Two levels of 3 each, and a receiving venue that takes 5 at least: two parts reach it, one never does.
  const levels = [level("a", 1_000_000, 1_000_000, 3_000_000), level("b", 1_000_000, 1_000_000, 3_000_000)];
  expect(minimumTake(levels, 10n ** 12n, new Set(), 5_000_000n)).toBe(5_000_000n);
  expect(minimumTake(levels, 10n ** 12n, new Set(), 5_000_000n, Date.now(), 1)).toBeNull();
});

test("the maker's 5 USDC minimum needs 5.00256 pUSD at the quoted price", () => {
  const book = [level("maker", 1_000_000, 1_000_512, 98_000_000, 5_000_000)];
  expect(minimumTake(book, NO_CAP, none)).toBe(5_002_560n);
  expect(sweep(book, NO_CAP, none, 5_000_000n).parts).toBe(0);
  expect(sweep(book, NO_CAP, none, 5_002_559n).parts).toBe(0);
  expect(sweep(book, NO_CAP, none, 5_002_560n)).toEqual({ out: 5_000_000n, pay: 5_002_560n, parts: 1 });
});

test("minimum payment rounds up and excludes expired, owned or unfillable quotes", () => {
  const book = [
    level("mine", 1, 1, 50, 1),
    { ...level("expired", 1, 1, 50, 1), valid_until: "2020-01-01T00:00:00Z" },
    level("empty", 1, 1, 0, 1),
    level("cap", 1, 1, 50, 20),
    level("valid", 3, 7, 50, 5),
  ];
  expect(minimumTake(book, 10n, new Set(["mine"]))).toBe(12n);
  expect(minimumTake(book.slice(0, 4), 10n, new Set(["mine"]))).toBeNull();
  expect(minimumTake([], NO_CAP, none)).toBeNull();
});

describe("sweep, as POST /takes takes", () => {
  test("pays each part's price rounded up, receives it rounded down", () => {
    // 10 USDC at 1.001 USDC per pUSD: 9.990009 pUSD, costing 9.999999009 rounded up.
    expect(sweep([level("a", 25_000_000, 25_025_000, 25_000_000)], NO_CAP, none, 10_000_000n)).toEqual({
      out: 9_990_009n,
      pay: 10_000_000n,
      parts: 1,
    });
  });

  test("goes through the book best first, the last order in part", () => {
    const levels = [level("a", 1_000_000, 1_000_000, 3_000_000), level("b", 1_000_000, 2_000_000, 5_000_000)];
    expect(sweep(levels, NO_CAP, none, 5_000_000n)).toEqual({ out: 4_000_000n, pay: 5_000_000n, parts: 2 });
  });

  test("takes at most max_fill from one level", () => {
    const levels = [level("a", 1, 1, 2_000_000_000), level("b", 1, 1, 1_000_000_000)];
    expect(sweep(levels, 1_000_000_000n, none, 1_500_000_000n)).toEqual({
      out: 1_500_000_000n,
      pay: 1_500_000_000n,
      parts: 2,
    });
  });

  test("skips an order whose share falls below its min_fill", () => {
    const levels = [level("a", 1, 1, 50_000_000, 5_000_000), level("b", 1, 2, 50_000_000, 1_000_000)];
    expect(sweep(levels, NO_CAP, none, 2_000_000n)).toEqual({ out: 1_000_000n, pay: 2_000_000n, parts: 1 });
  });

  test("leaves one's own orders out", () => {
    const levels = [level("mine", 1, 1, 10_000_000), level("b", 1, 2, 10_000_000)];
    expect(sweep(levels, NO_CAP, new Set(["mine"]), 2_000_000n)).toEqual({ out: 1_000_000n, pay: 2_000_000n, parts: 1 });
  });

  test("goes through at most MAX_PARTS levels", () => {
    const levels = Array.from({ length: 10 }, (_, index) => level(`o${index}`, 1, 1, 1_000_000));
    expect(sweep(levels, NO_CAP, none, 20_000_000n)).toEqual({ out: BigInt(MAX_PARTS) * 1_000_000n, pay: BigInt(MAX_PARTS) * 1_000_000n, parts: MAX_PARTS });
  });

  test("the receiving venue's minimum applies to all parts together, not to each order", () => {
    // Three makers with 2 pUSD left each, as Polymarket's 5 pUSD minimum leaves them.
    const levels = ["a", "b", "c"].map(id => level(id, 1, 1, 2_000_000, 1_000_000));
    expect(sweep(levels, NO_CAP, none, 5_000_000n, MAX_PARTS, 5_000_000n)).toEqual({ out: 5_000_000n, pay: 5_000_000n, parts: 3 });
    expect(sweep(levels, NO_CAP, none, 4_999_999n, MAX_PARTS, 5_000_000n)).toEqual({ out: 0n, pay: 0n, parts: 0 });
    expect(sweep(levels, NO_CAP, none, 5_000_000n, 2, 5_000_000n).parts).toBe(0);
    expect(minimumTake(levels, NO_CAP, none, 5_000_000n)).toBe(5_000_000n);
    expect(minimumTake(levels, NO_CAP, none, 7_000_000n)).toBeNull();
    expect(minimumTake(levels, NO_CAP, none)).toBe(1_000_000n);
  });

  test("an empty book or no amount takes nothing", () => {
    expect(sweep([], NO_CAP, none, 5_000_000n)).toEqual({ out: 0n, pay: 0n, parts: 0 });
    expect(sweep([level("a", 1, 1, 1_000_000)], NO_CAP, none, 0n)).toEqual({ out: 0n, pay: 0n, parts: 0 });
  });
});

test("fresh quote validation respects the reviewed amount, minimum and part limit", () => {
  const quoted = level("order", 1_000_000, 1_000_000, 5_000_000, 1_000_000);
  const book = { max_fill:"100000000",levels:[quoted] };
  const input = { amount_in: "5000000", min_out: "4900000", max_parts: 2 };
  expect(() => checkQuote(book,new Set(),input)).not.toThrow();
  expect(() => checkQuote({...book,levels:[{...quoted,receive:"1010000"}]},new Set(),input)).not.toThrow();
  expect(() => checkQuote({...book,levels:[{...quoted,supply:"990000",available:"6000000"}]},new Set(),input)).not.toThrow();
  expect(() => checkQuote({...book,levels:[{...quoted,receive:"1100000"}]},new Set(),input)).toThrow("minimum");
  const split = {...book, levels:[{...quoted,available:"3000000"},{...quoted,order_id:"other",available:"2000000"}]};
  expect(() => checkQuote(split,new Set(),input)).not.toThrow();
  expect(() => checkQuote(split,new Set(),{...input,max_parts:1})).toThrow("minimum");
  expect(() => checkQuote({...book,levels:[{...quoted,available:"4000000"}]},new Set(),input)).toThrow("minimum");
  expect(() => checkQuote({...book,levels:[]},new Set(),input)).toThrow("No executable price");
  expect(() => checkQuote(split,new Set(),input,5_000_000n)).not.toThrow();
  expect(() => checkQuote(split,new Set(),input,5_000_001n)).toThrow("No executable price");
});

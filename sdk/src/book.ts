// The book as the server matches a take, so a client knows before funding whether a take executes.
type Level = { order_id: string; supply: string; receive: string; available: string; min_fill: string; valid_until: string };

/** The most fills one take reserves. */
export const MAX_PARTS = 8;

const divCeil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const live = <L extends Level>(levels: L[]) => levels.filter(level => Date.parse(level.valid_until) > Date.now());

/** `out` received on the destination, `pay` paid on the source. */
export interface Sweep { out: bigint; pay: bigint; parts: number }

/**
 * As the server matches: best price first, at most `maxParts`; each part takes the least of what
 * is left, `available` and `maxFill`, is skipped below `min_fill` and pays rounded up. Nothing
 * executes when the parts together stay below `floor`, the receiving venue's minimum deposit.
 */
export function sweep(levels: Level[], maxFill: bigint, own: Set<string>, amount: bigint, maxParts = MAX_PARTS, floor = 0n): Sweep {
  let left = amount;
  let out = 0n;
  let parts = 0;
  for (const level of live(levels)) {
    if (parts === maxParts || left === 0n) break;
    if (own.has(level.order_id)) continue;
    const supply = BigInt(level.supply);
    const receive = BigInt(level.receive);
    const got = [(left * supply) / receive, BigInt(level.available), maxFill].reduce((a, b) => (a < b ? a : b));
    if (got === 0n || got < BigInt(level.min_fill)) continue;
    out += got;
    left -= divCeil(got * receive, supply);
    parts += 1;
  }
  return out < floor ? { out: 0n, pay: 0n, parts: 0 } : { out, pay: amount - left, parts };
}

/** Smallest payment the book executes, in payment units: each part meets its maker's minimum and
 * the parts together `floor`. A larger payment never receives less, so a bisection finds it. */
export function minimumTake(levels: Level[], maxFill: bigint, own: Set<string>, floor = 0n): bigint | null {
  let high = 0n;
  for (const level of live(levels)) {
    if (own.has(level.order_id)) continue;
    const most = BigInt(level.available) < maxFill ? BigInt(level.available) : maxFill;
    high += divCeil(most * BigInt(level.receive), BigInt(level.supply));
  }
  if (!sweep(levels, maxFill, own, high, MAX_PARTS, floor).parts) return null;
  let low = 0n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (sweep(levels, maxFill, own, middle, MAX_PARTS, floor).parts) high = middle;
    else low = middle;
  }
  return high;
}

/** The book cannot take this request now: nothing was reserved or signed. */
export class QuoteUnavailable extends Error {
  override readonly name = "QuoteUnavailable";
}

/** That the book pays all of `amount_in` for at least `min_out`, the caller's own orders aside; `floor` is the receiving venue's minimum deposit. */
export function checkQuote(book: { max_fill: string; levels: Level[] }, own: Set<string>, input: { amount_in: string; min_out: string; max_parts?: number | undefined }, floor = 0n): void {
  const amount = BigInt(input.amount_in);
  const next = sweep(book.levels, BigInt(book.max_fill), own, amount, input.max_parts, floor);
  if (!next.parts) throw new QuoteUnavailable("No executable price available");
  if (next.pay !== amount || next.out < BigInt(input.min_out)) throw new QuoteUnavailable("No price meets this transfer's minimum");
}

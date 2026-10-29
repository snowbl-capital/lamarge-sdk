import { feeOn, NO_FEE, priceWithin, takeFee } from "./protocol/fees.ts";
import { insist } from "./protocol/protocol.ts";

type Level = { order_id: string; supply: string; receive: string; available: string; min_fill: string; valid_until: string };

export const MAX_PARTS = 8;

const divCeil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const live = <L extends Level>(levels: L[], now: number) => levels.filter(level => Date.parse(level.valid_until) > now);

/** `out` received on the destination, `pay` paid on the source. */
export interface Sweep { out: bigint; pay: bigint; parts: number }

/**
 * Matches in server order, rounding payment up. Payment fees are added; delivery fees are deducted.
 * `floor` is the destination's minimum deposit across all parts; below it nothing executes.
 */
export function sweep(levels: Level[], maxFill: bigint, own: Set<string>, amount: bigint, maxParts = MAX_PARTS, floor = 0n, now = Date.now(), fee = NO_FEE): Sweep {
  let left = amount;
  let out = 0n;
  let parts = 0;
  for (const level of live(levels, now)) {
    if (parts === maxParts || left === 0n) break;
    if (own.has(level.order_id)) continue;
    const supply = BigInt(level.supply);
    const receive = BigInt(level.receive);
    const priced = fee.onDelivery ? left : priceWithin(left, fee.bps);
    const got = [(priced * supply) / receive, BigInt(level.available), maxFill].reduce((a, b) => (a < b ? a : b));
    if (got === 0n || got < BigInt(level.min_fill)) continue;
    const paid = divCeil(got * receive, supply);
    out += fee.onDelivery ? got - feeOn(got, fee.bps) : got;
    left -= fee.onDelivery ? paid : paid + feeOn(paid, fee.bps);
    parts += 1;
  }
  return out < floor ? { out: 0n, pay: 0n, parts: 0 } : { out, pay: amount - left, parts };
}

/** Smallest executable payment in base units. Bisection relies on monotonic output; venue payments buy one fill. */
export function minimumTake(levels: Level[], maxFill: bigint, own: Set<string>, floor = 0n, now = Date.now(), maxParts = MAX_PARTS, fee = NO_FEE): bigint | null {
  let high = 0n;
  for (const level of live(levels, now)) {
    if (own.has(level.order_id)) continue;
    const most = BigInt(level.available) < maxFill ? BigInt(level.available) : maxFill;
    const paid = divCeil(most * BigInt(level.receive), BigInt(level.supply));
    high += fee.onDelivery ? paid : paid + feeOn(paid, fee.bps);
  }
  if (!sweep(levels, maxFill, own, high, maxParts, floor, now, fee).parts) return null;
  let low = 0n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (sweep(levels, maxFill, own, middle, maxParts, floor, now, fee).parts) high = middle;
    else low = middle;
  }
  return high;
}

/** The book cannot take this request now: nothing was reserved or signed. */
export class QuoteUnavailable extends Error {
  override readonly name = "QuoteUnavailable";
}

/** True if the remainder cannot buy one more output unit, including fee rounding. */
export function paysAll(levels: Level[], own: Set<string>, amount: bigint, swept: Sweep, fee = NO_FEE, now = Date.now()): boolean {
  const best = live(levels, now).filter(level => !own.has(level.order_id))
    .reduce<Level | undefined>((kept, level) => !kept || BigInt(level.receive) * BigInt(kept.supply) < BigInt(kept.receive) * BigInt(level.supply) ? level : kept, undefined);
  if (!best) return true;
  const unit = divCeil(BigInt(best.receive), BigInt(best.supply));
  // Rounding the total fee down can make the next output unit cost one extra payment unit.
  const cost = fee.onDelivery || fee.bps === 0n ? unit : unit + feeOn(unit, fee.bps) + 1n;
  return amount - swept.pay < cost;
}

/** That the book pays all of `amount_in` but for rounding for at least `min_out`, fee included, the caller's own orders aside; `floor` is the receiving venue's minimum deposit. */
export function checkQuote(book: { max_fill: string; levels: Level[]; taker_fee_bps: number }, own: Set<string>,
  input: { amount_in: string; min_out: string; max_parts?: number | undefined; from?: string | undefined; max_fee_bps?: number | undefined }, floor = 0n, now = Date.now()): void {
  const amount = BigInt(input.amount_in);
  insist(input.max_fee_bps === undefined || input.from, "A take accepting a fee names the venue it pays from");
  if (input.max_fee_bps !== undefined && book.taker_fee_bps > input.max_fee_bps) throw new QuoteUnavailable("The fee is above what this transfer accepts");
  const fee = takeFee(input.from ?? "", book.taker_fee_bps, input.max_fee_bps);
  const next = sweep(book.levels, BigInt(book.max_fill), own, amount, input.max_parts, floor, now, fee);
  if (!next.parts) throw new QuoteUnavailable("No executable price available");
  if (!paysAll(book.levels, own, amount, next, fee, now) || next.out < BigInt(input.min_out)) throw new QuoteUnavailable("No price meets this transfer's minimum");
}

import { feeOn, NO_FEE, priceWithin, takeFee, type Fee } from "./protocol/fees.ts";
import { destinationOf, type Destination } from "./protocol/intents.ts";
import { insist } from "./protocol/protocol.ts";

type Level = { order_id: string; supply: string; receive: string; available: string; min_fill: string; valid_until: string };

export const MAX_PARTS = 8;

const divCeil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const live = <L extends Level>(levels: L[], now: number) => levels.filter(level => Date.parse(level.valid_until) > now);

function bookBudget(levels: Level[], maxFill: bigint, own: Set<string>, now: number, fee: Fee): bigint {
  return live(levels, now).filter(level => !own.has(level.order_id)).reduce((sum, level) => {
    const out = BigInt(level.available) < maxFill ? BigInt(level.available) : maxFill;
    const paid = divCeil(out * BigInt(level.receive), BigInt(level.supply));
    return sum + paid + (fee.onDelivery ? 0n : feeOn(paid, fee.bps));
  }, 0n);
}

/** `out` received on the destination, `pay` paid on the source. */
export interface Sweep { out: bigint; pay: bigint; parts: number }

/** The least a take delivers: `total` across its parts, a venue's minimum deposit, and `part` in each, fee deducted, a wallet's minimum. A bigint is a `total` alone. */
export interface Floor { total: bigint; part: bigint }
const floorOf = (minimum: bigint | Floor): Floor => typeof minimum === "bigint" ? { total: minimum, part: 0n } : minimum;

/** Matches in server order, rounding payment up. Payment fees are added; delivery fees are deducted. Below `floor` nothing executes. */
export function sweep(levels: Level[], maxFill: bigint, own: Set<string>, amount: bigint, maxParts = MAX_PARTS, minimum: bigint | Floor = 0n, now = Date.now(), fee = NO_FEE): Sweep {
  const floor = floorOf(minimum);
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
    const delivered = fee.onDelivery ? got - feeOn(got, fee.bps) : got;
    if (delivered < floor.part) continue;
    const paid = divCeil(got * receive, supply);
    out += delivered;
    left -= fee.onDelivery ? paid : paid + feeOn(paid, fee.bps);
    parts += 1;
  }
  return out < floor.total ? { out: 0n, pay: 0n, parts: 0 } : { out, pay: amount - left, parts };
}

/** Smallest executable payment in base units. Bisection relies on monotonic output; venue payments buy one fill. */
export function minimumTake(levels: Level[], maxFill: bigint, own: Set<string>, floor: bigint | Floor = 0n, now = Date.now(), maxParts = MAX_PARTS, fee = NO_FEE): bigint | null {
  let high = bookBudget(levels, maxFill, own, now, fee);
  if (!sweep(levels, maxFill, own, high, maxParts, floor, now, fee).parts) return null;
  let low = 0n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (sweep(levels, maxFill, own, middle, maxParts, floor, now, fee).parts) high = middle;
    else low = middle;
  }
  return high;
}

export interface BookLimitsOptions {
  own?: Set<string>;
  minimum?: bigint | Floor;
  /** Source budget in base units, after withdrawal fees and reserves. Omit to inspect book capacity. */
  budget?: bigint;
  maxParts?: number;
  fee?: Fee;
  now?: number;
}

/** Executable endpoints in book order, including fees. Amounts between them can fall in minimum-fill gaps. */
export interface BookLimits { minimum: Sweep; maximum: Sweep }

/**
 * Snapshot of a direct book's smallest take and its sweep at capacity (or `budget`, if smaller).
 * Venue payments use one part. Null means this snapshot cannot execute within the budget.
 * It reserves nothing and excludes account funding and intermediate-route constraints.
 */
export function bookLimits(book: { levels: Level[]; max_fill: string }, options: BookLimitsOptions = {}): BookLimits | null {
  const { own = new Set<string>(), minimum = 0n, fee = NO_FEE, now = Date.now(), budget } = options;
  const maxParts = fee.onDelivery ? 1 : options.maxParts ?? MAX_PARTS;
  insist(Number.isInteger(maxParts) && maxParts >= 1 && maxParts <= MAX_PARTS && (budget === undefined || budget >= 0n), "Invalid book limits");
  const maxFill = BigInt(book.max_fill);
  const maximum = sweep(book.levels, maxFill, own, budget ?? bookBudget(book.levels, maxFill, own, now, fee), maxParts, minimum, now, fee);
  if (!maximum.parts) return null;
  const least = minimumTake(book.levels, maxFill, own, minimum, now, maxParts, fee);
  return least === null ? null : { minimum: sweep(book.levels, maxFill, own, least, maxParts, minimum, now, fee), maximum };
}

/** Minimum output for a quoted amount, rounded down in destination base units; not a liquidity or delivery guarantee. */
export function slippageMinimum(amountOut: bigint, slippageBps: number): bigint {
  insist(amountOut >= 0n && Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps <= 10_000, "Invalid slippage or output amount");
  return amountOut * BigInt(10_000 - slippageBps) / 10_000n;
}

/** The book cannot take this request now: nothing was reserved or signed. */
export class QuoteUnavailable extends Error {
  override readonly name = "QuoteUnavailable";
}

/** True if the remainder cannot buy one more part, an output unit or `floor`'s per-part minimum, including fee rounding. */
export function paysAll(levels: Level[], own: Set<string>, amount: bigint, swept: Sweep, fee = NO_FEE, now = Date.now(), floor: bigint | Floor = 0n): boolean {
  const best = live(levels, now).filter(level => !own.has(level.order_id))
    .reduce<Level | undefined>((kept, level) => !kept || BigInt(level.receive) * BigInt(kept.supply) < BigInt(kept.receive) * BigInt(level.supply) ? level : kept, undefined);
  if (!best) return true;
  // The output a part needs: one unit, or the per-part minimum with its fee on delivery added back,
  // the least g with g − ⌊g × bps / 10,000⌋ ≥ the minimum.
  const least = floorOf(floor).part;
  const part = fee.onDelivery && least > 0n ? (least - 1n) * 10_000n / (10_000n - fee.bps) + 1n : least;
  const unit = divCeil((part > 1n ? part : 1n) * BigInt(best.receive), BigInt(best.supply));
  // Rounding the total fee down can make the next output unit cost one extra payment unit.
  const cost = fee.onDelivery || fee.bps === 0n ? unit : unit + feeOn(unit, fee.bps) + 1n;
  return amount - swept.pay < cost;
}

/** The least a take to `to` delivers, as `GET /v1/venues` lists it: the venue's release minimum in all, or with a wallet destination the chain's wallet minimum in each part. */
export function deliveryFloor(venues: readonly { id: string; release_minimum?: string | null | undefined; chain?: { wallet?: { minimum: string } | null | undefined } | null | undefined }[],
  to: string, destination?: Destination | null | undefined): Floor {
  const venue = venues.find(row => row.id === to);
  return destinationOf({ destination }) === "wallet"
    ? { total: 0n, part: BigInt(venue?.chain?.wallet?.minimum ?? 0) }
    : { total: BigInt(venue?.release_minimum ?? 0), part: 0n };
}

/** That the book pays all of `amount_in` but for rounding for at least `min_out`, fee included, the caller's own orders aside, each part and all of them above `floor`. */
export function checkQuote(book: { max_fill: string; levels: Level[]; taker_fee_bps: number }, own: Set<string>,
  input: { amount_in: string; min_out: string; max_parts?: number | undefined; from?: string | undefined; max_fee_bps?: number | undefined }, floor: bigint | Floor = 0n, now = Date.now()): void {
  const amount = BigInt(input.amount_in);
  insist(input.max_fee_bps === undefined || input.from, "A take accepting a fee names the venue it pays from");
  if (input.max_fee_bps !== undefined && book.taker_fee_bps > input.max_fee_bps) throw new QuoteUnavailable("The fee is above what this transfer accepts");
  const fee = takeFee(input.from ?? "", book.taker_fee_bps, input.max_fee_bps);
  const next = sweep(book.levels, BigInt(book.max_fill), own, amount, input.max_parts, floor, now, fee);
  if (!next.parts) throw new QuoteUnavailable("No executable price available");
  if (!paysAll(book.levels, own, amount, next, fee, now, floor) || next.out < BigInt(input.min_out)) throw new QuoteUnavailable("No price meets this transfer's minimum");
}

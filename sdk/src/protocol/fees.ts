import { differs, insist, uint, VENUE_SETTLED } from "./protocol.ts";

/** The escrow's tags: a swap id starting with one carries the taker fee in its next ten bytes. */
export const FEE_ON_PAYMENT = "0xde65f326692b";
export const FEE_ON_DELIVERY = "0xcc909c08081a";
/** The most a fee takes of the total it is part of, in basis points, as the escrow bounds it. */
export const MAX_FEE_BPS = 100;

/** A take's taker fee: basis points, charged on top of the payment, or out of what the maker delivers when the taker pays inside a venue. */
export interface Fee { bps: bigint; onDelivery: boolean }
export const NO_FEE: Fee = { bps: 0n, onDelivery: false };

/** The fee a take from `from` pays at its pair's `taker_fee_bps`: none without the taker's consent, `max_fee_bps`. */
export const takeFee = (from: string, pairBps: number | undefined, maxFeeBps: number | undefined): Fee =>
  maxFeeBps === undefined ? NO_FEE : { bps: BigInt(pairBps ?? 0), onDelivery: VENUE_SETTLED.has(from) };

/** The fee on `amount`, rounded down. */
export const feeOn = (amount: bigint, bps: bigint) => amount * bps / 10_000n;

/** The largest price whose fee on top fits `budget`: P + ⌊P × bps / 10,000⌋ ≤ budget, as the server plans it. */
export const priceWithin = (budget: bigint, bps: bigint) => ((budget + 1n) * 10_000n - 1n) / (10_000n + bps);

/** The fee `swapId` carries and where the escrow takes it; 0 on the payment without a tag. */
export function swapFee(swapId: string): { fee: bigint; onDelivery: boolean } {
  const id = swapId.toLowerCase();
  const tag = id.slice(0, 14);
  if (!/^0x[0-9a-f]{64}$/.test(id) || tag !== FEE_ON_PAYMENT && tag !== FEE_ON_DELIVERY) return { fee: 0n, onDelivery: false };
  return { fee: BigInt(`0x${id.slice(14, 34)}`), onDelivery: tag === FEE_ON_DELIVERY };
}

/**
 * That a fill's fee is the one its swap id carries, taken where its payment says, within what the
 * taker consented to: on the maker's price from an escrow payment, on what the offer delivers when
 * the taker pays inside a venue. Without consent, no fee.
 */
export function checkFee(fill: { swap_id: string; taker_fee?: string | undefined; amount_in: string; amount_out: string }, onDelivery: boolean, maxFeeBps: number | undefined): void {
  const { fee, onDelivery: tagged } = swapFee(fill.swap_id);
  // A server before fees names none.
  insist(fee === uint(fill.taker_fee ?? "0"), differs("fills.taker_fee"));
  if (fee === 0n) return;
  insist(tagged === onDelivery, differs("fills.swap_id"));
  const charged = onDelivery ? uint(fill.amount_out) + fee : uint(fill.amount_in) - fee;
  insist(maxFeeBps !== undefined && fee * 10_000n <= BigInt(maxFeeBps) * charged, "The take's fee is above what you accepted");
}

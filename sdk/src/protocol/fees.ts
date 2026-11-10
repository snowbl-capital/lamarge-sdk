import { differs, insist, uint, VENUE_SETTLED } from "./protocol.ts";

/** The escrow's tags: a swap id starting with one carries the taker fee in its next ten bytes. */
export const FEE_ON_PAYMENT = "0xde65f326692b";
export const FEE_ON_DELIVERY = "0xcc909c08081a";
/** Their wallet twins, which a wallet delivery's swap id always carries, fee zero included: the escrow pays it by plain transfer, never into a venue. */
export const WALLET_FEE_ON_PAYMENT = "0x1b4c4374729e";
export const WALLET_FEE_ON_DELIVERY = "0xfcb0d9ddb285";
const TAGS: Record<string, { onDelivery: boolean; wallet: boolean }> = {
  [FEE_ON_PAYMENT]: { onDelivery: false, wallet: false }, [FEE_ON_DELIVERY]: { onDelivery: true, wallet: false },
  [WALLET_FEE_ON_PAYMENT]: { onDelivery: false, wallet: true }, [WALLET_FEE_ON_DELIVERY]: { onDelivery: true, wallet: true },
};
/** The most a fee takes of the total it is part of, in basis points, as the escrow bounds it. */
export const MAX_FEE_BPS = 100;

/** A take's taker fee: basis points, charged on top of the payment, or out of what the maker delivers when the taker pays inside a venue. */
export interface Fee { bps: bigint; onDelivery: boolean }
export const NO_FEE: Fee = { bps: 0n, onDelivery: false };

/** The fee a take from `from` pays at its pair's `taker_fee_bps`: none without the taker's consent, `max_fee_bps`. */
export const takeFee = (from: string, pairBps: number | undefined, maxFeeBps: number | undefined): Fee =>
  maxFeeBps === undefined ? NO_FEE : { bps: BigInt(pairBps ?? 0), onDelivery: VENUE_SETTLED.has(from) };

export const feeOn = (amount: bigint, bps: bigint) => amount * bps / 10_000n;

/** The largest price whose fee on top fits `budget`: P + ⌊P × bps / 10,000⌋ ≤ budget, as the server plans it. */
export const priceWithin = (budget: bigint, bps: bigint) => ((budget + 1n) * 10_000n - 1n) / (10_000n + bps);

/** The fee `swapId` carries, where the escrow takes it, and whether it is a wallet delivery's; 0 on the payment, into a venue, without a tag. */
export function swapFee(swapId: string): { fee: bigint; onDelivery: boolean; wallet: boolean } {
  const id = swapId.toLowerCase();
  const tag = /^0x[0-9a-f]{64}$/.test(id) ? TAGS[id.slice(0, 14)] : undefined;
  return tag ? { fee: BigInt(`0x${id.slice(14, 34)}`), ...tag } : { fee: 0n, onDelivery: false, wallet: false };
}

/**
 * That a fill's fee is the one its swap id carries, taken where its payment says, within what the
 * taker consented to: on the maker's price from an escrow payment, on what the offer delivers when
 * the taker pays inside a venue. Without consent, no fee.
 */
export function checkFee(fill: { swap_id: string; taker_fee: string; amount_in: string; amount_out: string }, onDelivery: boolean, maxFeeBps: number | undefined): void {
  const { fee, onDelivery: tagged } = swapFee(fill.swap_id);
  insist(fee === uint(fill.taker_fee), differs("fills.taker_fee"));
  if (fee === 0n) return;
  insist(tagged === onDelivery, differs("fills.swap_id"));
  const charged = onDelivery ? uint(fill.amount_out) + fee : uint(fill.amount_in) - fee;
  insist(maxFeeBps !== undefined && fee * 10_000n <= BigInt(maxFeeBps) * charged, "The take's fee is above what you accepted");
}

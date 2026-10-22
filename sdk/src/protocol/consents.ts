import { requireV5Deployment } from "./deployments.ts";
import { CHAINS, checkDeadline, checkEscrowTyped, checkRegistry, insist, same, type SignItem } from "./protocol.ts";
import { required, type Verified } from "./validation.ts";

/** Each venue's name, as the link message names it. */
const VENUE_NAMES: Record<string, string> = { hyperliquid: "Hyperliquid", polymarket: "Polymarket Perps", lighter: "Lighter", aster: "Aster" };

/** The message `address` signs to be linked on `venue` under `master`: six lines, naming all three, valid ten minutes at most. */
export function checkLinkChallenge(challenge: { message: string; nonce: string; expires_at: string }, address: string, master: string, venue: string, now = Date.now()): void {
  const lines = challenge.message.split("\n");
  const expires = Date.parse(challenge.expires_at);
  insist(lines.length === 6 && VENUE_NAMES[venue] !== undefined && lines[0] === `LaMarge: link a ${VENUE_NAMES[venue]} account` && lines[1] === "" && same(lines[2], `Account: ${address}`) && same(lines[3], `Master account: ${master}`)
    && lines[4] === `Nonce: ${challenge.nonce}` && lines[5] === `Expires: ${challenge.expires_at}` && expires > now && expires <= now + 10 * 60_000, "Unexpected account-link challenge");
}

/** The one kind of request each setup step signs. */
const SETUP_KINDS: Record<string, string> = { permit: "permit", agent: "aster_approval", api_key: "lighter_api_key" };

/** A prepared setup step's request asks the kind of signature its step does, and nothing else. */
export function checkSetupKind(step: string, kind: string): void {
  insist(SETUP_KINDS[step] === kind, "The setup step asks another kind of signature");
}

type FundingRequest = { kind: string; signer: string; chain_id: number };
type FundingPlan = {
  venue: string; owner: string; amount: string; deposit: string; withdrawal_amount: string; withdrawal_to: string | null;
  observed_at: string; payment_setup: string; requests: FundingRequest[];
};

/** What a transfer from wallet funds will ask its payer to sign: at most a permit, a margin withdrawal and the payment, on the pinned escrow chain, for this amount. */
export function checkFundingPlan<P extends FundingPlan>(intent: { from: string; payer: string; amount_in: string; funding_plan: P | null; funding_plan_error?: { message: string } | null }, now = Date.now()): P {
  // The server says why it has no plan, such as a balance short of the amount.
  const plan = required(intent.funding_plan, intent.funding_plan_error?.message ?? "Funding details unavailable; try again shortly");
  const chain = required(CHAINS[intent.from], "Unknown funding venue");
  requireV5Deployment(chain.id, chain.escrow);
  insist(plan.venue === intent.from && same(plan.owner, intent.payer) && plan.amount === intent.amount_in
    && BigInt(plan.deposit) <= BigInt(plan.amount) && BigInt(plan.withdrawal_amount) <= BigInt(plan.amount), "Funding details changed; review the transfer");
  const age = now - Date.parse(plan.observed_at);
  insist(age >= -5_000 && age < 120_000, "Funding details expired; review the transfer");
  insist(plan.withdrawal_to === (BigInt(plan.withdrawal_amount) > 0n ? "signer" : null), "Funding destination differs from the transfer");
  const kinds = plan.requests.map(request => request.kind);
  const permit = plan.payment_setup === "required";
  insist(plan.requests.every(request => same(request.signer, intent.payer) && request.chain_id === chain.id)
    && kinds.filter(kind => kind === "pay_take").length === 1 && new Set(kinds).size === kinds.length
    && kinds.every(kind => kind === "permit" || kind === "margin_move" || kind === "pay_take")
    && kinds.includes("margin_move") === (BigInt(plan.withdrawal_amount) > 0n)
    && kinds.includes("permit") === permit && (!permit || kinds[0] === "permit" && BigInt(plan.deposit) > 0n), "Funding requests differ from the transfer");
  return plan;
}

/** How long a close signature may be good for, and the clock's margin. */
const CLOSE_TTL = 3_600 + 60;
/** Where a release may go on each venue: Hyperliquid's perps or spot, Polymarket's or Aster's account. */
const DEXES: Record<string, number[]> = { hyperliquid: [0, 4_294_967_295], polymarket: [0], aster: [0] };

type PreparedClose = { venue: string; order_id: string; to_margin: boolean; dex: number; nonce: string; deadline: number; to_sign: SignItem[] };

/** One `close_offer` by the owner, in the pinned escrow domain, to the requested destination, good for an hour at most. */
export function checkCloseOffer<P extends PreparedClose>(prepared: P, order: { venue: string; owner: string; order_id: string }, chain: { id: number; token: string; decimals: number; escrow: string },
  now = Date.now() / 1000, toMargin = true): prepared is P & { to_sign: Verified<P["to_sign"]> } {
  if (prepared.to_sign.length !== 1) return false;
  const [item] = prepared.to_sign;
  if (!item) return false;
  try {
    checkRegistry(order.venue, chain);
    checkEscrowTyped(item.typed_data, order.venue);
  } catch { return false; }
  const { primaryType, message } = item.typed_data;
  return item.kind === "close_offer" && same(item.signer, order.owner) && primaryType === "CloseOffer" && same(message.owner, order.owner)
    && same(message.offerId, order.order_id) && message.toMargin === toMargin && prepared.to_margin === toMargin
    && (toMargin ? (DEXES[order.venue] ?? []).includes(prepared.dex) : prepared.dex === 0)
    && String(message.dex) === String(prepared.dex) && String(message.nonce) === prepared.nonce && String(message.deadline) === String(prepared.deadline)
    && same(prepared.order_id, order.order_id) && prepared.venue === order.venue && prepared.deadline > now && prepared.deadline <= now + CLOSE_TTL;
}

type RefundFill = {
  id: string; role: string; maker_leg: string; payment_leg: string; t2: string; from_venue: string; maker_recipient: string; payer: string; swap_id: string;
  amount_in: string; hashlock: string; deliver_by?: string | null | undefined; delivery_hash?: string | null | undefined;
};

/** The maker of an abandoned fill may give the taker's locked payment back before `t2`. */
export const canRefundPayment = <F extends RefundFill>(fill: F) =>
  fill.role === "maker" && fill.maker_leg === "ABANDONED" && fill.payment_leg === "LOCKED" && Date.parse(fill.t2) > Date.now();

/** The one `refund_payment` consent of `fill`, signed by its payment's beneficiary, good until `t2` at most. */
export function checkPaymentRefund<F extends RefundFill, P extends { deadline: number; to_sign: SignItem[] }>(fill: F, prepared: P, now = Date.now() / 1000): asserts prepared is P & { to_sign: Verified<P["to_sign"]> } {
  insist(canRefundPayment(fill), "This payment cannot be refunded early");
  insist(prepared.to_sign.length === 1, "Unexpected refund signatures");
  const item = required(prepared.to_sign[0]);
  checkEscrowTyped(item.typed_data, fill.from_venue);
  const message = item.typed_data.message;
  insist(item.kind === "refund_payment" && item.fill_id === fill.id && same(item.signer, fill.maker_recipient)
    && item.typed_data.primaryType === "RefundPayment" && same(message.payer, fill.payer) && same(message.swapId, fill.swap_id)
    && String(message.deadline) === String(prepared.deadline) && prepared.deadline <= Date.parse(fill.t2) / 1000, "Refund terms changed");
  checkDeadline(message.deadline, 3600, now);
}

/** An escrow lock as `locks(owner, offerId, swapId)` returns it: amount, hashlock, recipient, refundAt, state, dex. */
export type EscrowLock = readonly [bigint, string, string, bigint, number, number];

/** The payment lock refunds `fill.amount_in` to its payer at `t2`, and the maker's lock, where the destination has one, was never made: consenting gives up nothing delivered. */
export function checkRefundLocks<F extends RefundFill>(fill: F, payment: EscrowLock, maker: EscrowLock | null): void {
  // A fill keeps the settlement it was taken under: delivered inside the venue, it has a deadline.
  const inVenue = Boolean(fill.deliver_by);
  insist(inVenue === (maker === null), "Unsupported refund chain");
  insist(!inVenue || !fill.delivery_hash, "This fill was delivered");
  insist(payment[4] === 1 && payment[0] === BigInt(fill.amount_in) && same(payment[1], fill.hashlock)
    && same(payment[2], fill.maker_recipient) && payment[3] === BigInt(Math.floor(Date.parse(fill.t2) / 1000))
    && (maker === null || maker[4] === 0), "The onchain locks no longer permit this refund");
}

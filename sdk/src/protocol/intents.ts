import { fillMemo, LIGHTER_MAX_TAKER_FEE, TAKER_API_KEYS } from "./lighter.ts";
import { isAddress, required, type Verified } from "./validation.ts";
import { escrowDeployment } from "./deployments.ts";
import { checkFee } from "./fees.ts";
import { asterTransfer, CHAINS, checkAsterTransfer, checkDeadline, checkEscrowTyped, checkSignedQuote, checkWithdrawal, differs, insist, isPinnedEscrow, MAKER_TIMEOUT_SECONDS, same, takePayments, TAKER_TIMEOUT_SECONDS, uint, VENUE_SETTLED, venueUnits, withdrawalCost, type SignItem, type QuoteIntent, type Typed } from "./protocol.ts";
/** Added capital comes from the linked wallet alone, or from one margin move of the whole deposit. */
export type FundingSource = "wallet" | "venue";
type MakerIntent = { venue: string; amount: string; quote_identity_id?: string | null | undefined; client_request_id: string; funding_source: FundingSource };
export type MakerOrderSnapshot = {
  id: string; venue: string; owner_address: string; quote_signer: string; quote_identity_id: string;
  state: string; revision: string; last_sequence: number; available_to_quote: string;
  quote_set: { sequence: number; active: boolean; valid_until: string; expires_at: string; quotes: (QuoteIntent & { available: string })[] } | null;
};
export type PreparedMaker = {
  id: string; client_request_id: string; state: string; venue: string; order: MakerOrderSnapshot;
  expires_at: string; expected_revision: string; sequence: number | null; to_sign: SignItem[];
  intent: { amount: string; quote_identity_id: string; funding_source: string };
  funding: { existing_available: string; wallet_amount: string; venue_amount: string; idle_amount: string };
};
type MakerAuthority = { owner: string; quoteSigner: string; quoteIdentityId: string; operator: string; existingOrder: MakerOrderSnapshot | null };
/** Bind all new capital, and what is re-signed of the current quote set, before any wallet request. */
export function checkMakerIntent<T extends PreparedMaker>(prepared: T, input: MakerIntent, authority: MakerAuthority, now = Date.now() / 1000): asserts prepared is T & { to_sign: Verified<SignItem[]> } {
  const { owner, quoteSigner, quoteIdentityId, operator, existingOrder } = authority;
  const { order, funding, intent, to_sign: items } = prepared;
  insist(isAddress(operator), "The deployment operator has not been configured");
  insist(prepared.state === "preparing" && prepared.id.length > 0, differs("state"));
  insist(prepared.client_request_id === input.client_request_id && input.client_request_id.length > 0, differs("client_request_id"));
  insist(prepared.venue === input.venue && order.venue === input.venue, differs("venue"));
  insist(same(order.owner_address, owner), differs("order.owner_address"));
  insist(same(order.quote_signer, quoteSigner), differs("order.quote_signer"));
  insist(order.quote_identity_id === quoteIdentityId && (!input.quote_identity_id || input.quote_identity_id === quoteIdentityId), differs("order.quote_identity_id"));
  insist(intent.amount === input.amount, differs("intent.amount"));
  insist(intent.quote_identity_id === quoteIdentityId, differs("intent.quote_identity_id"));
  insist(intent.funding_source === input.funding_source, differs("intent.funding_source"));
  insist(prepared.expected_revision === order.revision, differs("expected_revision"));
  checkDeadline(Math.floor(Date.parse(prepared.expires_at) / 1000), 3600, now);
  if (existingOrder) {
    insist(same(order.id, existingOrder.id), differs("order.id"));
    insist(existingOrder.venue === input.venue && same(existingOrder.owner_address, owner) && same(existingOrder.quote_signer, quoteSigner) && existingOrder.quote_identity_id === quoteIdentityId, differs("existing order"));
    insist(order.last_sequence === existingOrder.last_sequence && order.available_to_quote === existingOrder.available_to_quote && uint(order.revision) >= uint(existingOrder.revision), "Maker capital changed; review again");
  } else insist(order.last_sequence === 0 && uint(order.available_to_quote) === 0n, differs("order"));
  const amount = uint(input.amount), available = existingOrder ? uint(existingOrder.available_to_quote) : 0n;
  const idle = uint(funding.idle_amount), wallet = uint(funding.wallet_amount), venue = uint(funding.venue_amount), existing = uint(funding.existing_available);
  const deposit = wallet + venue;
  insist(amount > 0n, differs("amount"));
  insist(existing >= available, differs("funding.existing_available"));
  insist(amount === idle + deposit, differs("funding.idle_amount"));
  insist((input.funding_source === "venue" ? wallet : venue) === 0n, differs(input.funding_source === "venue" ? "funding.wallet_amount" : "funding.venue_amount"));
  const quotes: QuoteIntent[] = [];
  // A deposit for a delegated quoter does not publish prices on its behalf.
  const prior = existingOrder && !["closed", "failed"].includes(existingOrder.state) ? existingOrder.quote_set : null;
  if (!input.quote_identity_id && prior && Date.parse(prior.valid_until) / 1000 > now) {
    for (const [index, q] of prior.quotes.entries()) {
      const remaining = uint(q.available), supply = uint(q.supply), receive = uint(q.receive);
      insist(remaining <= supply && remaining <= available, differs(`quote_set.quotes[${index}].available`));
      if (remaining < uint(q.min_fill) || remaining === 0n) continue;
      quotes.push({ venue: q.venue, recipient: q.recipient, supply: String(remaining), receive: String((remaining * receive + supply - 1n) / supply), min_fill: q.min_fill });
    }
  }
  const spare = existing - available;
  insist(deposit === (amount > spare ? amount - spare : 0n), differs("funding.wallet_amount + funding.venue_amount"));
  // The server's stable order: by venue, each venue's quotes as the current set had them.
  quotes.sort((a, b) => a.venue < b.venue ? -1 : a.venue > b.venue ? 1 : 0);
  const kinds = items.map(item => item.kind);
  insist(new Set(kinds).size === kinds.length && kinds.includes("fund") && kinds.includes("quote_set") === (quotes.length > 0) && kinds.includes("margin_move") === (venue > 0n), differs("to_sign"));
  const sequence = prepared.sequence === null ? null : uint(prepared.sequence);
  insist(quotes.length ? sequence !== null && sequence > BigInt(order.last_sequence) : sequence === null, differs("sequence"));
  for (const item of items) {
    const typed = item.typed_data, m = typed.message;
    if (item.kind === "margin_move") {
      // The wallet keeps what the move rounds up to whole millionths.
      const moved = venueUnits(venue, input.venue);
      insist(same(item.signer, owner), differs("margin_move.signer"));
      insist(withdrawalCost(input.venue, typed) === moved, differs("margin_move.amount"));
      checkWithdrawal(typed, input.venue, owner, owner, moved, now);
    } else if (item.kind === "fund") {
      checkEscrowTyped(typed, input.venue);
      const floor = uint(m.minQuoteSequence);
      insist(typed.primaryType === "FundOffer", differs("fund.primaryType"));
      insist(same(item.signer, owner), differs("fund.signer"));
      insist(same(m.owner, owner), differs("fund.owner"));
      insist(same(m.offerId, order.id), differs("fund.offerId"));
      insist(uint(m.amount) === amount, differs("fund.amount"));
      insist(uint(m.deposit) === deposit, differs("fund.deposit"));
      insist(same(m.quoteSigner, quoteSigner), differs("fund.quoteSigner"));
      insist(same(m.operator, operator), differs("fund.operator"));
      insist(floor > BigInt(order.last_sequence) && floor <= BigInt(Number.MAX_SAFE_INTEGER) && (sequence === null || floor === sequence), differs("fund.minQuoteSequence"));
      checkDeadline(m.deadline, 3600, now);
    } else if (item.kind === "quote_set") {
      const expiry = Number(uint(m.expiresAt));
      insist(prior && expiry === Math.floor(Date.parse(prior.expires_at) / 1000), differs("quote_set.expiresAt"));
      insist(sequence !== null && sequence <= BigInt(Number.MAX_SAFE_INTEGER), differs("sequence"));
      checkSignedQuote(item, order, quotes, Number(sequence), expiry);
    } else throw new Error("Unexpected maker signing operation");
  }
}
type TakeIntent = { from: string; to: string; amount_in: string; min_out: string; max_parts?: number; max_fee_bps?: number | undefined };
export type TakeFill = { id: string; order_id: string; sequence: number; role: string; from_venue: string; to_venue: string; amount_in: string; amount_out: string; payer: string; maker_recipient: string; taker_recipient: string; swap_id: string; hashlock: string; pay_by: string; t1: string; t2: string; delivery_to?: string | null | undefined; taker_fee: string };
export const takePaymentKind = (venue: string): string => venue === "aster" ? "aster_transfer" : venue === "lighter" ? "lighter_transfer" : "pay_take";
type LighterTransfer = { kind: string; signer: string; fill_id?: string | undefined; typed_data: { api_key_index: number; from_account_index: number; amount: string; usdc_fee: string; memo: string } };
function checkFill(fill: TakeFill, input: TakeIntent, payer: string, recipient: string) {
  insist(fill.role === "taker", differs("fills.role"));
  insist(fill.from_venue === input.from, differs("fills.from_venue"));
  insist(fill.to_venue === input.to, differs("fills.to_venue"));
  insist(same(fill.payer, payer), differs("fills.payer"));
  insist(same(fill.taker_recipient, recipient), differs("fills.taker_recipient"));
  insist(BigInt(fill.amount_in) > 0n, differs("fills.amount_in"));
}
/** Delivered inside a venue, a fill goes to the taker's own account there: its Aster address, or its Lighter index, whose owner only Lighter can confirm. Through an escrow, to none. */
function checkDelivery(fill: TakeFill, recipient: string) {
  const to = fill.delivery_to;
  insist(VENUE_SETTLED.has(fill.to_venue) ? typeof to === "string" && (fill.to_venue === "aster" ? same(to, recipient) : /^\d+$/.test(to)) : to === null || to === undefined, "The take delivers to another account than yours");
}
type TakeItems = readonly (SignItem | LighterTransfer)[];
/** A take paid inside its venue buys exactly one fill, paid by one signed transfer that is the whole batch. */
function checkVenueTake(items: TakeItems, kind: string, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, now: number) {
  insist(takePaymentKind(input.from) === kind, "The signing request differs from the take's venue");
  const item = items[0];
  insist(items.length === 1 && fills.length === 1 && item?.kind === kind && same(item.signer, payer), "A take paid inside a venue is one transfer");
  const fill = required(fills[0]);
  checkFill(fill, input, payer, recipient);
  insist(item.fill_id === fill.id, differs("fill_id"));
  insist(BigInt(fill.amount_in) <= BigInt(input.amount_in), differs("fills.amount_in"));
  insist(BigInt(fill.amount_out) >= BigInt(input.min_out), differs("fills.amount_out"));
  checkFee(fill, true, input.max_fee_bps);
  checkDelivery(fill, recipient);
  const payBy = Date.parse(fill.pay_by) / 1000, t1 = Date.parse(fill.t1) / 1000;
  insist(payBy > now && payBy <= now + 90, differs("fills.pay_by"));
  insist(t1 > payBy && t1 <= now + MAKER_TIMEOUT_SECONDS + 30, differs("fills.t1"));
  return { terms: item.typed_data, fill };
}
/** A take paid from Lighter: the transfer the taker signs pays exactly its fill, from his linked account, named by its memo. */
export function checkLighterTakeIntent(items: TakeItems, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, account: number, now = Date.now() / 1000): void {
  const { terms, fill } = checkVenueTake(items, "lighter_transfer", fills, input, payer, recipient, now);
  insist("memo" in terms && terms.from_account_index === account && terms.amount === fill.amount_in && terms.memo === fillMemo(fill.id), "The Lighter transfer differs from the take");
  insist(TAKER_API_KEYS.includes(terms.api_key_index), "Unexpected Lighter key");
  insist(uint(terms.usdc_fee) <= LIGHTER_MAX_TAKER_FEE, "Lighter's fee on the transfer is above 1 USDC");
}
/** A take paid from Aster: the taker's wallet signs a transfer of the fill's amount to the maker's
 * account under the fill id, with a nonce far enough ahead for LaMarge to relay it and within
 * Aster's nonce window when relayed. */
export function checkAsterTakeIntent(items: TakeItems, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, now = Date.now() / 1000): void {
  const { terms, fill } = checkVenueTake(items, "aster_transfer", fills, input, payer, recipient, now);
  insist("domain" in terms, "Unexpected Aster transfer");
  const transfer = asterTransfer(terms);
  checkAsterTransfer(transfer, fill);
  // A grouped preparation extends pay_by and its nonce together; an aborted route keeps that take.
  const latestNonce = Math.max(now + 70, Date.parse(fill.pay_by) / 1000 + ASTER_NONCE_AHEAD);
  insist(transfer.nonce >= now + ASTER_NONCE_AHEAD && transfer.nonce <= latestNonce, "The Aster transfer's nonce differs from the take");
}
/** An Aster transfer is signed while its nonce is at least this many seconds ahead. */
const ASTER_NONCE_AHEAD = 20;
/** Until when, in seconds, a reserved take can still be signed: its `pay_by`, sooner for an Aster transfer whose nonce must stay ahead. */
export function signableUntil(prepared: { take: { fills: readonly { pay_by: string }[] }; to_sign: TakeItems }): number {
  const nonces = prepared.to_sign.flatMap(({ kind, typed_data: terms }) => kind === "aster_transfer" && "domain" in terms ? [asterTransfer(terms).nonce - ASTER_NONCE_AHEAD] : []);
  return Math.min(...prepared.take.fills.map(fill => Date.parse(fill.pay_by) / 1000), ...nonces);
}
type RouteTransfer = { id: string; from: string; to: string; amount_in: string; min_out: string; payer: string; recipient: string; previous_transfer_id: string | null;
  withdrawal_preparation: { amount: string; typed_data: Typed } | null; max_fee_bps?: number | undefined };
/** The second leg must spend no more than the first delivers, at least 1% of the plan, at the planned price. Its withdrawal goes only to `hub`. */
export function checkRouteIntent(first: { id: string; to: string; then?: { to: string; recipient: string; amount_in: string; min_out: string; max_fee_bps?: number | undefined } | null | undefined },
  delivering: readonly { amount_out: string }[], second: RouteTransfer, hub: string, now = Date.now() / 1000): void {
  const then = first.then;
  insist(then && second.previous_transfer_id === first.id && second.from === first.to && second.to === then.to && same(second.payer, hub) && same(second.recipient, then.recipient)
    && second.max_fee_bps === then.max_fee_bps, "The route's second transfer differs from the route");
  const delivers = delivering.reduce((sum, fill) => sum + uint(fill.amount_out), 0n), pays = uint(second.amount_in), planned = uint(then.amount_in);
  insist(pays > 0n && pays <= delivers && pays * 100n >= planned && uint(second.min_out) >= uint(then.min_out) * pays / planned, "The route's second take differs from its plan");
  const withdrawal = second.withdrawal_preparation;
  if (withdrawal) {
    const amount = uint(withdrawal.amount);
    insist(amount <= delivers, "The route withdraws more than it brings");
    checkWithdrawal(withdrawal.typed_data, second.from, hub, hub, amount, now);
  }
}

/** `payWindow`: the most seconds to `pay_by`, `ROUTE_PAY_WINDOW_SECONDS` for a route's second take signed at once. */
export function checkTakeIntent(items: SignItem[], fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, now = Date.now() / 1000, payWindow = 90): asserts items is Verified<SignItem[]> {
  insist(takePaymentKind(input.from) === "pay_take", "The signing request differs from the take's venue");
  insist(fills.length > 0 && fills.length <= (input.max_parts ?? 8), differs("fills"));
  insist(new Set(fills.map(fill => fill.id)).size === fills.length, differs("fills.id"));
  insist(new Set(fills.map(fill => fill.swap_id.toLowerCase())).size === fills.length, differs("fills.swap_id"));
  const totalIn = fills.reduce((sum, fill) => sum + BigInt(fill.amount_in), 0n);
  const totalOut = fills.reduce((sum, fill) => sum + BigInt(fill.amount_out), 0n);
  insist(totalIn > 0n && totalIn <= BigInt(input.amount_in), differs("amount_in"));
  insist(totalOut >= BigInt(input.min_out), differs("amount_out"));
  const takes = items.filter(item => item.kind === "pay_take");
  insist(takes.length === 1 && items.length === 1, "A reserved take must already be funded and authorized");
  const take = required(takes[0]), typed = take.typed_data, m = typed.message;
  checkEscrowTyped(typed, input.from);
  const paidIn = escrowDeployment(typed.domain.chainId, typed.domain.verifyingContract);
  insist(typed.primaryType === "PayTake", differs("primaryType"));
  insist(same(take.signer, payer) && same(m.payer, payer), differs("payer"));
  insist(take.fill_id !== undefined && fills.some(fill => fill.id === take.fill_id), differs("fill_id"));
  const payments = takePayments(typed);
  insist(payments.length === fills.length, differs("payments"));
  const receive = CHAINS[input.to];
  for (const fill of fills) {
    checkFill(fill, input, payer, recipient);
    insist(BigInt(fill.amount_out) > 0n, differs("fills.amount_out"));
    checkDelivery(fill, recipient);
    const t1 = Date.parse(fill.t1) / 1000, t2 = Date.parse(fill.t2) / 1000, payBy = Date.parse(fill.pay_by) / 1000;
    insist(payBy > now && payBy <= now + payWindow, differs("fills.pay_by"));
    insist(t1 > payBy && t1 <= now + MAKER_TIMEOUT_SECONDS + 30, differs("fills.t1"));
    insist(t2 > t1 && t2 <= now + TAKER_TIMEOUT_SECONDS + 30, differs("fills.t2"));
    const matching = payments.filter(payment => same(payment.swapId, fill.swap_id));
    insist(matching.length === 1, differs("payments.swapId"));
    const p = required(matching[0]);
    insist(same(p.payer, payer), differs("payments.payer"));
    insist(same(p.recipient, fill.maker_recipient), differs("payments.recipient"));
    insist(same(p.hashlock, fill.hashlock) && /^0x[0-9a-f]{64}$/i.test(fill.hashlock), differs("payments.hashlock"));
    insist(uint(p.amount) === BigInt(fill.amount_in), differs("payments.amount"));
    // The fee rides on the payment, which the claim splits: the maker's price is the rest.
    checkFee(fill, false, input.max_fee_bps);
    insist(uint(p.refundAt) === BigInt(Math.floor(t2)), differs("payments.refundAt"));
    insist(uint(p.deadline) === BigInt(Math.floor(payBy)), differs("payments.deadline"));
    insist(uint(p.dex) === 0n || input.from === "hyperliquid" && uint(p.dex) === 4294967295n, differs("payments.dex"));
    insist(same(p.orderId, fill.order_id), differs("payments.orderId"));
    // A fill that followed a requote at its signed price names the later set.
    insist(uint(p.sequence) <= BigInt(fill.sequence), differs("payments.sequence"));
    insist(uint(p.amountOut) === BigInt(fill.amount_out), differs("payments.amountOut"));
    insist(same(p.receiveRecipient, recipient), differs("payments.receiveRecipient"));
    insist(receive && uint(p.receiveChainId) === BigInt(receive.id) && same(p.receiveToken, receive.token) && isPinnedEscrow(input.to, p.receiveEscrow)
      && (VENUE_SETTLED.has(input.to) || escrowDeployment(receive.id, String(p.receiveEscrow))?.environment === paidIn?.environment), differs("payments.receive"));
  }
  // Only the shortfall is pulled from the payer. The allowance is reusable, but no unrelated operation is signed.
  const deposit = uint(m.deposit);
  insist(deposit <= totalIn, differs("deposit"));
}

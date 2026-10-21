import { fillMemo, LIGHTER_MAX_TAKER_FEE, TAKER_API_KEYS } from "./lighter.ts";
import { required, type Verified } from "./validation.ts";
import { asterTransfer, CHAINS, checkAsterTransfer, checkDeadline, checkEscrowTyped, checkSignedQuote, checkWithdrawal, insist, MAKER_TIMEOUT_SECONDS, NEVER_VALID_UNTIL, same, takePayments, TAKER_TIMEOUT_SECONDS, uint, VENUE_SETTLED, venueUnits, withdrawalCost, type SignItem, type QuoteIntent, type Typed } from "./protocol.ts";
/** `replace` names a position in the current set; without it, the quote adds a price level on `receive_venue`. */
export type MakerQuoteIntent = { receive_venue: string; receive: string; min_fill: string; quote_validity_seconds?: number | null | undefined; replace?: { sequence: number; index: number } | undefined };
/** Added capital comes from the linked wallet alone, or from one margin move of the whole deposit. */
export type FundingSource = "wallet" | "venue";
type MakerIntent = { venue: string; amount: string; quote?: MakerQuoteIntent | null; quote_identity_id?: string | null | undefined; client_request_id: string; funding_source: FundingSource };
export type MakerOrderSnapshot = {
  id: string; venue: string; owner_address: string; quote_signer: string; quote_identity_id: string;
  state: string; revision: string; last_sequence: number; available_to_quote: string;
  quote_set: { sequence: number; active: boolean; valid_until: string; expires_at: string; quotes: (QuoteIntent & { available: string })[] } | null;
};
export type PreparedMaker = {
  id: string; client_request_id: string; state: string; venue: string; order: MakerOrderSnapshot;
  expires_at: string; expected_revision: string; sequence: number | null; to_sign: SignItem[];
  intent: { amount: string; quote: MakerQuoteIntent | null; quote_identity_id: string; funding_source: string };
  funding: { existing_available: string; added_amount: string; wallet_amount: string; venue_amount: string; idle_amount: string };
};
type MakerAuthority = { owner: string; quoteSigner: string; quoteIdentityId: string; operator: string; recipient?: string; existingOrder: MakerOrderSnapshot | null };
/** Bind all new capital and the complete replacement quote set before any wallet request. */
export function checkMakerIntent<T extends PreparedMaker>(prepared: T, input: MakerIntent, authority: MakerAuthority, now = Date.now() / 1000): asserts prepared is T & { to_sign: Verified<SignItem[]> } {
  const { owner, quoteSigner, quoteIdentityId, operator, existingOrder } = authority;
  const { order, funding, intent, to_sign: items } = prepared;
  insist(/^0x[0-9a-fA-F]{40}$/.test(operator), "The deployment operator has not been configured");
  insist(prepared.state === "preparing" && prepared.id.length > 0 && prepared.client_request_id === input.client_request_id && input.client_request_id.length > 0 && prepared.venue === input.venue);
  insist(order.venue === input.venue && same(order.owner_address, owner) && same(order.quote_signer, quoteSigner) && order.quote_identity_id === quoteIdentityId && (!input.quote_identity_id || input.quote_identity_id === quoteIdentityId));
  insist(intent.amount === input.amount && intent.quote_identity_id === quoteIdentityId && intent.funding_source === input.funding_source && prepared.expected_revision === order.revision);
  checkDeadline(Math.floor(Date.parse(prepared.expires_at) / 1000), 3600, now);
  const asked = input.quote ?? null, echoed = intent.quote;
  insist(asked === null ? echoed === null : echoed !== null && echoed.receive_venue === asked.receive_venue && echoed.receive === asked.receive && echoed.min_fill === asked.min_fill && (echoed.quote_validity_seconds ?? 0) === (asked.quote_validity_seconds ?? 0) && echoed.replace?.sequence === asked.replace?.sequence && echoed.replace?.index === asked.replace?.index);
  insist(!asked?.replace || existingOrder?.quote_set?.sequence === asked.replace.sequence, "Quotes changed; review again");
  if (existingOrder) {
    insist(same(order.id, existingOrder.id) && existingOrder.venue === input.venue && same(existingOrder.owner_address, owner) && same(existingOrder.quote_signer, quoteSigner) && existingOrder.quote_identity_id === quoteIdentityId);
    insist(order.last_sequence === existingOrder.last_sequence && order.available_to_quote === existingOrder.available_to_quote && uint(order.revision) >= uint(existingOrder.revision), "Maker capital changed; review again");
  } else insist(order.last_sequence === 0 && uint(order.available_to_quote) === 0n);
  const amount = uint(input.amount), available = existingOrder ? uint(existingOrder.available_to_quote) : 0n;
  const added = uint(funding.added_amount), idle = uint(funding.idle_amount), wallet = uint(funding.wallet_amount), venue = uint(funding.venue_amount), existing = uint(funding.existing_available);
  const deposit = wallet + venue;
  insist(amount > 0n && existing >= available && added === idle + deposit && (input.funding_source === "venue" ? wallet : venue) === 0n);
  const kept: (QuoteIntent & { index: number })[] = [];
  // A deposit for a delegated quoter does not publish prices on its behalf.
  const prior = existingOrder && !["closed", "failed"].includes(existingOrder.state) ? existingOrder.quote_set : null;
  if ((asked || !input.quote_identity_id) && prior && Date.parse(prior.valid_until) / 1000 > now) {
    for (const [index, q] of prior.quotes.entries()) {
      const remaining = uint(q.available), supply = uint(q.supply), receive = uint(q.receive);
      insist(remaining <= supply && remaining <= available);
      if (remaining < uint(q.min_fill) || remaining === 0n) continue;
      kept.push({ venue: q.venue, recipient: q.recipient, supply: String(remaining), receive: String((remaining * receive + supply - 1n) / supply), min_fill: q.min_fill, index });
    }
  }
  if (asked) {
    // A venue's levels need capital for their sum; other venues share it. A change adds only
    // the amount by which it raises that sum above both the available capital and the current sum.
    const levels = kept.filter(q => q.venue === asked.receive_venue);
    const before = levels.reduce((sum, q) => sum + uint(q.supply), 0n);
    const after = levels.filter(q => q.index !== asked.replace?.index).reduce((sum, q) => sum + uint(q.supply), amount);
    const covered = before > available ? before : available;
    insist(added === (after > covered ? after - covered : 0n));
  } else insist(added === amount);
  // The available balance pays first; the source deposits the rest.
  const spare = existing - available;
  insist(deposit === (added > spare ? added - spare : 0n));
  const quotes: QuoteIntent[] = kept.filter(q => q.index !== asked?.replace?.index).map(({ index: _, ...q }) => q);
  if (asked) quotes.push({ venue: asked.receive_venue, recipient: required(authority.recipient), supply: input.amount, receive: asked.receive, min_fill: asked.min_fill });
  // The server's stable order: by venue, a venue's levels as they were, a new one last.
  quotes.sort((a, b) => a.venue < b.venue ? -1 : a.venue > b.venue ? 1 : 0);
  const kinds = items.map(item => item.kind);
  insist(new Set(kinds).size === kinds.length && kinds.includes("fund") === (added > 0n) && kinds.includes("quote_set") === (quotes.length > 0) && kinds.includes("margin_move") === (venue > 0n));
  const sequence = prepared.sequence === null ? null : uint(prepared.sequence);
  insist(quotes.length ? sequence !== null && sequence > BigInt(order.last_sequence) : sequence === null);
  for (const item of items) {
    const typed = item.typed_data, m = typed.message;
    if (item.kind === "margin_move") {
      // The wallet keeps what the move rounds up to whole millionths.
      const moved = venueUnits(venue, input.venue);
      insist(same(item.signer, owner) && withdrawalCost(input.venue, typed) === moved);
      checkWithdrawal(typed, input.venue, owner, owner, moved, now);
    } else if (item.kind === "fund") {
      checkEscrowTyped(typed, input.venue);
      const floor = uint(m.minQuoteSequence);
      insist(typed.primaryType === "FundOffer" && same(item.signer, owner) && same(m.owner, owner) && same(m.offerId, order.id) && uint(m.amount) === added && uint(m.deposit) === deposit && same(m.quoteSigner, quoteSigner) && same(m.operator, operator));
      insist(floor > BigInt(order.last_sequence) && floor <= BigInt(Number.MAX_SAFE_INTEGER) && (sequence === null || floor === sequence));
      checkDeadline(m.deadline, 3600, now);
    } else if (item.kind === "quote_set") {
      const expiry = Number(uint(m.expiresAt)), validity = asked?.quote_validity_seconds ?? 0;
      insist(Number.isSafeInteger(validity) && validity >= 0 && validity <= 300);
      insist(!asked ? prior !== null && prior !== undefined && expiry === Math.floor(Date.parse(prior.expires_at) / 1000) : validity === 0 ? expiry === NEVER_VALID_UNTIL + MAKER_TIMEOUT_SECONDS + 1 : expiry > now + MAKER_TIMEOUT_SECONDS && expiry <= now + validity + MAKER_TIMEOUT_SECONDS + 31);
      insist(sequence !== null && sequence <= BigInt(Number.MAX_SAFE_INTEGER));
      checkSignedQuote(item, order, quotes, Number(sequence), expiry);
    } else throw new Error("Unexpected maker signing operation");
  }
}
type TakeIntent = { from: string; to: string; amount_in: string; min_out: string; max_parts?: number };
export type TakeFill = { id: string; order_id: string; sequence: number; role: string; from_venue: string; to_venue: string; amount_in: string; amount_out: string; payer: string; maker_recipient: string; taker_recipient: string; swap_id: string; hashlock: string; pay_by: string; t1: string; t2: string; delivery_to?: string | null | undefined };
/** What a take from `venue` signs to pay: a transfer inside Aster or Lighter, an escrow `pay_take` elsewhere. */
export const takePaymentKind = (venue: string): string => venue === "aster" ? "aster_transfer" : venue === "lighter" ? "lighter_transfer" : "pay_take";
type LighterTransfer = { kind: string; signer: string; fill_id?: string | undefined; typed_data: { api_key_index: number; from_account_index: number; amount: string; usdc_fee: string; memo: string } };
/** Delivered inside a venue, a fill goes to the taker's own account there: its Aster address, or its Lighter index, whose owner only Lighter can confirm. Through an escrow, to none. */
function checkDelivery(fill: TakeFill, recipient: string) {
  const to = fill.delivery_to;
  insist(VENUE_SETTLED.has(fill.to_venue) ? typeof to === "string" && (fill.to_venue === "aster" ? same(to, recipient) : /^\d+$/.test(to)) : to === null || to === undefined, "The take delivers to another account than yours");
}
/** A take's whole signing batch, as the API sends it. */
type TakeItems = readonly (SignItem | LighterTransfer)[];
/** A take paid inside its venue buys exactly one fill, paid by one signed transfer that is the whole batch. */
function checkVenueTake(items: TakeItems, kind: string, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, now: number) {
  insist(takePaymentKind(input.from) === kind, "The signing request differs from the take's venue");
  const item = items[0];
  insist(items.length === 1 && fills.length === 1 && item?.kind === kind && same(item.signer, payer), "A take paid inside a venue is one transfer");
  const fill = required(fills[0]);
  insist(fill.role === "taker" && fill.from_venue === input.from && fill.to_venue === input.to && same(fill.payer, payer) && same(fill.taker_recipient, recipient) && item.fill_id === fill.id);
  insist(BigInt(fill.amount_in) > 0n && BigInt(fill.amount_in) <= BigInt(input.amount_in) && BigInt(fill.amount_out) >= BigInt(input.min_out));
  checkDelivery(fill, recipient);
  const payBy = Date.parse(fill.pay_by) / 1000, t1 = Date.parse(fill.t1) / 1000;
  insist(payBy > now && payBy <= now + 90 && t1 > payBy && t1 <= now + MAKER_TIMEOUT_SECONDS + 30);
  return { terms: item.typed_data, fill };
}
/** A take paid from Lighter: the transfer the taker signs pays exactly its fill, from his linked account, named by its memo. */
export function checkLighterTakeIntent(items: TakeItems, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, account: number, now = Date.now() / 1000): void {
  const { terms, fill } = checkVenueTake(items, "lighter_transfer", fills, input, payer, recipient, now);
  insist("memo" in terms && terms.from_account_index === account && terms.amount === fill.amount_in && terms.memo === fillMemo(fill.id), "The Lighter transfer differs from the take");
  insist(TAKER_API_KEYS.includes(terms.api_key_index), "The Lighter transfer is not sent by LaMarge's key");
  insist(uint(terms.usdc_fee) <= LIGHTER_MAX_TAKER_FEE, "Lighter's fee on the transfer is above 1 USDC");
}
/** A take paid from Aster: the taker's wallet signs a transfer of the fill's amount to the maker's
 * account under the fill id, with a nonce far enough ahead for LaMarge to lock the maker and
 * within Aster's nonce window. */
export function checkAsterTakeIntent(items: TakeItems, fills: TakeFill[], input: TakeIntent, payer: string, recipient: string, now = Date.now() / 1000): void {
  const { terms, fill } = checkVenueTake(items, "aster_transfer", fills, input, payer, recipient, now);
  insist("domain" in terms, "Unexpected Aster transfer");
  const transfer = asterTransfer(terms);
  checkAsterTransfer(transfer, fill);
  insist(transfer.nonce >= now + ASTER_NONCE_AHEAD && transfer.nonce <= now + 70, "The Aster transfer's nonce differs from the take");
}
/** An Aster transfer is signed while its nonce is at least this many seconds ahead. */
const ASTER_NONCE_AHEAD = 20;
/** Until when, in seconds, a reserved take can still be signed: its `pay_by`, sooner for an Aster transfer whose nonce must stay ahead. */
export function signableUntil(prepared: { take: { fills: readonly { pay_by: string }[] }; to_sign: TakeItems }): number {
  const nonces = prepared.to_sign.flatMap(({ kind, typed_data: terms }) => kind === "aster_transfer" && "domain" in terms ? [asterTransfer(terms).nonce - ASTER_NONCE_AHEAD] : []);
  return Math.min(...prepared.take.fills.map(fill => Date.parse(fill.pay_by) / 1000), ...nonces);
}
type RouteTransfer = { id: string; from: string; to: string; amount_in: string; min_out: string; payer: string; recipient: string; previous_transfer_id: string | null;
  withdrawal_preparation: { amount: string; typed_data: Typed } | null };
/**
 * A route signed at once, before its first signature: its second transfer goes on from `hub`, the
 * account on the venue between, to the route's end, for at most what the first take delivers, at
 * least a hundredth of the plan and at the planned price; its withdrawal from the venue between
 * brings no more than that, to `hub`. Each take's payment is checked as any take's when signed.
 */
export function checkRouteIntent(first: { id: string; to: string; then?: { to: string; recipient: string; amount_in: string; min_out: string } | null | undefined }, delivering: readonly { amount_out: string }[],
  second: RouteTransfer, hub: string, now = Date.now() / 1000): void {
  const then = first.then;
  insist(then && second.previous_transfer_id === first.id && second.from === first.to && second.to === then.to && same(second.payer, hub) && same(second.recipient, then.recipient), "The route's second transfer differs from the route");
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
  insist(fills.length > 0 && fills.length <= (input.max_parts ?? 8) && new Set(fills.map(fill => fill.id)).size === fills.length && new Set(fills.map(fill => fill.swap_id.toLowerCase())).size === fills.length);
  const totalIn = fills.reduce((sum, fill) => sum + BigInt(fill.amount_in), 0n);
  const totalOut = fills.reduce((sum, fill) => sum + BigInt(fill.amount_out), 0n);
  insist(totalIn > 0n && totalIn <= BigInt(input.amount_in) && totalOut >= BigInt(input.min_out));
  const takes = items.filter(item => item.kind === "pay_take");
  insist(takes.length === 1 && items.length === 1, "A reserved take must already be funded and authorized");
  const take = required(takes[0]), typed = take.typed_data, m = typed.message;
  checkEscrowTyped(typed, input.from);
  insist(typed.primaryType === "PayTake" && same(take.signer, payer) && same(m.payer, payer) && take.fill_id !== undefined && fills.some(fill => fill.id === take.fill_id));
  const payments = takePayments(typed);
  insist(payments.length === fills.length);
  const receive = CHAINS[input.to];
  for (const fill of fills) {
    insist(fill.role === "taker" && fill.from_venue === input.from && fill.to_venue === input.to && same(fill.payer, payer) && same(fill.taker_recipient, recipient) && BigInt(fill.amount_in) > 0n && BigInt(fill.amount_out) > 0n);
    checkDelivery(fill, recipient);
    const t1 = Date.parse(fill.t1) / 1000, t2 = Date.parse(fill.t2) / 1000, payBy = Date.parse(fill.pay_by) / 1000;
    insist(payBy > now && payBy <= now + payWindow && t1 > payBy && t1 <= now + MAKER_TIMEOUT_SECONDS + 30 && t2 > t1 && t2 <= now + TAKER_TIMEOUT_SECONDS + 30);
    const matching = payments.filter(payment => same(payment.swapId, fill.swap_id));
    insist(matching.length === 1);
    const p = required(matching[0]);
    insist(same(p.payer, payer) && same(p.recipient, fill.maker_recipient) && same(p.hashlock, fill.hashlock) && /^0x[0-9a-f]{64}$/i.test(fill.hashlock) && uint(p.amount) === BigInt(fill.amount_in) && uint(p.refundAt) === BigInt(Math.floor(t2)) && uint(p.deadline) === BigInt(Math.floor(payBy)));
    insist(uint(p.dex) === 0n || input.from === "hyperliquid" && uint(p.dex) === 4294967295n);
    insist(same(p.orderId, fill.order_id) && uint(p.sequence) === BigInt(fill.sequence) && uint(p.amountOut) === BigInt(fill.amount_out) && same(p.receiveRecipient, recipient) && receive && uint(p.receiveChainId) === BigInt(receive.id) && same(p.receiveToken, receive.token) && same(p.receiveEscrow, receive.escrow));
  }
  // Only the shortfall is pulled from the payer. The allowance is reusable, but no unrelated operation is signed.
  const deposit = uint(m.deposit);
  insist(deposit <= totalIn);
}

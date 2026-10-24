import { wait, type Client } from "./client.ts";
import { fresh, prefunded } from "./funds.ts";
import { CHAINS, groupable, insist, same, venueStep, VENUE_SETTLED } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { MAX_PARTS } from "./book.ts";
import type { Signer } from "./signer.ts";
import type { Fill } from "./take.ts";
import { consent, transfer, TransferPending, unsignedReservation, type Funding, type TransferIntent, type TransferOptions, type TransferStage } from "./transfer.ts";
import { signRoute } from "./grouped.ts";

/** A route's two transfers: the first from `from` to `via`, the second from `via` to `to`, as `GET /v1/routes` plans them. */
export interface RouteRequest {
  /** Persist it before the first call: the first transfer goes under it, the second under it and `.2`. */
  client_transfer_id: string;
  from: string;
  via: string;
  to: string;
  /** The first take: what it pays on `from`, and the least it delivers on `via`. */
  amount_in: string;
  min_out: string;
  /** The second take as planned: what it pays on `via`, the least it delivers on `to`, and the highest taker fee it accepts (none without). */
  then: { amount_in: string; min_out: string; max_fee_bps?: number | undefined };
  /** The linked account receiving on `to`; the signer, or `via`'s own (`RouteOptions.viaSigner`), receives on `via` and pays from there. */
  recipient: string;
  /** The highest taker fee the first take accepts, in basis points, as the route's first leg shows it; without it, it pays none. */
  max_fee_bps?: number | undefined;
  /** How the first transfer pays; the second pays from the account on `via`. */
  funding: Funding;
  /** The route's first transfer, as `onIntent` last named it. */
  transfer_id?: string | undefined;
  /** Its second, as `onIntent` last named it: LaMarge no longer counts what that one holds as left to continue with. */
  then_transfer_id?: string | undefined;
}

/** `settling`: a route signed at once runs to its end, nothing left to sign. */
export type RouteStage = TransferStage | "relaying" | "continuing" | "settling";

export type RouteOptions = Omit<TransferOptions, "onStage"> & {
  onStage?: ((stage: RouteStage) => void) | undefined;
  /** The account linked on `via`, when another than the signer: it receives the first take and pays the second. */
  viaSigner?: Signer | undefined;
  /** True signs the route at once where LaMarge can: `beforeSigning` then sees the whole route before its requests. Leg by leg otherwise. */
  grouped?: boolean | undefined;
};

/**
 * What the first take delivered on `via`, when its last part was released, and whether it was kept
 * in the payer's available balance there, as a grouped route's is, rather than sent to the venue
 * account; null while a part can still deliver.
 */
function delivered(fills: Fill[]) {
  if (!fills.every(fill => fill.maker_leg === "CLAIMED" || ["SETTLED", "EXPIRED", "REFUNDED", "TAKER_LOSS", "MAKER_LOSS"].includes(fill.state))) return null;
  const claimed = fills.filter(fill => fill.maker_leg === "CLAIMED");
  return { received: claimed.reduce((sum, fill) => sum + BigInt(fill.amount_out), 0n), released: Math.max(0, ...claimed.map(fill => Date.parse(fill.maker_claimed_at ?? "") || 0)),
    kept: claimed.length > 0 && claimed.every(fill => fill.maker_destination === "escrow") };
}

/** The latest transfer continuing `first`, read back through the history down to `first` itself. */
async function lastContinuation(client: Client, first: TransferIntent, signal?: AbortSignal): Promise<TransferIntent | undefined> {
  let after: string | undefined;
  for (;;) {
    const page = await client.call("getTransfers", { query: { limit: 100, ...(after ? { after } : {}) }, signal });
    const found = page.data.find(intent => intent.previous_transfer_id === first.id);
    if (found || !page.has_more || !page.next_cursor || page.data.some(intent => intent.id === first.id)) return found;
    after = page.next_cursor;
  }
}

/**
 * Moves through a venue between in two transfers, each a `transfer`: the first names the route's
 * end (`then`), the second pays what the server leaves to continue with (`continuable`), in whole
 * venue steps, for the route's least in proportion, once a read of `via` made after the delivery
 * shows it there. The takes are independent: what the second can't take waits on `via`. With
 * `grouped`, a route whose first take pays inside a venue through an escrow venue is signed at once
 * where LaMarge can: its second take is then priced and signed before the first delivers, and paid
 * once its funds arrive. Running the same request again, with `transfer_id`, resumes it, the
 * second found again by its client id.
 */
export async function route(client: Client, signer: Signer, request: RouteRequest, options: RouteOptions = {}): Promise<{ first: Fill[]; second: Fill[] }> {
  const { signal, onStage, onIntent, viaSigner: hub = signer, pollMs = 2_000, arrivalWaitMs = 10 * 60_000, now = Date.now, sleep = (ms: number) => wait(ms, signal) } = options;
  const stage = (value: RouteStage) => { signal?.throwIfAborted(); onStage?.(value); };
  const secondId = `${request.client_transfer_id}.2`;
  insist(secondId.length <= 64 && request.via !== request.from && request.via !== request.to, "Unexpected route");
  let first: TransferIntent = request.transfer_id
    ? await client.call("getTransfer", { path: { id: request.transfer_id }, signal })
    : await client.call("postTransfer", { body: { client_transfer_id: request.client_transfer_id, from: request.from, to: request.via, amount_in: request.amount_in, min_out: request.min_out,
      max_parts: MAX_PARTS, payer: signer.address, recipient: hub.address, then: { to: request.to, recipient: request.recipient, amount_in: request.then.amount_in, min_out: request.then.min_out,
        ...consent(request.then.max_fee_bps) }, ...consent(request.max_fee_bps) }, signal, retry: true });
  const then = first.then;
  // The first transfer is the one asked before anything of it is reserved or signed. A cancelled one goes to `transfer`, which completes a replacement it had decided.
  insist(then && first.from === request.from && first.to === request.via && first.from_chain_id === CHAINS[request.from]?.id && first.to_chain_id === CHAINS[request.via]?.id
    && first.amount_in === request.amount_in && first.min_out === request.min_out && first.max_fee_bps === request.max_fee_bps && same(first.payer, signer.address) && same(first.recipient, hub.address)
    && then.to === request.to && same(then.recipient, request.recipient) && then.amount_in === request.then.amount_in && then.min_out === request.then.min_out
    && then.max_fee_bps === request.then.max_fee_bps, "Transfer terms changed; review the original transfer");
  // Signed at once where it can be: committed, it runs to its end with nothing left to sign. It is named before anything of it is reserved or signed.
  if (options.grouped === true && !first.cancelled_at && groupable(request.from, request.via) && (!first.grouped || first.grouped.state === "prepared")) {
    await onIntent?.(first);
    await signRoute(client, signer, hub, first, { store: options.store, signal, beforeSigning: options.beforeSigning, now, lock: options.lock });
    first = await client.call("getTransfer", { path: { id: first.id }, signal });
  }
  const grouped = first.grouped?.state === "committed" || first.grouped?.state === "closed" ? first.grouped : null;
  let fills: Fill[];
  if (grouped) {
    stage("settling");
    for (const deadline = now() + arrivalWaitMs; first.grouped?.state !== "closed";) {
      if (now() >= deadline) throw new TransferPending(first, "arrival_unconfirmed");
      await sleep(pollMs);
      first = await client.call("getTransfer", { path: { id: first.id }, signal });
    }
    fills = (await client.call("getV1TakesId", { path: { id: grouped.first_take_id }, signal })).take.fills;
  } else {
    fills = await transfer(client, signer, { client_transfer_id: first.client_transfer_id, from: request.from, to: request.via, amount_in: request.amount_in, min_out: request.min_out,
      recipient: hub.address, funding: request.funding, transfer_id: first.id, max_parts: first.max_parts, max_fee_bps: request.max_fee_bps }, { ...options, onStage: stage, onIntent: async intent => { first = intent; await onIntent?.(intent); } });
    stage("relaying");
  }
  const take = fills[0]?.take_id ?? first.take_id;
  const deadline = now() + arrivalWaitMs;
  let arrived = delivered(fills);
  while (!arrived) {
    if (now() >= deadline || !take) throw new TransferPending(first, "arrival_unconfirmed");
    await sleep(pollMs);
    fills = (await client.call("getV1TakesId", { path: { id: take }, signal })).take.fills;
    arrived = delivered(fills);
  }
  // What the route's own second take paid: never continued itself, what it left goes on through a successor.
  const paid = grouped ? await executed(client, grouped.second_transfer_id, signal) : [];
  if (arrived.received === 0n) return { first: fills, second: paid };
  const continuing = (second: TransferIntent) => {
    insist(second.previous_transfer_id === first.id && second.from === request.via && second.to === request.to && same(second.recipient, request.recipient)
      && BigInt(second.amount_in) <= arrived.received && second.max_fee_bps === request.then.max_fee_bps, "Transfer terms changed; review the original transfer");
    stage("continuing");
    // Kept in escrow, it pays from the available balance and never withdraws from the venue.
    return transfer(client, hub, { client_transfer_id: second.client_transfer_id, from: request.via, to: request.to, amount_in: second.amount_in, min_out: second.min_out,
      recipient: request.recipient, funding: arrived.kept ? "wallet" : "venue", transfer_id: second.id, max_parts: second.max_parts, max_fee_bps: request.then.max_fee_bps }, { ...options, onStage: stage });
  };
  // A continuation already opened is followed, never opened again: the one named, else the route's latest, from the history.
  let latest = request.then_transfer_id ? await client.call("getTransfer", { path: { id: request.then_transfer_id }, signal }) : undefined;
  if (!latest || latest.cancelled_at || latest.id === grouped?.second_transfer_id) latest = await lastContinuation(client, first, signal) ?? latest;
  // A replacement of a take that expired unsigned goes on through the one it replaced: that one knows it was funded, and is never funded again.
  while (latest && !latest.cancelled_at && latest.client_transfer_id !== secondId && latest.client_transfer_id.startsWith("retry:")) latest = await client.call("getTransfer", { path: { id: latest.client_transfer_id.slice("retry:".length) }, signal });
  if (latest && !latest.cancelled_at && latest.id !== grouped?.second_transfer_id) return { first: fills, second: [...paid, ...await continuing(latest)] };
  // What earlier continuations took or hold is not left; unknown while the venue between's fee is, read until known.
  let left: string | null = null;
  for (;;) {
    first = await client.call("getTransfer", { path: { id: first.id }, signal });
    left = first.continuable;
    if (left !== null) break;
    if (now() >= deadline) throw new TransferPending(first, "arrival_unconfirmed");
    await sleep(pollMs);
  }
  const step = venueStep(request.via), amount = BigInt(left) / step * step;
  // What is left never goes past what the first take delivered: more would pay from the account's other funds.
  insist(amount <= arrived.received, "LaMarge leaves more to continue with than the first take delivered");
  // Less than a venue step, or a hundredth of the second take planned, is rounding: it waits on `via`.
  if (amount === 0n || amount * 100n < BigInt(then.amount_in)) return { first: fills, second: paid };
  const minOut = BigInt(then.min_out) * amount / BigInt(then.amount_in);
  // The venue between credits the delivery after its release, the escrow a delivery kept there: the second transfer waits for a read that shows it.
  for (;;) {
    const row = (await client.call("getBalances", { signal })).find(balance => balance.venue === request.via);
    insist(same(row?.address, hub.address), "Linked account changed; review the transfer again");
    const balance = required(row);
    let held: bigint | null, read: string | null | undefined;
    if (arrived.kept) [held, read] = [prefunded(balance, now()), balance.chain_read_at];
    else {
      const margin = balance.withdrawable === null || !fresh(balance.read_at, now()) ? null : BigInt(balance.withdrawable) - BigInt(balance.withdrawal_fee ?? 0);
      [held, read] = [margin === null ? null : margin + (VENUE_SETTLED.has(request.via) ? 0n : prefunded(balance, now()) ?? 0n), balance.read_at];
    }
    if ((Date.parse(read ?? "") || 0) > arrived.released && held !== null && held >= amount) break;
    if (now() >= deadline) throw new TransferPending(first, "arrival_unconfirmed");
    await sleep(pollMs);
  }
  // A cancelled one, as when its review was left, held nothing; nor does a route's own second, once closed: its successor goes under a client id derived from it, with what is left now.
  const second = await client.call("postTransfer", { body: { client_transfer_id: latest ? `renew:${latest.id}` : secondId, from: request.via, to: request.to, amount_in: amount.toString(),
    min_out: minOut.toString(), max_parts: MAX_PARTS, payer: hub.address, recipient: request.recipient, previous_transfer_id: first.id, ...consent(request.then.max_fee_bps) }, signal, retry: true });
  return { first: fills, second: [...paid, ...await continuing(second)] };
}

/** What a route's own second take paid: its fills, none of them a reservation released unsigned. */
async function executed(client: Client, id: string, signal?: AbortSignal): Promise<Fill[]> {
  const second = await client.call("getTransfer", { path: { id }, signal });
  return second.take_id ? (await client.call("getV1TakesId", { path: { id: second.take_id }, signal })).take.fills.filter(fill => !unsignedReservation(fill)) : [];
}

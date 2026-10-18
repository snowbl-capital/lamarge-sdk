import { wait, type Client } from "./client.ts";
import { fresh, prefunded } from "./funds.ts";
import { insist, same, venueStep, VENUE_SETTLED } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { MAX_PARTS } from "./book.ts";
import type { Signer } from "./signer.ts";
import type { Fill } from "./take.ts";
import { transfer, TransferPending, type Funding, type TransferIntent, type TransferOptions, type TransferStage } from "./transfer.ts";

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
  /** The second take as planned: what it pays on `via`, and the least it delivers on `to`. */
  then: { amount_in: string; min_out: string };
  /** The linked account receiving on `to`; the signer receives on `via` and pays from there. */
  recipient: string;
  /** How the first transfer pays; the second pays from the account on `via`. */
  funding: Funding;
  /** The route's first transfer, as `onIntent` last named it. */
  transfer_id?: string | undefined;
  /** Its second, as `onIntent` last named it: LaMarge no longer counts what that one holds as left to continue with. */
  then_transfer_id?: string | undefined;
}

export type RouteStage = TransferStage | "relaying" | "continuing";

export type RouteOptions = Omit<TransferOptions, "onStage"> & { onStage?: ((stage: RouteStage) => void) | undefined };

/** What the first take delivered on `via`, and when its last part was released; null while a part can still deliver. */
function delivered(fills: Fill[]) {
  if (!fills.every(fill => fill.maker_leg === "CLAIMED" || ["SETTLED", "EXPIRED", "REFUNDED", "TAKER_LOSS", "MAKER_LOSS"].includes(fill.state))) return null;
  const claimed = fills.filter(fill => fill.maker_leg === "CLAIMED");
  return { received: claimed.reduce((sum, fill) => sum + BigInt(fill.amount_out), 0n), released: Math.max(0, ...claimed.map(fill => Date.parse(fill.maker_claimed_at ?? "") || 0)) };
}

/**
 * Moves through a venue between in two transfers, each a `transfer`: the first names the route's
 * end (`then`), the second pays what the server leaves to continue with (`continuable`), in whole
 * venue steps, for the route's least in proportion, once a read of `via` made after the delivery
 * shows it there. The takes are independent: what the second can't take waits on `via`. Running the
 * same request again, with `transfer_id`, resumes it, the second found again by its client id.
 */
export async function route(client: Client, signer: Signer, request: RouteRequest, options: RouteOptions = {}): Promise<{ first: Fill[]; second: Fill[] }> {
  const { signal, onStage, onIntent, pollMs = 2_000, arrivalWaitMs = 10 * 60_000, now = Date.now, sleep = (ms: number) => wait(ms, signal) } = options;
  const stage = (value: RouteStage) => { signal?.throwIfAborted(); onStage?.(value); };
  const secondId = `${request.client_transfer_id}.2`;
  insist(secondId.length <= 64 && request.via !== request.from && request.via !== request.to, "Unexpected route");
  let first: TransferIntent = request.transfer_id
    ? await client.call("getTransfer", { path: { id: request.transfer_id }, signal })
    : await client.call("postTransfer", { body: { client_transfer_id: request.client_transfer_id, from: request.from, to: request.via, amount_in: request.amount_in, min_out: request.min_out,
      max_parts: MAX_PARTS, payer: signer.address, recipient: signer.address, then: { to: request.to, recipient: request.recipient, ...request.then } }, signal, retry: true });
  const then = first.then;
  insist(then && first.to === request.via && then.to === request.to && same(then.recipient, request.recipient) && then.amount_in === request.then.amount_in && then.min_out === request.then.min_out,
    "Transfer terms changed; review the original transfer");
  let fills = await transfer(client, signer, { client_transfer_id: first.client_transfer_id, from: request.from, to: request.via, amount_in: request.amount_in, min_out: request.min_out,
    recipient: signer.address, funding: request.funding, transfer_id: first.id, max_parts: first.max_parts }, { ...options, onStage: stage, onIntent: async intent => { first = intent; await onIntent?.(intent); } });
  stage("relaying");
  const take = fills[0]?.take_id ?? first.take_id;
  const deadline = now() + arrivalWaitMs;
  let arrived = delivered(fills);
  while (!arrived) {
    if (now() >= deadline || !take) throw new TransferPending(first, "arrival_unconfirmed");
    await sleep(pollMs);
    fills = (await client.call("getV1TakesId", { path: { id: take }, signal })).take.fills;
    arrived = delivered(fills);
  }
  if (arrived.received === 0n) return { first: fills, second: [] };
  const continuing = (second: TransferIntent) => {
    insist(second.previous_transfer_id === first.id && second.from === request.via && second.to === request.to && same(second.recipient, request.recipient)
      && BigInt(second.amount_in) <= arrived.received, "Transfer terms changed; review the original transfer");
    stage("continuing");
    return transfer(client, signer, { client_transfer_id: second.client_transfer_id, from: request.via, to: request.to, amount_in: second.amount_in, min_out: second.min_out,
      recipient: request.recipient, funding: "venue", transfer_id: second.id, max_parts: second.max_parts }, { ...options, onStage: stage });
  };
  if (request.then_transfer_id) return { first: fills, second: await continuing(await client.call("getTransfer", { path: { id: request.then_transfer_id }, signal })) };
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
  if (amount === 0n || amount * 100n < BigInt(then.amount_in)) return { first: fills, second: [] };
  const minOut = BigInt(then.min_out) * amount / BigInt(then.amount_in);
  // The venue between credits the delivery after its release: the second transfer waits for a read that shows it.
  for (;;) {
    const row = (await client.call("getBalances", { signal })).find(balance => balance.venue === request.via);
    insist(same(row?.address, signer.address), "Linked account changed; review the transfer again");
    const balance = required(row);
    const margin = balance.withdrawable === null || !fresh(balance.read_at, now()) ? null : BigInt(balance.withdrawable) - BigInt(balance.withdrawal_fee ?? 0);
    const held = margin === null ? null : margin + (VENUE_SETTLED.has(request.via) ? 0n : prefunded(balance, now()) ?? 0n);
    if ((Date.parse(balance.read_at ?? "") || 0) > arrived.released && held !== null && held >= amount) break;
    if (now() >= deadline) throw new TransferPending(first, "arrival_unconfirmed");
    await sleep(pollMs);
  }
  const second = await client.call("postTransfer", { body: { client_transfer_id: secondId, from: request.via, to: request.to, amount_in: amount.toString(), min_out: minOut.toString(),
    max_parts: MAX_PARTS, payer: signer.address, recipient: request.recipient, previous_transfer_id: first.id }, signal, retry: true });
  return { first: fills, second: await continuing(second) };
}

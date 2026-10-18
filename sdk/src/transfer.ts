import { LaMargeError, wait, type Answer, type Client } from "./client.ts";
import { permitDone, submitPermit } from "./account.ts";
import { prefunded, sweepable } from "./funds.ts";
import { checkFundingPlan } from "./protocol/consents.ts";
import { CHAINS, insist, same, shortfall, VENUE_SETTLED } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import type { BeforeSigning, Signer } from "./signer.ts";
import { exclusive, memoryStore, type SignatureStore } from "./store.ts";
import { submitWithdrawal } from "./withdraw.ts";
import { checkQuote, MAX_PARTS } from "./book.ts";
import { take, type Fill, type TakeInput } from "./take.ts";

export type TransferIntent = Answer<"getTransfer">;

/**
 * Where a transfer from an escrow venue pays from. `venue`: what the escrow chain does not hold
 * is withdrawn from the venue account first. `wallet`: only the address and its available balance
 * pay; a shortfall stops the transfer before anything is signed, and nothing is withdrawn.
 */
export type Funding = "venue" | "wallet";

export interface TransferRequest {
  /** Persist it before the first call: the same id finds the same transfer again after a restart. */
  client_transfer_id: string;
  from: string;
  to: string;
  amount_in: string;
  min_out: string;
  max_parts?: number | undefined;
  /** The linked account receiving on `to`; the payer is the signer. */
  recipient: string;
  funding: Funding;
  /** The transfer to resume, as `onIntent` last named it. */
  transfer_id?: string | undefined;
}

export type TransferStage = "checking" | "funding" | "waiting" | "authorizing" | "taking";

export interface TransferOptions {
  store?: SignatureStore | undefined;
  signal?: AbortSignal | undefined;
  onStage?: ((stage: TransferStage) => void) | undefined;
  /** Called with each transfer this one becomes: a stale one is replaced, never repeated. Persist its id; the flow waits for a returned promise. */
  onIntent?: ((intent: TransferIntent) => void | Promise<void>) | undefined;
  /** Between reads while funds or a permit arrive. */
  pollMs?: number | undefined;
  /** How long to wait for funds or a permit before `TransferPending`. */
  arrivalWaitMs?: number | undefined;
  /** Runs on each checked request before it is first signed: the permit, the withdrawal, the take's payment. One that throws signs nothing. */
  beforeSigning?: BeforeSigning | undefined;
  /** The clock the flow's windows and deadlines are read on, and how it sleeps between reads; the machine's by default. */
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** Nothing failed, but the transfer cannot go on yet; run it again with the same request later. */
export class TransferPending extends Error {
  override readonly name = "TransferPending";
  constructor(readonly intent: TransferIntent, readonly reason: "arrival_unconfirmed" | "authorization_unconfirmed" | "unknown" | "refused") {
    super(reason === "refused" ? intent.withdrawal?.error ?? "Funding refused" : reason === "unknown" ? "Funding outcome unknown"
      : reason === "authorization_unconfirmed" ? "Authorization not confirmed yet" : "Funds not received yet");
  }
}

/** The book, the caller's own orders aside, pays all of the take for at least its minimum. */
async function reviewQuote(client: Client, input: TakeInput, now: number, signal?: AbortSignal) {
  const [book, orders, venues] = await Promise.all([
    client.call("getBook", { query: { from: input.from, to: input.to }, signal }), client.call("getOrders", { signal }), client.call("getVenues", { signal })]);
  checkQuote(book, new Set(orders.map(order => order.id)), input, BigInt(venues.find(venue => venue.id === input.to)?.release_minimum ?? 0), now);
}

/** A reservation nothing was signed or paid for: replacing it repeats nothing. */
export const unsignedReservation = (fill: {
  state: string; payment_leg: string; maker_leg: string; transactions: readonly unknown[]; delivery_hash: string | null;
  signed_at?: string | null | undefined; payment_locked_at?: string | null | undefined; maker_claimed_at?: string | null | undefined;
}) => (fill.state === "RESERVED" || fill.state === "EXPIRED") && fill.signed_at === null
  && fill.payment_leg === "NONE" && (fill.maker_leg === "NONE" || fill.maker_leg === "ABANDONED")
  && fill.transactions.length === 0 && !fill.delivery_hash && !fill.payment_locked_at && !fill.maker_claimed_at;

function replacement(intent: TransferIntent, clientId: string) {
  const { from, to, amount_in, min_out, max_parts, payer, recipient, then, previous_transfer_id: previous } = intent;
  return { client_transfer_id: clientId, from, to, amount_in, min_out, max_parts, payer, recipient, ...(then ? { then } : {}), ...(previous ? { previous_transfer_id: previous } : {}) };
}

/** The transfer the API answers is the one asked: by its id, or by the client id it was created under. */
function asked(intent: TransferIntent, by: { id: string } | { clientId: string }): TransferIntent {
  insist("id" in by ? intent.id === by.id : intent.client_transfer_id === by.clientId, "The API answered another transfer");
  return intent;
}

/** The transfer's withdrawal from the venue account, to the signer, for exactly `amount`. Once the server records it, the transfer names it: the stored signature can go. */
async function withdrawFor(client: Client, signer: Signer, intent: TransferIntent, amount: bigint, store: SignatureStore, now: () => number, signal?: AbortSignal, beforeSigning?: BeforeSigning) {
  const key = `transfer-withdrawal:${intent.id}`;
  return exclusive(store, key, async () => {
    try {
      const { result } = await submitWithdrawal({
        key, venue: intent.from, signer, destination: signer.address, amount, store, signal, beforeSigning, now,
        prepare: async () => intent.withdrawal_preparation?.typed_data
          ?? (await client.call("prepareTransferWithdrawal", { path: { id: intent.id }, body: { amount: amount.toString() }, signal })).typed_data,
        submit: (_typed, signature) => client.call("submitTransferWithdrawal", { path: { id: intent.id }, body: { signature }, signal, retry: true }),
      });
      // Kept until the answer reads as a known outcome: an unreadable one leaves the signature to submit again.
      insist(typeof result?.state === "string", "Unreadable answer to the withdrawal");
      if (result.state !== "unknown") await store.delete(key);
      return result;
    } catch (error) {
      if (error instanceof LaMargeError && error.code === "VENUE_REJECTED") await store.delete(key);
      throw error;
    }
  });
}

/**
 * Moves `amount_in` from the signer's account on `from` to `recipient` on `to`, for at least
 * `min_out`: funding first (per `funding`), then the take, signed and submitted. Durable
 * operations are resolved before anything new: running the same request again resumes it, and a
 * withdrawal is never repeated because a balance looks short.
 */
export async function transfer(client: Client, signer: Signer, request: TransferRequest, options: TransferOptions = {}): Promise<Fill[]> {
  const { store = memoryStore(), signal, onStage, onIntent, pollMs = 2_000, arrivalWaitMs = 10 * 60_000, now = Date.now, sleep = (ms: number) => wait(ms, signal) } = options;
  const payer = signer.address;
  const maxParts = request.max_parts ?? MAX_PARTS;
  const stage = (value: TransferStage) => { signal?.throwIfAborted(); onStage?.(value); };
  // A venue settled inside itself pays from its account: there is no wallet to pay from.
  insist(request.funding === "venue" || !VENUE_SETTLED.has(request.from), `Wallet funding does not apply to ${request.from}, whose account pays`);
  stage("checking");
  let intent = request.transfer_id
    ? asked(await client.call("getTransfer", { path: { id: request.transfer_id }, query: { funding_plan: true }, signal }), { id: request.transfer_id })
    : asked(await client.call("postTransfer", { body: { client_transfer_id: request.client_transfer_id, from: request.from, to: request.to, amount_in: request.amount_in,
      min_out: request.min_out, max_parts: maxParts, payer, recipient: request.recipient }, signal, retry: true }), { clientId: request.client_transfer_id });
  // A replacement repeats nothing: the same terms, under a client id derived from the transfer it replaces.
  const replace = async (clientId: string) => asked(await client.call("postTransfer", { body: replacement(intent, clientId), signal, retry: true }), { clientId });
  // A replacement decided before a lost cancellation answer is completed, never decided again.
  const renewal = (id: string) => `renewal:${id}`;
  let renewedFrom: string | undefined;
  if (intent.cancelled_at && await store.load(renewal(intent.id)) !== undefined) {
    renewedFrom = intent.id;
    intent = await replace(`renew:${renewedFrom}`);
  }
  const checkIntent = () => {
    insist(!intent.cancelled_at, "Transfer cancelled");
    insist(intent.max_parts === maxParts && intent.from === request.from && intent.to === request.to && intent.from_chain_id === CHAINS[request.from]?.id && intent.to_chain_id === CHAINS[request.to]?.id && intent.amount_in === request.amount_in
      && intent.min_out === request.min_out && same(intent.payer, payer) && same(intent.recipient, request.recipient), "Transfer terms changed; review the original transfer");
  };
  checkIntent();
  if (!intent.withdrawal && !intent.take_id && intent.withdrawal_preparation && now() - Date.parse(intent.withdrawal_preparation.created_at) > 45_000) {
    // Cancellation serializes with acceptance; an uncertain withdrawal is never replaced.
    renewedFrom = intent.id;
    await store.save(renewal(renewedFrom), true);
    try {
      await client.call("cancelTransfer", { path: { id: intent.id }, signal });
    } catch (error) {
      // An answered refusal means nothing was cancelled: no replacement is owed. Only a lost answer keeps the marker.
      if (error instanceof LaMargeError) await store.delete(renewal(renewedFrom));
      throw error;
    }
    intent = await replace(`renew:${intent.id}`);
    checkIntent();
  }
  await onIntent?.(intent);
  if (renewedFrom) await store.delete(renewal(renewedFrom));
  // A replacement of a take that expired unsigned after its funding: never funded again.
  const funded = (id: string) => `funded:${id}`;
  const alreadyFunded = await store.load(funded(intent.id)) !== undefined;
  const amount = BigInt(intent.amount_in);
  const readFunds = async () => {
    const balances = await client.call("getBalances", { signal });
    const from = balances.find(balance => balance.venue === intent.from);
    const to = balances.find(balance => balance.venue === intent.to);
    insist(same(from?.address, payer) && same(to?.address, request.recipient), "Linked account changed; review the transfer again");
    // Ready pays the take; supplied adds what the deposit address holds until it is swept.
    const ready = prefunded(from, now());
    return ready === null ? null : { ready, supplied: ready + sweepable(from), balances };
  };
  const covers = (funds: Awaited<ReturnType<typeof readFunds>>) => insist(funds !== null && funds.supplied >= amount, "Wallet funds do not cover the transfer");
  // Every new payment signature from wallet funds is preceded by a fresh read that covers it.
  const beforeSigning: BeforeSigning = async signing => {
    if (request.funding === "wallet") covers(await readFunds());
    await options.beforeSigning?.(signing);
  };
  const takeInput = (): TakeInput => ({ from: intent.from, to: intent.to, amount_in: intent.amount_in, min_out: intent.min_out, max_parts: intent.max_parts,
    client_take_id: intent.client_take_id, transfer_intent_id: intent.id });
  const pay = (balances?: Answer<"getBalances">) => take(client, signer, takeInput(), { store, signal, balances, recipient: request.recipient, beforeSigning, now });
  // A take reserved again is priced again first, as the app does: a book that no longer pays its minimum reserves nothing.
  const repriced = async (balances?: Answer<"getBalances">) => {
    const [, read] = await Promise.all([reviewQuote(client, takeInput(), now(), signal), balances ?? client.call("getBalances", { signal })]);
    return pay(read);
  };
  /** The take already reserved, signed or paid, settled first; a replaced one is priced and taken again. Null when there is none. */
  const recoverTake = async (): Promise<Fill[] | null> => {
    let renewed = false;
    while (intent.take_id) {
      stage("taking");
      let prepared = await client.call("getV1TakesId", { path: { id: intent.take_id }, signal });
      const unsigned = () => prepared.take.fills.length > 0 && prepared.take.fills.every(unsignedReservation);
      if (unsigned() && prepared.take.fills.some(fill => fill.state === "RESERVED" && Date.parse(fill.pay_by) <= now())) {
        // Cancellation serializes with acceptance. A late or uncertain signature is never replaced.
        await client.call("deleteTake", { path: { id: intent.take_id }, signal });
        prepared = await client.call("getV1TakesId", { path: { id: intent.take_id }, signal });
      }
      if (!unsigned() || !prepared.take.fills.every(fill => fill.state === "EXPIRED")) {
        if (!prepared.to_sign.length || prepared.take.fills.some(fill => fill.state !== "RESERVED")) return prepared.take.fills;
        return take(client, signer, takeInput(), { store, signal, prepared, recipient: request.recipient, beforeSigning, now });
      }
      // A deterministic replacement survives a lost response or a restart, with the same terms.
      intent = await replace(`retry:${intent.id}`);
      checkIntent();
      await store.save(funded(intent.id), true);
      await onIntent?.(intent);
      renewed = true;
    }
    // The original take was already funded: repricing never triggers another withdrawal.
    return renewed ? repriced() : null;
  };
  const recovered = await recoverTake();
  if (recovered) return recovered;
  if (alreadyFunded) return repriced();
  // Paid inside the venue: nothing to fund, the take's transfer comes from the venue account.
  if (VENUE_SETTLED.has(intent.from)) { stage("taking"); return pay(); }

  const checkWithdrawalState = () => {
    if (intent.withdrawal?.state === "refused") throw new TransferPending(intent, "refused");
    if (intent.withdrawal?.state === "unknown") throw new TransferPending(intent, "unknown");
  };
  // A wallet deposit without payment setup signs its permit first; the take waits until it is final.
  let authorizing = false;
  const fund = async () => {
    const plan = checkFundingPlan(intent, now());
    insist(request.funding === "venue" || BigInt(plan.withdrawal_amount) === 0n, "Wallet funds do not cover the transfer");
    authorizing = ["required", "pending"].includes(plan.payment_setup);
    if (plan.requests.some(item => item.kind === "permit")) { stage("funding"); await submitPermit(client, intent.from, signer, signal, options.beforeSigning, now); }
  };
  checkWithdrawalState();
  let funds = await readFunds();
  // Wallet funds are read before the permit too: a transfer they cannot pay signs nothing.
  if (request.funding === "wallet" && !intent.withdrawal) covers(funds);
  let planned = false;
  if (!intent.withdrawal) { await fund(); planned = true; }
  if (!intent.withdrawal && (intent.withdrawal_preparation || funds !== null && funds.supplied < amount)) {
    insist(request.funding === "venue", "Wallet funds do not cover the transfer");
    // Margin leaves the venue only for a take the book can execute now.
    if (!intent.withdrawal_preparation) await reviewQuote(client, takeInput(), now(), signal);
    stage("funding");
    const preparation = intent.withdrawal_preparation;
    const withdrawal = preparation ? BigInt(preparation.amount) : shortfall(amount, required(funds, "A fresh balance is required").supplied, intent.from);
    if (intent.funding_plan) insist(withdrawal === BigInt(intent.funding_plan.withdrawal_amount), "Funding amount changed; review the transfer again");
    intent.withdrawal = await withdrawFor(client, signer, intent, withdrawal, store, now, signal, options.beforeSigning);
    checkWithdrawalState();
    // Until it is relayed the wait below reads the balance anyway.
    if (intent.withdrawal.state === "relayed") funds = await readFunds();
  }
  insist(intent.withdrawal || funds !== null, "A fresh balance is required; try again shortly");
  const waitingForFunds = () => funds === null || funds.ready < amount || (intent.withdrawal != null && intent.withdrawal.state !== "relayed");
  const deadline = now() + arrivalWaitMs;
  let reread = false;
  if (waitingForFunds()) stage("waiting");
  while (waitingForFunds()) {
    if (now() >= deadline) throw new TransferPending(intent, "arrival_unconfirmed");
    await sleep(pollMs);
    const id = intent.id;
    [intent, funds] = await Promise.all([client.call("getTransfer", { path: { id }, signal }).then(read => asked(read, { id })), readFunds()]);
    checkIntent();
    const accepted = await recoverTake();
    if (accepted) return accepted;
    checkWithdrawalState();
    reread = true;
  }
  stage("taking");
  // The wait's last read stands unless the funding plan is still to be read.
  if (!reread || !planned) {
    intent = asked(await client.call("getTransfer", { path: { id: intent.id }, query: { funding_plan: !planned }, signal }), { id: intent.id });
    checkIntent();
    const accepted = await recoverTake();
    if (accepted) return accepted;
  }
  if (!planned && intent.funding_plan) await fund();
  // The permit gets its own wait, however long the funds took to arrive.
  const confirmBy = now() + arrivalWaitMs;
  while (authorizing && !await permitDone(client, intent.from, signer, signal)) {
    stage("authorizing");
    if (now() >= confirmBy) throw new TransferPending(intent, "authorization_unconfirmed");
    await sleep(pollMs);
  }
  stage("taking");
  return repriced(required(funds, "A fresh balance is required").balances);
}

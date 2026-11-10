import { LaMargeError, wait, type Answer, type Client } from "./client.ts";
import { permitDone, submitPermit } from "./account.ts";
import { prefunded, sweepable } from "./funds.ts";
import { checkFundingPlan } from "./protocol/consents.ts";
import { destined, destinationOf, signableUntil, toWallet, type Destination } from "./protocol/intents.ts";
import { CHAINS, checkWithdrawal, GMX_TRANSFER_ROUTER, gmxTransferOut, insist, OWNER_WITHDRAWS, same, VENUE_SETTLED, type Dex, type Typed } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import type { BeforeSigning, Signer } from "./signer.ts";
import { exclusive, memoryStore, type SignatureStore } from "./store.ts";
import { submitWithdrawal } from "./withdraw.ts";
import { checkQuote, deliveryFloor, MAX_PARTS } from "./book.ts";
import { atOnceCutoff, signableAtOnce, take, takeKey, type Fill, type TakeInput, type TakeOptions } from "./take.ts";

export type TransferIntent = Answer<"getTransfer">;

/** `venue` withdraws any escrow-chain shortfall; `wallet` stops on a shortfall without signing or withdrawing. */
export type Funding = "venue" | "wallet";

export interface TransferRequest {
  /** Persist it before the first call: the same id finds the same transfer again after a restart. */
  client_transfer_id: string;
  from: string;
  to: string;
  amount_in: string;
  min_out: string;
  max_parts?: number | undefined;
  /** The highest taker fee accepted, in basis points, as a book's or a route's `taker_fee_bps` shows it: a pair whose fee is higher refuses the take. Without it, the take pays no fee. */
  max_fee_bps?: number | undefined;
  /** The account receiving on `to`: the linked one, or with a wallet destination any address; the payer is the signer. */
  recipient: string;
  /** `wallet`: by plain transfer to `recipient` on `to`'s escrow chain, in its wallet token, no account on `to` needed; `venue`, the default: into the account linked on `to`. */
  destination?: Destination | undefined;
  funding: Funding;
  /** `xyz`: from a standard Hyperliquid account, the withdrawal leaves its trade.xyz balance instead of its perps. */
  from_dex?: "xyz" | undefined;
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
  lock?: TakeOptions["lock"];
}

/** Nothing failed, but the transfer cannot go on yet; run it again with the same request later. */
export class TransferPending extends Error {
  override readonly name = "TransferPending";
  constructor(readonly intent: TransferIntent, readonly reason: "arrival_unconfirmed" | "authorization_unconfirmed" | "unknown" | "refused") {
    super(reason === "refused" ? intent.withdrawal?.error ?? "Funding refused" : reason === "unknown" ? "Funding outcome unknown"
      : reason === "authorization_unconfirmed" ? "Authorization not confirmed yet" : "Funds not received yet");
  }
}

async function reviewQuote(client: Client, input: TakeInput, now: number, signal?: AbortSignal) {
  const [book, orders, venues] = await Promise.all([
    client.call("getBook", { query: { from: input.from, to: input.to }, signal }), client.call("getOrders", { signal }), client.call("getVenues", { query: { all: true }, signal })]);
  checkQuote(book, new Set(orders.map(order => order.id)), input, deliveryFloor(venues, input.to, input.destination), now);
}

export const unsignedReservation = (fill: {
  state: string; payment_leg: string; maker_leg: string; transactions: readonly unknown[]; delivery_hash: string | null;
  signed_at?: string | null | undefined; payment_locked_at?: string | null | undefined; maker_claimed_at?: string | null | undefined;
}) => (["PREPARED", "RESERVED"].includes(fill.state) || fill.state === "EXPIRED") && fill.signed_at === null
  && fill.payment_leg === "NONE" && (fill.maker_leg === "NONE" || fill.maker_leg === "ABANDONED")
  && fill.transactions.length === 0 && !fill.delivery_hash && !fill.payment_locked_at && !fill.maker_claimed_at;

export const consent = (maxFeeBps: number | undefined) => maxFeeBps === undefined ? {} : { max_fee_bps: maxFeeBps };

/** The transfer's take, its wallet destination and recipient included: checked against the transfer, itself checked against what the caller asked. */
export const takeInput = (intent: TransferIntent): TakeInput => ({ from: intent.from, to: intent.to, amount_in: intent.amount_in, min_out: intent.min_out,
  max_parts: intent.max_parts, client_take_id: intent.client_take_id, transfer_intent_id: intent.id, ...consent(intent.max_fee_bps),
  ...destined(intent.destination), ...destinationOf(intent) === "wallet" ? { recipient: intent.recipient } : {} });

function replacement(intent: TransferIntent, clientId: string) {
  const { from, to, amount_in, min_out, max_parts, payer, recipient, then, previous_transfer_id: previous } = intent;
  // The request's `then` carries the route's terms only: `chain_id` is the server's answer.
  return { client_transfer_id: clientId, from, to, amount_in, min_out, max_parts, payer, recipient, ...destined(intent.destination), ...consent(intent.max_fee_bps), ...fromDex(intent.from_dex),
    ...(then ? { then: { to: then.to, recipient: then.recipient, ...destined(then.destination), amount_in: then.amount_in, min_out: then.min_out, ...consent(then.max_fee_bps) } } : {}),
    ...(previous ? { previous_transfer_id: previous } : {}) };
}

/** The Hyperliquid balance a transfer's withdrawal leaves: trade.xyz, or the perps without `from_dex`. */
function dexOf(intent: TransferIntent): Dex {
  insist(!intent.from_dex || intent.from_dex === "xyz", "Unknown Hyperliquid balance");
  return intent.from_dex ? "xyz" : undefined;
}

/** A request's trade.xyz source, the field left out when the perps pay. */
const fromDex = (dex: string | undefined) => dex === "xyz" ? { from_dex: "xyz" as const } : {};

function asked(intent: TransferIntent, by: { id: string } | { clientId: string }): TransferIntent {
  insist("id" in by ? intent.id === by.id : intent.client_transfer_id === by.clientId, "The API answered another transfer");
  return intent;
}

const withdrawalKey = (id: string) => `transfer-withdrawal:${id}`;

/** The transfer's withdrawal from the venue account, to the signer, for exactly `amount`. Once the server records it, the transfer names it: the stored signature can go. */
async function withdrawFor(client: Client, signer: Signer, intent: TransferIntent, amount: bigint, store: SignatureStore, now: () => number, signal?: AbortSignal, beforeSigning?: BeforeSigning) {
  const key = withdrawalKey(intent.id);
  return exclusive(store, key, async () => {
    try {
      const { result } = await submitWithdrawal({
        key, venue: intent.from, signer, destination: signer.address, amount, store, signal, beforeSigning, now, dex: dexOf(intent),
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

/** Where a GMX transfer records its `transferOut`, from just before it is sent: its funds may have left GMX. */
export const transferOutKey = (id: string) => `transfer_out:${id}`;
/**
 * A `transferOut` asked or broadcast but not seen mined is not sent again for this long: it may still land. After
 * it, one whose funds never arrived may be sent again: a second only moves the signer's own funds to itself.
 */
const TRANSFER_OUT_PENDING_MS = 10 * 60_000;

/** Paying from GMX, the signer must send its own `transferOut`: checked before anything is signed. */
export const sendsFrom = (venue: string, signer: Pick<Signer, "sendTransaction">) =>
  insist(!OWNER_WITHDRAWS.has(venue) || signer.sendTransaction, "This signer cannot send GMX's transferOut");

/**
 * From GMX, `amount` of the signer's GMX Account to its own address, by its own transaction; then the plan
 * finds it in the wallet. One mined, or sent within ten minutes, for this transfer is not sent again; another
 * store (tab, process) may send a second, which moves only the signer's own funds to its own address.
 */
async function transferOut(signer: Signer, intent: TransferIntent, amount: bigint, store: SignatureStore, now: () => number, beforeSigning?: BeforeSigning) {
  const key = transferOutKey(intent.id);
  return exclusive(store, key, async () => {
    const known: unknown = await store.load(key);
    if (known !== undefined && (record(known).mined === true || now() - Number(record(known).at) < TRANSFER_OUT_PENDING_MS)) return;
    await beforeSigning?.({ kind: "transfer_out", venue: "gmx", amount });
    const terms = { amount: amount.toString() };
    await store.save(key, { ...terms, at: now() });
    let broadcast = false;
    try {
      const hash = await required(signer.sendTransaction)({ chainId: required(CHAINS.gmx).id, to: GMX_TRANSFER_ROUTER, data: gmxTransferOut(amount) },
        async sent => { broadcast = true; await store.save(key, { ...terms, at: now(), hash: sent }); });
      await store.save(key, { ...terms, at: now(), hash, mined: true });
    } catch (error) {
      // Refused before broadcast, nothing left GMX; broadcast, its outcome stays unknown.
      if (!broadcast) await store.delete(key);
      throw error;
    }
  });
}

/** Resumes durable operations before new funding or payment; a short balance never repeats a withdrawal. */
export async function transfer(client: Client, signer: Signer, request: TransferRequest, options: TransferOptions = {}): Promise<Fill[]> {
  insist(!Object.hasOwn(request, "to_dex"), "trade.xyz is not a transfer destination");
  const wallet = toWallet(request);
  if (request.funding !== "wallet") sendsFrom(request.from, signer);
  const { store = memoryStore(), signal, onStage, onIntent, pollMs = 2_000, arrivalWaitMs = 10 * 60_000, now = Date.now, sleep = (ms: number) => wait(ms, signal) } = options;
  const payer = signer.address;
  const maxParts = request.max_parts ?? MAX_PARTS;
  const stage = (value: TransferStage) => { signal?.throwIfAborted(); onStage?.(value); };
  insist(request.funding === "venue" || !VENUE_SETTLED.has(request.from), `Wallet funding does not apply to ${request.from}, whose account pays`);
  stage("checking");
  let intent = request.transfer_id
    ? asked(await client.call("getTransfer", { path: { id: request.transfer_id }, query: { funding_plan: true }, signal }), { id: request.transfer_id })
    : asked(await client.call("postTransfer", { body: { client_transfer_id: request.client_transfer_id, from: request.from, to: request.to, amount_in: request.amount_in,
      min_out: request.min_out, max_parts: maxParts, payer, recipient: request.recipient, ...destined(request.destination), ...consent(request.max_fee_bps), ...fromDex(request.from_dex) }, signal, retry: true }),
    { clientId: request.client_transfer_id });
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
      && intent.min_out === request.min_out && intent.max_fee_bps === request.max_fee_bps && intent.from_dex === request.from_dex && same(intent.payer, payer) && same(intent.recipient, request.recipient)
      && destinationOf(intent) === destinationOf(request), "Transfer terms changed; review the original transfer");
  };
  checkIntent();
  /** A transfer whose withdrawal preparation went unsigned over 45 seconds is replaced. */
  const renewStale = async () => {
    if (intent.withdrawal || intent.take_id || !intent.withdrawal_preparation || now() - Date.parse(intent.withdrawal_preparation.created_at) <= 45_000) return false;
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
    return true;
  };
  const announce = async () => {
    await onIntent?.(intent);
    if (renewedFrom) await store.delete(renewal(renewedFrom));
  };
  await renewStale();
  await announce();
  // A replacement of a take that expired unsigned after its funding: never funded again.
  const funded = (id: string) => `funded:${id}`;
  const alreadyFunded = await store.load(funded(intent.id)) !== undefined;
  const amount = BigInt(intent.amount_in);
  const readFunds = async () => {
    const balances = await client.call("getBalances", { signal });
    const from = balances.find(balance => balance.venue === intent.from);
    const to = balances.find(balance => balance.venue === intent.to);
    // A wallet delivery needs no account on `to`.
    insist(same(from?.address, payer) && (wallet || same(to?.address, request.recipient)), "Linked account changed; review the transfer again");
    const ready = prefunded(from, now());
    return ready === null ? null : { ready, supplied: ready + sweepable(from), balances };
  };
  const covers = (funds: Awaited<ReturnType<typeof readFunds>>) => insist(funds !== null && funds.supplied >= amount, "Wallet funds do not cover the transfer");
  // Every new payment signature from wallet funds is preceded by a fresh read that covers it.
  const beforeSigning: BeforeSigning = async signing => {
    if (request.funding === "wallet") covers(await readFunds());
    await options.beforeSigning?.(signing);
  };
  const pay = (balances?: Answer<"getBalances">) => take(client, signer, takeInput(intent), { store, signal, balances, recipient: request.recipient, beforeSigning, now, lock: options.lock });
  // A take prepared again is priced first: a book that no longer pays its minimum takes nothing.
  const repriced = async (balances?: Answer<"getBalances">) => {
    const [, read] = await Promise.all([reviewQuote(client, takeInput(intent), now(), signal), balances ?? client.call("getBalances", { signal })]);
    return pay(read);
  };
  const checkWithdrawalState = () => {
    if (intent.withdrawal?.state === "refused") throw new TransferPending(intent, "refused");
    if (intent.withdrawal?.state === "unknown") throw new TransferPending(intent, "unknown");
  };
  const readIntent = async (funding_plan: boolean) => {
    intent = asked(await client.call("getTransfer", { path: { id: intent.id }, query: { funding_plan }, signal }), { id: intent.id });
    checkIntent();
  };
  /** Whether a take prepared against `preparation` can still be submitted with it: in time for the server to send the withdrawal, and signed already or still signable in time. */
  const sendable = async (preparation: { amount: string; typed_data: Typed }, prepared: Answer<"getV1TakesId">) => {
    const cutoff = atOnceCutoff(prepared) * 1000;
    if (cutoff <= now()) return false;
    if (await store.load(takeKey(prepared.take.id)) !== undefined) return true;
    if (!signableAtOnce(prepared, now() / 1000)) return false;
    try {
      checkWithdrawal(preparation.typed_data, intent.from, signer.address, signer.address, BigInt(preparation.amount), now() / 1000, dexOf(intent));
      return true;
    } catch {
      return false;
    }
  };
  /** Signs a take prepared against `withdrawal` and submits both: a withdrawal refused, or of unknown outcome, never pays it. */
  const signAtOnce = async (prepared: Answer<"postTake">, withdrawal: { amount: string; typed_data: Typed }, extra: Pick<TakeOptions, "balances" | "lock">) => {
    const fills = await take(client, signer, takeInput(intent), { store, signal, prepared, recipient: request.recipient, beforeSigning, now, withdrawal: { ...withdrawal, dex: dexOf(intent) }, ...extra });
    await readIntent(false);
    checkWithdrawalState();
    return fills;
  };
  /** The take already reserved, signed or paid, settled first; a replaced one is priced and taken again. Null when there is none. */
  const recoverTake = async (): Promise<Fill[] | null> => {
    let renewed = false;
    while (intent.take_id) {
      stage("taking");
      let prepared = await client.call("getV1TakesId", { path: { id: intent.take_id }, signal });
      const unsigned = () => prepared.take.fills.length > 0 && prepared.take.fills.every(unsignedReservation);
      const preparation = !intent.withdrawal && !intent.grouped ? intent.withdrawal_preparation : null;
      // Past what it can still be signed by, an Aster transfer's nonce or a withdrawal to send with it included, it is replaced.
      if (unsigned() && prepared.take.fills.some(fill => ["PREPARED", "RESERVED"].includes(fill.state)) && (signableUntil(prepared) * 1000 <= now() || preparation && !await sendable(preparation, prepared))) {
        // Cancellation serializes with acceptance. A late or uncertain signature is never replaced.
        await client.call("deleteTake", { path: { id: intent.take_id }, signal });
        prepared = await client.call("getV1TakesId", { path: { id: intent.take_id }, signal });
      }
      if (!unsigned() || !prepared.take.fills.every(fill => fill.state === "EXPIRED")) {
        if (!prepared.to_sign.length || prepared.take.fills.some(fill => !["PREPARED", "RESERVED"].includes(fill.state))) {
          // Signed with its withdrawal: one refused, or of unknown outcome, never pays it.
          checkWithdrawalState();
          return prepared.take.fills;
        }
        if (preparation) return signAtOnce(prepared, preparation, { lock: options.lock });
        return take(client, signer, takeInput(intent), { store, signal, prepared, recipient: request.recipient, beforeSigning, now, lock: options.lock });
      }
      // A deterministic replacement survives a lost response or a restart, with the same terms. One
      // whose withdrawal was never sent is funded again.
      intent = await replace(`retry:${intent.id}`);
      checkIntent();
      if (!preparation) await store.save(funded(intent.id), true);
      await onIntent?.(intent);
      renewed = !preparation;
    }
    // The original take was already funded: repricing never triggers another withdrawal.
    return renewed ? repriced() : null;
  };
  const recovered = await recoverTake();
  if (recovered) return recovered;
  if (alreadyFunded) return repriced();
  // A replacement recovered above can hold a preparation as stale as the transfer it replaced.
  if (await renewStale()) await announce();
  if (VENUE_SETTLED.has(intent.from)) { stage("taking"); return pay(); }

  /**
   * The take prepared against the withdrawal prepared for it, then signed and submitted with it:
   * the server sends the withdrawal, then the payment as soon as its funds reach the wallet.
   */
  const takeAtOnce = async (withdrawal: { amount: string; typed_data: Typed }, balances?: Answer<"getBalances">) => {
    checkWithdrawal(withdrawal.typed_data, intent.from, signer.address, signer.address, BigInt(withdrawal.amount), now() / 1000, dexOf(intent));
    const run = async () => {
      let prepared: Answer<"postTake">;
      try {
        prepared = await client.call("postTake", { body: takeInput(intent), signal, retry: true });
      } catch (error) {
        // Submitted meanwhile by another run: followed as any other withdrawal, never sent again.
        if (error instanceof LaMargeError && error.reason === "withdrawal_submitted" && await readIntent(false).then(() => intent.withdrawal, () => null)) return null;
        throw error;
      }
      stage("taking");
      return signAtOnce(prepared, withdrawal, { balances });
    };
    return options.lock ? options.lock(run) : run();
  };
  let authorizing = false;
  const checkPlan = () => {
    // A plan the server could not compute fails as its refusal would: code, reason and Retry-After kept.
    const refused = intent.funding_plan ? null : intent.funding_plan_error;
    if (refused) throw new LaMargeError(refused.status, refused.code, refused.message, { reason: refused.reason, venue: refused.venue, step: refused.step,
      retryAfterMs: refused.retry_after === undefined ? undefined : refused.retry_after * 1000 });
    const plan = checkFundingPlan(intent, now());
    insist(request.funding === "venue" || BigInt(plan.withdrawal_amount) === 0n, "Wallet funds do not cover the transfer");
    authorizing = ["required", "pending"].includes(plan.payment_setup);
    return plan;
  };
  const fund = async () => {
    const plan = checkPlan();
    if (!plan.requests.some(item => item.kind === "permit")) return plan;
    stage("funding");
    await submitPermit(client, intent.from, signer, signal, options.beforeSigning, now);
    // The permit waited for its signer: the plan is read again before it decides a withdrawal. One
    // another run recorded meanwhile is waited for as any other.
    if (intent.withdrawal) return;
    await readIntent(true);
    return intent.withdrawal ? undefined : checkPlan();
  };
  checkWithdrawalState();
  let funds = await readFunds();
  let reread = false;
  // Wallet funds are read before the permit too: a transfer they cannot pay signs nothing.
  if (request.funding === "wallet" && !intent.withdrawal) covers(funds);
  // The plan reads the escrow chain when it is answered; a balances read may predate a payment that
  // spent it. It also withdraws at most what a route signed at once may still: the rest is on its way.
  const plan = intent.withdrawal ? undefined : await fund();
  const withdrawal = plan ? BigInt(plan.withdrawal_amount) : 0n;
  // GMX funds sent to the wallet by the signer's transaction, which the plan has yet to see.
  let movedOut = false;
  if (withdrawal > 0n) {
    // Margin leaves the venue only for a take the book can execute now.
    if (!intent.withdrawal_preparation) await reviewQuote(client, takeInput(intent), now(), signal);
    stage("funding");
    try {
      if (plan?.signed_at_once && await store.load(withdrawalKey(intent.id)) === undefined) {
        const preparation = intent.withdrawal_preparation
          ?? { amount: withdrawal.toString(), typed_data: (await client.call("prepareTransferWithdrawal", { path: { id: intent.id }, body: { amount: withdrawal.toString() }, signal })).typed_data };
        insist(BigInt(preparation.amount) === withdrawal, "Funding amount changed; review the transfer again");
        const signed = await takeAtOnce(preparation, funds?.balances);
        if (signed) return signed;
      } else if (OWNER_WITHDRAWS.has(intent.from)) {
        // Its funds leave GMX by the signer's transaction, whose arrival only a fresh read shows.
        insist(funds !== null, "A fresh balance is required; try again shortly");
        await transferOut(signer, intent, withdrawal, store, now, options.beforeSigning);
        movedOut = true;
      } else intent.withdrawal = await withdrawFor(client, signer, intent, withdrawal, store, now, signal, options.beforeSigning);
    } catch (error) {
      // An earlier withdrawal of the route is still arriving: nothing is withdrawn again.
      if (error instanceof LaMargeError && error.reason === "funds_arriving") throw new TransferPending(intent, "arrival_unconfirmed");
      throw error;
    }
    checkWithdrawalState();
    // The plan read before it is no sign of its arrival: the transfer is read again, with its plan once relayed.
    await readIntent(movedOut || intent.withdrawal?.state === "relayed");
    reread = true;
  }
  insist(intent.withdrawal || movedOut || funds !== null, "A fresh balance is required; try again shortly");
  // Only the live funding plan proves arrival or detects funds spent since the balance read.
  // A grouped route may still have funds in transit.
  let arriving: boolean | undefined;
  const waitingForFunds = async () => {
    const { withdrawal, funding_plan, previous_transfer_id: previous } = intent;
    if (withdrawal) return !funds || withdrawal.state !== "relayed" || !funding_plan;
    // The plan reads the chain itself: it needs no withdrawal once the transferOut arrived; the rest, such as
    // a deposit address's sweep, still shows in the spendable balance.
    if (movedOut && (!funding_plan || BigInt(funding_plan.withdrawal_amount) > 0n)) return true;
    if (funding_plan && BigInt(funding_plan.withdrawal_amount) > 0n) {
      arriving ??= movedOut || !!previous && !!(await client.call("getTransfer", { path: { id: previous }, signal })).grouped;
      insist(arriving, request.funding === "wallet" ? "Wallet funds do not cover the transfer" : "Funding amount changed; review the transfer again");
    }
    return !funds || funds.ready < amount;
  };
  const deadline = now() + arrivalWaitMs;
  if (await waitingForFunds()) stage("waiting");
  while (await waitingForFunds()) {
    if (now() >= deadline) throw new TransferPending(intent, "arrival_unconfirmed");
    await sleep(pollMs);
    [, funds] = await Promise.all([readIntent(true), readFunds()]);
    const accepted = await recoverTake();
    if (accepted) return accepted;
    checkWithdrawalState();
    reread = true;
  }
  stage("taking");
  if (!reread) {
    await readIntent(!plan);
    const accepted = await recoverTake();
    if (accepted) return accepted;
  }
  if (!plan && intent.funding_plan) await fund();
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

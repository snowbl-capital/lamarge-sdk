import { LaMargeError, type Client } from "./client.ts";
import type { components } from "./generated/api.ts";
import { checkPaymentRefund, checkRefundLocks, type EscrowLock } from "./protocol/consents.ts";
import { CHAINS, checkTransfer, insist, isPinnedEscrow, same, signedAt, type Dex, type TransferTyped } from "./protocol/protocol.ts";
import { address, array, hex, record, required } from "./protocol/validation.ts";
import { signItems, signTyped, type BeforeSigning, type Hex, type Signer } from "./signer.ts";
import { exclusive, memoryStore, transferTypedData, type SignatureStore } from "./store.ts";

export type Withdrawal = components["schemas"]["Withdrawal"];

/** Checks a withdrawal, or a send to `destination` with `send`, against its terms at `at` seconds and the caller's own checks, then signs it. */
export async function signWithdrawal(signer: Signer, typed: TransferTyped, venue: string, destination: string, amount: bigint, at: number, beforeSigning?: BeforeSigning, send = false, dex?: Dex): Promise<Hex> {
  checkTransfer(typed, venue, signer.address, destination, amount, send, at, dex);
  await beforeSigning?.({ kind: "withdrawal", venue, destination, amount, typed, ...send && !dex && same(destination, signer.address) && venue === "hyperliquid" ? { move: true as const } : {} });
  return signTyped(signer, typed);
}

/**
 * One withdrawal's signature, stored under `key` (with `context`) before its first submission and
 * submitted again after a restart; a stored one is checked at its own signing time. The caller
 * decides when the record may go.
 */
export async function submitWithdrawal(options: {
  key: string; context?: Record<string, unknown>; venue: string; signer: Signer; destination: string; amount: bigint; store: SignatureStore; signal?: AbortSignal | undefined;
  prepare: () => Promise<TransferTyped>; submit: (typed: TransferTyped, signature: `0x${string}`) => Promise<Withdrawal>; beforeSigning?: BeforeSigning | undefined;
  now?: (() => number) | undefined; send?: boolean | undefined; dex?: Dex;
}): Promise<{ result: Withdrawal; saved: Record<string, unknown> }> {
  const { key, venue, signer, destination, amount, store, signal, send = false, dex } = options;
  const stored: unknown = await store.load(key);
  let saved = stored === undefined || record(stored).typed === undefined ? undefined : { typed: transferTypedData(record(stored).typed), signature: hex(record(stored).signature) };
  if (!saved) {
    const typed = await options.prepare();
    saved = { typed, signature: await signWithdrawal(signer, typed, venue, destination, amount, (options.now ?? Date.now)() / 1000, options.beforeSigning, send, dex) };
    signal?.throwIfAborted();
    await store.save(key, { ...options.context, ...saved });
  }
  checkTransfer(saved.typed, venue, signer.address, destination, amount, send, signedAt(saved.typed), dex);
  const kept = { ...options.context, ...saved };
  return { result: await options.submit(saved.typed, saved.signature), saved: kept };
}

/** A withdrawal read back from a store, in the API's shape, or refused. */
function withdrawalOf(value: unknown): Withdrawal {
  const row = record(value);
  const text = (name: string) => { const field = row[name]; insist(typeof field === "string", "Unreadable stored withdrawal"); return field; };
  const optional = (name: string) => row[name] === null ? null : text(name);
  // Withdrawals stored before sends existed carry no kind.
  const kind = row.kind === undefined ? "withdrawal" : text("kind");
  return { id: text("id"), venue: text("venue"), kind, amount: text("amount"), destination: text("destination"), from_dex: row.from_dex === "xyz" ? "xyz" : null, state: text("state"),
    venue_ref: optional("venue_ref"), error: optional("error"), created_at: text("created_at"), relayed_at: optional("relayed_at") };
}

const FINAL = new Set(["relayed", "refused"]);

export interface WithdrawalRequest {
  /** Persist it before the first call and keep it: the same id finds this withdrawal again, never a second one. */
  id: string;
  venue: string;
  amount: bigint;
  /**
   * `signer`, the linked address; `wallet`, its venue wallet; `account`, a send to `recipient`.
   * A standard Hyperliquid account: `xyz` moves from its perps to its own trade.xyz balance,
   * `perps` back from there.
   */
  to: "wallet" | "signer" | "account" | "xyz" | "perps";
  /** With `to: "account"`: another account on the same venue. On Polymarket, its Perps owner (signer) address. */
  recipient?: string;
  /** `xyz`: a standard Hyperliquid account's trade.xyz balance pays a withdrawal or send instead of its perps. */
  dex?: "xyz" | undefined;
}

/**
 * Withdraws exactly `amount` from the signer's Hyperliquid or Polymarket account, or with
 * `to: "account"` sends it to `recipient` on Hyperliquid, Polymarket or Aster; `to: "xyz"` or
 * `"perps"` moves it between a standard Hyperliquid account's perps and trade.xyz. Its signature and
 * outcome stay in `store` under `id`: running the same request again returns the outcome or
 * submits the same signature, and a refused one asks for a new id. Aster relays a withdrawal in a
 * second envelope this flow does not sign yet; a send needs none.
 */
export async function withdraw(client: Client, signer: Signer, request: WithdrawalRequest,
  options: { store?: SignatureStore | undefined; signal?: AbortSignal | undefined; beforeSigning?: BeforeSigning | undefined; now?: (() => number) | undefined } = {}): Promise<Withdrawal> {
  const { id, venue, amount, to, dex } = request;
  const { store = memoryStore(), signal } = options;
  const move = to === "xyz" || to === "perps";
  const send = to === "account" || move;
  insist(venue === "hyperliquid" || venue === "polymarket" && !move || to === "account" && venue === "aster", `Withdrawals from ${venue} are not supported here`);
  insist((to === "account") === (request.recipient !== undefined), "A recipient goes with to: account, and only with it");
  // A send to the signer itself would sign a move between its balances it did not ask for.
  insist(to !== "account" || !same(request.recipient, signer.address), "A send goes to another account");
  insist(!dex || venue === "hyperliquid" && !move, "Only a Hyperliquid withdrawal or send pays from trade.xyz");
  // A move to the perps leaves trade.xyz; one to trade.xyz leaves the perps.
  const from: Dex = to === "perps" ? "xyz" : dex;
  const key = `withdrawal:${id}`;
  return exclusive(store, key, async () => {
    const context = { venue, amount: amount.toString(), to, signer: signer.address.toLowerCase(), ...(to === "account" ? { recipient: required(request.recipient).toLowerCase() } : {}), ...(dex ? { dex } : {}) };
    const stored: unknown = await store.load(key);
    if (stored !== undefined) {
      const known = record(stored);
      insist(Object.entries(context).every(([name, value]) => known[name] === value), `Withdrawal ${id} names another withdrawal`);
      if (typeof known.refused === "string") throw new Error(`Withdrawal ${id} was refused (${known.refused}); use a new id`);
      const outcome = known.result === undefined ? undefined : withdrawalOf(known.result);
      // Queued, submitting or unknown: the same signature, submitted again, reads the current state.
      if (outcome && FINAL.has(outcome.state)) return outcome;
    }
    const balance = (await client.call("getBalances", { signal })).find(row => row.venue === venue);
    insist(balance && same(balance.address, signer.address), "Linked account changed; refresh before signing");
    const destination = required(to === "account" ? request.recipient : to === "wallet" ? balance.venue_wallet : signer.address, "No linked destination wallet");
    const body = { venue, amount: amount.toString(), to, ...(to === "account" ? { recipient: destination } : {}), ...(dex ? { dex } : {}) };
    try {
      const { result, saved } = await submitWithdrawal({
        key, context, venue, signer, destination, amount, store, signal, beforeSigning: options.beforeSigning, now: options.now, send, dex: from,
        prepare: async () => transferTypedData((await client.call("postWithdrawalPrepare", { body, signal })).typed_data),
        submit: (typed, signature) => client.call("postWithdrawal", { body: { venue, typed_data: typed, signature }, signal, retry: true }),
      });
      await store.save(key, { ...saved, result });
      return result;
    } catch (error) {
      if (error instanceof LaMargeError && (error.code === "VENUE_REJECTED" || error.code === "WITHDRAWAL_EXPIRED")) await store.save(key, { ...record(await store.load(key) ?? {}), refused: error.code });
      throw error;
    }
  });
}

/** Reads the escrows, as a viem `PublicClient` per chain id does with `readContract`. */
export type ChainReaders = Record<number, { readContract(request: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; blockTag?: "finalized" | "latest" }): Promise<unknown> }>;

const LOCKS = [{ type: "function", name: "locks", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }, { name: "offerId", type: "bytes32" }, { name: "swapId", type: "bytes32" }],
  outputs: [{ name: "amount", type: "uint256" }, { name: "hashlock", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "refundAt", type: "uint64" }, { name: "state", type: "uint8" }, { name: "dex", type: "uint32" }] }] as const;
const DIGEST = [{ type: "function", name: "refundPaymentDigest", stateMutability: "view",
  inputs: [{ name: "consent", type: "tuple", components: [{ name: "payer", type: "address" }, { name: "swapId", type: "bytes32" }, { name: "deadline", type: "uint256" }] }],
  outputs: [{ type: "bytes32" }] }] as const;
const ZERO = `0x${"0".repeat(64)}` as const;

function lockOf(value: unknown): EscrowLock {
  const fields = array(value);
  insist(fields.length === 6, "Unreadable escrow lock");
  const [amount, hashlock, recipient, refundAt, state, dex] = fields;
  insist(typeof amount === "bigint" && typeof hashlock === "string" && typeof recipient === "string" && typeof refundAt === "bigint" && typeof state === "number" && typeof dex === "number", "Unreadable escrow lock");
  return [amount, hashlock, recipient, refundAt, state, dex];
}

/** What a refund reads of the fill: a REST fill fits. */
export type RefundFill = Pick<components["schemas"]["Fill"], "id" | "role" | "maker_leg" | "payment_leg" | "t2" | "from_venue" | "to_venue" | "maker_recipient"
  | "maker_owner" | "payer" | "swap_id" | "order_id" | "amount_in" | "hashlock" | "deliver_by" | "delivery_hash">;

/**
 * The payment's escrow, read directly: its lock at a finalized block and the consent digest, which
 * an old ABI cannot answer. Consent applies only to a delivery inside a venue, so a server's label
 * cannot authorize giving up a payment an escrow delivered. `escrows`, by venue, names the escrow
 * read, which must be pinned: the consent's domain.
 */
export async function checkEscrowLocks(fill: RefundFill, deadline: number, readers: ChainReaders, escrows: Readonly<Record<string, string | undefined>>): Promise<void> {
  const reader = (venue: string) => required(readers[required(CHAINS[venue], "Unknown venue").id], `No reader for ${venue}'s chain`);
  const escrow = (venue: string) => {
    const named = escrows[venue];
    insist(isPinnedEscrow(venue, named), "API deployment differs from the reviewed deployment");
    return address(named);
  };
  const [payment] = await Promise.all([
    reader(fill.from_venue).readContract({ address: escrow(fill.from_venue), abi: LOCKS, functionName: "locks", args: [address(fill.payer), ZERO, hex(fill.swap_id)], blockTag: "finalized" }),
    // An old ABI cannot answer the consent digest: the call fails.
    reader(fill.from_venue).readContract({ address: escrow(fill.from_venue), abi: DIGEST, functionName: "refundPaymentDigest", args: [{ payer: address(fill.payer), swapId: hex(fill.swap_id), deadline: BigInt(deadline) }] }),
  ]);
  // An escrow destination fails the check: its delivery is never refunded by consent.
  checkRefundLocks(fill, lockOf(payment), null);
}

/**
 * As the maker of a fill abandoned inside its venue, gives the taker's locked payment back before
 * `t2`. Without a reader of the paying chain, nothing is signed; the escrow read is the one the
 * consent names, the deployment's.
 */
export async function refundPayment(client: Client, signer: Signer, fill: RefundFill, readers: ChainReaders, signal?: AbortSignal): Promise<void> {
  const prepared = await client.call("preparePaymentRefund", { path: { id: fill.id }, signal });
  checkPaymentRefund(fill, prepared);
  const escrows = { [fill.from_venue]: required(prepared.to_sign[0]).typed_data.domain.verifyingContract };
  await checkEscrowLocks(fill, prepared.deadline, readers, escrows);
  const [signed] = await signItems(signer, prepared.to_sign);
  await checkEscrowLocks(fill, prepared.deadline, readers, escrows);
  await client.call("submitPaymentRefund", { path: { id: fill.id }, body: { deadline: prepared.deadline, signature: required(signed).signature }, signal, retry: true });
}

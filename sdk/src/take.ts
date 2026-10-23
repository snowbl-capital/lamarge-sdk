import { LaMargeError, type Answer, type Client } from "./client.ts";
import type { components } from "./generated/api.ts";
import { checkAsterTakeIntent, checkLighterTakeIntent, checkTakeIntent, takePaymentKind } from "./protocol/intents.ts";
import { COLLATERAL_ROUTE, fromHex, lighterAccountOwner, transferMessage, USDC_ASSET } from "./protocol/lighter.ts";
import { ASTER_TRANSFER_CHAIN_ID, checkAsterRequest, insist, ROUTE_PAY_WINDOW_SECONDS, same, type Typed } from "./protocol/protocol.ts";
import { isRecord, required } from "./protocol/validation.ts";
import { MAX_PARTS } from "./book.ts";
import { signedItem, signItems, signTyped, type BeforeSigning, type Signer } from "./signer.ts";
import { canonical, memoryStore, signedItems, type SignatureStore } from "./store.ts";
import { signWithdrawal } from "./withdraw.ts";

export type Fill = Answer<"getFills">[number];
export type TakeInput = components["schemas"]["TakeInput"];
export type Balance = Answer<"getBalances">[number];
type Prepared = Answer<"postTake">;
type Item = Prepared["to_sign"][number];
type LighterItem = components["schemas"]["LighterTransferItem"];
type AsterItem = components["schemas"]["AsterTransferItem"];
// Kinds are open strings, so the union narrows through these guards.
const isLighter = (item: Item): item is LighterItem => item.kind === "lighter_transfer";
const isAster = (item: Item): item is AsterItem => item.kind === "aster_transfer";

export interface TakeOptions {
  store?: SignatureStore | undefined;
  signal?: AbortSignal | undefined;
  /** A fresh read of the taker's balances, when the caller already has one. */
  balances?: Balance[] | undefined;
  /** A take reserved earlier, to sign and submit. */
  prepared?: Prepared | undefined;
  /** The account that must receive on `input.to`; the linked one otherwise. */
  recipient?: string | undefined;
  /** Runs on the checked payment before it is first signed, never before submitting a stored one: a check that throws stops the take. */
  beforeSigning?: BeforeSigning | undefined;
  /** The clock the payment's windows are checked against, in milliseconds. */
  now?: (() => number) | undefined;
  /** Runs the whole take inside it, from reserving to submitting: a lock other processes or browser tabs share, so none takes a reservation still being signed for abandoned. */
  lock?: (<T>(run: () => Promise<T>) => Promise<T>) | undefined;
  /** A transfer's prepared withdrawal the take was reserved against: signed before the payment, to the signer, and submitted with it. */
  withdrawal?: { amount: string; typed_data: Typed } | undefined;
}

/** How a payment is checked and signed: at `at` seconds, `payWindow` its longest window, `route` when it is part of a route signed at once. */
export interface PaymentOptions { at: number; signal?: AbortSignal | undefined; before?: BeforeSigning | undefined; payWindow?: number | undefined; route?: boolean | undefined }

/** Each venue pays its own way: the escrow payment, or the one transfer LaMarge sends inside Aster or Lighter once the maker is locked. */
export async function signPayment(client: Client, prepared: Prepared, input: TakeInput, signer: Signer, payer: Balance, recipient: string, options: PaymentOptions) {
  const { take, to_sign } = prepared;
  const { at, signal, before } = options;
  const checked = async () => { await before?.({ kind: "take", input, prepared, ...(options.route ? { route: true as const } : {}) }); };
  insist(to_sign.every(entry => entry.kind === takePaymentKind(input.from)), "The signing request differs from the take's venue");
  const item = required(to_sign[0]);
  // A Lighter account is an index: Lighter itself says whose it is, LaMarge's record of it doesn't.
  if (input.to === "lighter") {
    const [index, ...others] = new Set(take.fills.map(fill => fill.delivery_to));
    insist(others.length === 0 && typeof index === "string" && /^\d+$/.test(index) && same(await lighterAccountOwner(Number(index), signal, client.fetch), recipient), "The take delivers to another account than yours");
  }
  if (isLighter(item)) {
    checkLighterTakeIntent(to_sign, take.fills, input, payer.address, recipient, Number(payer.venue_wallet), at);
    const terms = item.typed_data;
    const [maker, own] = await Promise.all([lighterAccountOwner(terms.to_account_index, signal, client.fetch), lighterAccountOwner(terms.from_account_index, signal, client.fetch)]);
    insist(same(maker, required(take.fills[0]).maker_recipient), "The Lighter transfer pays another account than the maker's");
    insist(same(own, payer.address), "The Lighter transfer pays from another account than yours");
    const message = transferMessage({
      from: terms.from_account_index, apiKey: terms.api_key_index, to: terms.to_account_index, asset: USDC_ASSET, fromRoute: COLLATERAL_ROUTE, toRoute: COLLATERAL_ROUTE,
      amount: BigInt(terms.amount), fee: BigInt(terms.usdc_fee), memo: fromHex(terms.memo), expiredAt: 0, nonce: terms.nonce,
    });
    await checked();
    return [signedItem(item, await signer.signMessage({ message }))];
  }
  if (isAster(item)) {
    checkAsterTakeIntent(to_sign, take.fills, input, payer.address, recipient, at);
    checkAsterRequest(item.typed_data, ASTER_TRANSFER_CHAIN_ID);
    await checked();
    return [signedItem(item, await signTyped(signer, item.typed_data))];
  }
  const typed = to_sign.filter((entry): entry is Exclude<Item, LighterItem | AsterItem> => !isLighter(entry) && !isAster(entry));
  checkTakeIntent(typed, take.fills, input, payer.address, recipient, at, options.payWindow);
  await checked();
  return signItems(signer, typed);
}

/**
 * Reserves `input`'s quotes, checks what the payment would sign against the request and the
 * linked accounts, signs and submits it. The signature is stored before its first submission, so
 * a restart submits it again rather than signing another. `signer` is the account paying on `input.from`.
 */
export async function take(client: Client, signer: Signer, input: TakeInput, options: TakeOptions = {}): Promise<Fill[]> {
  const { lock, ...unlocked } = options;
  if (lock) return lock(() => take(client, signer, input, unlocked));
  const { store = memoryStore(), signal, withdrawal } = options;
  input = { ...input, max_parts: input.max_parts ?? MAX_PARTS };
  insist(!withdrawal || BigInt(withdrawal.amount) > 0n && BigInt(withdrawal.amount) <= BigInt(input.amount_in), "The withdrawal differs from the take it funds");
  const balances = options.balances ?? await client.call("getBalances", { signal });
  const payer = balances.find(balance => balance.venue === input.from);
  const recipient = balances.find(balance => balance.venue === input.to)?.address;
  insist(payer && recipient, "Link both venues first");
  insist(options.recipient === undefined || same(recipient, options.recipient), "Linked account changed; review the transfer again");
  insist(same(payer.address, signer.address), "The signer is not the account paying on this venue");
  const prepared = options.prepared ?? await client.call("postTake", { body: input, signal });
  const { take: reserved, to_sign } = prepared;
  if (!to_sign.length || input.transfer_intent_id && reserved.fills.some(fill => fill.state !== "RESERVED")) return reserved.fills;
  const key = `take:${reserved.id}`;
  // Kept with the request it signs: the same signature never goes with another request.
  const kept: unknown = await store.load(key);
  let signatures = signedItems(isRecord(kept) ? kept.items : kept);
  if (signatures && isRecord(kept)) insist(canonical(kept.to_sign) === canonical(to_sign) && canonical(kept.withdrawal) === canonical(withdrawal?.typed_data), "The take's payment differs from the one already signed");
  if (!signatures) {
    try {
      const at = (options.now ?? Date.now)() / 1000;
      const moved = withdrawal && await signWithdrawal(signer, withdrawal.typed_data, input.from, signer.address, BigInt(withdrawal.amount), at, options.beforeSigning);
      const paid = await signPayment(client, prepared, input, signer, payer, recipient, { at, signal, before: options.beforeSigning, payWindow: withdrawal ? ROUTE_PAY_WINDOW_SECONDS : undefined });
      signatures = moved ? [...paid, { kind: "margin_move", signature: moved }] : paid;
      signal?.throwIfAborted();
      await store.save(key, { items: signatures, to_sign, ...withdrawal ? { withdrawal: withdrawal.typed_data } : {} });
    } catch (error) {
      // A transfer's own recovery decides what happens to its reservation.
      if (!input.transfer_intent_id) await client.call("deleteTake", { path: { id: reserved.id } }).catch(() => null);
      throw error;
    }
  }
  try {
    const { fills } = await client.call("postTakeSignatures", { path: { id: reserved.id }, body: { signatures }, signal, retry: true });
    // Kept until the answer reads as one: a lost or unreadable answer leaves the signature to submit again.
    insist(Array.isArray(fills), "Unreadable answer to the payment");
    await store.delete(key);
    return fills;
  } catch (error) {
    // Expired: none of its signatures was accepted, so they can never be used.
    if (error instanceof LaMargeError && error.code === "TAKE_EXPIRED") await store.delete(key);
    throw error;
  }
}

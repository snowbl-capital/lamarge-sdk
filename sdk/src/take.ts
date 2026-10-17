import { LaMargeError, type Answer, type Client } from "./client.ts";
import type { components } from "./generated/api.ts";
import { checkAsterTakeIntent, checkLighterTakeIntent, checkTakeIntent, takePaymentKind } from "./protocol/intents.ts";
import { COLLATERAL_ROUTE, fromHex, lighterAccountOwner, TAKER_API_KEY, transferMessage, USDC_ASSET } from "./protocol/lighter.ts";
import { ASTER_TRANSFER_CHAIN_ID, checkAsterRequest, insist, same } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { MAX_PARTS } from "./book.ts";
import { signedItem, signItems, signTyped, type Signer } from "./signer.ts";
import { memoryStore, signedItems, type SignatureStore } from "./store.ts";

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
  /** Runs before a new payment signature, never before submitting a stored one: a check that refuses stops the take. */
  beforeSigning?: (() => Promise<void>) | undefined;
}

/** Each venue pays its own way: the escrow payment, or the one transfer LaMarge sends inside Aster or Lighter once the maker is locked. */
async function signPayment(prepared: Prepared, input: TakeInput, signer: Signer, payer: Balance, recipient: string, signal?: AbortSignal) {
  const { take, to_sign } = prepared;
  insist(to_sign.every(entry => entry.kind === takePaymentKind(input.from)), "The signing request differs from the take's venue");
  const item = required(to_sign[0]);
  if (isLighter(item)) {
    checkLighterTakeIntent(to_sign, take.fills, input, payer.address, recipient, Number(payer.venue_wallet));
    const terms = item.typed_data;
    insist(same(await lighterAccountOwner(terms.to_account_index, signal), required(take.fills[0]).maker_recipient), "The Lighter transfer pays another account than the maker's");
    const message = transferMessage({
      from: terms.from_account_index, apiKey: TAKER_API_KEY, to: terms.to_account_index, asset: USDC_ASSET, fromRoute: COLLATERAL_ROUTE, toRoute: COLLATERAL_ROUTE,
      amount: BigInt(terms.amount), fee: BigInt(terms.usdc_fee), memo: fromHex(terms.memo), expiredAt: 0, nonce: terms.nonce,
    });
    return [signedItem(item, await signer.signMessage({ message }))];
  }
  if (isAster(item)) {
    checkAsterTakeIntent(to_sign, take.fills, input, payer.address, recipient);
    checkAsterRequest(item.typed_data, ASTER_TRANSFER_CHAIN_ID);
    return [signedItem(item, await signTyped(signer, item.typed_data))];
  }
  const typed = to_sign.filter((entry): entry is Exclude<Item, LighterItem | AsterItem> => !isLighter(entry) && !isAster(entry));
  checkTakeIntent(typed, take.fills, input, payer.address, recipient);
  return signItems(signer, typed);
}

/**
 * Reserves `input`'s quotes, checks what the payment would sign against the request and the
 * linked accounts, signs and submits it. The signature is stored before its first submission, so
 * a restart submits it again rather than signing another. `signer` is the account paying on `input.from`.
 */
export async function take(client: Client, signer: Signer, input: TakeInput, options: TakeOptions = {}): Promise<Fill[]> {
  const { store = memoryStore(), signal } = options;
  input = { ...input, max_parts: input.max_parts ?? MAX_PARTS };
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
  let signatures = signedItems(await store.load(key));
  if (!signatures) {
    try {
      await options.beforeSigning?.();
      signatures = await signPayment(prepared, input, signer, payer, recipient, signal);
      signal?.throwIfAborted();
      await store.save(key, signatures);
    } catch (error) {
      // A transfer's own recovery decides what happens to its reservation.
      if (!input.transfer_intent_id) await client.call("deleteTake", { path: { id: reserved.id } }).catch(() => null);
      throw error;
    }
  }
  try {
    const { fills } = await client.call("postTakeSignatures", { path: { id: reserved.id }, body: { signatures }, signal, retry: true });
    await store.delete(key);
    return fills;
  } catch (error) {
    // Expired: none of its signatures was accepted, so they can never be used.
    if (error instanceof LaMargeError && error.code === "TAKE_EXPIRED") await store.delete(key);
    throw error;
  }
}

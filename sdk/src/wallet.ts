import type { Client } from "./client.ts";
import { CHAINS, checkPermit, checkRegistry, insist, same } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { signTyped, type BeforeSigning, type Signer } from "./signer.ts";
import { canonical, exclusive, type SignatureStore } from "./store.ts";

/** Explicit funding support, checked against the SDK's pinned escrow-token deployment. */
export async function requireWalletFunding(client: Client, venue: string, signal?: AbortSignal) {
  const venues = await client.call("getVenues", { query: { all: true }, signal });
  const chain = required(venues.find(row => row.id === venue && row.enabled)?.chain, "Funding network unavailable");
  const capability = required(chain.wallet_funding, "Wallet funding unavailable");
  checkRegistry(venue, chain);
  insist(same(capability.token, chain.token) && capability.decimals === chain.decimals, "Funding token changed");
}

/** Fresh, address-based holdings, excluding an own take only when checking that take's signature. */
export async function readWalletFunding(client: Client, venue: string, payer: string, now = Date.now(), signal?: AbortSignal, takeId?: string) {
  const funds = await client.call("getWalletFunding", { path: { venue }, query: { payer, ...takeId ? { take_id: takeId } : {} }, signal });
  checkRegistry(venue, { id: funds.chain_id, escrow: funds.escrow, token: funds.token, decimals: funds.decimals });
  insist(funds.venue === venue && same(funds.address, payer) && funds.chain_id === CHAINS[venue]?.id, "Funding payer changed");
  const age = now - Date.parse(funds.observed_at);
  insist(age >= -15_000 && age < 120_000, "Funding balance unavailable");
  insist(BigInt(funds.spendable_wallet) <= BigInt(funds.wallet) && BigInt(funds.spendable_available) <= BigInt(funds.available), "Invalid funding balance");
  insist(same(funds.payment_setup.address, payer), "Payment permission names another payer");
  return funds;
}

/** The existing unlimited escrow-token permit, journalled before submission and checked independently. */
export async function submitWalletPermit(client: Client, venue: string, signer: Signer, store: SignatureStore,
  signal?: AbortSignal, before?: BeforeSigning, now: () => number = Date.now) {
  const key = `wallet-permit:${venue}:${signer.address.toLowerCase()}`;
  return exclusive(store, key, async () => {
    const current = await client.call("postWalletPermit", { path: { venue }, body: { payer: signer.address }, signal });
    insist(same(current.address, signer.address), "Permit names another payer");
    if (current.authorized || current.pending) { await store.delete(key); return; }
    const permit = required(current.permit, "Payment permission unavailable");
    checkPermit(permit.to_sign, venue, signer.address, 600, now() / 1000);
    const loaded = await store.load(key);
    let signature: string;
    if (loaded !== undefined && record(loaded).id === permit.id) {
      const saved = record(loaded);
      insist(canonical(saved.typed) === canonical(permit.to_sign.typed_data) && typeof saved.signature === "string", "Stored permit terms changed");
      signature = saved.signature;
    } else {
      await before?.({ kind: "setup", venue, step: { step: "permit", status: "required", reason: null, expires_at: null, needed_for: ["pay"],
        hash: null, to_sign: { ...permit.to_sign, ref: permit.id } } });
      signature = await signTyped(signer, permit.to_sign.typed_data);
      await store.save(key, { id: permit.id, typed: permit.to_sign.typed_data, signature });
    }
    const accepted = await client.call("postWalletPermit", { path: { venue }, body: { payer: signer.address, ref: permit.id, signature }, signal, retry: true });
    insist(same(accepted.address, signer.address) && (accepted.authorized || accepted.pending), "Payment authorization failed");
    await store.delete(key);
  });
}

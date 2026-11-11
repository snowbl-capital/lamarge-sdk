import type { Answer, Client } from "./client.ts";
import type { components } from "./generated/api.ts";
import { CHAINS, checkRegistry, insist, same, uint, WALLET_SWAP_MIN_BPS } from "./protocol/protocol.ts";
import { address, required } from "./protocol/validation.ts";
import { walletRefused, type BeforeSigning, type Hex, type Signer } from "./signer.ts";
import { canonical, exclusive, type SignatureStore } from "./store.ts";
import { readWalletFunding } from "./wallet.ts";

export type ConversionInput = components["schemas"]["WalletConversionInput"];
export const POLYGON_FUNDING_CONVERTER = "0x2d31ff03f5da1c385a64d764389962c160e789f8";
export const POLYGON_USDC = required(required(CHAINS.polymarket).walletToken);
export const conversionMinimum = (amount: bigint) => (amount * BigInt(WALLET_SWAP_MIN_BPS) + 9_999n) / 10_000n;
const word = (value: unknown) => { const n = uint(value); insist(n < 1n << 256n, "Invalid conversion integer"); return n.toString(16).padStart(64, "0"); };

export function conversionInput(conversion: ConversionInput | undefined): { conversion?: ConversionInput } {
  return conversion ? { conversion: { amount_in: conversion.amount_in, min_out: conversion.min_out, ...(conversion.id ? { id: conversion.id } : {}) } } : {};
}

export function checkConversion(intent: Answer<"getTransfer">, requested: ConversionInput | undefined) {
  const c = intent.conversion;
  insist(Boolean(c) === Boolean(requested), "Conversion terms changed");
  if (!c || !requested) return;
  insist(intent.from === "polymarket" && intent.funding === "wallet" && c.amount_in === requested.amount_in
    && c.min_out === requested.min_out && intent.amount_in === c.min_out && (!requested.id || c.id === requested.id)
    && uint(c.amount_in) >= 10_000n && uint(c.min_out) >= conversionMinimum(uint(c.amount_in)), "Conversion terms changed");
}

/** One broadcast per durable nonce. Unknown wallet answers remain pending across tabs and devices. */
export async function convertFunding(client: Client, signer: Signer, intent: Answer<"getTransfer">, store: SignatureStore,
  now: () => number, signal?: AbortSignal, before?: BeforeSigning): Promise<boolean> {
  if (!intent.conversion) return true;
  const original = intent.conversion;
  const c = await client.call("prepareTransferConversion", { path: { id: intent.id }, signal, retry: true });
  checkConversion({ ...intent, conversion: c }, original);
  const id = required(c.id, "Conversion identity missing");
  const chain = required(CHAINS.polymarket), escrow = required(c.escrow, "Conversion escrow missing");
  checkRegistry("polymarket", { id: required(c.chain_id), escrow, token: chain.token, decimals: chain.decimals });
  insist(c.chain_id === 137 && same(c.payer, signer.address)
    && same(c.token, POLYGON_USDC) && same(c.converter, POLYGON_FUNDING_CONVERTER), "Conversion deployment changed");
  const nonce = required(c.nonce, "Conversion nonce missing"), deadline = required(c.deadline, "Conversion deadline missing");
  const terms = { id, chain: 137, escrow, payer: c.payer, converter: c.converter, amount: c.amount_in, minOut: c.min_out, nonce, deadline };
  return exclusive(store, `conversion:${id}`, async () => {
    const keys = [`conversion-intent:${intent.id}`, `conversion:${id}:terms`];
    const previous = await Promise.all(keys.map(key => store.load(key)));
    insist(previous.every(value => value === undefined || canonical(value) === canonical(terms)), "Stored conversion changed");
    for (const key of keys) await store.save(key, terms);
    if (c.state === "ready") {
      insist(typeof c.received === "string" && uint(c.received) >= uint(c.min_out) && typeof c.tx_hash === "string", "Conversion receipt missing");
      return true;
    }
    insist(c.state !== "expired", "Conversion expired; review a new transfer");
    const sentKey = `conversion:${id}:sent`;
    const sent = await store.load(sentKey);
    // A confirmed refusal may reprompt this exact nonce locally; it never releases the server fence.
    const retry = sent === false;
    if (typeof sent === "string" && !c.attempts?.some(hash => same(hash, sent))) {
      await client.call("reportTransferConversion", { path: { id: intent.id }, body: { tx_hash: sent }, signal, retry: true });
    }
    if (!retry && (c.state === "pending" || sent !== undefined)) return false;
    insist((c.state === "prepared" || retry && c.state === "pending") && uint(deadline) > BigInt(Math.floor(now() / 1000))
      && uint(deadline) <= BigInt(Math.floor(now() / 1000) + 1815), "Conversion deadline invalid");
    insist(signer.sendTransaction, "This wallet cannot send conversion transactions");
    const venues = await client.call("getVenues", { query: { all: true }, signal });
    const advertised = required(venues.find(v => v.id === "polymarket" && v.enabled)?.chain, "Conversion unavailable");
    checkRegistry("polymarket", advertised);
    insist(same(advertised.escrow, escrow), "Conversion escrow changed");
    const capability = required(advertised.wallet_funding?.conversion, "Conversion unavailable");
    insist(same(capability.converter, POLYGON_FUNDING_CONVERTER) && same(capability.token, POLYGON_USDC)
      && capability.decimals === 6 && capability.min_out_bps === WALLET_SWAP_MIN_BPS, "Conversion capability changed");
    const funding = await readWalletFunding(client, "polymarket", signer.address, now(), signal);
    insist(same(funding.escrow, escrow), "Conversion funding escrow changed");
    const funds = required(funding.conversion, "Native funding balance missing");
    insist(same(funds.token, POLYGON_USDC) && uint(funds.balance) >= uint(c.amount_in), "USDC balance too low");
    if (uint(funds.allowance) < uint(c.amount_in)) {
      const approvalKey = `conversion:${id}:approval`;
      if (await store.load(approvalKey) !== undefined) return false;
      await before?.({ kind: "conversion", step: "approve", amount: uint(c.amount_in), minOut: uint(c.min_out) });
      signal?.throwIfAborted();
      await store.save(approvalKey, true);
      let broadcast = false;
      try {
        const hash = await signer.sendTransaction({ chainId: 137, to: address(POLYGON_USDC),
          data: `0x095ea7b3${word(BigInt(escrow).toString())}${word(c.amount_in)}` }, async hash => {
            broadcast = true;
            await store.save(approvalKey, hash);
          });
        broadcast = true;
        await store.save(approvalKey, hash);
      } catch (error) {
        if (!broadcast && walletRefused(error)) await store.delete(approvalKey);
        throw error;
      }
    }
    await before?.({ kind: "conversion", step: "convert", amount: uint(c.amount_in), minOut: uint(c.min_out) });
    signal?.throwIfAborted();
    // A lost fence response must not prompt again. The server also fences another device.
    await store.save(sentKey, true);
    if (!retry) await client.call("reportTransferConversion", { path: { id: intent.id }, body: {}, signal });
    let broadcast = false;
    const saveHash = async (hash: Hex) => {
      broadcast = true;
      await store.save(sentKey, hash);
      await client.call("reportTransferConversion", { path: { id: intent.id }, body: { tx_hash: hash }, signal, retry: true });
    };
    try {
      const hash = await signer.sendTransaction({ chainId: 137, to: address(escrow),
        data: `0x320a91b1${word(c.amount_in)}${word(c.min_out)}${word(nonce)}${word(deadline)}` }, saveHash);
      await saveHash(hash);
    } catch (error) {
      if (!broadcast && walletRefused(error)) await store.save(sentKey, false);
      throw error;
    }
    return false;
  });
}

import { checkDirectAmounts } from "./protocol/direct.ts";
import type { Client } from "./client.ts";
import { POLYGON_FUNDING_CONVERTER, POLYGON_USDC } from "./conversion.ts";
import type { components } from "./generated/api.ts";
import { CHAINS, checkRegistry, GMX_TRANSFER_ROUTER, gmxTransferOut, insist, same, uint, WALLET_SWAP_MIN_BPS } from "./protocol/protocol.ts";
import { address, hex, required } from "./protocol/validation.ts";
import { walletRefused, type Hex, type Signer } from "./signer.ts";
import { canonical, exclusive, type SignatureStore } from "./store.ts";

export type DirectOperation = components["schemas"]["DirectOperation"];
export type DirectRequest = components["schemas"]["DirectRequest"];
export type DirectSigning = { kind: "direct"; step: "approve" | "deposit" | "withdrawal"; operation: DirectOperation };
export type DirectBeforeSigning = (signing: DirectSigning) => void | Promise<void>;
const identity = (operation: DirectOperation) => ({ id: operation.id, nonce: operation.nonce, deadline: operation.deadline, escrow: operation.escrow.toLowerCase() });
const word = (value: string) => { const n = uint(value); insist(n < 1n << 256n, "Invalid direct amount"); return n.toString(16).padStart(64, "0"); };
const addressWord = (value: string) => address(value).slice(2).toLowerCase().padStart(64, "0");

/** Rebuild the owner-sent transaction; no arbitrary API calldata is signed. */
function directCalldata(operation: DirectOperation): { to: Hex; data: Hex } {
  if (operation.kind === "withdrawal") {
    insist(operation.venue === "gmx" && same(operation.owner, operation.recipient), "Invalid GMX withdrawal");
    return { to: GMX_TRANSFER_ROUTER, data: gmxTransferOut(uint(operation.amount)) };
  }
  insist(operation.kind === "deposit", "Unknown direct operation");
  return { to: address(operation.escrow), data: `0xfc9598e8${addressWord(operation.recipient)}${addressWord(operation.token)}${word(operation.amount)}${word(operation.min_out)}${word(operation.nonce)}${word(operation.deadline)}` };
}

function check(operation: DirectOperation, request: DirectRequest, owner: string) {
  const chain = required(CHAINS[request.venue], "Unknown direct chain");
  checkRegistry(request.venue, { id: operation.chain_id, escrow: operation.escrow, token: chain.token, decimals: chain.decimals });
  insist(operation.client_operation_id === request.client_operation_id && operation.venue === request.venue
    && operation.kind === request.kind && same(operation.owner, owner) && same(request.owner, owner)
    && same(operation.recipient, request.recipient) && same(operation.token, request.token)
    && operation.amount === request.amount && operation.min_out === request.min_out, "Direct operation terms changed");
  const amount = uint(operation.amount), minimum = uint(operation.min_out);
  checkDirectAmounts(request.venue, request.token, amount, minimum, request.kind === "deposit");
  if (operation.state === "confirmed") {
    insist(operation.tx_hash && operation.received && uint(operation.received) >= minimum, "Direct receipt missing");
    hex(operation.tx_hash);
  }
  directCalldata(operation);
}

/**
 * A local deposit or GMX withdrawal, without quotes or makers. Keep the client id and a durable
 * store across restarts. Call again to reconcile pending work; an unknown send is never repeated.
 * Existing venue withdrawals and account sends continue to use `withdraw`.
 */
export async function directTransfer(client: Client, signer: Signer, request: DirectRequest,
  options: { store: SignatureStore; signal?: AbortSignal; beforeSigning?: DirectBeforeSigning; now?: () => number }): Promise<DirectOperation> {
  const { store, signal, beforeSigning } = options, now = options.now ?? Date.now;
  insist(same(request.owner, signer.address), "Direct payer differs from signer");
  const key = `direct:${request.client_operation_id}`;
  return exclusive(store, key, async () => {
    const context = { ...request, owner: request.owner.toLowerCase(), recipient: request.recipient.toLowerCase(), token: request.token.toLowerCase() };
    const previous = await store.load(`${key}:request`);
    insist(previous === undefined || canonical(previous) === canonical(context), "Stored direct request changed");
    await store.save(`${key}:request`, context);
    let operation = await client.call("createDirectOperation", { body: request, signal, retry: true });
    check(operation, request, signer.address);
    const original = identity(operation);
    const prior = await store.load(`${key}:identity`);
    insist(prior === undefined || canonical(prior) === canonical(original), "Direct operation identity changed");
    await store.save(`${key}:identity`, original);
    const path = { id: operation.id };
    const sentKey = `${key}:sent`, sent = await store.load(sentKey);
    if (typeof sent === "string" && !operation.attempts.some(hash => same(hash, sent))) {
      await client.call("reportDirectOperation", { path, body: { tx_hash: sent }, signal, retry: true });
    }
    operation = await client.call("getDirectOperation", { path, signal });
    check(operation, request, signer.address);
    insist(canonical(identity(operation)) === canonical(original), "Direct operation identity changed");
    if (["confirmed", "failed", "expired"].includes(operation.state)) return operation;
    // A known wallet refusal may retry a nonce-protected deposit locally. A GMX withdrawal
    // has no application nonce; only its first fenced prompt may send it.
    const retry = request.kind === "deposit" && sent === false;
    if (!retry && (operation.state !== "prepared" || sent !== undefined)) return operation;
    insist(uint(operation.deadline) > BigInt(Math.floor(now()/1000))
      && uint(operation.deadline) <= BigInt(Math.floor(now()/1000)+1815), "Direct operation expired or deadline changed");
    const chain = required((await client.call("getVenues", { query: { all: true }, signal })).find(v => v.id === request.venue && v.enabled)?.chain, "Direct chain unavailable");
    checkRegistry(request.venue, chain);
    insist(same(chain.escrow, operation.escrow), "Direct capability escrow changed");
    insist(request.kind === "deposit" ? chain.direct_deposit === true : chain.direct_withdrawal === true, "Direct operation unavailable");
    if (!same(request.token, chain.token)) {
      const conversion = required(chain.wallet_funding?.conversion, "Conversion unavailable");
      insist(same(conversion.token, POLYGON_USDC) && same(conversion.converter, POLYGON_FUNDING_CONVERTER)
        && conversion.decimals === 6 && conversion.min_out_bps === WALLET_SWAP_MIN_BPS, "Conversion capability changed");
    }
    const send = required(signer.sendTransaction, "This wallet cannot send direct transactions").bind(signer);
    const readFunds = async () => {
      const funds = await client.call("getDirectFunding", { path, signal });
      insist(same(funds.owner, signer.address) && same(funds.token, request.token) && same(funds.spender, operation.escrow), "Direct funding terms changed");
      const age = now()-Date.parse(funds.observed_at);
      insist(age >= -15_000 && age < 120_000 && uint(funds.balance) >= uint(request.amount), "Direct funds unavailable");
      return funds;
    };
    let funds = await readFunds();
    if (request.kind === "deposit" && uint(funds.allowance) < uint(request.amount)) {
      const approval = `${key}:approval`;
      if (await store.load(approval) !== undefined) return operation;
      await beforeSigning?.({ kind: "direct", step: "approve", operation });
      signal?.throwIfAborted();
      await store.save(approval, true);
      let broadcast = false;
      try {
        const hash = await send({ chainId: operation.chain_id, to: address(request.token),
          data: `0x095ea7b3${addressWord(operation.escrow)}${word(request.amount)}` }, async hash => { broadcast = true; await store.save(approval, hash); });
        broadcast = true; await store.save(approval, hash);
      } catch (error) {
        if (!broadcast && walletRefused(error)) await store.delete(approval);
        throw error;
      }
      funds = await readFunds();
      if (uint(funds.allowance) < uint(request.amount)) return operation;
    }
    await beforeSigning?.({ kind: "direct", step: request.kind, operation });
    signal?.throwIfAborted();
    await store.save(sentKey, true);
    if (!retry) await client.call("reportDirectOperation", { path, body: {}, signal });
    let broadcast = false;
    let reported: Hex | undefined;
    const saveHash = async (hash: Hex) => {
      broadcast = true;
      if (reported && same(reported, hash)) return;
      await store.save(sentKey, hash);
      await client.call("reportDirectOperation", { path, body: { tx_hash: hash }, signal, retry: true });
      reported = hash;
    };
    try {
      const hash = await send({ chainId: operation.chain_id, ...directCalldata(operation) }, saveHash);
      await saveHash(hash);
    } catch (error) {
      if (!broadcast && walletRefused(error)) await store.save(sentKey, false);
      throw error;
    }
    const result = await client.call("getDirectOperation", { path, signal });
    check(result, request, signer.address);
    insist(canonical(identity(result)) === canonical(original), "Direct operation identity changed");
    return result;
  });
}

/** Narrow allowlist for an own-account direct call; useful in a browser or isolated key service. */
export function inspectDirectTransaction(transaction: { chainId: number; to: string; data: string }, owner: string, now = Date.now()): {
  step: "approve" | "deposit" | "withdrawal" | "convert"; venue: "hyperliquid" | "polymarket" | "gmx";
  token: string; recipient: string; amount: bigint; minimum: bigint;
} {
  address(owner);
  const venue = (["hyperliquid", "polymarket", "gmx"] as const).find(venue => CHAINS[venue]?.id === transaction.chainId);
  insist(venue, "Unsupported direct chain");
  const chain = required(CHAINS[venue]);
  const data = hex(transaction.data).toLowerCase();
  const tokenAllowed = (token: string) => same(token, chain.token) || venue === "polymarket" && same(token, POLYGON_USDC);
  const read = (index: number) => required(data.slice(10 + index*64, 74 + index*64));
  const readAddress = (index: number) => { const value = read(index); insist(value.startsWith("0".repeat(24)), "Invalid address encoding"); return address(`0x${value.slice(24)}`); };
  const readAmount = (index: number) => BigInt(`0x${read(index)}`);
  if (data.startsWith("0x095ea7b3") && data.length === 138 && tokenAllowed(transaction.to)) {
    checkRegistry(venue, { ...chain, escrow: readAddress(0), permit: undefined });
    const amount = readAmount(1);
    insist(amount > 0n, "Empty direct approval");
    return { step: "approve", venue, token: transaction.to, recipient: owner, amount, minimum: 0n };
  }
  if (data.startsWith("0xfc9598e8") && data.length === 394) {
    checkRegistry(venue, { ...chain, escrow: transaction.to, permit: undefined });
    const recipient = readAddress(0), token = readAddress(1), amount = readAmount(2), minimum = readAmount(3), deadline = readAmount(5);
    insist(same(recipient, owner), "Invalid direct recipient");
    checkDirectAmounts(venue, token, amount, minimum, true);
    insist(deadline > BigInt(Math.floor(now/1000)) && deadline <= BigInt(Math.floor(now/1000)+1815), "Invalid direct deadline");
    return { step: "deposit", venue, token, recipient, amount, minimum };
  }
  if (venue === "polymarket" && data.startsWith("0x320a91b1") && data.length === 266) {
    checkRegistry(venue, { ...chain, escrow: transaction.to, permit: undefined });
    const amount = readAmount(0), minimum = readAmount(1), deadline = readAmount(3);
    checkDirectAmounts(venue, POLYGON_USDC, amount, minimum, true);
    insist(deadline > BigInt(Math.floor(now/1000)) && deadline <= BigInt(Math.floor(now/1000)+1815), "Invalid conversion deadline");
    return { step: "convert", venue, token: POLYGON_USDC, recipient: owner, amount, minimum };
  }
  if (venue === "gmx" && same(transaction.to, GMX_TRANSFER_ROUTER) && data.length === 458) {
    const amount = readAmount(2);
    insist(amount > 0n && data === gmxTransferOut(amount), "Invalid GMX withdrawal");
    return { step: "withdrawal", venue, token: chain.token, recipient: owner, amount, minimum: amount };
  }
  throw new Error("Unsupported direct transaction");
}

export { POLYGON_USDC } from "./conversion.ts";

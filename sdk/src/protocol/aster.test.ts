import { expect, test } from "bun:test";
import { required, checkAsterTakeIntent, checkTakeIntent, type TakeFill, ASTER_CHAIN_ID, ASTER_TRANSFER_CHAIN_ID, asterRequest, CHAINS, ESCROW, EIP712Domain, checkAsterApproval, checkEscrowTyped, checkWithdrawal, escrowOf, schemas, withdrawalCost, type SignItem, type Typed } from "./index.ts";

const owner = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";
const now = 1_791_220_981;
const nobody = "0x0000000000000000000000000000000000000000";

/** BSC, Aster's vault and its USDT, 18 decimals: the terms Aster settles in, inside itself. */
const pinned = () => required(CHAINS.aster);
const USDT = 10n ** 18n;

function action(message: Record<string, unknown> = {}): Typed {
  return {
    types: { EIP712Domain, ...schemas.Action }, primaryType: "Action",
    domain: { name: "Aster", version: "1", chainId: ASTER_CHAIN_ID, verifyingContract: nobody },
    message: { type: "Withdraw", destination: owner, "destination Chain": "BSC", token: "USDT", amount: "10.11", fee: "0.11", nonce: String(BigInt(now) * 1_000_000n), "aster chain": "Mainnet", ...message },
  };
}

test("an Aster withdrawal is pinned to the account, BSC, USDT, a bounded fee and a fresh nonce", () => {
  pinned();
  expect(() => checkWithdrawal(action(), "aster", owner, owner, 10n * USDT, now)).not.toThrow();
  expect(withdrawalCost("aster", action())).toBe(10n * USDT);
  const refused: [Record<string, unknown>, bigint][] = [
    [{ amount: "10.1" }, 10n * USDT],
    [{ fee: "2.000001", amount: "12.000001" }, 10n * USDT],
    [{ destination: agent }, 10n * USDT],
    [{ "destination Chain": "Arbitrum" }, 10n * USDT],
    [{ token: "USDC" }, 10n * USDT],
    [{ type: "Transfer" }, 10n * USDT],
    [{ "aster chain": "Testnet" }, 10n * USDT],
    [{ nonce: String((BigInt(now) - 61n) * 1_000_000n) }, 10n * USDT],
    [{}, 10_110_000_000_000_000_000n],
    [{}, 10_000_000n],
  ];
  for (const [patch, amount] of refused) expect(() => checkWithdrawal(action(patch), "aster", owner, owner, amount, now)).toThrow();
  const elsewhere = action();
  elsewhere.domain.chainId = 42161;
  expect(() => checkWithdrawal(elsewhere, "aster", owner, owner, 10n * USDT, now)).toThrow();
  expect(() => checkWithdrawal(action(), "aster", owner, agent, 10n * USDT, now)).toThrow();
});

test("Aster signs quote sets in its own domain; its former escrow only ends what it holds", () => {
  const chain = pinned();
  const typed = (primaryType: string, verifyingContract: string): Typed => ({ types: { EIP712Domain, ...required(schemas[primaryType]) }, primaryType, domain: { name: "LaMarge", version: "1", chainId: chain.id, verifyingContract }, message: Object.fromEntries(required(schemas[primaryType]?.[primaryType]).map(field => [field.name, "0"])) });
  expect(escrowOf("aster")).toBe(ESCROW);
  expect(escrowOf("hyperliquid")).toBe(ESCROW);
  expect(() => checkEscrowTyped(typed("QuoteSet", chain.escrow), "aster")).not.toThrow();
  expect(() => checkEscrowTyped(typed("QuoteSet", ESCROW), "aster")).toThrow("Unexpected signing domain");
  expect(() => checkEscrowTyped(typed("CloseOffer", ESCROW), "aster")).not.toThrow();
  expect(() => checkEscrowTyped(typed("CloseOffer", chain.escrow), "aster")).toThrow("Unexpected signing domain");
  for (const primary of ["FundOffer", "PayTake"]) for (const escrow of [chain.escrow, ESCROW]) expect(() => checkEscrowTyped(typed(primary, escrow), "aster")).toThrow("Unexpected signing request");
});

test("a take into Aster names its own escrow", () => {
  const chain = pinned();
  const hyper = required(CHAINS.hyperliquid);
  const fill: TakeFill = { id: "fill-1", order_id: `0x${"cd".repeat(32)}`, sequence: 1, role: "taker", from_venue: "hyperliquid", to_venue: "aster", amount_in: "1000000", amount_out: USDT.toString(), payer: owner, maker_recipient: agent, taker_recipient: owner, swap_id: `0x${"ef".repeat(32)}`, hashlock: `0x${"bb".repeat(32)}`, pay_by: new Date((now + 45) * 1000).toISOString(), t1: new Date((now + 3600) * 1000).toISOString(), t2: new Date((now + 7200) * 1000).toISOString() };
  const payment = (escrow: string): SignItem => ({ kind: "pay_take", fill_id: fill.id, signer: owner, typed_data: { types: { EIP712Domain, ...schemas.PayTake }, primaryType: "PayTake", domain: { name: "LaMarge", version: "1", chainId: hyper.id, verifyingContract: hyper.escrow }, message: { payer: owner, deposit: "1000000", payments: [{ payer: owner, swapId: fill.swap_id, recipient: agent, amount: "1000000", hashlock: fill.hashlock, refundAt: now + 7200, deadline: now + 45, orderId: fill.order_id, sequence: 1, amountOut: USDT.toString(), receiveChainId: chain.id, receiveToken: chain.token, receiveEscrow: escrow, receiveRecipient: owner, dex: 0 }] } } });
  const take = { from: "hyperliquid", to: "aster", amount_in: "1000000", min_out: USDT.toString() };
  expect(() => checkTakeIntent([payment(chain.escrow)], [fill], take, owner, owner, now)).not.toThrow();
  expect(() => checkTakeIntent([payment(agent)], [fill], take, owner, owner, now)).toThrow();
});

test("an agent approval is LaMarge's, for this address, only moving margin to Spot, for a year", () => {
  const nonce = String(BigInt(now) * 1_000_000n + 42n);
  const expired = String(BigInt(now) * 1000n + 365n * 86_400_000n);
  const message = (patch: Record<string, string> = {}, extra = "") => {
    const fields: Record<string, string> = { user: owner, nonce, agentName: "LaMarge", agentAddress: agent, expired, signatureChainId: "56", canSpotTrade: "false", canPerpTrade: "true", canWithdraw: "false", ...patch };
    return Object.entries(fields).map(([key, value]) => `${key}=${value}`).join("&") + extra;
  };
  const challenge = (msg: string, typedMsg = msg) => ({ message: msg, nonce, expires_at: "2026-10-05T18:00:00Z", typed_data: { types: { EIP712Domain, ...schemas.Message }, primaryType: "Message", domain: { name: "AsterSignTransaction", version: "1", chainId: ASTER_CHAIN_ID, verifyingContract: nobody }, message: { msg: typedMsg } } as Typed });
  expect(() => checkAsterApproval(challenge(message()), owner, now * 1000)).not.toThrow();
  expect(() => checkAsterApproval(challenge(message({}, "&ipWhitelist=1.2.3.4 10.0.0.0/24")), owner, now * 1000)).not.toThrow();
  expect(() => checkAsterApproval(challenge(message({ agentName: "LaMargeDev" })), owner, now * 1000)).not.toThrow();
  for (const bad of [
    message({ canWithdraw: "true" }), message({ canPerpTrade: "false" }), message({ canSpotTrade: "true" }), message({}, "&ipWhitelist="), message({ user: agent }), message({ agentName: "Other" }),
    message({ agentName: "@aster-desktop" }), message({ agentName: "LaMargeProd" }), message({ agentName: "LaMargeWithdrawal" }),
    message({ agentAddress: owner }), message({ signatureChainId: "42161" }), message({ expired: String(BigInt(expired) + 1n) }),
    message({ nonce: String(BigInt(nonce) + 61_000_000n) }), message({}, "&agentCode=ref"), message({}, "&ipWhitelist=1.2.3.4&extra=1"),
  ]) expect(() => checkAsterApproval(challenge(bad), owner, now * 1000)).toThrow();
  expect(() => checkAsterApproval(challenge(message(), message({ canWithdraw: "true" })), owner, now * 1000)).toThrow();
  const elsewhere = challenge(message());
  elsewhere.typed_data.domain.chainId = 42161;
  expect(() => checkAsterApproval(elsewhere, owner, now * 1000)).toThrow();
  expect(() => checkAsterApproval({ ...challenge(message()), typed_data: undefined }, owner, now * 1000)).toThrow();
});

test("a take paid from Aster signs one transfer of its amount to the maker, under its fill id, its nonce about a minute ahead", () => {
  const maker = "0x14791697260E4c9A71f18484C9f997B308e59325";
  const fill: TakeFill = { id: "0192f0a1-b2c3-7d4e-8f90-a1b2c3d4e5f6", order_id: `0x${"cd".repeat(32)}`, sequence: 1, role: "taker", from_venue: "aster", to_venue: "hyperliquid", amount_in: "1500000000000000001", amount_out: "1000000", payer: owner, maker_recipient: maker, taker_recipient: owner, swap_id: `0x${"ef".repeat(32)}`, hashlock: `0x${"bb".repeat(32)}`, pay_by: new Date((now + 45) * 1000).toISOString(), t1: new Date((now + 3600) * 1000).toISOString(), t2: new Date((now + 7200) * 1000).toISOString() };
  const nonce = String(BigInt(now + 55) * 1_000_000n);
  const fields = { asset: "USDT", amount: "1.500001", toAddress: maker, clientTranId: "0192f0a1b2c37d4e8f90a1b2c3d4e5f6", nonce, user: owner };
  const item = (patch: Record<string, string> = {}, extra = "", chainId = ASTER_TRANSFER_CHAIN_ID): SignItem => ({ kind: "aster_transfer", signer: owner, fill_id: fill.id, typed_data: {
    types: { EIP712Domain, ...schemas.Message }, primaryType: "Message", domain: { name: "AsterSignTransaction", version: "1", chainId, verifyingContract: nobody },
    message: { msg: Object.entries({ ...fields, ...patch }).map(([name, value]) => `${name}=${value}`).join("&") + extra } } });
  const take = { from: "aster", to: "hyperliquid", amount_in: fill.amount_in, min_out: "1000000" };
  expect(() => checkAsterTakeIntent([item()], [fill], take, owner, owner, now)).not.toThrow();
  for (const bad of [
    item({ amount: "1.5" }), item({ amount: "1.500002" }), item({ amount: "1.5000011" }), item({ asset: "USDC" }), item({ toAddress: agent }), item({ user: agent }),
    item({ clientTranId: "0".repeat(32) }), item({ nonce: String(BigInt(now + 10) * 1_000_000n) }), item({ nonce: String(BigInt(now + 80) * 1_000_000n) }),
    item({}, "&signer=" + owner), item({}, "", ASTER_CHAIN_ID), { ...item(), kind: "lighter_transfer" }, { ...item(), signer: agent }, { ...item(), fill_id: "other" },
  ]) expect(() => checkAsterTakeIntent([bad], [fill], take, owner, owner, now)).toThrow();
  expect(() => checkAsterTakeIntent([item(), item()], [fill], take, owner, owner, now)).toThrow("one transfer");
  expect(() => checkAsterTakeIntent([item()], [fill, { ...fill, id: "other" }], take, owner, owner, now)).toThrow("one transfer");
  expect(() => checkAsterTakeIntent([item()], [fill], take, owner, owner, now + 60)).toThrow();
});

test("an Aster transfer never pays a take from another venue", () => {
  // Hyperliquid to Polymarket, 1 USDC: an Aster request for 0.000001 USDT must not stand for its payment.
  const maker = "0x14791697260E4c9A71f18484C9f997B308e59325";
  const fill: TakeFill = { id: "0192f0a1-b2c3-7d4e-8f90-a1b2c3d4e5f6", order_id: `0x${"cd".repeat(32)}`, sequence: 1, role: "taker", from_venue: "hyperliquid", to_venue: "polymarket", amount_in: "1000000", amount_out: "1000000", payer: owner, maker_recipient: maker, taker_recipient: owner, swap_id: `0x${"ef".repeat(32)}`, hashlock: `0x${"bb".repeat(32)}`, pay_by: new Date((now + 45) * 1000).toISOString(), t1: new Date((now + 3600) * 1000).toISOString(), t2: new Date((now + 7200) * 1000).toISOString() };
  const msg = `asset=USDT&amount=0.000001&toAddress=${maker}&clientTranId=0192f0a1b2c37d4e8f90a1b2c3d4e5f6&nonce=${String(BigInt(now + 55) * 1_000_000n)}&user=${owner}`;
  const item: SignItem = { kind: "aster_transfer", signer: owner, fill_id: fill.id, typed_data: asterRequest(msg, ASTER_TRANSFER_CHAIN_ID) };
  expect(() => checkAsterTakeIntent([item], [fill], { from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000" }, owner, owner, now)).toThrow();
});

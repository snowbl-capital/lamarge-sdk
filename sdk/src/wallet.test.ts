import { expect, test } from "bun:test";
import { countingSigner, mockApi } from "./mock.test.ts";
import { CHAINS, EIP712Domain, schemas, UNLIMITED_ALLOWANCE } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { memoryStore } from "./store.ts";
import { readWalletFunding, requireWalletFunding, submitWalletPermit } from "./wallet.ts";

const owner = `0x${"11".repeat(20)}` as const;
const other = `0x${"22".repeat(20)}`;
const pin = required(CHAINS.hyperliquid);
const now = 1_800_000_000_000;
const held = () => ({ venue: "hyperliquid", address: owner, chain_id: pin.id, escrow: pin.escrow, token: pin.token, decimals: 6, symbol: "USDC",
  wallet: "12", available: "4", committed_wallet: "2", committed_available: "1", spendable_wallet: "10", spendable_available: "3",
  block: 1, observed_at: new Date(now).toISOString(), payment_setup: { address: owner, authorized: true, pending: false, permit: null, hash: null } });
const permission = () => ({ address: owner, authorized: false, pending: false, hash: null, permit: { id: "permit-1", to_sign: { kind: "permit", signer: owner,
  typed_data: { types: { EIP712Domain, ...schemas.Permit }, primaryType: "Permit",
    domain: { name: required(pin.permit), version: pin.version, chainId: pin.id, verifyingContract: pin.token },
    message: { owner, spender: pin.escrow, value: UNLIMITED_ALLOWANCE.toString(), nonce: "1", deadline: String(now / 1000 + 300) } } } } });

test("wallet reads bind the payer, token, deployment and fresh observation; an own take is explicit", async () => {
  const queries: string[] = [];
  let patch: Record<string, unknown> = {};
  const { client } = mockApi({ "GET /v1/wallets/hyperliquid": (_, query) => { queries.push(query.toString()); return { ...held(), ...patch }; } });
  expect((await readWalletFunding(client, "hyperliquid", owner, now, undefined, "take-1")).spendable_available).toBe("3");
  expect(queries[0]).toContain("take_id=take-1");
  for (const changed of [{ address: other }, { token: other }, { escrow: other }, { observed_at: new Date(now - 120_000).toISOString() },
    { observed_at: new Date(now + 16_000).toISOString() }, { spendable_wallet: "13" }, { payment_setup: { ...held().payment_setup, address: other } }]) {
    patch = changed;
    await expect(readWalletFunding(client, "hyperliquid", owner, now)).rejects.toThrow();
  }
});

test("new wallet funding fails closed when the server does not advertise support", async () => {
  const { client } = mockApi({ "GET /v1/venues": () => [{ id: "hyperliquid", enabled: true, chain: { ...pin, permit: undefined } }] });
  await expect(requireWalletFunding(client, "hyperliquid")).rejects.toThrow("Wallet funding unavailable");
});

test("an unanswered permit submission replays the saved signature after reconnect", async () => {
  let unavailable = true;
  const { client, bodies } = mockApi({ "POST /v1/wallets/hyperliquid/permit": body => {
    if (!body.signature) return permission();
    if (unavailable) throw new TypeError("lost permit response");
    return { ...permission(), pending: true, permit: null };
  } });
  const signer = countingSigner(owner), store = memoryStore();
  await expect(submitWalletPermit(client, "hyperliquid", signer, store, undefined, undefined, () => now)).rejects.toThrow("lost permit response");
  expect(signer.signed).toBe(1);
  unavailable = false;
  await submitWalletPermit(client, "hyperliquid", signer, store, undefined, undefined, () => now);
  expect(signer.signed).toBe(1);
  const signed = bodies["POST /v1/wallets/hyperliquid/permit"]?.filter(body => body.signature);
  expect(signed?.every(body => body.ref === "permit-1" && body.signature === "0x00")).toBe(true);
  expect(await store.load(`wallet-permit:hyperliquid:${owner}`)).toBeUndefined();
});

test("a wallet permit cannot authorize another spender", async () => {
  const value = permission();
  value.permit.to_sign.typed_data.message.spender = other;
  const { client } = mockApi({ "POST /v1/wallets/hyperliquid/permit": () => value });
  const signer = countingSigner(owner);
  await expect(submitWalletPermit(client, "hyperliquid", signer, memoryStore(), undefined, undefined, () => now)).rejects.toThrow();
  expect(signer.signed).toBe(0);
});

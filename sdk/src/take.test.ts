import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { bybit, mockApi } from "./mock.test.ts";
import { WALLET_FEE_ON_DELIVERY } from "./protocol/fees.ts";
import { checkLighterTakeIntent, type TakeFill } from "./protocol/intents.ts";
import { CHAINS } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { fillMemo, transferMessage } from "./protocol/lighter.ts";
import { memoryStore } from "./store.ts";
import { take, takeKey } from "./take.ts";

const owner = privateKeyToAccount(`0x${"44".repeat(32)}`);
const fill = "018f8d98-f485-7f48-9630-e0b7368fe28f";
const memo = fillMemo(fill);
const maker = "0x00000000000000000000000000000000000000aa";
const terms = { api_key_index: 254, from_account_index: 42, to_account_index: 731033, amount: "2001300", usdc_fee: "0", memo, nonce: 7 };
const message = transferMessage({ from: 42, apiKey: 254, to: 731033, asset: 3, fromRoute: 0, toRoute: 0, amount: 2001300n, fee: 0n,
  memo: Uint8Array.from(Buffer.from(memo, "hex")), expiredAt: 0, nonce: 7 });
const item = { kind: "lighter_transfer", signer: owner.address, fill_id: fill, typed_data: terms };
const input = { from: "lighter", to: "hyperliquid", amount_in: "2001300", min_out: "0", client_take_id: "take-client" };
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const reserved = { id: fill, take_id: "take-1", order_id: "0x01", sequence: 1, role: "taker", state: "PREPARED", from_venue: "lighter", to_venue: "hyperliquid", amount_in: "2001300", amount_out: "2000000",
  payer: owner.address, maker_owner: maker, maker_recipient: maker, taker_recipient: owner.address, taker_fee: "0", swap_id: "0x02", hashlock: "0x03", pay_by: at(40_000), t1: at(3_600_000), t2: at(7_200_000),
  signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_to: null, delivery_hash: null };

/** A take paid from the Lighter account #42, the API and Lighter itself answering; `owners` is whose account each index is, as Lighter says. `taken` adds to the reserved take, `linked` the accounts beside #42. */
function lighter(owners: Record<number, string> = { 42: owner.address, 731033: maker }, asked: object = item, taken: Record<string, unknown> = {}, linked = [{ venue: "hyperliquid", address: owner.address, venue_wallet: null }]) {
  const { client, calls } = mockApi({
    "GET /api/v1/account": (_, query) => ({ accounts: [{ index: Number(query.get("value")), l1_address: owners[Number(query.get("value"))] }] }),
    "GET /v1/balances": () => [{ venue: "lighter", address: owner.address, venue_wallet: "42" }, ...linked],
    "POST /v1/takes": () => ({ take: { id: "take-1", fills: [reserved], ...taken }, to_sign: [asked] }),
    "POST /v1/takes/take-1/signatures": () => ({ fills: [{ ...reserved, state: "PAID" }] }),
    "DELETE /v1/takes/take-1": () => null,
  });
  const messages: string[] = [];
  const contexts: unknown[] = [];
  const signer = { address: owner.address, signTypedData: owner.signTypedData, signMessage: ({ message }: { message: string }, context?: unknown) => { messages.push(message); contexts.push(context); return owner.signMessage({ message }); } };
  return { client, calls, messages, contexts, signer };
}

test("a take paid from Lighter signs the transfer message its terms build, once Lighter confirms both accounts", async () => {
  const { client, messages, signer } = lighter();
  expect((await take(client, signer, input)).map(row => row.state)).toEqual(["PAID"]);
  expect(messages).toEqual([message]);
  // An account Lighter says is not the maker's is never signed for, nor one paying from someone else's.
  for (const owners of [{ 42: owner.address, 731033: owner.address }, { 42: maker, 731033: maker }]) {
    const other = lighter(owners);
    await expect(take(other.client, other.signer, input)).rejects.toThrow(/another account than the maker's|from another account than yours/);
    expect(other.messages).toEqual([]);
    expect(other.calls).toContain("DELETE /v1/takes/take-1");
  }
});

test("a take runs inside the caller's lock, from its first read to its submission", async () => {
  const { client, calls, signer } = lighter();
  const inside: string[][] = [];
  await take(client, signer, input, { lock: async run => { inside.push([...calls]); const result = await run(); inside.push([...calls]); return result; } });
  expect(inside).toEqual([[], ["GET /v1/balances", "POST /v1/takes", "POST /v1/takes/take-1/signatures"]]);
});

test("a take paid from Lighter checks its one transfer against the reserved fill", () => {
  const fills: TakeFill[] = [reserved];
  const check = (items: Parameters<typeof checkLighterTakeIntent>[0], rows = fills, request = input, account = 42) => checkLighterTakeIntent(items, rows, request, owner.address, owner.address, account);
  check([item]);
  expect(() => check([item], fills, input, 43)).toThrow("differs from the take");
  expect(() => check([{ ...item, typed_data: { ...terms, amount: "2001301" } }])).toThrow("differs from the take");
  expect(() => check([{ ...item, typed_data: { ...terms, memo: "00".repeat(32) } }])).toThrow("differs from the take");
  expect(() => check([item, item])).toThrow("one transfer");
  expect(() => check([item], [reserved, { ...reserved, id: "other" }])).toThrow("one transfer");
  expect(() => check([item], fills, { ...input, from: "aster" })).toThrow("take's venue");
  // LaMarge's key in development, never another slot of the account.
  check([{ ...item, typed_data: { ...terms, api_key_index: 253 } }]);
  expect(() => check([{ ...item, typed_data: { ...terms, api_key_index: 4 } }])).toThrow("Unexpected Lighter key");
  check([{ ...item, typed_data: { ...terms, usdc_fee: "1000000" } }]);
  expect(() => check([{ ...item, typed_data: { ...terms, usdc_fee: "1000001" } }])).toThrow("above 1 USDC");
});

const attestation = (byte: string) => ({ signature: `0x${byte.repeat(65)}`, terms: { take: `0x${"01".repeat(32)}`, from: "lighter", to: "hyperliquid", recipient: owner.address, token: `0x${"02".repeat(20)}`, amountOut: "2000000", payBy: 1 } });

test("a take hands its signer the attestation of each request", async () => {
  const { client, contexts, signer } = lighter(undefined, { ...item, attestation: attestation("aa") });
  await take(client, signer, input);
  expect(contexts).toEqual([{ attestation: attestation("aa") }]);
});

test("a take resumes its kept signature when only LaMarge's attestation of the request changed", async () => {
  const store = memoryStore();
  const kept = { items: [{ kind: "lighter_transfer", fill_id: fill, signature: `0x${"cc".repeat(65)}` }] };
  await store.save(takeKey("take-1"), { ...kept, to_sign: [{ ...item, attestation: attestation("aa") }] });
  const resumed = lighter(undefined, { ...item, attestation: attestation("bb") });
  expect((await take(resumed.client, resumed.signer, input, { store })).map(row => row.state)).toEqual(["PAID"]);
  expect(resumed.messages).toEqual([]);
  // Another request is another payment: the kept signature never goes with it.
  await store.save(takeKey("take-1"), { ...kept, to_sign: [{ ...item, typed_data: { ...terms, amount: "1" } }] });
  const other = lighter(undefined, { ...item, attestation: attestation("bb") });
  await expect(take(other.client, other.signer, input, { store })).rejects.toThrow("differs from the one already signed");
});

const toWallet = { ...input, destination: "wallet", recipient: bybit };
const delivered = { ...reserved, destination: "wallet", swap_id: `${WALLET_FEE_ON_DELIVERY}${"00".repeat(26)}`, taker_recipient: bybit };
const least = (amount: string) => ({ fills: [delivered], minimum_received: { token: required(CHAINS.hyperliquid?.walletToken), amount } });

test("a take to a wallet pays the address it names, with no account linked where it ends", async () => {
  const { client, calls, messages, signer } = lighter(undefined, item, least("2000000"), []);
  expect((await take(client, signer, toWallet)).map(row => row.state)).toEqual(["PAID"]);
  expect(messages).toEqual([message]);
  expect(calls).toContain("POST /v1/takes");
  // Into a venue the same take needs that account; to a wallet, the address and a pinned destination, before any request.
  await expect(take(lighter(undefined, item, {}, []).client, signer, input)).rejects.toThrow("Link both venues first");
  for (const [asked, error] of [[{ ...input, destination: "wallet" }, "Invalid recipient"], [{ ...toWallet, to: "aster" }, "No wallet destination on aster"]] as const) {
    const refused = lighter(undefined, item, {}, []);
    await expect(take(refused.client, refused.signer, asked)).rejects.toThrow(error);
    expect(refused.calls).toEqual([]);
  }
  // A least received other than the escrow's is refused before anything is signed.
  const short = lighter(undefined, item, least("1999999"), []);
  await expect(take(short.client, short.signer, toWallet)).rejects.toThrow("minimum_received");
  expect(short.messages).toEqual([]);
});

test("a take paid from Lighter to a wallet is checked against the address and the kind it asked", () => {
  const check = (fill: TakeFill, request: Parameters<typeof checkLighterTakeIntent>[2] = toWallet, recipient = bybit) => () => checkLighterTakeIntent([item], [fill], request, owner.address, recipient, 42);
  expect(check(delivered)).not.toThrow();
  expect(check({ ...delivered, destination: "venue" })).toThrow("fills.destination");
  expect(check({ ...delivered, swap_id: `0x${"02".repeat(32)}` })).toThrow("fills.swap_id");
  expect(check({ ...delivered, taker_recipient: owner.address })).toThrow("fills.taker_recipient");
  expect(check({ ...delivered, taker_recipient: owner.address }, toWallet, owner.address)).toThrow("fills.taker_recipient");
  expect(check(delivered, input)).toThrow("fills.destination");
  expect(check(delivered, { ...toWallet, to: "aster" })).toThrow("No wallet destination on aster");
});

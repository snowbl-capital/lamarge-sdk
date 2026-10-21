import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "./client.ts";
import { checkLighterTakeIntent, type TakeFill } from "./protocol/intents.ts";
import { fillMemo, LIGHTER_API, transferMessage } from "./protocol/lighter.ts";
import { take } from "./take.ts";

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
const reserved = { id: fill, take_id: "take-1", order_id: "0x01", sequence: 1, role: "taker", state: "RESERVED", from_venue: "lighter", to_venue: "hyperliquid", amount_in: "2001300", amount_out: "2000000",
  payer: owner.address, maker_owner: maker, maker_recipient: maker, taker_recipient: owner.address, swap_id: "0x02", hashlock: "0x03", pay_by: at(40_000), t1: at(3_600_000), t2: at(7_200_000),
  signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_to: null, delivery_hash: null };

/** A take paid from the Lighter account #42, the API and Lighter itself answering; `owners` is whose account each index is, as Lighter says. */
function lighter(owners: Record<number, string> = { 42: owner.address, 731033: maker }) {
  const calls: string[] = [];
  const fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    const target = new URL(request.url);
    if (request.url.startsWith(LIGHTER_API)) {
      const index = Number(target.searchParams.get("value"));
      return Response.json({ accounts: [{ index, l1_address: owners[index] }] });
    }
    const route = `${request.method} ${target.pathname}`;
    calls.push(route);
    if (route === "GET /v1/balances") return Response.json([{ venue: "lighter", address: owner.address, venue_wallet: "42" }, { venue: "hyperliquid", address: owner.address, venue_wallet: null }]);
    if (route === "POST /v1/takes") return Response.json({ take: { id: "take-1", fills: [reserved] }, to_sign: [item] });
    if (route === "POST /v1/takes/take-1/signatures") return Response.json({ fills: [{ ...reserved, state: "PAID" }] });
    if (route === "DELETE /v1/takes/take-1") return new Response(null, { status: 204 });
    return Response.json({ error: { code: "NOT_FOUND", message: route, request_id: "r", retryable: false } }, { status: 404 });
  }, { preconnect: globalThis.fetch.preconnect });
  const messages: string[] = [];
  const signer = { address: owner.address, signMessage: ({ message }: { message: string }) => { messages.push(message); return owner.signMessage({ message }); } };
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, messages, signer };
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

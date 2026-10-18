import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { route, type RouteRequest } from "./route.ts";

const owner = `0x${"11".repeat(20)}` as const, maker = `0x${"22".repeat(20)}`, id = `0x${"aa".repeat(32)}`;
const now = () => Math.floor(Date.now() / 1000);
const at = (seconds: number) => new Date((now() + seconds) * 1000).toISOString();

/** The API for a route from Polymarket to Aster through Hyperliquid, 1 USDC each take, the second continuing what the first delivered. */
function api(options: { continuable?: string; received?: string; unknownReads?: number } = {}) {
  const calls: string[] = [];
  const legs = { first: { from: "polymarket", to: "hyperliquid" }, second: { from: "hyperliquid", to: "aster" } };
  const intents: Record<string, Record<string, unknown>> = {};
  const delivery = { claimed: false };
  let unknown = options.unknownReads ?? 0;
  const intent = (key: "first" | "second", body: Record<string, unknown>) => {
    const leg = legs[key], chain = required(CHAINS[leg.from]);
    return { id: `transfer-${key}`, client_transfer_id: body.client_transfer_id, client_take_id: `take-client-${key}`, ...leg, amount_in: body.amount_in, min_out: body.min_out,
      max_parts: 8, payer: owner, recipient: body.recipient, from_chain_id: chain.id, to_chain_id: required(CHAINS[leg.to]).id, withdrawal: null, take_id: null as string | null,
      withdrawal_preparation: null, take_final: null, then: body.then ?? null, previous_transfer_id: body.previous_transfer_id ?? null,
      continuable: key === "first" && delivery.claimed ? options.continuable ?? "1000000" : null, cancelled_at: null, created_at: at(0),
      funding_plan: { venue: leg.from, owner, amount: body.amount_in, deposit: "0", withdrawal_amount: "0", withdrawal_to: null, observed_at: at(0), payment_setup: "done",
        requests: [{ kind: "pay_take", signer: owner, chain_id: chain.id }] } };
  };
  const fill = (key: "first" | "second") => {
    const leg = legs[key], claimed = key === "first" && delivery.claimed;
    return { id: `fill-${key}`, take_id: `take-${key}`, order_id: id, sequence: 1, role: "taker", state: claimed ? "SETTLED" : "PAID", from_venue: leg.from, to_venue: leg.to,
      amount_in: "1000000", amount_out: key === "first" ? options.received ?? "1000000" : String(10n ** 18n), payer: owner, maker_recipient: maker, taker_recipient: owner,
      swap_id: id, hashlock: `0x${"bb".repeat(32)}`, pay_by: at(45), t1: at(3600), t2: at(7200), signed_at: null, payment_leg: "NONE", maker_leg: claimed ? "CLAIMED" : "NONE",
      maker_claimed_at: claimed ? at(-5) : null, transactions: [], delivery_hash: null, payment_locked_at: null, delivery_to: leg.to === "aster" ? owner : null };
  };
  const prepared = (key: "first" | "second") => {
    const leg = legs[key], pay = required(CHAINS[leg.from]), receive = required(CHAINS[leg.to]), reserved = { ...fill(key), state: "RESERVED" };
    const payment = { payer: owner, swapId: id, recipient: maker, amount: "1000000", hashlock: reserved.hashlock, refundAt: now() + 7200, deadline: now() + 45, orderId: id, sequence: 1,
      amountOut: reserved.amount_out, receiveChainId: receive.id, receiveToken: receive.token, receiveEscrow: receive.escrow, receiveRecipient: owner, dex: 0 };
    return { take: { id: `take-${key}`, fills: [reserved] }, to_sign: [{ kind: "pay_take", fill_id: reserved.id, signer: owner,
      typed_data: { types: { EIP712Domain, ...schemas.PayTake }, primaryType: "PayTake", domain: { name: "LaMarge", version: "1", chainId: pay.id, verifyingContract: ESCROW }, message: { payer: owner, deposit: "0", payments: [payment] } } }] };
  };
  const balance = (venue: string, held: string) => ({ venue, address: owner, venue_wallet: null, chain_balance: held, chain_error: null, chain_read_at: at(0), escrow_balance: "0",
    deposit_balance: "0", withdrawable: "0", withdrawal_fee: "0", read_at: at(0) });
  const book = (from: string, to: string) => ({ from, to, max_fill: String(10n ** 24n), levels: [{ order_id: id, supply: to === "aster" ? String(10n ** 18n) : "1000000", receive: "1000000", available: String(10n ** 24n), min_fill: "1", valid_until: at(60) }] });
  const routes: Record<string, (body: Record<string, unknown>, query: URLSearchParams) => unknown> = {
    "GET /v1/venues": () => [],
    "GET /v1/orders": () => [],
    "GET /v1/books": (_body, query) => book(String(query.get("from")), String(query.get("to"))),
    "POST /v1/transfers": body => {
      const key = body.previous_transfer_id ? "second" : "first";
      intents[key] ??= intent(key, body);
      return intents[key];
    },
    "GET /v1/transfers/transfer-first": () => ({ ...required(intents.first), continuable: delivery.claimed && unknown-- <= 0 ? options.continuable ?? "1000000" : null }),
    "GET /v1/transfers/transfer-second": () => intents.second,
    "GET /v1/balances": () => [balance("polymarket", "1000000"), balance("hyperliquid", delivery.claimed ? options.received ?? "1000000" : "0"), balance("aster", "0")],
    "POST /v1/takes": body => { const key = body.transfer_intent_id === "transfer-second" ? "second" : "first"; required(intents[key]).take_id = `take-${key}`; return prepared(key); },
    "GET /v1/takes/take-first": () => { delivery.claimed = true; return { take: { id: "take-first", fills: [fill("first")] }, to_sign: [] }; },
    "POST /v1/takes/take-first/signatures": () => ({ fills: [fill("first")] }),
    "POST /v1/takes/take-second/signatures": () => ({ fills: [fill("second")] }),
    "GET /v1/takes/take-second": () => ({ take: { id: "take-second", fills: [fill("second")] }, to_sign: [] }),
  };
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    const name = `${request.method} ${url.pathname}`;
    calls.push(name);
    const handler = routes[name];
    if (!handler) return Response.json({ error: { code: "NOT_FOUND", message: name, request_id: "r", retryable: false } }, { status: 404 });
    const body = request.method === "GET" ? {} : record(await request.json());
    return Response.json(handler(body, url.searchParams));
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, intents };
}

const signer = () => {
  const counted = { address: owner, signed: 0, signMessage: async () => "0x00" as const, signTypedData: async () => { counted.signed++; return "0x00" as const; } };
  return counted;
};
const request: RouteRequest = { client_transfer_id: "move-1", from: "polymarket", via: "hyperliquid", to: "aster", amount_in: "1000000", min_out: "1000000",
  then: { amount_in: "1000000", min_out: String(10n ** 18n) }, recipient: owner, funding: "wallet" };

test("a route pays the first take, waits for its delivery on the venue between, then continues what is left to its end", async () => {
  const { client, calls, intents } = api();
  const paying = signer();
  const named: string[] = [];
  const { first, second } = await route(client, paying, request, { pollMs: 1, onIntent: intent => { named.push(String(intent.client_transfer_id)); } });
  expect(first.map(fill => fill.maker_leg)).toEqual(["CLAIMED"]);
  expect(second.map(fill => [fill.from_venue, fill.to_venue])).toEqual([["hyperliquid", "aster"]]);
  expect(paying.signed).toBe(2);
  expect(named).toEqual(["move-1", "move-1.2"]);
  expect(required(intents.first).then).toMatchObject({ to: "aster", amount_in: "1000000" });
  expect(required(intents.second).previous_transfer_id).toBe("transfer-first");
  expect(calls.indexOf("GET /v1/takes/take-first")).toBeLessThan(calls.lastIndexOf("POST /v1/transfers"));
});

test("what is left to continue with is read again until LaMarge knows it, within the wait for the arrival", async () => {
  const { client } = api({ unknownReads: 2 });
  const { second } = await route(client, signer(), request, { pollMs: 1 });
  expect(second).toHaveLength(1);
});

test("a route sleeps between its reads as the caller says: a minute's poll there takes no minute here", async () => {
  const { client } = api();
  const slept: number[] = [];
  const { second } = await route(client, signer(), request, { pollMs: 60_000, sleep: ms => { slept.push(ms); return Promise.resolve(); } });
  expect(second).toHaveLength(1);
  expect(slept.length).toBeGreaterThan(0);
  expect(slept.every(ms => ms === 60_000)).toBe(true);
});

test("what LaMarge leaves to continue with never goes past what the first take delivered", async () => {
  const { client, calls } = api({ continuable: "1000001" });
  const paying = signer();
  await expect(route(client, paying, request, { pollMs: 1 })).rejects.toThrow("more to continue with than the first take delivered");
  expect(paying.signed).toBe(1);
  expect(calls.filter(call => call === "POST /v1/transfers")).toHaveLength(1);
});

test("run again with its second transfer's id, a route follows that one, never opens another", async () => {
  const { client, calls } = api();
  const paying = signer();
  const named: Record<string, string> = {};
  const onIntent = (intent: { id: string; previous_transfer_id?: string | null }) => { named[intent.previous_transfer_id ? "second" : "first"] = intent.id; };
  await route(client, paying, request, { pollMs: 1, onIntent });
  const again = await route(client, paying, { ...request, transfer_id: named.first, then_transfer_id: named.second }, { pollMs: 1 });
  expect(again.second.map(fill => fill.id)).toEqual(["fill-second"]);
  expect(paying.signed).toBe(2);
  expect(calls.filter(call => call === "POST /v1/transfers")).toHaveLength(2);
});

test("run again, a route's transfers go on with the parts they were opened with", async () => {
  const { client, intents } = api();
  const paying = signer();
  await route(client, paying, request, { pollMs: 1 });
  // Opened by a client that asked one fill, as a take paid inside its venue buys.
  Object.assign(intents.first ?? {}, { max_parts: 1 });
  Object.assign(intents.second ?? {}, { max_parts: 1 });
  const again = await route(client, paying, { ...request, transfer_id: "transfer-first", then_transfer_id: "transfer-second" }, { pollMs: 1 });
  expect(again.second).toHaveLength(1);
  expect(paying.signed).toBe(2);
});

test("what is left under a hundredth of the second take waits on the venue between", async () => {
  const { client, calls } = api({ continuable: "9999" });
  const { second } = await route(client, signer(), request, { pollMs: 1 });
  expect(second).toEqual([]);
  expect(calls.filter(call => call === "POST /v1/transfers")).toHaveLength(1);
});

test("a route whose first transfer names another end is never paid", async () => {
  const { client } = api();
  await route(client, signer(), request, { pollMs: 1 });
  const paying = signer();
  await expect(route(client, paying, { ...request, recipient: maker, transfer_id: "transfer-first" }, { pollMs: 1 })).rejects.toThrow("Transfer terms changed");
  await expect(route(client, paying, { ...request, then: { amount_in: "2000000", min_out: "1" }, transfer_id: "transfer-first" }, { pollMs: 1 })).rejects.toThrow("Transfer terms changed");
  expect(paying.signed).toBe(0);
});

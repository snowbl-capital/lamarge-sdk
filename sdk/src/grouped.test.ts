import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "./client.ts";
import { signRoute } from "./grouped.ts";
import { fillMemo, LIGHTER_API } from "./protocol/lighter.ts";
import { ASTER_TRANSFER_CHAIN_ID, asterRequest, CHAINS, EIP712Domain, ESCROW, ROUTE_PAY_WINDOW_SECONDS, schemas } from "./protocol/protocol.ts";
import { checkRouteIntent, signableUntil } from "./protocol/intents.ts";
import { array, record, required } from "./protocol/validation.ts";
import type { Signing } from "./signer.ts";
import { memoryStore } from "./store.ts";

const account = privateKeyToAccount(`0x${"44".repeat(32)}`);
const owner = account.address;
const maker = "0x00000000000000000000000000000000000000aa";
const now = Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date((now + seconds) * 1000).toISOString();
const firstFill = "018f8d98-f485-7f48-9630-e0b7368fe28f", secondFill = "018f8d98-f485-7f48-9630-e0b7368fe290";
const id = `0x${"aa".repeat(32)}`, hashlock = `0x${"bb".repeat(32)}`;
const error = (status: number, code: string, reason?: string) =>
  Response.json({ error: { code, message: code, request_id: "r", retryable: false, ...(reason ? { reason } : {}) } }, { status });

const first = {
  id: "transfer-first", client_transfer_id: "move", client_take_id: "transfer:transfer-first", from: "lighter", to: "hyperliquid", amount_in: "10006500", min_out: "10000000",
  max_parts: 1, payer: owner, recipient: owner, from_chain_id: 304, to_chain_id: 999, withdrawal_preparation: null, withdrawal: null, take_id: "take-first", take_final: false,
  then: { to: "polymarket", recipient: owner, amount_in: "10000000", min_out: "9000000", chain_id: 137 }, previous_transfer_id: null, continuable: null,
  cancelled_at: null, created_at: iso(0), funding_plan: null, funding_plan_error: null, grouped: null,
};
const fill = (overrides: Record<string, unknown>) => ({ order_id: id, sequence: 1, role: "taker", state: "RESERVED", payer: owner, maker_owner: maker, maker_recipient: maker,
  taker_recipient: owner, swap_id: id, hashlock, t1: iso(3600), t2: iso(7200), signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_to: null,
  delivery_hash: null, ...overrides });
const lighterTake = (out = "10000000") => ({ take: { id: "take-first", fills: [fill({ id: firstFill, take_id: "take-first", from_venue: "lighter", to_venue: "hyperliquid", amount_in: "10006500",
  amount_out: out, pay_by: iso(40) })] }, to_sign: [{ kind: "lighter_transfer", signer: owner, fill_id: firstFill,
  typed_data: { api_key_index: 254, from_account_index: 42, to_account_index: 731033, amount: "10006500", usdc_fee: "0", memo: fillMemo(firstFill), nonce: 7 } }] });
const typed = (primaryType: string, message: Record<string, unknown>) => ({ types: { EIP712Domain, ...schemas[primaryType] }, primaryType,
  domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW }, message });
/** The second take, its `pay_by` `payIn` seconds ahead: a route's is longer than any other take's. */
const payTake = (payIn = 120) => ({ take: { id: "take-second", fills: [fill({ id: secondFill, take_id: "take-second", from_venue: "hyperliquid", to_venue: "polymarket", amount_in: "10000000",
  amount_out: "9990000", pay_by: iso(payIn) })] }, to_sign: [{ kind: "pay_take", signer: owner, fill_id: secondFill, typed_data: typed("PayTake", { payer: owner, deposit: "0", payments: [{
  payer: owner, swapId: id, recipient: maker, amount: "10000000", hashlock, refundAt: now + 7200, deadline: now + payIn, orderId: id, sequence: 1, amountOut: "9990000", receiveChainId: 137,
  receiveToken: required(CHAINS.polymarket).token, receiveEscrow: ESCROW, receiveRecipient: owner, dex: 0 }] }) }] });
const withdrawal = { amount: "4000000", created_at: iso(0), typed_data: { types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" }], ...schemas["HyperliquidTransaction:SendAsset"] }, primaryType: "HyperliquidTransaction:SendAsset",
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 999, verifyingContract: "0x0000000000000000000000000000000000000000" },
  message: { hyperliquidChain: "Mainnet", destination: "0x2000000000000000000000000000000000000000", sourceDex: "", destinationDex: "spot", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
    amount: "4", fromSubAccount: "", nonce: now * 1000 } } };
const second = { ...first, id: "transfer-second", client_transfer_id: "grouped:transfer-first", client_take_id: "transfer:transfer-second", from: "hyperliquid", to: "polymarket",
  amount_in: "10000000", min_out: "9000000", previous_transfer_id: "transfer-first", take_id: "take-second", then: null, withdrawal_preparation: withdrawal };
const route = (state = "prepared", commitIn = 40) => ({ state, second_transfer_id: "transfer-second", first_take_id: "take-first", second_take_id: "take-second", commit_by: iso(commitIn) });

function api(answers: { prepare?: () => unknown; commit?: () => unknown; second?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const bodies: ({ name: string } & Record<string, unknown>)[] = [];
  const routes: Record<string, () => unknown> = {
    "POST /v1/transfers/transfer-first/grouped": answers.prepare ?? (() => ({ route: route(), first: lighterTake(), second: payTake() })),
    "GET /v1/transfers/transfer-second": () => ({ ...second, ...answers.second }),
    "GET /v1/balances": () => [{ venue: "lighter", address: owner, venue_wallet: "42" }, { venue: "hyperliquid", address: owner, venue_wallet: null }, { venue: "polymarket", address: owner }],
    "POST /v1/transfers/transfer-first/grouped/signatures": answers.commit ?? (() => route("committed")),
    "DELETE /v1/transfers/transfer-first/grouped": () => new Response(null, { status: 204 }),
  };
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (request.url.startsWith(LIGHTER_API)) {
      const index = Number(url.searchParams.get("value"));
      return Response.json({ accounts: [{ index, l1_address: index === 42 ? owner : maker }] });
    }
    const name = `${request.method} ${url.pathname}`;
    calls.push(name);
    if (request.method === "POST") bodies.push({ name, ...record(await request.json().catch(() => ({}))) });
    const answer = (routes[name] ?? (() => error(404, "NOT_FOUND")))();
    return answer instanceof Response ? answer : Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, bodies };
}
/** The account signing everything, counting what it signs. */
function wallet() {
  const signed: string[] = [];
  return { signed, signer: { address: owner, signMessage: async (request: { message: string }) => { signed.push("message"); return account.signMessage(request); },
    signTypedData: async (request: Parameters<typeof account.signTypedData>[0]) => { signed.push(request.primaryType); return account.signTypedData(request); } } };
}
const abort = "DELETE /v1/transfers/transfer-first/grouped";

test("a route signed at once signs its three requests back to back, checked as any take's, and commits them together inside the lock", async () => {
  const { client, calls, bodies } = api();
  const { signer, signed } = wallet();
  const hooks: string[] = [];
  const inside: boolean[] = [];
  let locked = false;
  const committed = await signRoute(client, signer, signer, first, {
    beforeSigning: (signing: Signing) => { hooks.push(`${signing.kind}${"route" in signing && signing.route ? " of the route" : ""}`); inside.push(locked); },
    lock: async run => { locked = true; try { return await run(); } finally { locked = false; } },
  });
  expect(committed?.state).toBe("committed");
  expect(signed).toEqual(["message", "HyperliquidTransaction:SendAsset", "PayTake"]);
  expect(hooks).toEqual(["route", "take of the route", "withdrawal of the route", "take of the route"]);
  expect(inside.every(Boolean)).toBe(true);
  const commit = required(bodies.find(body => body.name.endsWith("/grouped/signatures")));
  expect(array(commit.signatures).map(item => record(item).kind)).toEqual(["lighter_transfer", "margin_move", "pay_take"]);
  expect(calls).not.toContain(abort);
});

test("a route LaMarge does not sign at once goes leg by leg with nothing signed", async () => {
  for (const answer of [error(409, "STATE_CONFLICT", "grouped_unavailable"), error(404, "NOT_FOUND")]) {
    const { client, calls } = api({ prepare: () => answer.clone() });
    const { signer, signed } = wallet();
    expect(await signRoute(client, signer, signer, first)).toBeNull();
    expect(signed).toEqual([]);
    expect(calls).not.toContain(abort);
  }
});

test("a second take paying more than the first delivers, or past the route's window, is refused and the route aborted", async () => {
  for (const prepare of [() => ({ route: route(), first: lighterTake("9000000"), second: payTake() }), () => ({ route: route(), first: lighterTake(), second: payTake(ROUTE_PAY_WINDOW_SECONDS + 60) })]) {
    const { client, calls } = api({ prepare });
    const { signer, signed } = wallet();
    await expect(signRoute(client, signer, signer, first)).rejects.toThrow();
    expect(signed.includes("PayTake")).toBe(false);
    expect(calls).toContain(abort);
  }
});

test("a signer other than the route's payer signs nothing", async () => {
  const { client } = api();
  const { signer, signed } = wallet();
  await expect(signRoute(client, { ...signer, address: maker }, signer, first)).rejects.toThrow();
  expect(signed).toEqual([]);
});

test("too little time left to sign the route aborts it and goes leg by leg, nothing signed", async () => {
  const { client, calls } = api({ prepare: () => ({ route: route("prepared", 3), first: lighterTake(), second: payTake() }) });
  const { signer, signed } = wallet();
  expect(await signRoute(client, signer, signer, first)).toBeNull();
  expect(signed).toEqual([]);
  expect(calls).toContain(abort);
});

test("a commit refused after commit_by aborts the route and leaves the first take to sign alone", async () => {
  const { client, calls } = api({ commit: () => error(409, "TAKE_EXPIRED") });
  const { signer } = wallet();
  const store = memoryStore();
  expect(await signRoute(client, signer, signer, first, { store })).toBeNull();
  expect(calls).toContain(abort);
  expect(await store.load("route:transfer-first")).toBeUndefined();
});

test("a commit refused for a bad signature forgets the signatures and ends the route", async () => {
  const { client, calls } = api({ commit: () => error(400, "BAD_SIGNATURE") });
  const { signer } = wallet();
  const store = memoryStore();
  await expect(signRoute(client, signer, signer, first, { store })).rejects.toThrow();
  expect(calls).toContain(abort);
  expect(await store.load("route:transfer-first")).toBeUndefined();
});

test("a flow aborted while signing still aborts the route", async () => {
  const { client, calls } = api();
  const controller = new AbortController();
  const signer = { address: owner, signMessage: async () => { controller.abort(); throw new Error("left"); }, signTypedData: async () => "0x00" as const };
  await expect(signRoute(client, signer, signer, first, { signal: controller.signal })).rejects.toThrow();
  expect(calls).toContain(abort);
});

test("a run interrupted after the first signature resumes from the kept one, the route shown again", async () => {
  const { client } = api();
  const { signer, signed } = wallet();
  const stop = new Error("interrupted");
  const interrupted = { ...signer, signTypedData: async () => { throw stop; } };
  // A restart, not a decline: the store keeps what was signed, as a crash between two requests would.
  const kept = new Map<string, unknown>();
  const durable = { load: async (key: string) => kept.get(key), save: async (key: string, value: unknown) => { kept.set(key, value); }, delete: async (key: string) => { if (key !== "route:transfer-first" || !crashed) kept.delete(key); } };
  let crashed = true;
  await expect(signRoute(client, signer, interrupted, first, { store: durable })).rejects.toBe(stop);
  crashed = false;
  expect(kept.has("route:transfer-first")).toBe(true);
  const hooks: string[] = [];
  expect((await signRoute(client, signer, signer, first, { store: durable, beforeSigning: signing => { hooks.push(signing.kind === "route" ? `route ${JSON.stringify(signing.signed)}` : signing.kind); } }))?.state).toBe("committed");
  expect(signed.filter(kind => kind === "message")).toHaveLength(1);
  expect(hooks).toEqual([`route ${JSON.stringify({ first: true, withdrawal: false, second: false })}`, "withdrawal", "take"]);
});

test("a route's checks compare its second transfer with the plan and its withdrawal with what the first take delivers", () => {
  const delivering = [{ amount_out: "10000000" }];
  checkRouteIntent(first, delivering, second, owner, now);
  expect(() => checkRouteIntent(first, delivering, { ...second, payer: maker }, owner, now)).toThrow("second transfer");
  expect(() => checkRouteIntent(first, delivering, { ...second, min_out: "8999999" }, owner, now)).toThrow("plan");
  expect(() => checkRouteIntent(first, delivering, { ...second, amount_in: "10000001" }, owner, now)).toThrow("plan");
  expect(() => checkRouteIntent(first, [{ amount_out: "3000000" }], { ...second, amount_in: "3000000", min_out: "2700000" }, owner, now)).toThrow("withdraws more");
});

test("an Aster take can be signed only while its nonce stays far enough ahead, short of its pay_by", () => {
  const msg = `asset=USDT&amount=1.5&toAddress=${maker}&clientTranId=0192f0a1b2c37d4e8f90a1b2c3d4e5f6&nonce=${String(BigInt(now + 55) * 1_000_000n)}&user=${owner}`;
  const aster = { kind: "aster_transfer", signer: owner, typed_data: asterRequest(msg, ASTER_TRANSFER_CHAIN_ID) };
  expect(signableUntil({ take: { fills: [{ pay_by: iso(45) }] }, to_sign: [] })).toBe(now + 45);
  expect(signableUntil({ take: { fills: [{ pay_by: iso(45) }] }, to_sign: [aster] })).toBe(now + 35);
});

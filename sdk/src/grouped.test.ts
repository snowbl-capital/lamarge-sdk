import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { RouteAbandoned, signRoute } from "./grouped.ts";
import { fillMemo } from "./protocol/lighter.ts";
import { ASTER_TRANSFER_CHAIN_ID, asterRequest, CHAINS, EIP712Domain, ESCROW, ROUTE_PAY_WINDOW_SECONDS, schemas } from "./protocol/protocol.ts";
import { checkRouteIntent, signableUntil } from "./protocol/intents.ts";
import { array, record, required } from "./protocol/validation.ts";
import type { Signing } from "./signer.ts";
import { memoryStore } from "./store.ts";
import { apiError, mockApi } from "./mock.test.ts";

const account = privateKeyToAccount(`0x${"44".repeat(32)}`);
const owner = account.address;
const maker = "0x00000000000000000000000000000000000000aa";
const now = Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date((now + seconds) * 1000).toISOString();
const firstFill = "018f8d98-f485-7f48-9630-e0b7368fe28f", secondFill = "018f8d98-f485-7f48-9630-e0b7368fe290";
const id = `0x${"aa".repeat(32)}`, hashlock = `0x${"bb".repeat(32)}`;
const error = (status: number, code: string, reason?: string) => apiError(status, code, code, reason ? { reason } : {});

const first = {
  id: "transfer-first", client_transfer_id: "move", client_take_id: "transfer:transfer-first", from: "lighter", to: "hyperliquid", amount_in: "10006500", min_out: "10000000",
  max_parts: 1, payer: owner, recipient: owner, from_chain_id: 304, to_chain_id: 999, withdrawal_preparation: null, withdrawal: null, take_id: "take-first", take_final: false,
  then: { to: "polymarket", recipient: owner, amount_in: "10000000", min_out: "9000000", chain_id: 137 }, previous_transfer_id: null, continuable: null,
  cancelled_at: null, created_at: iso(0), funding_plan: null, funding_plan_error: null, grouped: null,
};
const fill = (overrides: Record<string, unknown>) => ({ order_id: id, sequence: 1, role: "taker", state: "RESERVED", payer: owner, maker_owner: maker, maker_recipient: maker,
  taker_recipient: owner, taker_fee: "0", swap_id: id, hashlock, t1: iso(3600), t2: iso(7200), signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_to: null,
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
const second = { ...first, id: "transfer-second", client_transfer_id: "grouped:transfer-first", client_take_id: "transfer:transfer-second", from: "hyperliquid", to: "polymarket",
  amount_in: "10000000", min_out: "9000000", previous_transfer_id: "transfer-first", take_id: "take-second", then: null };
const route = (state = "prepared", commitIn = 40) => ({ state, second_transfer_id: "transfer-second", first_take_id: "take-first", second_take_id: "take-second", commit_by: iso(commitIn) });

function api(answers: { prepare?: () => unknown; commit?: () => unknown; abort?: () => unknown; second?: Record<string, unknown>; from?: string } = {}) {
  return mockApi({
    "POST /v1/transfers/transfer-first/grouped": answers.prepare ?? (() => ({ route: route(), first: lighterTake(), second: payTake() })),
    "GET /v1/transfers/transfer-second": () => ({ ...second, ...answers.second }),
    "GET /v1/balances": () => [{ venue: answers.from ?? "lighter", address: owner, venue_wallet: "42" }, { venue: "hyperliquid", address: owner, venue_wallet: null }, { venue: "polymarket", address: owner }],
    "POST /v1/transfers/transfer-first/grouped/signatures": answers.commit ?? (() => route("committed")),
    "DELETE /v1/transfers/transfer-first/grouped": answers.abort ?? (() => null),
    "GET /api/v1/account": (_, query) => ({ accounts: [{ index: Number(query.get("value")), l1_address: query.get("value") === "42" ? owner : maker }] }),
  });
}
function wallet() {
  const signed: string[] = [];
  return { signed, signer: { address: owner, signMessage: async (request: { message: string }) => { signed.push("message"); return account.signMessage(request); },
    signTypedData: async (request: Parameters<typeof account.signTypedData>[0]) => { signed.push(request.primaryType); return account.signTypedData(request); } } };
}
const abort = "DELETE /v1/transfers/transfer-first/grouped";

test("a route signed at once signs its two requests back to back, checked as any take's, and commits them together inside the lock", async () => {
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
  expect(signed).toEqual(["message", "PayTake"]);
  expect(hooks).toEqual(["route", "take of the route", "take of the route"]);
  expect(inside.every(Boolean)).toBe(true);
  const commit = required(bodies["POST /v1/transfers/transfer-first/grouped/signatures"]?.[0]);
  expect(array(commit.signatures).map(item => record(item).kind)).toEqual(["lighter_transfer", "pay_take"]);
  expect(calls).not.toContain(abort);
});

test("an unavailable grouped route throws with nothing signed", async () => {
  for (const answer of [error(409, "STATE_CONFLICT", "grouped_unavailable"), error(404, "NOT_FOUND")]) {
    const { client, calls } = api({ prepare: () => answer.clone() });
    const { signer, signed } = wallet();
    await expect(signRoute(client, signer, signer, first)).rejects.toBeInstanceOf(RouteAbandoned);
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

test("too little time left aborts the route and throws, nothing signed", async () => {
  const { client, calls } = api({ prepare: () => ({ route: route("prepared", 3), first: lighterTake(), second: payTake() }) });
  const { signer, signed } = wallet();
  await expect(signRoute(client, signer, signer, first)).rejects.toBeInstanceOf(RouteAbandoned);
  expect(signed).toEqual([]);
  expect(calls).toContain(abort);
});

test("a refused commit aborts the route, forgets signatures and exposes its deadline and cause", async () => {
  const { client, calls } = api({ commit: () => error(409, "TAKE_EXPIRED") });
  const { signer } = wallet();
  const store = memoryStore();
  await expect(signRoute(client, signer, signer, first, { store, now: () => now * 1000 })).rejects.toMatchObject({
    name: "RouteAbandoned", transferId: first.id, reason: "expired", commitBy: iso(40), lateByMs: 0, cause: { code: "TAKE_EXPIRED" },
  });
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
  expect(hooks).toEqual([`route ${JSON.stringify({ first: true, withdrawal: false, second: false })}`, "take"]);
});

test("a checkpoint an earlier SDK saved resumes from its signature, unless it holds a withdrawal", async () => {
  for (const [withdrawal, messages] of [[null, 1], [{ primaryType: "Withdrawal" }, 2]] as const) {
    const { client } = api();
    const { signer, signed } = wallet();
    const stop = new Error("interrupted");
    const interrupted = { ...signer, signTypedData: async () => { throw stop; } };
    const kept = new Map<string, unknown>();
    const durable = { load: async (key: string) => kept.get(key), save: async (key: string, value: unknown) => { kept.set(key, value); }, delete: async (key: string) => { if (key !== "route:transfer-first" || !crashed) kept.delete(key); } };
    let crashed = true;
    await expect(signRoute(client, signer, interrupted, first, { store: durable })).rejects.toBe(stop);
    crashed = false;
    // As SDK 0.14 and earlier saved it: a withdrawal entry, and each request with its attestation.
    const checkpoint = record(kept.get("route:transfer-first"));
    const requests = record(checkpoint.requests);
    const proven = (items: unknown) => array(items).map(item => ({ ...record(item), attestation: { signature: `0x${"aa".repeat(65)}` } }));
    kept.set("route:transfer-first", { ...checkpoint, requests: { first: proven(requests.first), second: proven(requests.second), withdrawal } });
    expect((await signRoute(client, signer, signer, first, { store: durable }))?.state).toBe("committed");
    expect(signed.filter(kind => kind === "message"), JSON.stringify(withdrawal)).toHaveLength(messages);
  }
});

test("a route's checks compare its second transfer with the plan and refuse any withdrawal from the venue between", () => {
  const delivering = [{ amount_out: "10000000" }];
  checkRouteIntent(first, delivering, second, owner);
  expect(() => checkRouteIntent(first, delivering, { ...second, payer: maker }, owner)).toThrow("second transfer");
  expect(() => checkRouteIntent(first, delivering, { ...second, min_out: "8999999" }, owner)).toThrow("plan");
  expect(() => checkRouteIntent(first, delivering, { ...second, amount_in: "10000001" }, owner)).toThrow("plan");
  expect(() => checkRouteIntent(first, delivering, { ...second, withdrawal_preparation: { amount: "4000000", created_at: iso(0), typed_data: {} } }, owner)).toThrow("second transfer");
});

test("an Aster take can be signed only while its nonce stays far enough ahead, short of its pay_by", () => {
  const msg = `asset=USDT&amount=1.5&toAddress=${maker}&clientTranId=0192f0a1b2c37d4e8f90a1b2c3d4e5f6&nonce=${String(BigInt(now + 55) * 1_000_000n)}&user=${owner}`;
  const aster = { kind: "aster_transfer", signer: owner, typed_data: asterRequest(msg, ASTER_TRANSFER_CHAIN_ID) };
  expect(signableUntil({ take: { fills: [{ pay_by: iso(45) }] }, to_sign: [] })).toBe(now + 45);
  expect(signableUntil({ take: { fills: [{ pay_by: iso(45) }] }, to_sign: [aster] })).toBe(now + 35);
});

const asterTake = () => ({ take: { id: "take-first", fills: [fill({ id: firstFill, take_id: "take-first", from_venue: "aster", to_venue: "hyperliquid",
  amount_in: "10006500000000000000", amount_out: "10000000", pay_by: iso(90) })] }, to_sign: [{ kind: "aster_transfer", signer: owner, fill_id: firstFill,
  typed_data: asterRequest(`asset=USDT&amount=10.0065&toAddress=${maker}&clientTranId=${firstFill.replaceAll("-", "")}&nonce=${BigInt(now + 110) * 1_000_000n}&user=${owner}`, ASTER_TRANSFER_CHAIN_ID) }] });

for (const seconds of [38, 89, 90, 94]) test(`an Aster route whose browser signatures take ${seconds}s respects the commit deadline`, async () => {
  const { client, calls, bodies } = api({ from: "aster",
    prepare: () => ({ route: route("prepared", 90), first: asterTake(), second: payTake(150) }) });
  const { signer, signed } = wallet();
  let clock = now * 1000;
  const slow = { ...signer, signTypedData: async (request: Parameters<typeof signer.signTypedData>[0]) => {
    const signature = await signer.signTypedData(request);
    clock += seconds * 500;
    return signature;
  } };
  const store = memoryStore();
  const signing = signRoute(client, slow, slow, { ...first, from: "aster", from_chain_id: 56, amount_in: "10006500000000000000" }, { store, now: () => clock });
  if (seconds < 90) {
    expect((await signing).state).toBe("committed");
    expect(calls).not.toContain(abort);
    expect(bodies["POST /v1/transfers/transfer-first/grouped/signatures"]).toHaveLength(1);
  } else {
    await expect(signing).rejects.toMatchObject({ name: "RouteAbandoned", reason: "expired", commitBy: iso(90), lateByMs: (seconds - 90) * 1000 });
    expect(calls).toContain(abort);
    expect(bodies["POST /v1/transfers/transfer-first/grouped/signatures"]).toBeUndefined();
  }
  expect(signed).toEqual(["Message", "PayTake"]);
  expect(await store.load("route:transfer-first")).toBeUndefined();
});

test("an uncertain commit keeps its signatures and resumes without another wallet request", async () => {
  let attempts = 0;
  const { client, calls } = api({ commit: () => ++attempts <= 3 ? error(503, "OPERATOR_UNAVAILABLE") : route("committed") });
  const { signer, signed } = wallet();
  const store = memoryStore();
  await expect(signRoute(client, signer, signer, first, { store })).rejects.toMatchObject({ code: "OPERATOR_UNAVAILABLE" });
  expect(await store.load("route:transfer-first")).toBeDefined();
  expect(calls).not.toContain(abort);
  attempts = 3;
  await signRoute(client, signer, signer, first, { store });
  expect(signed).toEqual(["message", "PayTake"]);
});

test("an unconfirmed abort preserves signatures and does not report the route abandoned", async () => {
  let expired = false;
  const { client } = api({
    prepare: () => ({ route: route("prepared", expired ? -1 : 40), first: lighterTake(), second: payTake() }),
    commit: () => error(503, "OPERATOR_UNAVAILABLE"), abort: () => error(409, "STATE_CONFLICT", "grouped_route"),
  });
  const { signer, signed } = wallet();
  const store = memoryStore();
  await expect(signRoute(client, signer, signer, first, { store })).rejects.toMatchObject({ code: "OPERATOR_UNAVAILABLE" });
  const kept = await store.load("route:transfer-first");
  expired = true;
  await expect(signRoute(client, signer, signer, first, { store })).rejects.toMatchObject({ code: "STATE_CONFLICT", reason: "grouped_route" });
  expect(await store.load("route:transfer-first")).toEqual(kept);
  expect(signed).toEqual(["message", "PayTake"]);
});

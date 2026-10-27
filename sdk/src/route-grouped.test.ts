import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { ASTER_TRANSFER_CHAIN_ID, asterRequest } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { route, type RouteRequest } from "./route.ts";
import { RouteAbandoned } from "./index.ts";
import { TransferPending } from "./transfer.ts";

const owner = `0x${"11".repeat(20)}` as const;
const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const error = (status: number, code: string, reason?: string) =>
  Response.json({ error: { code, message: code, request_id: "r", retryable: false, ...(reason ? { reason } : {}) } }, { status });

const fill = (take: string, state: "SETTLED" | "RESERVED" | "EXPIRED", paid: string, out: string, signed = state !== "RESERVED") => ({ id: `fill-${take}`, take_id: take, amount_in: paid,
  amount_out: out, state, payment_leg: state === "SETTLED" ? "CLAIMED" : "NONE", maker_leg: state === "SETTLED" ? "CLAIMED" : state === "EXPIRED" ? "ABANDONED" : "NONE",
  maker_claimed_at: state === "SETTLED" ? at(-5) : null, signed_at: signed ? at(-20) : null, transactions: [], delivery_hash: null, payment_locked_at: null, pay_by: at(45) });
const base = { max_parts: 1, payer: owner, recipient: owner, withdrawal_preparation: null, withdrawal: null, cancelled_at: null, created_at: at(0), funding_plan: null };
const then = { to: "polymarket", recipient: owner, amount_in: "10000000", min_out: "9000000", chain_id: 137 };
const grouped = (state: string) => ({ state, second_transfer_id: "transfer-second", first_take_id: "take-first", second_take_id: "take-second", commit_by: at(40) });

/**
 * Lighter → Hyperliquid → Polymarket. `state`: the route as the first transfer shows it from the
 * start, `closedAfter` reads of it before a committed one closes; `paid`: whether its second take
 * paid; `left`: what the first transfer leaves to continue with once closed; `kept`: its first take
 * delivered into the available balance, which holds `escrow`, `mixed` half of it; `venueRead`:
 * false when Hyperliquid cannot be read; `continued`: a successor of its second transfer already
 * open; `accept`: a successor is created rather than refused.
 */
function api(options: { state?: string | null; closedAfter?: number; paid?: boolean; left?: string; from?: string; prepare?: () => Response; kept?: boolean; mixed?: boolean;
  escrow?: string; venueRead?: boolean; continued?: boolean; accept?: boolean } = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  let reads = 0, declined = false;
  const from = options.from ?? "lighter";
  const state = () => options.state === "committed" && reads >= (options.closedAfter ?? 0) ? "closed" : options.state ?? null;
  const first = () => {
    const shown = state();
    return { ...base, id: "transfer-first", client_transfer_id: "move", client_take_id: "transfer:transfer-first", from, to: "hyperliquid", from_chain_id: from === "aster" ? 56 : 304,
      to_chain_id: 999, amount_in: "10006500", min_out: "0", take_id: "take-first", take_final: shown === "closed", then, previous_transfer_id: null,
      continuable: shown === "closed" ? options.left ?? "0" : null, grouped: shown ? grouped(shown) : null };
  };
  const second = () => ({ ...base, id: "transfer-second", client_transfer_id: "grouped:transfer-first", client_take_id: "transfer:transfer-second", from: "hyperliquid", to: "polymarket",
    from_chain_id: 999, to_chain_id: 137, amount_in: "6000000", min_out: "5400000", take_id: "take-second", take_final: true, previous_transfer_id: "transfer-first", then: null,
    continuable: null, grouped: grouped(state() ?? "aborted") });
  const successor = { ...base, id: "transfer-third", client_transfer_id: "renew:transfer-second", client_take_id: "transfer:transfer-third", from: "hyperliquid", to: "polymarket",
    from_chain_id: 999, to_chain_id: 137, amount_in: "10000000", min_out: "9000000", take_id: null, take_final: false, previous_transfer_id: "transfer-first", then: null,
    continuable: null, grouped: null, funding_plan: { venue: "hyperliquid", owner, amount: "10000000", deposit: "0", withdrawal_amount: "0", withdrawal_to: null, observed_at: at(0),
      payment_setup: "done", requests: [{ kind: "pay_take", signer: owner, chain_id: 999 }] } };
  const nonce = String(BigInt(Math.floor(Date.now() / 1000) + 15) * 1_000_000n);
  const aster = { kind: "aster_transfer", signer: owner, fill_id: "fill-take-first",
    typed_data: asterRequest(`asset=USDT&amount=10.0065&toAddress=${owner}&clientTranId=${"0".repeat(32)}&nonce=${nonce}&user=${owner}`, ASTER_TRANSFER_CHAIN_ID) };
  const routes: Record<string, () => unknown> = {
    "POST /v1/transfers": () => options.accept ? Response.json(successor, { status: 201 }) : error(409, "STATE_CONFLICT", "stop"),
    "GET /v1/transfers/transfer-first": () => { reads++; return first(); },
    "GET /v1/transfers/transfer-second": second,
    "GET /v1/transfers": () => ({ data: [...options.continued ? [successor] : [], second(), first()], next_cursor: null, has_more: false }),
    "GET /v1/transfers/transfer-third": () => successor,
    "POST /v1/transfers/transfer-first/grouped": options.prepare ?? (() => error(409, "STATE_CONFLICT", "grouped_unavailable")),
    "GET /v1/balances": () => [{ venue: from, address: owner, venue_wallet: "42" }, { venue: "hyperliquid", address: owner, venue_wallet: null,
      withdrawable: options.venueRead === false ? null : "100000000", withdrawal_fee: "0", read_at: options.venueRead === false ? null : at(1), chain_balance: "0",
      escrow_balance: options.escrow ?? "0", deposit_balance: "0", chain_read_at: at(0) }, { venue: "polymarket", address: owner }],
    "GET /v1/takes/take-first": () => state() ? { take: { id: "take-first", fills: options.mixed
      ? [{ ...fill("take-first", "SETTLED", "5003250", "5000000"), maker_destination: "escrow" }, { ...fill("take-first", "SETTLED", "5003250", "5000000"), id: "fill-other", maker_destination: "venue" }]
      : [{ ...fill("take-first", "SETTLED", "10006500", "10000000"), maker_destination: options.kept ? "escrow" : "venue" }] }, to_sign: [] }
      // Signed alone: an Aster reservation past its nonce bound, ten seconds short of its pay_by.
      : { take: { id: "take-first", fills: [{ ...fill("take-first", declined ? "EXPIRED" : "RESERVED", "10006500", "10000000", false), pay_by: at(25) }] }, to_sign: declined ? [] : [aster] },
    "DELETE /v1/takes/take-first": () => { declined = true; return new Response(null, { status: 204 }); },
    "GET /v1/takes/take-second": () => ({ take: { id: "take-second", fills: [fill("take-second", options.paid === false ? "EXPIRED" : "SETTLED", "6000000", "5994000", options.paid !== false)] }, to_sign: [] }),
  };
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url), name = `${request.method} ${url.pathname}`;
    calls.push(name);
    if (request.method === "POST") bodies.push({ name, ...record(await request.json().catch(() => ({}))) });
    const answer = (routes[name] ?? (() => error(404, "NOT_FOUND")))();
    return answer instanceof Response ? answer : Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, bodies };
}

const signer = { address: owner, signMessage: async () => "0x00" as const, signTypedData: async () => "0x00" as const };
const request: RouteRequest = { client_transfer_id: "move", from: "lighter", via: "hyperliquid", to: "polymarket", amount_in: "10006500", min_out: "0",
  then: { amount_in: "10000000", min_out: "9000000" }, recipient: owner, funding: "venue", transfer_id: "transfer-first" };
const fast = { pollMs: 1, sleep: async () => {} };

test("a committed route is followed until it closes, settling only, its second take's payment the route's second leg", async () => {
  const { client, calls } = api({ state: "committed", closedAfter: 3 });
  const stages: string[] = [];
  const result = await route(client, signer, request, { ...fast, grouped: true, onStage: stage => stages.push(stage) });
  expect(stages).toEqual(["settling"]);
  expect(calls.some(call => call.startsWith("POST"))).toBe(false);
  expect(result.second.map(fill => fill.take_id)).toEqual(["take-second"]);
});

test("a committed route still open when the wait ends is pending, never returned", async () => {
  const { client } = api({ state: "committed", closedAfter: Number.POSITIVE_INFINITY });
  let clock = Date.now();
  await expect(route(client, signer, request, { pollMs: 1, sleep: async () => { clock += 60_000; }, now: () => clock, arrivalWaitMs: 120_000, grouped: true }))
    .rejects.toBeInstanceOf(TransferPending);
});

test("what a closed route leaves continues through a successor of its second transfer, never the second itself", async () => {
  const { client, bodies } = api({ state: "committed", paid: false, left: "10000000" });
  await expect(route(client, signer, request, { ...fast, grouped: true })).rejects.toThrow();
  expect(bodies.filter(body => body.name === "POST /v1/transfers").map(body => [body.client_transfer_id, body.amount_in])).toEqual([["renew:transfer-second", "10000000"]]);
});

test("the first transfer is compared with the request, and named, before anything is reserved or signed", async () => {
  const { client, calls } = api();
  const named: number[] = [];
  await route(client, signer, request, { ...fast, arrivalWaitMs: 1, grouped: true, onIntent: () => { named.push(calls.length); } }).catch(() => null);
  expect(calls.slice(0, required(named[0]))).toEqual(["GET /v1/transfers/transfer-first"]);
  const other = api();
  await expect(route(other.client, signer, { ...request, amount_in: "20000000" }, { ...fast, grouped: true })).rejects.toThrow("Transfer terms changed");
  expect(other.calls).toEqual(["GET /v1/transfers/transfer-first"]);
});

test("without grouped, a route is signed leg by leg", async () => {
  const { client, calls } = api();
  await route(client, signer, request, { ...fast, arrivalWaitMs: 1 }).catch(() => null);
  expect(calls.some(call => call.includes("/grouped"))).toBe(false);
});

test("an unavailable grouped Aster route never replaces its take or starts a sequential transfer", async () => {
  const { client, calls, bodies } = api({ from: "aster" });
  await expect(route(client, signer, { ...request, from: "aster" }, { ...fast, grouped: true })).rejects.toBeInstanceOf(RouteAbandoned);
  expect(calls).toEqual(["GET /v1/transfers/transfer-first", "POST /v1/transfers/transfer-first/grouped"]);
  expect(bodies.some(body => body.name === "POST /v1/transfers")).toBe(false);
});

/** A closed route whose second take never paid, its first take's 10 kept in escrow, Hyperliquid unread. */
const kept = { state: "committed", paid: false, left: "10000000", kept: true, escrow: "10000000", venueRead: false };

test("a route kept in escrow continues from its available balance, Hyperliquid unread, never withdrawing", async () => {
  const { client, calls, bodies } = api({ ...kept, accept: true });
  await expect(route(client, signer, request, { ...fast, arrivalWaitMs: 1_000, grouped: true })).rejects.toThrow("NOT_FOUND");
  expect(bodies.filter(body => body.name === "POST /v1/transfers").map(body => [body.client_transfer_id, body.amount_in])).toEqual([["renew:transfer-second", "10000000"]]);
  // Paid from the available balance, it goes on to price its take.
  expect(calls).toContain("GET /v1/books");
  expect(calls.some(call => call.includes("/withdrawal"))).toBe(false);
});

test("a successor of a route kept in escrow, resumed, pays from it, never withdrawing", async () => {
  const { client, calls } = api({ ...kept, continued: true });
  await expect(route(client, signer, request, { ...fast, arrivalWaitMs: 1_000, grouped: true })).rejects.toThrow("NOT_FOUND");
  expect(calls).toContain("GET /v1/transfers/transfer-third");
  expect(calls).toContain("GET /v1/books");
  expect(calls.some(call => call.includes("/withdrawal"))).toBe(false);
});

test("a first take delivered partly into the venue continues from the venue and the escrow together", async () => {
  const { client, bodies } = api({ state: "committed", paid: false, left: "10000000", mixed: true, escrow: "5000000" });
  await expect(route(client, signer, request, { ...fast, arrivalWaitMs: 1_000, grouped: true })).rejects.toThrow("STATE_CONFLICT");
  expect(bodies.filter(body => body.name === "POST /v1/transfers").map(body => [body.client_transfer_id, body.amount_in])).toEqual([["renew:transfer-second", "10000000"]]);
});

test("resuming an aborted grouped route stops before any reservation or signature", async () => {
  const { client, calls } = api({ state: "aborted" });
  await expect(route(client, signer, request, { ...fast, grouped: true })).rejects.toMatchObject({ name: "RouteAbandoned", reason: "aborted", transferId: "transfer-first" });
  expect(calls).toEqual(["GET /v1/transfers/transfer-first"]);
});

test("the caller can explicitly retry an unavailable route leg by leg", async () => {
  const { client, calls, bodies } = api({ from: "aster" });
  const aster = { ...request, from: "aster" };
  await expect(route(client, signer, aster, { ...fast, grouped: true })).rejects.toBeInstanceOf(RouteAbandoned);
  await expect(route(client, signer, aster, { ...fast, grouped: false })).rejects.toThrow("STATE_CONFLICT");
  expect(calls).toContain("DELETE /v1/takes/take-first");
  expect(bodies.filter(body => body.name === "POST /v1/transfers").map(body => body.client_transfer_id)).toEqual(["retry:transfer-first"]);
});

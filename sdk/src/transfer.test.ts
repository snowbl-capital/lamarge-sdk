import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import type { Signing } from "./signer.ts";
import { memoryStore } from "./store.ts";
import { take } from "./take.ts";
import { transfer, type TransferRequest } from "./transfer.ts";

const payer = `0x${"11".repeat(20)}` as const, maker = `0x${"22".repeat(20)}`, id = `0x${"aa".repeat(32)}`;
const now = () => Math.floor(Date.now() / 1000);
const at = (seconds: number) => new Date((now() + seconds) * 1000).toISOString();

/** The API as a taker sees it for one Hyperliquid to Polymarket transfer of 1 USDC. */
function api(options: { chainBalance?: string; withdrawalAmount?: string; recipient?: string; linkedRecipient?: string; failSubmissions?: number;
  permit?: boolean; levels?: unknown[]; stalePreparation?: boolean; loseCancel?: boolean; refuseCancel?: boolean; takeId?: string; answered?: Record<string, unknown>;
  unreadable?: number } = {}) {
  const calls: string[] = [];
  let failures = options.failSubmissions ?? 0;
  let unreadable = options.unreadable ?? 0;
  const intent = {
    id: "transfer-1", client_transfer_id: "move-1", client_take_id: "take-client-1", from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000",
    max_parts: 8, payer, recipient: payer, from_chain_id: 999, to_chain_id: 137, withdrawal: null, take_id: (options.takeId ?? null) as string | null,
    withdrawal_preparation: options.stalePreparation ? { amount: "600000", created_at: at(-60), typed_data: {} } : null,
    take_final: null, previous_transfer_id: null, continuable: null, cancelled_at: null as string | null, created_at: at(0),
    funding_plan: { venue: "hyperliquid", owner: payer, amount: "1000000", deposit: "0", withdrawal_amount: options.withdrawalAmount ?? "0",
      withdrawal_to: options.withdrawalAmount ? "signer" : null, observed_at: at(0), payment_setup: options.permit ? "required" : "done",
      requests: [...options.permit ? [{ kind: "permit", signer: payer, chain_id: 999 }] : [], ...options.withdrawalAmount ? [{ kind: "margin_move", signer: payer, chain_id: 999 }] : [], { kind: "pay_take", signer: payer, chain_id: 999 }] },
  };
  const fill = { id: "fill-1", take_id: "take-1", order_id: id, sequence: 1, role: "taker", state: "RESERVED", from_venue: "hyperliquid", to_venue: "polymarket",
    amount_in: "1000000", amount_out: "1005000", payer, maker_recipient: maker, taker_recipient: payer, swap_id: id, hashlock: `0x${"bb".repeat(32)}`,
    pay_by: at(45), t1: at(3600), t2: at(7200), signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_hash: null, payment_locked_at: null, maker_claimed_at: null };
  const payment = { payer, swapId: id, recipient: maker, amount: "1000000", hashlock: fill.hashlock, refundAt: now() + 7200, deadline: now() + 45, orderId: id, sequence: 1,
    amountOut: fill.amount_out, receiveChainId: 137, receiveToken: required(CHAINS.polymarket).token, receiveEscrow: ESCROW, receiveRecipient: options.recipient ?? payer, dex: 0 };
  const prepared = () => ({ take: { id: "take-1", fills: [fill] }, to_sign: [{ kind: "pay_take", fill_id: fill.id, signer: payer,
    typed_data: { types: { EIP712Domain, ...schemas.PayTake }, primaryType: "PayTake", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW }, message: { payer, deposit: "0", payments: [payment] } } }] });
  const routes: Record<string, (body: unknown) => unknown> = {
    "GET /v1/venues": () => [],
    "GET /v1/orders": () => [],
    "GET /v1/books": () => ({ from: "hyperliquid", to: "polymarket", max_fill: "100000000", levels: options.levels ?? [{ order_id: id, supply: "1005000", receive: "1000000", available: "100000000", min_fill: "1", valid_until: at(60) }] }),
    "POST /v1/transfers": body => {
      const id = String(record(body).client_transfer_id);
      if (id.startsWith("renew:")) { Object.assign(intent, { id: "transfer-2", client_transfer_id: id, cancelled_at: null, withdrawal_preparation: null }); }
      return { ...intent, ...options.answered };
    },
    "GET /v1/transfers/transfer-1": () => intent.id === "transfer-1" ? intent : { ...intent, id: "transfer-1", cancelled_at: at(0) },
    "GET /v1/transfers/transfer-2": () => intent,
    "DELETE /v1/transfers/transfer-1": () => {
      if (options.refuseCancel) return Response.json({ error: { code: "STATE_CONFLICT", message: "withdrawal accepted", request_id: "r", retryable: false } }, { status: 409 });
      intent.cancelled_at = at(0);
      if (options.loseCancel) { options.loseCancel = false; throw new TypeError("lost cancel acknowledgement"); }
      return null;
    },
    "GET /v1/balances": () => [
      { venue: "hyperliquid", address: payer, venue_wallet: null, chain_balance: options.chainBalance ?? "1000000", chain_error: null, chain_read_at: at(0), escrow_balance: "0", deposit_balance: "0" },
      { venue: "polymarket", address: options.linkedRecipient ?? payer, venue_wallet: null, chain_balance: "0", chain_error: null, chain_read_at: at(0), escrow_balance: "0", deposit_balance: "0" },
    ],
    "POST /v1/takes": () => { intent.take_id = "take-1"; return prepared(); },
    "GET /v1/takes/take-1": () => prepared(),
    "POST /v1/takes/take-1/signatures": () => {
      if (failures-- > 0) throw new TypeError("connection reset");
      if (unreadable-- > 0) return {};
      return { fills: [{ ...fill, state: "PAID", signed_at: at(0) }] };
    },
  };
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    calls.push(route);
    const handler = routes[route];
    if (!handler) return Response.json({ error: { code: "NOT_FOUND", message: route, request_id: "r", retryable: false } }, { status: 404 });
    const body: unknown = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json();
    const answer = handler(body);
    return answer instanceof Response ? answer : answer === null ? new Response(null, { status: 204 }) : Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, fill, payment };
}

const counting = () => {
  const signer = { address: payer, signed: 0, signMessage: async () => "0x00" as const, signTypedData: async () => { signer.signed++; return "0x00" as const; } };
  return signer;
};
const request: TransferRequest = { client_transfer_id: "move-1", from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000", recipient: payer, funding: "wallet" };

test("a wallet-funded transfer signs only its payment and submits it", async () => {
  const { client, calls } = api();
  const signer = counting();
  const stages: string[] = [];
  const fills = await transfer(client, signer, request, { onStage: stage => stages.push(stage) });
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.signed).toBe(1);
  expect(stages).toEqual(["checking", "taking", "taking"]);
  expect(calls).not.toContain("POST /v1/transfers/transfer-1/withdrawal");
});

test("wallet funding never withdraws: a shortfall stops before anything is signed or reserved", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000" });
  const signer = counting();
  await expect(transfer(client, signer, request)).rejects.toThrow("Wallet funds do not cover the transfer");
  expect(signer.signed).toBe(0);
  expect(calls.some(call => call.startsWith("POST /v1/takes") || call.includes("withdrawal"))).toBe(false);
});

test("a payment to anyone but the requested recipient is never signed", async () => {
  const { client } = api({ recipient: maker });
  const signer = counting();
  await expect(transfer(client, signer, request)).rejects.toThrow();
  expect(signer.signed).toBe(0);
});

test("after a lost submission, running it again submits the stored signature instead of signing another", async () => {
  const { client } = api({ failSubmissions: 3 });
  const signer = counting();
  const store = memoryStore();
  let transferId: string | undefined;
  await expect(transfer(client, signer, request, { store, onIntent: intent => { transferId = intent.id; } })).rejects.toThrow("connection reset");
  expect(signer.signed).toBe(1);
  const fills = await transfer(client, signer, { ...request, transfer_id: transferId }, { store });
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.signed).toBe(1);
});

test("an unreadable answer to the payment keeps its signature, submitted again as signed", async () => {
  const { client } = api({ unreadable: 1 });
  const signer = counting();
  const store = memoryStore();
  await expect(transfer(client, signer, request, { store })).rejects.toThrow("Unreadable answer to the payment");
  expect(await store.load("take:take-1")).toBeDefined();
  expect((await transfer(client, signer, { ...request, transfer_id: "transfer-1" }, { store })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.signed).toBe(1);
});

test("the caller's own checks see each request once it is checked, before it is first signed, and can stop it", async () => {
  const seen: string[] = [];
  const watched = (refuse: boolean) => (signing: Signing) => {
    seen.push(signing.kind === "take" ? `take ${signing.prepared.take.id} ${signing.input.amount_in}` : signing.kind);
    if (refuse) throw new Error("over my own limit");
  };
  const refused = counting();
  await expect(transfer(api().client, refused, request, { beforeSigning: watched(true) })).rejects.toThrow("over my own limit");
  expect(refused.signed).toBe(0);
  expect(seen).toEqual(["take take-1 1000000"]);
  // A stored signature submitted again is no new signature: nothing to check.
  seen.length = 0;
  const { client } = api({ failSubmissions: 3 });
  const signer = counting();
  const store = memoryStore();
  let transferId: string | undefined;
  await expect(transfer(client, signer, request, { store, beforeSigning: watched(false), onIntent: intent => { transferId = intent.id; } })).rejects.toThrow("connection reset");
  await transfer(client, signer, { ...request, transfer_id: transferId }, { store, beforeSigning: watched(false) });
  expect(seen).toEqual(["take take-1 1000000"]);
  expect(signer.signed).toBe(1);
});

test("a signature stored by an earlier release, without its request, is still submitted", async () => {
  const { client } = api({ takeId: "take-1" });
  const store = memoryStore();
  await store.save("take:take-1", [{ kind: "pay_take", fill_id: "fill-1", signature: "0x00" }]);
  const signer = counting();
  const fills = await transfer(client, signer, { ...request, transfer_id: "transfer-1" }, { store });
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.signed).toBe(0);
});

test("a resumed take never pays an account other than the transfer's recipient", async () => {
  const { client } = api({ takeId: "take-1", recipient: maker, linkedRecipient: maker });
  const signer = counting();
  await expect(transfer(client, signer, { ...request, transfer_id: "transfer-1" })).rejects.toThrow("Linked account changed");
  expect(signer.signed).toBe(0);
});

test("wallet funding is refused for a venue whose account pays, before any request", async () => {
  const { client, calls } = api();
  const signer = counting();
  await expect(transfer(client, signer, { ...request, from: "aster" })).rejects.toThrow("Wallet funding does not apply to aster");
  expect(calls).toEqual([]);
  expect(signer.signed).toBe(0);
});

test("wallet funds short of the amount sign no permit, even when the plan shows no withdrawal", async () => {
  const { client, calls } = api({ chainBalance: "400000", permit: true });
  const signer = counting();
  await expect(transfer(client, signer, request)).rejects.toThrow("Wallet funds do not cover the transfer");
  expect(signer.signed).toBe(0);
  expect(calls.some(call => call.includes("/setup/"))).toBe(false);
});

test("margin leaves the venue only for a take the book can execute", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000", levels: [] });
  const signer = counting();
  await expect(transfer(client, signer, { ...request, funding: "venue" })).rejects.toThrow("No executable price available");
  expect(signer.signed).toBe(0);
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
});

test("the book is priced at the caller's clock: a level past its validity there funds nothing", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000" });
  const signer = counting();
  await expect(transfer(client, signer, { ...request, funding: "venue" }, { now: () => Date.now() + 90_000 })).rejects.toThrow("No executable price available");
  expect(signer.signed).toBe(0);
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
});

test("a replacement decided before a lost cancellation answer is completed on the next run", async () => {
  const { client } = api({ stalePreparation: true, loseCancel: true });
  const signer = counting();
  const store = memoryStore();
  await expect(transfer(client, signer, { ...request, funding: "venue", transfer_id: "transfer-1" }, { store })).rejects.toThrow("lost cancel acknowledgement");
  const named: string[] = [];
  const fills = await transfer(client, signer, { ...request, funding: "venue", transfer_id: "transfer-1" }, { store, onIntent: intent => { named.push(intent.id); } });
  expect(named).toEqual(["transfer-2"]);
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(await store.load("renewal:transfer-1")).toBeUndefined();
});

test("a recovered take from wallet funds signs only after a fresh read covers it", async () => {
  const { client, calls } = api({ takeId: "take-1", chainBalance: "0" });
  const signer = counting();
  await expect(transfer(client, signer, { ...request, transfer_id: "transfer-1" })).rejects.toThrow("Wallet funds do not cover the transfer");
  expect(signer.signed).toBe(0);
  expect(calls).not.toContain("POST /v1/takes/take-1/signatures");
});

test("a replacement recorded as funded is never funded again, even when the balance looks short", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000" });
  const store = memoryStore();
  await store.save("funded:transfer-1", true);
  const signer = counting();
  await transfer(client, signer, { ...request, funding: "venue", transfer_id: "transfer-1" }, { store });
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
  expect(calls).toContain("POST /v1/takes");
});

test("a transfer answered under another client id, or between other chains, is never paid", async () => {
  for (const answered of [{ client_transfer_id: "move-2" }, { to_chain_id: 56 }, { from_chain_id: 137 }]) {
    const { client, calls } = api({ answered });
    const signer = counting();
    await expect(transfer(client, signer, request)).rejects.toThrow(/another transfer|Transfer terms changed/);
    expect(signer.signed).toBe(0);
    expect(calls.some(call => call.startsWith("POST /v1/takes"))).toBe(false);
  }
});

test("a take checks its payment window against the caller's clock", async () => {
  const input = { from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000", client_take_id: "take-client-1" };
  const late = counting();
  await expect(take(api().client, late, input, { now: () => Date.now() + 120_000 })).rejects.toThrow();
  expect(late.signed).toBe(0);
  const signer = counting();
  expect((await take(api().client, signer, input, { now: () => Date.now() })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.signed).toBe(1);
});

test("a refused cancellation leaves no replacement owed", async () => {
  const { client } = api({ stalePreparation: true, refuseCancel: true });
  const store = memoryStore();
  await expect(transfer(client, counting(), { ...request, funding: "venue", transfer_id: "transfer-1" }, { store })).rejects.toThrow("withdrawal accepted");
  expect(await store.load("renewal:transfer-1")).toBeUndefined();
});

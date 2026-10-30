import { expect, test } from "bun:test";
import { createClient, LaMargeError } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas, UNLIMITED_ALLOWANCE } from "./protocol/protocol.ts";
import { array, record, required } from "./protocol/validation.ts";
import type { Signing } from "./signer.ts";
import { memoryStore } from "./store.ts";
import { take } from "./take.ts";
import { transfer, TransferPending, type TransferRequest } from "./transfer.ts";

const payer = `0x${"11".repeat(20)}` as const, maker = `0x${"22".repeat(20)}`, id = `0x${"aa".repeat(32)}`;
const now = () => Math.floor(Date.now() / 1000);
const at = (seconds: number) => new Date((now() + seconds) * 1000).toISOString();

const sendAsset = (amount: string, sourceDex = "") => ({ types: { EIP712Domain, ...schemas["HyperliquidTransaction:SendAsset"] }, primaryType: "HyperliquidTransaction:SendAsset",
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 999, verifyingContract: `0x${"00".repeat(20)}` },
  message: { hyperliquidChain: "Mainnet", destination: `0x20${"00".repeat(19)}`, sourceDex, destinationDex: "spot", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: String(Number(amount) / 1e6), fromSubAccount: "", nonce: Date.now() } });
const permitTyped = () => ({ types: { EIP712Domain, ...schemas.Permit }, primaryType: "Permit",
  domain: { name: required(CHAINS.hyperliquid?.permit), version: required(CHAINS.hyperliquid?.version), chainId: 999, verifyingContract: required(CHAINS.hyperliquid).token },
  message: { owner: payer, spender: ESCROW, value: UNLIMITED_ALLOWANCE.toString(), nonce: "0", deadline: String(now() + 300) } });

function api(options: { chainBalance?: string; withdrawalAmount?: string; recipient?: string; linkedRecipient?: string; failSubmissions?: number;
  permit?: boolean; levels?: unknown[]; stalePreparation?: boolean; loseCancel?: boolean; refuseCancel?: boolean; takeId?: string; answered?: Record<string, unknown>;
  unreadable?: number; from?: string; setup?: string; permitReads?: string[]; funds?: Record<string, string>[]; withdrawal?: string; withdrawn?: string;
  loseWithdrawals?: number; unrecorded?: number; freshPreparation?: boolean; takeFill?: Record<string, unknown>; refuseTakeCancel?: boolean;
  then?: Record<string, string | number>; loseReplacements?: number; live?: string[]; spent?: string; withdrawnDuringPermit?: boolean;
  previous?: "grouped" | "single" | undefined; atOnce?: boolean; committed?: boolean; payWindow?: number; submittedMeanwhile?: boolean; conflict?: string;
  fromDex?: string; sourceDex?: string } = {}) {
  const calls: string[] = [];
  // A withdrawal prepared, never submitted: a server without takes signed at once takes nothing before it.
  let unsent = Boolean(options.freshPreparation) && !options.withdrawal, committed = Boolean(options.committed);
  const bodies: Record<string, unknown[]> = {};
  let failures = options.failSubmissions ?? 0;
  let unreadable = options.unreadable ?? 0;
  let lostWithdrawals = options.loseWithdrawals ?? 0, unrecorded = options.unrecorded ?? 0, lostReplacements = options.loseReplacements ?? 0, reads = 0, permitReads = 0;
  // What the escrow chain holds for the payer: the server's plan reads it live, as of the last balances
  // answer unless `live` gives each of its reads after a withdrawal.
  let held = 0n, liveReads = 0;
  const from = options.from ?? "hyperliquid";
  const setup = options.setup ?? (options.permit ? "required" : "done");
  const withdrawal = (state: string) => ({ id: "withdrawal-1", venue: from, amount: options.withdrawalAmount ?? "600000", destination: payer, state, venue_ref: null,
    error: state === "refused" ? "Margin unavailable" : null, created_at: at(0), relayed_at: state === "relayed" ? at(0) : null });
  const intent = {
    id: "transfer-1", client_transfer_id: "move-1", client_take_id: "take-client-1", from, to: "polymarket", amount_in: "1000000", min_out: "1000000",
    max_parts: 8, payer, recipient: payer, from_chain_id: required(CHAINS[from]).id, to_chain_id: 137,
    withdrawal: (options.withdrawal ? withdrawal(options.withdrawal) : null) as Record<string, unknown> | null, take_id: (options.takeId ?? null) as string | null,
    withdrawal_preparation: options.stalePreparation ? { amount: "600000", created_at: at(-60), typed_data: {} }
      : options.freshPreparation ? { amount: "600000", created_at: at(0), typed_data: sendAsset("600000") } : null as unknown,
    take_final: null, previous_transfer_id: options.previous ? "transfer-0" : null, continuable: null, cancelled_at: null as string | null, created_at: at(0), ...options.then ? { then: options.then } : {},
    ...options.fromDex ? { from_dex: options.fromDex } : {},
    funding_plan: { venue: "hyperliquid", owner: payer, amount: "1000000", deposit: setup === "required" ? "1000000" : "0", withdrawal_amount: options.withdrawalAmount ?? "0",
      withdrawal_to: options.withdrawalAmount ? "signer" : null, observed_at: at(0), payment_setup: setup, ...options.atOnce ? { signed_at_once: true } : {},
      requests: [...setup === "required" ? [{ kind: "permit", signer: payer, chain_id: 999 }] : [], ...options.withdrawalAmount ? [{ kind: "margin_move", signer: payer, chain_id: 999 }] : [], { kind: "pay_take", signer: payer, chain_id: 999 }] },
  };
  const fill = { id: "fill-1", take_id: "take-1", order_id: id, sequence: 1, role: "taker", state: "PREPARED", from_venue: "hyperliquid", to_venue: "polymarket",
    amount_in: "1000000", amount_out: "1005000", payer, maker_recipient: maker, taker_recipient: payer, taker_fee: "0", swap_id: id, hashlock: `0x${"bb".repeat(32)}`,
    pay_by: at(options.payWindow ?? 45), t1: at(3600), t2: at(7200), signed_at: null, payment_leg: "NONE", maker_leg: "NONE", transactions: [], delivery_hash: null, payment_locked_at: null, maker_claimed_at: null };
  const payment = { payer, swapId: id, recipient: maker, amount: "1000000", hashlock: fill.hashlock, refundAt: now() + 7200, deadline: now() + (options.payWindow ?? 45), orderId: id, sequence: 1,
    amountOut: fill.amount_out, receiveChainId: 137, receiveToken: required(CHAINS.polymarket).token, receiveEscrow: ESCROW, receiveRecipient: options.recipient ?? payer, dex: 0 };
  const prepared = () => ({ take: { id: "take-1", fills: [{ ...fill, ...committed ? { signed_at: at(0) } : {}, ...options.takeFill }] }, to_sign: committed ? [] : [{ kind: "pay_take", fill_id: fill.id, signer: payer,
    typed_data: { types: { EIP712Domain, ...schemas.PayTake }, primaryType: "PayTake", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW }, message: { payer, deposit: "0", payments: [payment] } } }] });
  const permitStep = (status: string) => ({ step: "permit", status, reason: null, expires_at: null, needed_for: ["pay"], hash: null,
    to_sign: status === "required" ? { kind: "permit", signer: payer, ref: "permit-1", typed_data: permitTyped() } : null });
  const payerBalance = () => {
    const row = { venue: from, address: payer, venue_wallet: null, chain_balance: options.chainBalance ?? "1000000", chain_error: null, chain_read_at: at(0), escrow_balance: "0",
      deposit_balance: "0", ...options.funds?.[Math.min(reads++, options.funds.length - 1)] };
    held = BigInt(row.chain_balance) + BigInt(row.escrow_balance);
    return row;
  };
  /** The transfer as the server answers it: its funding plan only when asked, after a relayed withdrawal only once the funds arrived. */
  const answer = (query: URLSearchParams) => {
    const plan = intent.funding_plan;
    if (query.get("funding_plan") !== "true" || intent.take_id || intent.cancelled_at) return { ...intent, funding_plan: null };
    if (!intent.withdrawal) return options.spent ? { ...intent, funding_plan: { ...plan, withdrawal_amount: options.spent } } : intent;
    const live = options.live ? BigInt(options.live[Math.min(liveReads++, options.live.length - 1)] ?? "0") : held;
    if (intent.withdrawal.state !== "relayed" || live < BigInt(intent.amount_in)) return { ...intent, funding_plan: null };
    return { ...intent, funding_plan: { ...plan, withdrawal_amount: "0", withdrawal_to: null, requests: plan.requests.filter(request => request.kind !== "margin_move") } };
  };
  const routes: Record<string, (body: unknown, query: URLSearchParams) => unknown> = {
    "GET /v1/venues": () => [],
    "GET /v1/orders": () => [],
    "GET /v1/books": () => ({ from: "hyperliquid", to: "polymarket", max_fill: "100000000", levels: options.levels ?? [{ order_id: id, supply: "1005000", receive: "1000000", available: "100000000", min_fill: "1", valid_until: at(60) }] }),
    "POST /v1/transfers": body => {
      const id = String(record(body).client_transfer_id);
      if (id.startsWith("renew:")) { Object.assign(intent, { id: "transfer-2", client_transfer_id: id, cancelled_at: null, withdrawal_preparation: null }); unsent = false; }
      if (id.startsWith("retry:")) {
        if (lostReplacements-- > 0) throw new TypeError("replacement reply lost");
        Object.assign(intent, { id: "transfer-2", client_transfer_id: id, client_take_id: "take-client-2", take_id: null, withdrawal: null, withdrawal_preparation: null });
        unsent = false;
        committed = false;
      }
      return { ...intent, ...options.answered };
    },
    "GET /v1/transfers/transfer-1": (_, query) => intent.id === "transfer-1" ? answer(query) : { ...intent, id: "transfer-1", cancelled_at: at(0) },
    "GET /v1/transfers/transfer-2": (_, query) => answer(query),
    "GET /v1/transfers/transfer-0": () => ({ ...intent, id: "transfer-0", previous_transfer_id: null, grouped: options.previous === "grouped" ? { state: "closed" } : null }),
    "DELETE /v1/transfers/transfer-1": () => {
      if (options.refuseCancel) return Response.json({ error: { code: "STATE_CONFLICT", message: "withdrawal accepted", request_id: "r", retryable: false } }, { status: 409 });
      intent.cancelled_at = at(0);
      if (options.loseCancel) { options.loseCancel = false; throw new TypeError("lost cancel acknowledgement"); }
      return null;
    },
    "POST /v1/transfers/transfer-1/withdrawal/prepare": body => {
      unsent = true;
      const typed_data = sendAsset(String(record(body).amount), options.sourceDex ?? (options.fromDex ? "xyz" : ""));
      if (options.atOnce) intent.withdrawal_preparation = { amount: String(record(body).amount), created_at: at(0), typed_data };
      return { typed_data };
    },
    "POST /v1/transfers/transfer-1/withdrawal": () => {
      unsent = false;
      if (unrecorded-- > 0) throw new TypeError("withdrawal reply lost");
      intent.withdrawal = withdrawal(options.withdrawn ?? "relayed");
      if (lostWithdrawals-- > 0) throw new TypeError("withdrawal reply lost");
      return intent.withdrawal;
    },
    "POST /v1/accounts/hyperliquid/setup/permit": body => {
      // Another run of the same transfer withdraws while this one's permit waits for its signer.
      if (options.withdrawnDuringPermit) intent.withdrawal = withdrawal("relayed");
      if (record(body).signature === undefined) return permitStep("required");
      intent.funding_plan = { ...intent.funding_plan, payment_setup: "pending", requests: intent.funding_plan.requests.filter(request => request.kind !== "permit") };
      return permitStep("pending");
    },
    "GET /v1/accounts/hyperliquid/setup": () => ({ venue: "hyperliquid", address: payer, ready: false,
      steps: [permitStep(options.permitReads?.[Math.min(permitReads++, options.permitReads.length - 1)] ?? "done")] }),
    "GET /v1/balances": () => [
      payerBalance(),
      { venue: "polymarket", address: options.linkedRecipient ?? payer, venue_wallet: null, chain_balance: "0", chain_error: null, chain_read_at: at(0), escrow_balance: "0", deposit_balance: "0" },
    ],
    "POST /v1/takes": () => {
      if (options.submittedMeanwhile) {
        // Another run of the same transfer submitted the prepared withdrawal alone.
        options.submittedMeanwhile = false;
        intent.withdrawal = withdrawal("relayed");
        unsent = false;
        return Response.json({ error: { code: "STATE_CONFLICT", reason: "withdrawal_submitted", message: "the withdrawal was submitted meanwhile: take again", request_id: "r", retryable: false } }, { status: 409 });
      }
      if (options.conflict) {
        intent.withdrawal = withdrawal("relayed");
        return Response.json({ error: { code: "STATE_CONFLICT", message: options.conflict, request_id: "r", retryable: false } }, { status: 409 });
      }
      if (unsent && !options.atOnce) return Response.json({ error: { code: "STATE_CONFLICT", message: "the prepared withdrawal must be resolved before taking", request_id: "r", retryable: false } }, { status: 409 });
      intent.take_id = "take-1";
      delete options.takeFill;
      return prepared();
    },
    "GET /v1/takes/take-1": () => prepared(),
    "DELETE /v1/takes/take-1": () => {
      if (options.refuseTakeCancel) return Response.json({ error: { code: "STATE_CONFLICT", message: "take signed", request_id: "r", retryable: false } }, { status: 409 });
      options.takeFill = { ...options.takeFill, state: "EXPIRED", maker_leg: "ABANDONED" };
      return null;
    },
    "POST /v1/takes/take-1/signatures": body => {
      if (failures-- > 0) throw new TypeError("connection reset");
      if (unreadable-- > 0) return {};
      const moves = array(record(body).signatures).filter(item => record(item).kind === "margin_move");
      if (unsent) {
        // Signed at once: the withdrawal is sent now, the payment once its funds arrive.
        if (moves.length !== 1) return Response.json({ error: { code: "VALIDATION_ERROR", message: "the take's withdrawal needs one signature", request_id: "r", retryable: false } }, { status: 400 });
        intent.withdrawal = withdrawal(options.withdrawn ?? "relayed");
        unsent = false;
        committed = true;
        return { fills: [{ ...fill, signed_at: at(0) }] };
      }
      if (moves.length) return Response.json({ error: { code: "VALIDATION_ERROR", message: "submit only the requested signatures", request_id: "r", retryable: false } }, { status: 400 });
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
    (bodies[route] ??= []).push(body);
    const answered = handler(body, new URL(request.url).searchParams);
    return answered instanceof Response ? answered : answered === null ? new Response(null, { status: 204 }) : Response.json(answered);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, bodies, intent, fill, payment };
}

const counting = (decline: (type: string) => boolean = () => false) => {
  const signer = { address: payer, signed: 0, kinds: [] as string[], signMessage: async () => "0x00" as const, signTypedData: async ({ primaryType }: { primaryType: string }) => {
    if (decline(primaryType)) throw new Error("User rejected the request");
    signer.signed++;
    signer.kinds.push(primaryType);
    return "0x00" as const;
  } };
  return signer;
};
/** The caller's clock, moved only by its own sleeps, each of which may change what the API answers next. */
const clock = (onSleep: () => void = () => {}) => {
  let time = Date.now();
  return { now: () => time, sleep: async (ms: number) => { time += ms; onSleep(); } };
};
const count = (calls: string[], route: string) => calls.filter(call => call === route).length;
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
  await expect(transfer(client, signer, request)).rejects.toThrow("The signing request differs from your instructions");
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

test("a plan the server could not compute fails as its refusal, with when to ask again", async () => {
  const { client, calls } = api({ withdrawalAmount: "600000", answered: { funding_plan: null,
    funding_plan_error: { code: "STATE_CONFLICT", message: "an earlier transfer is being sent", status: 409, retry_after: 9 } } });
  const signer = counting();
  const refused = await transfer(client, signer, { ...request, funding: "venue" }).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(LaMargeError);
  expect(refused).toMatchObject({ status: 409, code: "STATE_CONFLICT", retryAfterMs: 9_000 });
  expect(signer.signed).toBe(0);
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
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

test("the plan decides the withdrawal: a balances read predating a payment that spent the funds withdraws them all the same", async () => {
  // The balances keep showing the spent funds; the take waits until the plan shows the withdrawal arrived.
  const { client, calls, bodies } = api({ withdrawalAmount: "600000", live: ["400000", "400000", "1000000"] });
  const signer = counting();
  const stages: string[] = [];
  const fills = await transfer(client, signer, { ...request, funding: "venue" }, { onStage: stage => stages.push(stage), ...clock() });
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(bodies["POST /v1/transfers/transfer-1/withdrawal/prepare"]).toEqual([{ amount: "600000" }]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(1);
  expect(stages).toEqual(["checking", "funding", "waiting", "taking", "taking"]);
});

test("the plan decides the withdrawal: funds the balances read has not seen yet are waited for, not withdrawn again", async () => {
  const before = { chain_balance: "400000" };
  const { client, calls } = api({ funds: [before, before, { chain_balance: "1000000" }] });
  const signer = counting();
  const fills = await transfer(client, signer, { ...request, funding: "venue" }, clock());
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
});

test("the plan decides the withdrawal: a plan asking for a withdrawal while the take waits stops before anything is withdrawn or signed", async () => {
  const sweeping = [{ chain_balance: "0", deposit_balance: "1000000" }];
  for (const [funding, previous, message] of [["venue", undefined, "Funding amount changed; review the transfer again"],
    ["wallet", undefined, "Wallet funds do not cover the transfer"], ["venue", "single", "Funding amount changed; review the transfer again"]] as const) {
    const { client, calls } = api({ funds: sweeping, spent: "600000", previous });
    const signer = counting();
    await expect(transfer(client, signer, { ...request, funding }, clock())).rejects.toThrow(message);
    expect(signer.signed).toBe(0);
    expect(calls.some(call => call.includes("withdrawal") || call.startsWith("POST /v1/takes"))).toBe(false);
  }
});

test("the plan decides the withdrawal: a continuation of a route signed at once waits for what its route still brings", async () => {
  const sweeping = { chain_balance: "0", deposit_balance: "1000000" };
  const { client, calls } = api({ funds: [sweeping, sweeping, { chain_balance: "1000000" }], spent: "600000", previous: "grouped" });
  expect((await transfer(client, counting(), { ...request, funding: "venue" }, clock())).map(fill => fill.state)).toEqual(["PAID"]);
  expect(calls.some(call => call.includes("withdrawal"))).toBe(false);
});

test("the plan decides the withdrawal: after its permit is signed, the plan is read again before withdrawing", async () => {
  const before = { chain_balance: "400000" };
  const { client, calls } = api({ permit: true, withdrawalAmount: "600000", permitReads: ["done"], funds: [before, before, { chain_balance: "1000000", chain_read_at: at(1) }] });
  const signer = counting();
  const fills = await transfer(client, signer, { ...request, funding: "venue" }, clock());
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  const permit = calls.indexOf("POST /v1/accounts/hyperliquid/setup/permit"), withdrawal = calls.indexOf("POST /v1/transfers/transfer-1/withdrawal/prepare");
  expect(calls.slice(permit, withdrawal)).toContain("GET /v1/transfers/transfer-1");
});

test("the plan decides the withdrawal: one recorded while the permit waited is not withdrawn again", async () => {
  for (const [live, paid] of [["400000", false], ["1000000", true]] as const) {
    const { client, calls } = api({ permit: true, withdrawalAmount: "600000", permitReads: ["done"], withdrawnDuringPermit: true, live: [live] });
    const signer = counting();
    const run = transfer(client, signer, { ...request, funding: "venue" }, clock());
    if (paid) expect((await run).map(fill => fill.state)).toEqual(["PAID"]);
    else await expect(run).rejects.toBeInstanceOf(TransferPending);
    expect(calls.some(call => call.includes("/withdrawal"))).toBe(false);
    expect(signer.kinds).toEqual(paid ? ["Permit", "PayTake"] : ["Permit"]);
  }
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

const venue: TransferRequest = { ...request, funding: "venue" };
const short = [{ chain_balance: "400000" }, { chain_balance: "400000" }, { chain_balance: "1000000" }];
const withdrawals = (calls: string[]) => calls.filter(call => call.includes("/withdrawal"));

test("one venue-funded transfer withdraws only what the address lacks, waits for its arrival, then takes", async () => {
  const { client, calls, bodies } = api({ withdrawalAmount: "600000", funds: short });
  const signer = counting();
  const stages: string[] = [];
  const fills = await transfer(client, signer, venue, { onStage: stage => stages.push(stage), ...clock() });
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(bodies["POST /v1/transfers/transfer-1/withdrawal/prepare"]).toEqual([{ amount: "600000" }]);
  expect(stages).toEqual(["checking", "funding", "waiting", "taking", "taking"]);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
  expect(count(calls, "POST /v1/takes")).toBe(1);
});

test("a transfer from trade.xyz asks for it and signs only a withdrawal from there", async () => {
  const { client, bodies } = api({ withdrawalAmount: "600000", funds: short, fromDex: "xyz" });
  const signer = counting();
  const fills = await transfer(client, signer, { ...venue, from_dex: "xyz" }, clock());
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(record(bodies["POST /v1/transfers"]?.[0]).from_dex).toBe("xyz");
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
  // The perps prepared for trade.xyz sign nothing, and neither does an intent that dropped it.
  const swapped = api({ withdrawalAmount: "600000", funds: short, fromDex: "xyz", sourceDex: "" });
  await expect(transfer(swapped.client, counting(), { ...venue, from_dex: "xyz" }, clock())).rejects.toThrow("sourceDex");
  const dropped = api({ withdrawalAmount: "600000", funds: short });
  await expect(transfer(dropped.client, counting(), { ...venue, from_dex: "xyz" }, clock())).rejects.toThrow("Transfer terms changed");
});

test("without payment setup, the permit is signed before the withdrawal and the take waits until it is final", async () => {
  const { client, calls } = api({ setup: "required", withdrawalAmount: "600000", funds: short, permitReads: ["pending", "pending", "done"] });
  const signer = counting();
  const stages: string[] = [];
  await transfer(client, signer, venue, { onStage: stage => stages.push(stage), ...clock() });
  expect(calls.filter(call => call.includes("/setup") || call.endsWith("/withdrawal") || call === "POST /v1/takes")).toEqual([
    "POST /v1/accounts/hyperliquid/setup/permit", "POST /v1/accounts/hyperliquid/setup/permit", "POST /v1/transfers/transfer-1/withdrawal",
    ...Array<string>(3).fill("GET /v1/accounts/hyperliquid/setup"), "POST /v1/takes"]);
  expect(signer.kinds).toEqual(["Permit", "HyperliquidTransaction:SendAsset", "PayTake"]);
  expect(stages.slice(-3)).toEqual(["authorizing", "authorizing", "taking"]);
});

test("a refused permit never withdraws or takes", async () => {
  const { client, calls } = api({ setup: "required", withdrawalAmount: "600000", funds: short });
  const signer = counting(type => type === "Permit");
  await expect(transfer(client, signer, venue, clock())).rejects.toThrow("User rejected");
  expect(withdrawals(calls)).toEqual([]);
  expect(calls).not.toContain("POST /v1/takes");
});

test("a submitted permit is waited for without another signature; still pending after the wait, the transfer stays resumable and takes nothing", async () => {
  const waited = api({ setup: "pending", permitReads: ["pending", "done"] });
  const signer = counting();
  expect((await transfer(waited.client, signer, venue, clock())).map(fill => fill.state)).toEqual(["PAID"]);
  expect(waited.calls.filter(call => call.includes("/setup"))).toEqual(["GET /v1/accounts/hyperliquid/setup", "GET /v1/accounts/hyperliquid/setup"]);
  expect(signer.kinds).toEqual(["PayTake"]);
  const pending = api({ setup: "pending", permitReads: ["pending"] });
  const error = await transfer(pending.client, counting(), venue, { ...clock(), arrivalWaitMs: 10_000 }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(TransferPending);
  expect(error).toMatchObject({ reason: "authorization_unconfirmed" });
  expect(pending.calls).not.toContain("POST /v1/takes");
});

test("a final or absent payment setup is not waited for", async () => {
  for (const [options, resume] of [[{ setup: "done" }, {}], [{ withdrawal: "relayed" }, { transfer_id: "transfer-1" }]] as const) {
    const { client, calls } = api(options);
    expect((await transfer(client, counting(), { ...venue, ...resume }, clock())).map(fill => fill.state)).toEqual(["PAID"]);
    expect(calls.some(call => call.includes("/setup"))).toBe(false);
  }
});

test("funds already at the deposit address are not withdrawn again; the take waits for their sweep", async () => {
  const deposited = { chain_balance: "0", deposit_balance: "1000000" };
  const { client, calls } = api({ funds: [deposited, deposited, { chain_balance: "0", deposit_balance: "0", escrow_balance: "1000000" }] });
  const stages: string[] = [];
  expect((await transfer(client, counting(), venue, { onStage: stage => stages.push(stage), ...clock() })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(withdrawals(calls)).toEqual([]);
  expect(stages).toEqual(["checking", "waiting", "taking", "taking"]);
});

test("dust at the deposit address is not counted: the shortfall is withdrawn in full", async () => {
  const dusty = { chain_balance: "400000", deposit_balance: "500000" };
  const { client, bodies } = api({ withdrawalAmount: "600000", funds: [dusty, dusty, { chain_balance: "1000000", deposit_balance: "0" }] });
  expect((await transfer(client, counting(), venue, clock())).map(fill => fill.state)).toEqual(["PAID"]);
  expect(bodies["POST /v1/transfers/transfer-1/withdrawal/prepare"]).toEqual([{ amount: "600000" }]);
});

test("a take paid inside a venue funds nothing first and goes straight to its reservation", async () => {
  for (const from of ["aster", "lighter"]) {
    const { client, calls } = api({ from });
    const signer = counting();
    const stages: string[] = [];
    await expect(transfer(client, signer, { ...venue, from }, { onStage: stage => stages.push(stage) })).rejects.toThrow("differs from the take's venue");
    expect(stages).toEqual(["checking", "taking"]);
    expect(calls).toContain("POST /v1/takes");
    expect(withdrawals(calls)).toEqual([]);
    expect(signer.signed).toBe(0);
  }
});

test("funds on the address that cover the amount go straight to the take without a withdrawal", async () => {
  const { client, calls } = api();
  const stages: string[] = [];
  expect((await transfer(client, counting(), venue, { onStage: stage => stages.push(stage) })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(stages).toEqual(["checking", "taking", "taking"]);
  expect(withdrawals(calls)).toEqual([]);
});

test("a refused or unknown withdrawal outcome stops before taking; a queued one read later as refused ends the wait with its error", async () => {
  for (const withdrawn of ["refused", "unknown"]) {
    const { client, calls } = api({ withdrawalAmount: "600000", chainBalance: "400000", withdrawn });
    const error = await transfer(client, counting(), venue, clock()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TransferPending);
    expect(error).toMatchObject({ reason: withdrawn });
    expect(calls).not.toContain("POST /v1/takes");
  }
  const { client, calls, intent } = api({ withdrawalAmount: "600000", chainBalance: "400000", withdrawn: "queued" });
  const refuse = () => { intent.withdrawal = { ...intent.withdrawal, state: "refused", error: "Margin unavailable" }; };
  await expect(transfer(client, counting(), venue, clock(refuse))).rejects.toThrow("Margin unavailable");
  expect(calls).not.toContain("POST /v1/takes");
});

test("a balance that covers the amount does not skip reconciling a queued withdrawal: the take waits until it is relayed", async () => {
  const { client, calls, intent } = api({ withdrawal: "queued", withdrawalAmount: "600000" });
  const stages: string[] = [];
  const relay = () => { expect(calls).not.toContain("POST /v1/takes"); intent.withdrawal = { ...intent.withdrawal, state: "relayed" }; };
  expect((await transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, { onStage: stage => stages.push(stage), ...clock(relay) })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(stages).toEqual(["checking", "waiting", "taking", "taking"]);
  expect(withdrawals(calls)).toEqual([]);
});

test("a linked account changed during the arrival wait prevents the take", async () => {
  const options: Parameters<typeof api>[0] = { withdrawalAmount: "600000", chainBalance: "400000" };
  const { client, calls } = api(options);
  await expect(transfer(client, counting(), venue, clock(() => { options.linkedRecipient = maker; }))).rejects.toThrow("Linked account changed");
  expect(calls).not.toContain("POST /v1/takes");
});

test("a stale balance read is refused even when it covers the amount: nothing is withdrawn or taken", async () => {
  const { client, calls } = api({ funds: [{ chain_read_at: "2020-01-01T00:00:00Z" }] });
  const signer = counting();
  await expect(transfer(client, signer, venue)).rejects.toThrow("fresh balance");
  expect(withdrawals(calls)).toEqual([]);
  expect(calls).not.toContain("POST /v1/takes");
  expect(signer.signed).toBe(0);
});

test("an accepted take is recovered before any balance is read, and one accepted elsewhere during the arrival wait is never taken again", async () => {
  const paid = { state: "PAID", payment_leg: "LOCKED", signed_at: at(-5) };
  const resumed = api({ takeId: "take-1", withdrawal: "relayed", chainBalance: "0", takeFill: paid });
  const signer = counting();
  expect((await transfer(resumed.client, signer, { ...venue, transfer_id: "transfer-1" })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(resumed.calls).not.toContain("GET /v1/balances");
  expect(signer.signed).toBe(0);
  const options: Parameters<typeof api>[0] = { withdrawalAmount: "600000", chainBalance: "400000" };
  const { client, calls, intent } = api(options);
  const elsewhere = () => { intent.take_id = "take-1"; options.takeFill = paid; };
  expect((await transfer(client, counting(), venue, clock(elsewhere))).map(fill => fill.state)).toEqual(["PAID"]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(1);
  expect(calls).not.toContain("POST /v1/takes");
});

test("a withdrawal answer lost after the server recorded it resumes from the transfer, never submitted or signed again", async () => {
  const { client, calls } = api({ withdrawalAmount: "600000", funds: [{ chain_balance: "400000" }, { chain_balance: "1000000" }], loseWithdrawals: 3 });
  const signer = counting();
  const store = memoryStore();
  await expect(transfer(client, signer, venue, { store, ...clock() })).rejects.toThrow("withdrawal reply lost");
  const sent = count(calls, "POST /v1/transfers/transfer-1/withdrawal");
  expect((await transfer(client, signer, { ...venue, transfer_id: "transfer-1" }, { store, ...clock() })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(sent);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal/prepare")).toBe(1);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
});

test("a withdrawal the server never recorded is submitted again with its stored signature, never signed twice", async () => {
  const { client, calls } = api({ withdrawalAmount: "600000", funds: [...short.slice(0, 2), ...short], unrecorded: 3 });
  const signer = counting();
  const store = memoryStore();
  await expect(transfer(client, signer, venue, { store, ...clock() })).rejects.toThrow("withdrawal reply lost");
  expect((await transfer(client, signer, { ...venue, transfer_id: "transfer-1" }, { store, ...clock() })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal/prepare")).toBe(1);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
  expect(await store.load("transfer-withdrawal:transfer-1")).toBeUndefined();
});

test("funds never confirmed leave the transfer pending, and running it again withdraws nothing more", async () => {
  const { client, calls } = api({ withdrawalAmount: "600000", chainBalance: "400000" });
  for (const resume of [{}, { transfer_id: "transfer-1" }]) {
    const error = await transfer(client, counting(), { ...venue, ...resume }, { ...clock(), arrivalWaitMs: 10_000 }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TransferPending);
    expect(error).toMatchObject({ reason: "arrival_unconfirmed" });
  }
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(1);
  expect(calls).not.toContain("POST /v1/takes");
});

test("a resumed transfer with other terms is refused, and one changed or cancelled during the wait opens no other signature", async () => {
  const resumed = api();
  const signer = counting();
  await expect(transfer(resumed.client, signer, { ...venue, min_out: "999999", transfer_id: "transfer-1" })).rejects.toThrow("Transfer terms changed");
  expect(withdrawals(resumed.calls)).toEqual([]);
  expect(signer.signed).toBe(0);
  for (const patch of [{ min_out: "1" }, { cancelled_at: at(0) }]) {
    const { client, calls, intent } = api({ withdrawalAmount: "600000", chainBalance: "400000" });
    const changed = counting();
    await expect(transfer(client, changed, venue, clock(() => Object.assign(intent, patch)))).rejects.toThrow(/Transfer terms changed|Transfer cancelled/);
    expect(calls).not.toContain("POST /v1/takes");
    expect(changed.kinds).toEqual(["HyperliquidTransaction:SendAsset"]);
  }
});

test("the price is read again after the funds arrive; running it again reconciles the same withdrawal and takes", async () => {
  const options: Parameters<typeof api>[0] = { withdrawalAmount: "600000", funds: short };
  const { client, calls } = api(options);
  const signer = counting();
  await expect(transfer(client, signer, venue, clock(() => { options.levels = []; }))).rejects.toThrow("No executable price available");
  expect(calls).not.toContain("POST /v1/takes");
  delete options.levels;
  expect((await transfer(client, signer, { ...venue, transfer_id: "transfer-1" }, clock())).map(fill => fill.state)).toEqual(["PAID"]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(1);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
});

test("a recent withdrawal preparation is signed and submitted before any new price check", async () => {
  const { client, calls } = api({ freshPreparation: true, withdrawalAmount: "600000", funds: short, levels: [] });
  const signer = counting();
  await expect(transfer(client, signer, { ...venue, transfer_id: "transfer-1" }, clock())).rejects.toThrow("No executable price available");
  expect(calls).not.toContain("POST /v1/transfers/transfer-1/withdrawal/prepare");
  expect(calls.indexOf("POST /v1/transfers/transfer-1/withdrawal")).toBeLessThan(calls.indexOf("GET /v1/books"));
  expect(calls).not.toContain("POST /v1/takes");
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset"]);
});

test("a stale withdrawal preparation cancels its transfer before the replacement, which the take pays", async () => {
  const { client, calls, bodies } = api({ stalePreparation: true });
  const named: string[] = [];
  expect((await transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, { onIntent: intent => { named.push(intent.id); } })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(calls.indexOf("DELETE /v1/transfers/transfer-1")).toBeLessThan(calls.indexOf("POST /v1/transfers"));
  expect(bodies["POST /v1/transfers"]).toMatchObject([{ client_transfer_id: "renew:transfer-1" }]);
  expect(bodies["POST /v1/takes"]).toMatchObject([{ transfer_intent_id: "transfer-2" }]);
  expect(named).toEqual(["transfer-2"]);
  expect(withdrawals(calls)).toEqual([]);
});

test("a reservation past its payment window is cancelled before any replacement: a refused cancellation stops everything", async () => {
  const late = { now: () => Date.now() + 60_000 };
  const refused = api({ takeId: "take-1", refuseTakeCancel: true });
  const signer = counting();
  await expect(transfer(refused.client, signer, { ...venue, transfer_id: "transfer-1" }, late)).rejects.toThrow("take signed");
  expect(refused.calls).toContain("DELETE /v1/takes/take-1");
  expect(refused.calls).not.toContain("POST /v1/transfers");
  expect(signer.signed).toBe(0);
  const { client, calls, bodies } = api({ takeId: "take-1" });
  await expect(transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, late)).rejects.toThrow();
  expect(calls.indexOf("DELETE /v1/takes/take-1")).toBeLessThan(calls.indexOf("POST /v1/transfers"));
  expect(bodies["POST /v1/transfers"]).toMatchObject([{ client_transfer_id: "retry:transfer-1" }]);
});

test("an expired take that was signed, or whose signature is unproven, is returned as it is, never replaced", async () => {
  for (const signed_at of [at(-10), undefined]) {
    const { client, calls } = api({ takeId: "take-1", takeFill: { state: "EXPIRED", maker_leg: "ABANDONED", signed_at } });
    const signer = counting();
    expect((await transfer(client, signer, { ...venue, transfer_id: "transfer-1" })).map(fill => fill.state)).toEqual(["EXPIRED"]);
    expect(calls.some(call => call === "POST /v1/transfers" || call === "POST /v1/takes")).toBe(false);
    expect(signer.signed).toBe(0);
  }
});

test("an unsigned expired take is replaced under retry:<id> with its route's terms, and the replacement is never funded again", async () => {
  const then = { to: "hyperliquid", recipient: payer, amount_in: "1000000", min_out: "990000" };
  const { client, calls, bodies } = api({ takeId: "take-1", withdrawal: "relayed", withdrawalAmount: "600000", chainBalance: "0", then: { ...then, chain_id: 999 }, takeFill: { state: "EXPIRED", maker_leg: "ABANDONED" } });
  const store = memoryStore();
  const named: string[] = [];
  expect((await transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, { store, onIntent: intent => { named.push(intent.id); } })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(bodies["POST /v1/transfers"]).toEqual([{ client_transfer_id: "retry:transfer-1", from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000", max_parts: 8, payer, recipient: payer, then }]);
  expect(bodies["POST /v1/takes"]).toMatchObject([{ client_take_id: "take-client-2", transfer_intent_id: "transfer-2" }]);
  expect(named).toEqual(["transfer-1", "transfer-2"]);
  expect(await store.load("funded:transfer-2")).toBe(true);
  expect(withdrawals(calls)).toEqual([]);
});

test("a lost replacement answer is asked again under the same retry:<id> key, funding nothing", async () => {
  const { client, calls, bodies } = api({ takeId: "take-1", takeFill: { state: "EXPIRED", maker_leg: "ABANDONED" }, loseReplacements: 3 });
  const store = memoryStore();
  await expect(transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, { store })).rejects.toThrow("replacement reply lost");
  expect((await transfer(client, counting(), { ...venue, transfer_id: "transfer-1" }, { store })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(new Set((bodies["POST /v1/transfers"] ?? []).map(body => record(body).client_transfer_id))).toEqual(new Set(["retry:transfer-1"]));
  expect(count(calls, "POST /v1/takes")).toBe(1);
  expect(withdrawals(calls)).toEqual([]);
});

test("a declined take signature after funding is signed again on the same take when run again, never withdrawn twice", async () => {
  const { client, calls } = api({ withdrawalAmount: "600000", funds: short });
  let declined = false;
  const signer = counting(type => type === "PayTake" && !declined && (declined = true));
  const store = memoryStore();
  await expect(transfer(client, signer, venue, { store, ...clock() })).rejects.toThrow("User rejected");
  expect((await transfer(client, signer, { ...venue, transfer_id: "transfer-1" }, { store, ...clock() })).map(fill => fill.state)).toEqual(["PAID"]);
  expect(count(calls, "POST /v1/transfers/transfer-1/withdrawal")).toBe(1);
  expect(count(calls, "POST /v1/takes")).toBe(1);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
});

const atOnce = { client_transfer_id: "move-1", from: "hyperliquid", to: "polymarket", amount_in: "1000000", min_out: "1000000", recipient: payer, funding: "venue" } as const;

test("a venue-funded transfer is signed at once: the take reserved against its prepared withdrawal, both committed together, no arrival waited for", async () => {
  const { client, calls, bodies } = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, payWindow: 120 });
  const signer = counting();
  const seen: string[] = [];
  const stages: string[] = [];
  const fills = await transfer(client, signer, atOnce, { ...clock(() => { throw new Error("nothing is waited for"); }), beforeSigning: signing => { seen.push(signing.kind); }, onStage: stage => stages.push(stage) });
  expect(fills.map(fill => fill.state)).toEqual(["PREPARED"]);
  expect(seen).toEqual(["withdrawal", "take"]);
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset", "PayTake"]);
  expect(stages).toEqual(["checking", "funding", "taking"]);
  expect(calls).not.toContain("POST /v1/transfers/transfer-1/withdrawal");
  expect(calls.indexOf("POST /v1/transfers/transfer-1/withdrawal/prepare")).toBeLessThan(calls.indexOf("POST /v1/takes"));
  const [submitted] = required(bodies["POST /v1/takes/take-1/signatures"]);
  expect(array(record(submitted).signatures).map(item => record(item).kind)).toEqual(["pay_take", "margin_move"]);
});

test("a take signed at once whose commit was lost is committed again with the same signatures, never signed twice, even once its withdrawal could no longer be signed", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, failSubmissions: 3, payWindow: 120 });
  const signer = counting();
  const store = memoryStore();
  await expect(transfer(client, signer, atOnce, { store })).rejects.toThrow("connection reset");
  expect(signer.signed).toBe(2);
  // Seventy seconds later the withdrawal could not be signed again, but it was signed already.
  const later = () => Date.now() + 70_000;
  const fills = await transfer(client, signer, { ...atOnce, transfer_id: "transfer-1" }, { store, now: later });
  expect(fills.map(fill => fill.state)).toEqual(["PREPARED"]);
  expect(signer.signed).toBe(2);
  expect(count(calls, "POST /v1/takes")).toBe(1);
  expect(calls).not.toContain("POST /v1/transfers/transfer-1/withdrawal");
});

test("a committed take signed at once waits for its funds, even past its pay_by: running it again signs, deletes and withdraws nothing", async () => {
  for (const takeFill of [{}, { pay_by: at(-1) }]) {
    const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, takeId: "take-1", withdrawal: "relayed", committed: true, takeFill });
    const signer = counting();
    const fills = await transfer(client, signer, { ...atOnce, transfer_id: "transfer-1" });
    expect(fills.map(fill => fill.state)).toEqual(["PREPARED"]);
    expect(signer.signed).toBe(0);
    expect(calls.filter(call => call.startsWith("POST") || call.startsWith("DELETE"))).toEqual([]);
  }
});

test("a take signed at once whose withdrawal is refused reports the refusal, on every run, and signs nothing more", async () => {
  const { client, calls } = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, withdrawn: "refused", payWindow: 120 });
  const signer = counting();
  const store = memoryStore();
  const refused = await transfer(client, signer, atOnce, { store }).catch((error: unknown) => error);
  expect(refused instanceof TransferPending && refused.reason).toBe("refused");
  const again = await transfer(client, signer, { ...atOnce, transfer_id: "transfer-1" }, { store }).catch((error: unknown) => error);
  expect(again instanceof TransferPending && again.reason).toBe("refused");
  expect(signer.signed).toBe(2);
  expect(count(calls, "POST /v1/takes/take-1/signatures")).toBe(1);
});

test("a take signed at once whose signature is refused releases its reservation, and one with too little time left asks for nothing more", async () => {
  const declined = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, payWindow: 120 });
  await expect(transfer(declined.client, counting(type => type === "PayTake"), atOnce)).rejects.toThrow("User rejected the request");
  expect(declined.calls).toContain("DELETE /v1/takes/take-1");
  expect(declined.calls).not.toContain("POST /v1/takes/take-1/signatures");
  // The wallet held the withdrawal's prompt until too little time was left to sign and submit the payment.
  const slow = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, payWindow: 120 });
  let time = Date.now();
  const signer = counting();
  const late = transfer(slow.client, signer, atOnce, { now: () => time, beforeSigning: signing => { if (signing.kind === "withdrawal") time += 65_000; } });
  await expect(late).rejects.toThrow("Too little time is left to sign the take");
  expect(signer.kinds).toEqual(["HyperliquidTransaction:SendAsset"]);
  expect(slow.calls).toContain("DELETE /v1/takes/take-1");
  const short = api({ chainBalance: "400000", withdrawalAmount: "600000", atOnce: true, payWindow: 55 });
  const unasked = counting();
  await expect(transfer(short.client, unasked, atOnce)).rejects.toThrow("Too little time is left to sign the take");
  expect(unasked.signed).toBe(0);
  expect(short.calls).toContain("DELETE /v1/takes/take-1");
});

test("a take signed at once whose withdrawal another run submitted meanwhile follows that withdrawal and signs only its payment", async () => {
  const { client, calls } = api({ chainBalance: "1000000", withdrawalAmount: "600000", atOnce: true, submittedMeanwhile: true });
  const signer = counting();
  const fills = await transfer(client, signer, atOnce);
  expect(fills.map(fill => fill.state)).toEqual(["PAID"]);
  expect(signer.kinds).toEqual(["PayTake"]);
  expect(calls).not.toContain("POST /v1/transfers/transfer-1/withdrawal");
  const other = api({ chainBalance: "1000000", withdrawalAmount: "600000", atOnce: true, conflict: "another financial preparation is open" });
  await expect(transfer(other.client, counting(), atOnce)).rejects.toThrow("another financial preparation is open");
});

import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { memoryStore } from "./store.ts";
import { refundPayment, withdraw, type ChainReaders } from "./withdraw.ts";

const owner = `0x${"11".repeat(20)}` as const, other = `0x${"22".repeat(20)}`, swap = `0x${"aa".repeat(32)}`, hashlock = `0x${"bb".repeat(32)}`;
const now = () => Math.floor(Date.now() / 1000);

function fake(routes: Record<string, (body: unknown) => unknown>) {
  const calls: string[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    calls.push(route);
    const handler = required(routes[route], route);
    const body: unknown = await request.json().catch(() => undefined);
    const answer = handler(body);
    return answer === null ? new Response(null, { status: 204 }) : Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls };
}
const counting = (address: `0x${string}` = owner) => {
  const signer = { address, signed: 0, signMessage: async () => "0x00" as const, signTypedData: async () => { signer.signed++; return "0x00" as const; } };
  return signer;
};

const polymarketWithdrawal = (to: string) => ({
  types: { EIP712Domain, ...schemas.Withdraw }, primaryType: "Withdraw",
  domain: { name: "Polymarket", version: "1", chainId: 137, verifyingContract: "0xdca4af75705dbb50f62437045aff9921947917d2" },
  message: { account: owner, token: required(CHAINS.polymarket).token, amount: "1000000", fee: "0", to, salt: 5, ts: now() },
});

test("a withdrawal signs only the exact amount to the signer, and a lost answer resubmits the same signature", async () => {
  let lose = 3;
  let to = other;
  const submissions: string[] = [];
  const { client } = fake({
    "GET /v1/balances": () => [{ venue: "polymarket", address: owner, venue_wallet: other }],
    "POST /v1/withdrawals/prepare": () => ({ typed_data: polymarketWithdrawal(to) }),
    "POST /v1/withdrawals": body => {
      submissions.push(String(record(body).signature));
      if (lose-- > 0) throw new TypeError("connection reset");
      return { id: "w1", venue: "polymarket", amount: "1000000", destination: owner, state: "relayed", venue_ref: null, error: null, created_at: "2026-10-17T00:00:00Z", relayed_at: null };
    },
  });
  const signer = counting();
  await expect(withdraw(client, signer, { id: "w-bad", venue: "polymarket", amount: 1_000_000n, to: "signer" })).rejects.toThrow();
  expect(signer.signed).toBe(0);
  to = owner;
  const store = memoryStore();
  await expect(withdraw(client, signer, { id: "w-1", venue: "polymarket", amount: 1_000_000n, to: "signer" }, { store })).rejects.toThrow("connection reset");
  expect(signer.signed).toBe(1);
  expect(await withdraw(client, signer, { id: "w-1", venue: "polymarket", amount: 1_000_000n, to: "signer" }, { store })).toMatchObject({ state: "relayed" });
  expect(signer.signed).toBe(1);
  // Its outcome stays under its id: running it again withdraws nothing more.
  const sent = submissions.length;
  expect(await withdraw(client, signer, { id: "w-1", venue: "polymarket", amount: 1_000_000n, to: "signer" }, { store })).toMatchObject({ id: "w1", state: "relayed" });
  expect([submissions.length, signer.signed]).toEqual([sent, 1]);
  await expect(withdraw(client, signer, { id: "w-1", venue: "polymarket", amount: 2_000_000n, to: "signer" }, { store })).rejects.toThrow("names another withdrawal");
});

test("a withdrawal shows the caller's own checks what it is about to sign, once checked, and signs nothing they refuse", async () => {
  const { client, calls } = fake({
    "GET /v1/balances": () => [{ venue: "polymarket", address: owner, venue_wallet: other }],
    "POST /v1/withdrawals/prepare": () => ({ typed_data: polymarketWithdrawal(owner) }),
  });
  const signer = counting();
  const seen: unknown[] = [];
  await expect(withdraw(client, signer, { id: "w-2", venue: "polymarket", amount: 1_000_000n, to: "signer" }, {
    beforeSigning: signing => { seen.push(signing.kind === "withdrawal" ? [signing.venue, signing.destination, signing.amount] : signing.kind); throw new Error("not today"); },
  })).rejects.toThrow("not today");
  expect(seen).toEqual([["polymarket", owner, 1_000_000n]]);
  expect(signer.signed).toBe(0);
  expect(calls).not.toContain("POST /v1/withdrawals");
});

test("a withdrawal is checked against the caller's clock, never the machine's", async () => {
  const later = (now() + 30 * 86_400) * 1000;
  const { client } = fake({
    "GET /v1/balances": () => [{ venue: "polymarket", address: owner, venue_wallet: other }],
    "POST /v1/withdrawals/prepare": () => ({ typed_data: { ...polymarketWithdrawal(owner), message: { ...polymarketWithdrawal(owner).message, ts: later / 1000 } } }),
    "POST /v1/withdrawals": () => ({ id: "w3", venue: "polymarket", amount: "1000000", destination: owner, state: "relayed", venue_ref: null, error: null, created_at: "2026-10-17T00:00:00Z", relayed_at: null }),
  });
  const signer = counting();
  await expect(withdraw(client, signer, { id: "w-3", venue: "polymarket", amount: 1_000_000n, to: "signer" })).rejects.toThrow();
  expect(signer.signed).toBe(0);
  expect(await withdraw(client, signer, { id: "w-4", venue: "polymarket", amount: 1_000_000n, to: "signer" }, { now: () => later })).toMatchObject({ state: "relayed" });
  expect(signer.signed).toBe(1);
});

test("an Aster withdrawal is refused before any request", async () => {
  const { client, calls } = fake({});
  await expect(withdraw(client, counting(), { id: "w-2", venue: "aster", amount: 1n, to: "signer" })).rejects.toThrow("not supported");
  expect(calls).toEqual([]);
});

const t2 = new Date((now() + 3600) * 1000).toISOString();
const fill = {
  id: "fill-1", role: "maker", maker_leg: "ABANDONED", payment_leg: "LOCKED", t2, from_venue: "hyperliquid", to_venue: "polymarket", maker_recipient: owner,
  maker_owner: owner, payer: other, swap_id: swap, order_id: `0x${"cc".repeat(32)}`, amount_in: "1000000", hashlock, deliver_by: null, delivery_hash: null,
};
const refundApi = () => fake({
  "POST /v1/fills/fill-1/refund/prepare": () => {
    const deadline = now() + 600;
    return { deadline, to_sign: [{ kind: "refund_payment", fill_id: "fill-1", signer: owner,
      typed_data: { types: { EIP712Domain, ...schemas.RefundPayment }, primaryType: "RefundPayment", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW }, message: { payer: other, swapId: swap, deadline } } }] };
  },
  "POST /v1/fills/fill-1/refund": () => null,
});
const readers = (paymentState = 1): ChainReaders => ({
  999: { readContract: async request => request.functionName === "locks" ? [1_000_000n, hashlock, owner, BigInt(Math.floor(Date.parse(t2) / 1000)), paymentState, 0] : `0x${"dd".repeat(32)}` },
  137: { readContract: async () => [0n, `0x${"0".repeat(64)}`, `0x${"0".repeat(40)}`, 0n, 0, 0] },
});

test("a refund is signed only once the pinned escrows confirm the locks", async () => {
  const { client, calls } = refundApi();
  const signer = counting();
  await expect(refundPayment(client, signer, structuredClone(fill), { 999: required(readers()[999]) })).rejects.toThrow("No reader for polymarket");
  await expect(refundPayment(client, signer, structuredClone(fill), readers(2))).rejects.toThrow("no longer permit this refund");
  expect(signer.signed).toBe(0);
  await refundPayment(client, signer, structuredClone(fill), readers());
  expect(signer.signed).toBe(1);
  expect(calls.at(-1)).toBe("POST /v1/fills/fill-1/refund");
});

test("two calls with one id share one signature, and a pending outcome is read again with it", async () => {
  const states = ["submitting", "relayed"];
  const submissions: string[] = [];
  let salt = 0;
  const { client } = fake({
    "GET /v1/balances": () => [{ venue: "polymarket", address: owner, venue_wallet: other }],
    "POST /v1/withdrawals/prepare": () => ({ typed_data: { ...polymarketWithdrawal(owner), message: { ...polymarketWithdrawal(owner).message, salt: ++salt } } }),
    "POST /v1/withdrawals": body => {
      submissions.push(String(record(body).signature));
      return { id: "w1", venue: "polymarket", amount: "1000000", destination: owner, state: states.shift() ?? "relayed", venue_ref: null, error: null, created_at: "2026-10-17T00:00:00Z", relayed_at: null };
    },
  });
  const signer = counting();
  const store = memoryStore();
  const ask = () => withdraw(client, signer, { id: "w-once", venue: "polymarket", amount: 1_000_000n, to: "signer" }, { store });
  const [first, second] = await Promise.all([ask(), ask()]);
  expect([first.state, second.state]).toEqual(["submitting", "relayed"]);
  expect([signer.signed, salt]).toEqual([1, 1]);
  expect((await ask()).state).toBe("relayed");
  expect(submissions).toHaveLength(2);
});

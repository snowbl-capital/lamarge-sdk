import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas } from "./protocol/protocol.ts";
import { address, record, required } from "./protocol/validation.ts";
import { memoryStore } from "./store.ts";
import { checkEscrowLocks, refundPayment, withdraw, type ChainReaders } from "./withdraw.ts";

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
/** A maker's fill whose delivery inside Lighter was abandoned, its payment locked on HyperEVM. */
const fill = {
  id: "fill-1", role: "maker", maker_leg: "ABANDONED", payment_leg: "LOCKED", t2, from_venue: "hyperliquid", to_venue: "lighter", maker_recipient: owner,
  maker_owner: owner, payer: other, swap_id: swap, order_id: `0x${"cc".repeat(32)}`, amount_in: "1000000", hashlock, deliver_by: t2 as string | null, delivery_hash: null,
};
const refundApi = (escrow = ESCROW) => fake({
  "POST /v1/fills/fill-1/refund/prepare": () => {
    const deadline = now() + 600;
    return { deadline, to_sign: [{ kind: "refund_payment", fill_id: "fill-1", signer: owner,
      typed_data: { types: { EIP712Domain, ...schemas.RefundPayment }, primaryType: "RefundPayment", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: escrow }, message: { payer: other, swapId: swap, deadline } } }] };
  },
  "POST /v1/fills/fill-1/refund": () => null,
});
/** Each chain's reads: the payment lock in `paymentState`, the maker's slot in `makerState`, and the escrows read. */
const readers = (paymentState = 1, makerState = 0, read: string[] = []): ChainReaders => ({
  999: { readContract: async request => { read.push(`999:${request.address}`); return request.functionName === "locks" ? [1_000_000n, hashlock, owner, BigInt(Math.floor(Date.parse(t2) / 1000)), paymentState, 0] : `0x${"dd".repeat(32)}`; } },
  137: { readContract: async request => { read.push(`137:${request.address}`); return [makerState ? 1_000_000n : 0n, `0x${"0".repeat(64)}`, makerState ? other : `0x${"0".repeat(40)}`, 0n, makerState, 0]; } },
});

test("a refund is signed only once the escrow its consent names confirms the payment lock", async () => {
  const { client, calls } = refundApi();
  const signer = counting();
  await expect(refundPayment(client, signer, structuredClone(fill), {})).rejects.toThrow("No reader for hyperliquid");
  await expect(refundPayment(client, signer, structuredClone(fill), readers(2))).rejects.toThrow("no longer permit this refund");
  await expect(refundPayment(client, signer, { ...structuredClone(fill), delivery_hash: "1234" }, readers())).rejects.toThrow("This fill was delivered");
  // From an escrow offer, the operator returns the payment itself.
  await expect(refundPayment(client, signer, { ...structuredClone(fill), to_venue: "polymarket", deliver_by: null }, readers())).rejects.toThrow("cannot be refunded early");
  expect(signer.signed).toBe(0);
  const read: string[] = [];
  await refundPayment(client, signer, structuredClone(fill), readers(1, 0, read));
  expect(signer.signed).toBe(1);
  expect(new Set(read)).toEqual(new Set([`999:${address(ESCROW)}`]));
  expect(calls.at(-1)).toBe("POST /v1/fills/fill-1/refund");
  await expect(refundPayment(refundApi(other).client, signer, structuredClone(fill), readers())).rejects.toThrow("Unexpected signing domain");
});

test("an escrow destination is never refunded by consent, and the escrow read is pinned", async () => {
  const escrowed = { ...structuredClone(fill), to_venue: "polymarket", deliver_by: null }, deadline = now() + 600;
  await expect(checkEscrowLocks(escrowed, deadline, readers(), { hyperliquid: ESCROW })).rejects.toThrow("Unsupported refund chain");
  await checkEscrowLocks(fill, deadline, readers(), { hyperliquid: ESCROW });
  for (const escrows of [{ hyperliquid: other }, { polymarket: ESCROW }]) {
    await expect(checkEscrowLocks(fill, deadline, readers(), escrows)).rejects.toThrow("API deployment differs");
  }
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

const hyperliquidSend = (message: Record<string, unknown>) => ({
  types: { EIP712Domain, ...schemas["HyperliquidTransaction:SendAsset"] }, primaryType: "HyperliquidTransaction:SendAsset",
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 999, verifyingContract: "0x0000000000000000000000000000000000000000" },
  message: { hyperliquidChain: "Mainnet", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "2", fromSubAccount: "", nonce: Date.now(), ...message },
});

test("a standard Hyperliquid account withdraws from trade.xyz and moves between its perps and trade.xyz as asked", async () => {
  const asked: unknown[] = [];
  const toHyperEvm = "0x2000000000000000000000000000000000000000";
  let answer = hyperliquidSend({ destination: toHyperEvm, sourceDex: "xyz", destinationDex: "spot" });
  const { client } = fake({
    "GET /v1/balances": () => [{ venue: "hyperliquid", address: owner, venue_wallet: null }],
    "POST /v1/withdrawals/prepare": body => { asked.push(body); return { typed_data: answer }; },
    "POST /v1/withdrawals": () => ({ id: "w", venue: "hyperliquid", kind: "withdrawal", amount: "2000000", destination: owner, state: "relayed", venue_ref: null, error: null, created_at: "2026-10-26T00:00:00Z", relayed_at: null }),
  });
  const signer = counting();
  await withdraw(client, signer, { id: "xyz-out", venue: "hyperliquid", amount: 2_000_000n, to: "signer", dex: "xyz" });
  answer = hyperliquidSend({ destination: owner, sourceDex: "", destinationDex: "xyz" });
  await withdraw(client, signer, { id: "xyz-in", venue: "hyperliquid", amount: 2_000_000n, to: "xyz" });
  expect(asked).toEqual([{ venue: "hyperliquid", amount: "2000000", to: "signer", dex: "xyz" }, { venue: "hyperliquid", amount: "2000000", to: "xyz" }]);
  // The perps answered for trade.xyz, or a move the other way, sign nothing.
  answer = hyperliquidSend({ destination: toHyperEvm, sourceDex: "", destinationDex: "spot" });
  await expect(withdraw(client, signer, { id: "xyz-swapped", venue: "hyperliquid", amount: 2_000_000n, to: "signer", dex: "xyz" })).rejects.toThrow("sourceDex");
  answer = hyperliquidSend({ destination: owner, sourceDex: "xyz", destinationDex: "" });
  await expect(withdraw(client, signer, { id: "xyz-back", venue: "hyperliquid", amount: 2_000_000n, to: "xyz" })).rejects.toThrow("Dex");
  expect(signer.signed).toBe(2);
  await expect(withdraw(client, signer, { id: "xyz-elsewhere", venue: "polymarket", amount: 2_000_000n, to: "signer", dex: "xyz" })).rejects.toThrow("trade.xyz");
});

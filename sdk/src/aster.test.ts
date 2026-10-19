import { afterEach, expect, test } from "bun:test";
import { formatUnits, parseUnits, recoverTypedDataAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AsterDeliverer, type AsterDelivery } from "./aster.ts";
import { LaMargeError } from "./client.ts";
import type { FillSource } from "./delivery.ts";
import type { DeliveryFill } from "./maker.ts";
import { asterAmount, hex, required } from "./protocol/index.ts";

// The server's test key and Foundry-signed transfer (server/src/aster.rs).
const owner = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const agent = privateKeyToAccount(`0x${"55".repeat(32)}`);
const taker = "0x14791697260e4c9a71f18484c9f997b308e59325";
const api = { chain: "http://chain.test", futures: "http://futures.test", spot: "http://spot.test" };
// AsterDeliverer calls Aster through the global fetch.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const fill = (overrides: Partial<DeliveryFill> = {}): DeliveryFill => ({
  id: "0192f0a1-b2c3-7d4e-8f90-a1b2c3d4e5f6", role: "maker", state: "PAID", payment_leg: "LOCKED", maker_leg: "NONE", to_venue: "aster", amount_out: "1500000000000000000",
  deliver_by: new Date(Date.now() + 120_000).toISOString(), report_by: new Date(Date.now() + 6_600_000).toISOString(), delivery_to: taker, delivery_hash: null,
  payment_verified_at: new Date().toISOString(),
  ...overrides,
});
const second = (overrides: Partial<DeliveryFill> = {}) => fill({ id: "0192f0a1-b2c3-7d4e-8f90-00000000beef", ...overrides });

/** Aster's Spot read, margin move and transfer: a repeated clientTranId returns its first id; `lose` drops answers, `refuse` refuses. */
function aster(spot = "10") {
  const book = { spot, reads: 0, moves: [] as URLSearchParams[], sent: [] as string[], lose: 0, refuse: null as null | { code: number; msg: string }, ids: new Map<string, string>() };
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin === api.spot && url.pathname === "/api/v3/account") { book.reads++; return Response.json({ balances: [{ asset: "USDT", free: book.spot }] }); }
    if (url.origin === api.futures && url.pathname === "/fapi/v3/asset/wallet/transfer") {
      book.moves.push(url.searchParams);
      book.spot = formatUnits(parseUnits(book.spot, 18) + parseUnits(url.searchParams.get("amount") ?? "0", 18), 18);
      return Response.json({ tranId: 1, status: "SUCCESS" });
    }
    if (url.origin === api.chain && url.pathname === "/aster-chain/v3/transfer") {
      book.sent.push(url.search.slice(1));
      if (book.refuse) return Response.json(book.refuse, { status: 400 });
      const client = url.searchParams.get("clientTranId") ?? "";
      const id = book.ids.get(client) ?? String(73_170_000 + book.ids.size);
      book.ids.set(client, id);
      if (book.lose > 0) { book.lose--; throw new TypeError("connection reset"); }
      return Response.json({ transferId: id, status: "SUCCESS" });
    }
    return new Response("unexpected", { status: 500 });
  }, { preconnect: realFetch.preconnect });
  return book;
}

const memory = () => { let saved: Record<string, AsterDelivery> = {}; const writes: Record<string, AsterDelivery>[] = []; return { writes, load: () => structuredClone(saved), save: (value: Record<string, AsterDelivery>) => { saved = structuredClone(value); writes.push(saved); } }; };
const quoterOf = (fills: () => DeliveryFill[], reported: [string, string][] = [], answer?: () => LaMargeError | null): FillSource => ({ fills: async () => fills(), deliver: async (id: string, hash: string) => { reported.push([id, hash]); const error = answer?.(); if (error) throw error; return { fill: { ...fill({ id }), delivery_hash: hash, state: "CLAIMING" } }; } });
const deliverer = (store = memory(), now = () => Date.now()) => new AsterDeliverer(owner, agent, store, api, now);

test("a delivery is the fill's transfer request, signed by the account at chain 1666", async () => {
  const delivery = await deliverer().sign(fill(), 1_791_220_981_561_788);
  expect(delivery.query).toBe("asset=USDT&amount=1.5&toAddress=0x14791697260E4c9A71f18484C9f997B308e59325&clientTranId=0192f0a1b2c37d4e8f90a1b2c3d4e5f6&nonce=1791220981561788&user=0xFCAd0B19bB29D4674531d6f115237E16AfCE377c"
    + "&signature=0x891aa73b0760e5a00d1797672995e7865ce99e4081b1cd1d9795430196f77097729aff036bfc07e39f4b9f03d5a36df49182252cf8a67e276c87d3b60d78e2431c");
  // Six decimals at most, rounded up: the taker never gets less.
  expect(asterAmount(1_500_000_000_000_000_001n)).toBe("1.500001");
  expect(asterAmount(2n * 10n ** 18n)).toBe("2");
});

test("the agent moves the Spot shortfall from the margin, then the transfer is persisted, sent once and reported", async () => {
  const book = aster("0.5");
  const store = memory();
  const reported: [string, string][] = [];
  const quoter = quoterOf(() => [fill()], reported);
  const bot = deliverer(store);
  await bot.run(quoter, () => {});
  expect(book.moves.length).toBe(1);
  const move = required(book.moves[0]);
  expect([...move.keys()]).toEqual(["amount", "asset", "clientTranId", "kindType", "nonce", "user", "signer", "signature"]);
  expect(move.get("amount")).toBe("1");
  expect(move.get("clientTranId")).toBe("m0192f0a1b2c37d4e8f90a1b2c3d4e5f6");
  expect(move.get("signer")).toBe(agent.address);
  const msg = [...move.entries()].filter(([name]) => name !== "signature").map(([name, value]) => `${name}=${value}`).join("&");
  expect(await recoverTypedDataAddress({ domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: zeroAddress }, types: { Message: [{ name: "msg", type: "string" }] }, primaryType: "Message", message: { msg }, signature: hex(move.get("signature")) })).toBe(agent.address);
  expect(store.writes[0]?.[fill().id]).toMatchObject({ attempted: false });
  expect(book.sent).toEqual([required(store.load()[fill().id]).query]);
  expect(reported).toEqual([[fill().id, "73170000"]]);
  expect(store.load()[fill().id]).toMatchObject({ transfer_id: "73170000", outcome: "reported" });
  await bot.run(quoter, () => {});
  expect(book.sent.length).toBe(1);
});

test("Spot is read once a pass, then again only after a margin move", async () => {
  const book = aster("2");
  const third = fill({ id: "0192f0a1-b2c3-7d4e-8f90-00000000cafe" });
  const reported: [string, string][] = [];
  await deliverer().run(quoterOf(() => [fill(), second(), third], reported), () => {});
  expect(reported.length).toBe(3);
  // 2 USDT pays the first; the second moves the 1 USDT Spot then lacks; the third reads Spot again.
  expect(book.moves.map(move => move.get("amount"))).toEqual(["1"]);
  expect(book.reads).toBe(2);
});

test("a lost answer is resent as the same bytes within the window, and the first transfer is reported", async () => {
  const book = aster();
  book.lose = 1;
  let now = Date.now();
  const store = memory();
  const reported: [string, string][] = [];
  const bot = deliverer(store, () => now);
  const quoter = quoterOf(() => [fill(), second()], reported);
  await bot.run(quoter, () => {});
  expect(store.load()[fill().id]).toMatchObject({ attempted: true });
  // No other fill is signed while one awaits Aster's answer.
  expect(store.load()[second().id]).toBeUndefined();
  now += 1_000;
  await bot.run(quoter, () => {});
  expect(book.sent.length).toBe(3);
  expect(book.sent[0]).toBe(required(book.sent[1]));
  expect(reported).toEqual([[fill().id, "73170000"], [second().id, "73170001"]]);
});

test("unanswered past its window, a transfer is never signed again and frees the pool", async () => {
  const book = aster();
  book.lose = 1_000;
  let now = Date.now();
  const store = memory();
  const bot = deliverer(store, () => now);
  const quoter = quoterOf(() => [fill({ deliver_by: new Date(now + 300_000).toISOString() })]);
  for (let tick = 0; tick < 120; tick++) { await bot.run(quoter, () => {}).catch(() => {}); now += 500; }
  expect(store.load()[fill().id]?.outcome).toBe("unknown");
  // A minute of retries: paced, all the same bytes.
  expect(book.sent.length).toBeLessThanOrEqual(15);
  expect(new Set(book.sent).size).toBe(1);
  expect(bot.blocked).toBe(false);
});

test("a refused first send is final: the fill is left to its refund and the next one is delivered", async () => {
  const book = aster();
  book.refuse = { code: -5124, msg: "This operation is not available when privacy mode is enabled." };
  const store = memory();
  let now = Date.now();
  const bot = deliverer(store, () => now);
  await bot.run(quoterOf(() => [fill()]), () => {});
  expect(store.load()[fill().id]?.outcome).toBe("refused");
  book.refuse = null;
  now += 1_000;
  await bot.run(quoterOf(() => [fill(), second()]), () => {});
  expect(book.sent.length).toBe(2);
  expect(store.load()[second().id]?.outcome).toBe("reported");
  expect(Object.keys(store.load()).length).toBe(2);
});

test("a pending report is retried less often, a refused one is final", async () => {
  aster();
  let now = Date.now();
  const store = memory();
  const bot = deliverer(store, () => now);
  const reported: [string, string][] = [];
  let answer: LaMargeError | null = new LaMargeError(425, "DELIVERY_PENDING", "neither history shows this transfer yet");
  const quoter = quoterOf(() => [fill()], reported, () => answer);
  await bot.run(quoter, () => {});
  await bot.run(quoter, () => {});
  expect(reported.length).toBe(1);
  now += 1_500;
  await bot.run(quoter, () => {});
  expect(reported.length).toBe(2);
  expect(store.load()[fill().id]?.outcome).toBeUndefined();
  answer = new LaMargeError(400, "VALIDATION_ERROR", "the transfer executed after deliver_by", { reason: "executed_late" });
  now += 5_000;
  await bot.run(quoter, () => {});
  expect(store.load()[fill().id]?.outcome).toBe("failed");
});

test("nothing is signed or sent within fifteen seconds of deliver_by", async () => {
  const book = aster();
  const store = memory();
  const now = Date.now();
  const bot = deliverer(store, () => now);
  const late = fill({ deliver_by: new Date(now + 10_000).toISOString() });
  await bot.run(quoterOf(() => [late]), () => {});
  expect(store.load()).toEqual({});
  // A persisted unsent request that close to the deadline is dropped, never sent.
  store.save({ [late.id]: await bot.sign(late, now * 1000) });
  await bot.run(quoterOf(() => [late]), () => {});
  expect(store.load()[fill().id]?.outcome).toBe("dropped");
  expect(book.sent.length).toBe(0);
});

test("nothing is sent before the journal's save resolves, and a failed save sends nothing", async () => {
  const book = aster("10");
  const order: string[] = [];
  let saved: Record<string, AsterDelivery> = {};
  const slow = { load: () => structuredClone(saved), save: async (value: Record<string, AsterDelivery>) => { order.push("save-start"); await new Promise(resolve => setTimeout(resolve, 20)); saved = structuredClone(value); order.push("saved"); } };
  const realFetchOf = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/aster-chain/v3/transfer") order.push("send");
    return realFetchOf(input, init);
  }, { preconnect: realFetch.preconnect });
  await new AsterDeliverer(owner, agent, slow, api).run(quoterOf(() => [fill()]), () => {});
  expect(order.slice(0, order.indexOf("send"))).toEqual(["save-start", "saved", "save-start", "saved"]);
  book.sent.length = 0;
  const failing = { load: () => ({}), save: async () => { throw new Error("disk full"); } };
  await expect(new AsterDeliverer(owner, agent, failing, api).run(quoterOf(() => [second()]), () => {})).resolves.toBeUndefined();
  expect(book.sent).toEqual([]);
});

import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { asterAmount, checkSend, CHAINS, EIP712Domain, opHash, schemas, signedAt, type OpTyped, type Typed } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { typedDataRequest } from "./signer.ts";
import { memoryStore, transferTypedData } from "./store.ts";
import { withdraw } from "./withdraw.ts";

const owner = `0x${"11".repeat(20)}` as const, recipient = "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc";
const now = () => Math.floor(Date.now() / 1000);
const PUSD = required(CHAINS.polymarket).token;
const opDomain = EIP712Domain.filter(field => field.name !== "verifyingContract");

/** The operation as the server writes it: checksummed or not, the hash covers the exact strings. */
function internalTransfer(args: { account?: string; to?: string; amount?: string } = {}, ts = now() * 1000): OpTyped {
  const op = { type: "internalTransfer" as const, args: { account: args.account ?? owner, token: PUSD, amount: args.amount ?? "10.5", to: args.to ?? recipient } };
  return {
    types: { EIP712Domain: opDomain, ...schemas.Op }, primaryType: "Op", domain: { name: "Polymarket", version: "1", chainId: 137 },
    message: { data: opHash("internalTransfer", [op.args.account, op.args.token, op.args.amount, op.args.to]), salt: 5, ts }, op,
  };
}
const sendAsset = (patch: Record<string, unknown> = {}): Typed => ({
  types: { EIP712Domain, ...schemas["HyperliquidTransaction:SendAsset"] }, primaryType: "HyperliquidTransaction:SendAsset",
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 999, verifyingContract: "0x0000000000000000000000000000000000000000" },
  message: { hyperliquidChain: "Mainnet", destination: recipient, sourceDex: "spot", destinationDex: "", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "5.25", fromSubAccount: "", nonce: now() * 1000, ...patch },
});
const asterSend = (patch: { id?: string; to?: string; amount?: string } = {}): Typed => {
  const msg = `asset=USDT&amount=${patch.amount ?? "5"}&toAddress=${patch.to ?? recipient}&clientTranId=${patch.id ?? `s${"ab".repeat(16)}`}&nonce=${now() * 1_000_000}&user=${owner}`;
  return {
    types: { EIP712Domain, ...schemas.Message }, primaryType: "Message",
    domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: "0x0000000000000000000000000000000000000000" }, message: { msg },
  };
};

test("the operation hash is Polymarket's: MessagePack of the exact strings, then keccak256", () => {
  // Polymarket's own encoder (`@msgpack/msgpack`) and viem give this hash; the server pins it too.
  expect(opHash("internalTransfer", ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB", "250.5", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"]))
    .toBe("0x116bb5d03ed73e04edd7c0ebfd0f9c37d9cf5dd00de629f8949cbdfc63e11825");
});

test("a Polymarket send is checked by rebuilding the hash its wallet is shown", () => {
  const at = now();
  expect(() => checkSend(internalTransfer(), "polymarket", owner, recipient, 10_500_000n, at)).not.toThrow();
  // Another operation under the same arguments: its type is not one a send signs.
  const withdrawOp = internalTransfer();
  Object.assign(withdrawOp.op, { type: "withdraw" });
  const swapped = internalTransfer();
  record(record(swapped.op).args).to = `0x${"33".repeat(20)}`;
  for (const [typed, amount, reason] of [
    [internalTransfer({ to: `0x${"33".repeat(20)}` }), 10_500_000n, "to"],
    [internalTransfer(), 10_000_000n, "amount"],
    [internalTransfer({ account: recipient }), 10_500_000n, "account"],
    // The arguments shown differ from the ones the signed hash covers.
    [swapped, 10_500_000n, "to"],
    [withdrawOp, 10_500_000n, "op"],
    [{ ...internalTransfer(), domain: { name: "Polymarket", version: "1", chainId: 137, verifyingContract: "0xdca4af75705dbb50f62437045aff9921947917d2" } } as OpTyped, 10_500_000n, "domain"],
    [internalTransfer({}, (at - 120) * 1000), 10_500_000n, "Stale"],
  ] as const) expect(() => checkSend(typed, "polymarket", owner, recipient, amount, at)).toThrow(reason);
  const forged = internalTransfer();
  forged.message.data = internalTransfer({ to: `0x${"33".repeat(20)}` }).message.data;
  expect(() => checkSend(forged, "polymarket", owner, recipient, 10_500_000n, at)).toThrow("data");
  expect(() => checkSend(internalTransfer({ to: owner }), "polymarket", owner, owner, 10_500_000n, at)).toThrow("recipient");
});

test("a Hyperliquid send names its recipient, mainnet and the two dexes", () => {
  const at = now();
  expect(() => checkSend(sendAsset(), "hyperliquid", owner, recipient, 5_250_000n, at)).not.toThrow();
  for (const [patch, reason] of [
    [{ destination: `0x${"33".repeat(20)}` }, "destination"],
    [{ destination: "0x2000000000000000000000000000000000000000" }, "destination"],
    [{ hyperliquidChain: "Testnet" }, "hyperliquidChain"],
    [{ destinationDex: "xyz" }, "destinationDex"],
    [{ sourceDex: "xyz" }, "sourceDex"],
    [{ amount: "5.3" }, "amount"],
    [{ nonce: (at - 120) * 1000 }, "Stale"],
  ] as const) expect(() => checkSend(sendAsset(patch), "hyperliquid", owner, recipient, 5_250_000n, at)).toThrow(reason);
  expect(() => checkSend(sendAsset(), "hyperliquid", owner, "0x2000000000000000000000000000000000000000", 5_250_000n, at)).toThrow();
});

test("an Aster send carries a send's own id, never a fill's or a margin move's", () => {
  const units = 5n * 10n ** 18n, at = now();
  expect(asterAmount(units)).toBe("5");
  expect(() => checkSend(asterSend(), "aster", owner, recipient, units, at)).not.toThrow();
  for (const [patch, reason] of [
    [{ id: "ab".repeat(16) }, "clientTranId"],
    [{ id: `m${"ab".repeat(16)}` }, "clientTranId"],
    [{ to: `0x${"33".repeat(20)}` }, "toAddress"],
    [{ amount: "6" }, "amount"],
  ] as const) expect(() => checkSend(asterSend(patch), "aster", owner, recipient, units, at)).toThrow(reason);
});

test("signing times read each venue's own unit", () => {
  const at = now();
  for (const typed of [internalTransfer(), sendAsset(), asterSend()]) expect(Math.abs(signedAt(typed) - at)).toBeLessThan(2);
});

test("a Polymarket operation keeps its op through a store and never shows it to the wallet", () => {
  const typed = internalTransfer();
  const stored = transferTypedData(JSON.parse(JSON.stringify(typed)));
  expect(stored).toEqual(typed);
  expect(() => transferTypedData({ ...typed, primaryType: "Withdraw" })).toThrow("Unreadable typed data");
  expect(() => transferTypedData({ ...typed, domain: { ...typed.domain, verifyingContract: "0xdca4af75705dbb50f62437045aff9921947917d2" } })).toThrow("Unreadable typed data");
  const request = typedDataRequest(stored);
  expect(request.domain).toEqual({ name: "Polymarket", version: "1", chainId: 137 });
  expect(Object.keys(request).sort()).toEqual(["domain", "message", "primaryType", "types"]);
});

test("a send signs once to its recipient, and a lost answer resubmits the same signature", async () => {
  let lose = 3;
  const bodies: Record<string, unknown>[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const body = record(await request.json().catch(() => ({})));
    if (route === "GET /v1/balances") return Response.json([{ venue: "polymarket", address: owner, venue_wallet: null }]);
    if (route === "POST /v1/withdrawals/prepare") { bodies.push(body); return Response.json({ typed_data: internalTransfer() }); }
    bodies.push(body);
    if (lose-- > 0) throw new TypeError("connection reset");
    return Response.json({ id: "s1", venue: "polymarket", kind: "send", amount: "10500000", destination: recipient, state: "relayed", venue_ref: "7", error: null, created_at: "2026-10-24T00:00:00Z", relayed_at: null });
  }, { preconnect: globalThis.fetch.preconnect });
  const client = createClient({ apiUrl: "http://localhost:8080", fetch });
  const signer = { address: owner, signed: 0, signMessage: async () => "0x00" as const, signTypedData: async () => { signer.signed++; return "0x00" as const; } };
  const store = memoryStore();
  const request = { id: "s-1", venue: "polymarket", amount: 10_500_000n, to: "account", recipient } as const;
  await expect(withdraw(client, signer, request, { store })).rejects.toThrow("connection reset");
  expect(await withdraw(client, signer, request, { store })).toMatchObject({ kind: "send", state: "relayed" });
  expect(signer.signed).toBe(1);
  expect(bodies[0]).toEqual({ venue: "polymarket", amount: "10500000", to: "account", recipient });
  // Both submissions carry the same operation, `op` included.
  const [first, second] = bodies.slice(1).map(body => JSON.stringify(body));
  expect(first).toBe(second);
  expect(record(record(bodies[1]).typed_data).op).toEqual(internalTransfer().op);
  await expect(withdraw(client, signer, { id: "s-2", venue: "polymarket", amount: 1n, to: "account" })).rejects.toThrow("recipient");
  await expect(withdraw(client, signer, { id: "s-3", venue: "lighter", amount: 1n, to: "account", recipient })).rejects.toThrow("not supported");
});

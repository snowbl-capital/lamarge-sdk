import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { EIP712Domain, schemas } from "./protocol/protocol.ts";
import { record, required } from "./protocol/validation.ts";
import { moveToXyz } from "./transfer.ts";
import { memoryStore } from "./store.ts";

const owner = `0x${"11".repeat(20)}` as const;
const sendAsset = (patch: Record<string, unknown> = {}) => ({
  types: { EIP712Domain, ...schemas["HyperliquidTransaction:SendAsset"] }, primaryType: "HyperliquidTransaction:SendAsset",
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 999, verifyingContract: "0x0000000000000000000000000000000000000000" },
  message: { hyperliquidChain: "Mainnet", destination: owner, sourceDex: "", destinationDex: "xyz", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "5", fromSubAccount: "", nonce: Date.now(), ...patch },
});
const intent = { id: "transfer-1", recipient: owner };
const fills = [{ to_venue: "hyperliquid", amount_out: "3000000" }, { to_venue: "hyperliquid", amount_out: "2000000" }];

function api(options: { typed?: unknown; held?: string; rejected?: string } = {}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    calls.push(route);
    if (route === "GET /v1/transfers/transfer-1") return Response.json({ ...intent, move: options.held ? { id: "held", state: options.held } : null });
    if (route === "POST /v1/transfers/transfer-1/move/prepare") return Response.json({ typed_data: options.typed ?? sendAsset() });
    if (route === "POST /v1/transfers/transfer-1/move") {
      bodies.push(await request.json());
      if (options.rejected) return Response.json({ error: { code: options.rejected, message: "never recorded", request_id: "r", retryable: false } }, { status: 400 });
      return Response.json({ id: "move-1", venue: "hyperliquid", kind: "move", amount: "5000000", destination: owner, from_dex: null, state: "queued", venue_ref: null, error: null, created_at: new Date().toISOString(), relayed_at: null });
    }
    throw new Error(`Unexpected ${route}`);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: "http://localhost:8080", fetch }), calls, bodies };
}
const signer = () => {
  const signed: unknown[] = [];
  return { address: owner, signed, signMessage: async () => "0x00" as const, signTypedData: async (typed: unknown) => { signed.push(typed); return "0x11" as const; } };
};

test("a transfer received for trade.xyz signs the move of exactly what its take delivers, then hands it to LaMarge", async () => {
  const { client, calls, bodies } = api();
  const wallet = signer();
  await moveToXyz(client, wallet, intent, fills);
  expect(calls).toEqual(["GET /v1/transfers/transfer-1", "POST /v1/transfers/transfer-1/move/prepare", "POST /v1/transfers/transfer-1/move"]);
  expect(wallet.signed).toHaveLength(1);
  expect(record(required(bodies[0])).signature).toBe("0x11");
});

test("a move to another balance, account or amount, or one already held, signs nothing", async () => {
  for (const typed of [sendAsset({ destinationDex: "" }), sendAsset({ destination: `0x${"22".repeat(20)}` }), sendAsset({ amount: "6" }), sendAsset({ sourceDex: "spot" })]) {
    const { client, calls } = api({ typed });
    const wallet = signer();
    await expect(moveToXyz(client, wallet, intent, fills)).rejects.toThrow();
    expect(wallet.signed).toHaveLength(0);
    expect(calls).not.toContain("POST /v1/transfers/transfer-1/move");
  }
  const held = api({ held: "queued" });
  await moveToXyz(held.client, signer(), intent, fills);
  expect(held.calls).toEqual(["GET /v1/transfers/transfer-1"]);
  // Another recipient than the signer moves its funds itself.
  const other = api();
  await moveToXyz(other.client, signer(), { ...intent, recipient: `0x${"22".repeat(20)}` }, fills);
  expect(other.calls).toEqual([]);
});

test("a move refused unsent is replaced by a new one, never by its own signature again", async () => {
  const { client, calls } = api({ held: "refused" });
  const wallet = signer();
  const store = memoryStore();
  await store.save("transfer-move:transfer-1", { signature: "0x99" });
  await moveToXyz(client, wallet, intent, fills, { store });
  expect(calls).toEqual(["GET /v1/transfers/transfer-1", "POST /v1/transfers/transfer-1/move/prepare", "POST /v1/transfers/transfer-1/move"]);
  expect(wallet.signed).toHaveLength(1);
});

test("a kept signature is submitted as it was signed, whatever the delivery became; one never recordable is dropped", async () => {
  for (const rejected of ["BAD_SIGNATURE", "WITHDRAWAL_EXPIRED"]) {
    const { client, calls } = api({ rejected });
    const store = memoryStore();
    await store.save("transfer-move:transfer-1", { typed: sendAsset(), signature: "0x99" });
    // Only three of the five units reached the perps since: no local check stops the kept one.
    await expect(moveToXyz(client, signer(), intent, fills.slice(0, 1), { store })).rejects.toThrow("never recorded");
    expect(calls).toEqual(["GET /v1/transfers/transfer-1", "POST /v1/transfers/transfer-1/move"]);
    expect(await store.load("transfer-move:transfer-1")).toBeUndefined();
  }
  const { client, calls } = api();
  const store = memoryStore();
  await store.save("transfer-move:transfer-1", { typed: sendAsset(), signature: "0x99" });
  await moveToXyz(client, signer(), intent, fills.slice(0, 1), { store });
  expect(calls).toEqual(["GET /v1/transfers/transfer-1", "POST /v1/transfers/transfer-1/move"]);
  expect(await store.load("transfer-move:transfer-1")).toBeUndefined();
});

import { expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import { directTransfer, type DirectOperation, type DirectRequest } from "./direct.ts";
import { POLYGON_FUNDING_CONVERTER, POLYGON_USDC } from "./conversion.ts";
import { CHAINS } from "./protocol/protocol.ts";
import { address, required } from "./protocol/validation.ts";
import { countingSigner, mockApi } from "./mock.test.ts";
import { memoryStore } from "./store.ts";
import type { Hex, Signer } from "./signer.ts";

const owner = `0x${"11".repeat(20)}` as const, recipient = `0x${"33".repeat(20)}` as const, hash = `0x${"22".repeat(32)}` as const;
const now = 1_800_000_000_000;
function scenario(native = false, withdrawal = false) {
  const venue = withdrawal ? "gmx" : "polymarket", chain = required(CHAINS[venue]);
  const request: DirectRequest = { client_operation_id: "direct-1", venue, kind: withdrawal ? "withdrawal" : "deposit", owner,
    recipient: withdrawal ? owner : recipient, token: native ? POLYGON_USDC : chain.token, amount: "10000000", min_out: native ? "9995000" : "10000000" };
  const operation: DirectOperation = { ...request, id: "operation", chain_id: chain.id, escrow: chain.escrow, nonce: "42", deadline: String(now/1000+1800),
    state: "prepared", attempts: [], tx_hash: null, received: null };
  let advertisedEscrow = chain.escrow;
  let allowance = "0", enabled = true, loseFence = false, loseHash = false, declined = false;
  const api = mockApi({
    "POST /v1/direct": () => ({ ...operation }),
    "GET /v1/direct/operation": () => ({ ...operation }),
    "POST /v1/direct/operation": body => {
      if (typeof body.tx_hash === "string") operation.attempts.push(body.tx_hash);
      else { expect(operation.state).toBe("prepared"); operation.state = "pending"; if (loseFence) throw new TypeError("lost fence"); }
      return { ...operation };
    },
    "GET /v1/venues": () => [{ id: venue, enabled: true, chain: { ...chain, escrow: advertisedEscrow, permit: undefined, decimals: 6, direct_deposit: enabled, direct_withdrawal: enabled,
      wallet_funding: { token: chain.token, conversion: { token: POLYGON_USDC, converter: POLYGON_FUNDING_CONVERTER, decimals: 6, min_out_bps: 9995 } } } }],
    "GET /v1/direct/operation/funding": () => ({ owner, token: request.token, spender: chain.escrow, balance: request.amount, allowance, observed_at: new Date(now).toISOString(), block: 1 }),
  });
  const sent: { chainId: number; to: Hex; data: Hex }[] = [];
  const signer: Signer = { ...countingSigner(owner), sendTransaction: async (tx, callback) => {
    sent.push(tx);
    if (declined) throw { code: 4001 };
    if (tx.to.toLowerCase() === request.token.toLowerCase()) allowance = request.amount;
    else if (loseHash) throw new TypeError("lost hash");
    await callback?.(hash); return hash;
  } };
  const run = (store = memoryStore()) => directTransfer(api.client, signer, request, { store, now: () => now });
  return { ...api, request, operation, sent, run, advertise: (value: string) => { advertisedEscrow = value; }, enable: (value: boolean) => { enabled=value; }, approve: () => { allowance = (2n**256n-1n).toString(); },
    loseFence: () => { loseFence = true; }, loseHash: () => { loseHash = true; }, decline: (value: boolean) => { declined=value; },
    confirmed: () => { operation.state="confirmed"; operation.tx_hash=hash; operation.received=request.min_out; } };
}

test.each([false,true])("direct deposit calldata fixes the recipient, token, amount, minimum and nonce (native: %s)", async native => {
  const s = scenario(native); await s.run();
  expect(s.sent).toHaveLength(2);
  expect(s.sent[0]?.data).toBe(encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName:"approve",args:[address(s.operation.escrow),10_000_000n] }));
  expect(s.sent[1]?.data).toBe(encodeFunctionData({ abi: parseAbi(["function directDeposit(address,address,uint256,uint256,uint256,uint256)"]),functionName:"directDeposit",
    args:[recipient,address(s.request.token),10_000_000n,BigInt(s.request.min_out),42n,BigInt(s.operation.deadline)] }));
  s.confirmed(); expect((await s.run()).state).toBe("confirmed"); expect(s.sent).toHaveLength(2);
});

test("an existing unlimited maker allowance is preserved", async () => {
  const s=scenario(); s.approve(); await s.run(); expect(s.sent).toHaveLength(1); expect<string | undefined>(s.sent[0]?.to).toBe(s.operation.escrow);
});

test.each(["fence","hash"])("losing the %s never resends from the same or another device", async lost => {
  const s=scenario(); s.approve(); const store=memoryStore();
  if(lost === "fence") s.loseFence(); else s.loseHash();
  await expect(s.run(store)).rejects.toThrow(`lost ${lost}`);
  await s.run(store); await s.run(); expect(s.sent).toHaveLength(lost === "fence" ? 0 : 1);
  s.confirmed(); s.enable(false); expect((await s.run()).state).toBe("confirmed");
});

test("a changed recipient, token, amount or chain is rejected before approval", async () => {
  for (const patch of [{recipient:owner},{amount:"10000001"},{token:owner},{chain_id:999},{escrow:owner}]) {
    const s=scenario(); Object.assign(s.operation,patch); await expect(s.run()).rejects.toThrow(); expect(s.sent).toHaveLength(0);
  }
});

test("a missing capability never requests a signature or transaction", async () => {
  const s=scenario(); s.enable(false); await expect(s.run()).rejects.toThrow("Direct operation unavailable"); expect(s.sent).toHaveLength(0);
});

test("GMX withdrawal is one owner-sent transferOut and never a maker route", async () => {
  const s=scenario(false,true); await s.run(); expect(s.sent).toHaveLength(1);
  expect(s.sent[0]?.data.startsWith("0x0b9066d9")).toBe(true);
  expect(s.calls.some(call => /takes|routes|quotes/.test(call))).toBe(false);
  await s.run(); expect(s.sent).toHaveLength(1);
});

test("an explicit deposit refusal can retry only the same persisted operation", async () => {
  const s=scenario(); s.approve(); s.decline(true); const store=memoryStore();
  await expect(s.run(store)).rejects.toMatchObject({code:4001}); s.decline(false); await s.run(store);
  expect(s.sent).toHaveLength(2); expect(s.sent[0]).toEqual(s.sent[1]);
  expect(s.bodies["POST /v1/direct/operation"]?.filter(body => !body.tx_hash)).toHaveLength(1);
});

test("isolated signers accept only canonical own-account direct calls", async () => {
  const { inspectDirectTransaction } = await import("./direct.ts");
  const s = scenario(); s.request.recipient = owner; s.operation.recipient = owner; await s.run();
  for (const tx of s.sent) expect(inspectDirectTransaction(tx, owner, now).amount).toBe(10_000_000n);
  const tx = required(s.sent[1]);
  for (const changed of [{ ...tx, data: `${tx.data}00` }, { ...tx, to: recipient }, { ...tx, chainId: 999 }]) {
    expect(() => inspectDirectTransaction(changed, owner, now)).toThrow();
  }
  expect(() => inspectDirectTransaction(tx, recipient, now)).toThrow();
  expect(() => inspectDirectTransaction(tx, owner, now + 1_801_000)).toThrow();
  const g = scenario(false, true); await g.run();
  expect(inspectDirectTransaction(required(g.sent[0]), owner, now).step).toBe("withdrawal");
});

test("wallet funding conversion inspection binds Polygon, token, floor, deployment and deadline", async () => {
  const { inspectDirectTransaction } = await import("./direct.ts");
  const chain = required(CHAINS.polymarket);
  const tx = { chainId: 137, to: chain.escrow, data: encodeFunctionData({
    abi: parseAbi(["function convertDeposit(uint256,uint256,uint256,uint256)"]), functionName: "convertDeposit",
    args: [10_000_000n, 9_995_000n, 42n, BigInt(now/1000+1800)] }) };
  expect(inspectDirectTransaction(tx, owner, now)).toMatchObject({ step: "convert", token: POLYGON_USDC, amount: 10_000_000n, minimum: 9_995_000n });
  for (const changed of [{ ...tx, to: recipient }, { ...tx, chainId: 999 }, { ...tx, data: `${tx.data}00` }]) {
    expect(() => inspectDirectTransaction(changed, owner, now)).toThrow();
  }
  expect(() => inspectDirectTransaction(tx, owner, now+1_801_000)).toThrow();
});


test("a direct prompt cannot switch to another pinned deployment between preparation and capability read", async () => {
  const s = scenario(); s.advertise("0xa3fca394739ec4b984e908bd7a3c3b72d0ed77d1");
  await expect(s.run()).rejects.toThrow("Direct capability escrow changed");
  expect(s.sent).toHaveLength(0);
});

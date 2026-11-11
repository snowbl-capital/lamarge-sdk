import { expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import { checkConversion, conversionMinimum, convertFunding, POLYGON_FUNDING_CONVERTER, POLYGON_USDC } from "./conversion.ts";
import { mockApi, countingSigner } from "./mock.test.ts";
import { CHAINS } from "./protocol/protocol.ts";
import { address, required } from "./protocol/validation.ts";
import { memoryStore } from "./store.ts";
import type { Hex, Signer } from "./signer.ts";
import { transfer } from "./transfer.ts";

const owner = `0x${"11".repeat(20)}` as const, hash = `0x${"22".repeat(32)}` as const;
const chain = required(CHAINS.polymarket), now = 1_800_000_000_000;

function scenario(escrow = chain.escrow) {
  const c = { id: "conversion", amount_in: "2000000", min_out: "1999000", chain_id: 137, escrow, payer: owner,
    token: POLYGON_USDC, converter: POLYGON_FUNDING_CONVERTER, nonce: "42", deadline: String(now/1000+1800), state: "prepared", attempts: [] as string[], received: null as string | null, tx_hash: null as string | null };
  let allowance = "0", fenceLost = false, advertisedEscrow = escrow, fundingEscrow = escrow;
  const prepare = () => ({ ...c });
  const report = (body: Record<string, unknown>) => {
    if (typeof body.tx_hash === "string") c.attempts.push(body.tx_hash);
    else { expect(c.state).toBe("prepared"); c.state = "pending"; if (fenceLost) throw new TypeError("lost fence"); }
    return { ...c };
  };
  const { client, bodies } = mockApi({
    "GET /v1/transfers/transfer": () => ({ id: "transfer", from: "polymarket", funding: "wallet", amount_in: "1999000", conversion: { ...c } }),
    "POST /v1/transfers/transfer/conversion/prepare": prepare,
    "POST /v1/transfers/transfer/conversion": report,
    "POST /v1/transfers/replacement/conversion/prepare": prepare,
    "POST /v1/transfers/replacement/conversion": report,
    "GET /v1/venues": () => [{ id: "polymarket", enabled: true, chain: { ...chain, escrow: advertisedEscrow, permit: undefined, decimals: 6,
      wallet_funding: { token: chain.token, conversion: { token: POLYGON_USDC, converter: POLYGON_FUNDING_CONVERTER, decimals: 6, min_out_bps: 9995 } } } }],
    "GET /v1/wallets/polymarket": () => ({ venue: "polymarket", address: owner, chain_id: 137, escrow: fundingEscrow, token: chain.token, decimals: 6,
      wallet: "0", available: "0", spendable_wallet: "0", spendable_available: "0", observed_at: new Date(now).toISOString(), payment_setup: { address: owner },
      conversion: { token: POLYGON_USDC, balance: "2000000", allowance } }),
  });
  const sent: { to: Hex; data: Hex }[] = [];
  let lost = false;
  const signer: Signer = { ...countingSigner(owner), sendTransaction: async (request, callback) => {
    sent.push(request);
    if (request.to === POLYGON_USDC) allowance = "2000000";
    else if (lost) throw new TypeError("lost hash");
    await callback?.(hash);
    return hash;
  } };
  return { c, client, bodies, signer, sent, advertise: (value: string) => { advertisedEscrow = value; }, fundingAt: (value: string) => { fundingEscrow = value; }, ready: () => { c.state="ready"; c.received="2000001"; c.tx_hash=hash; }, lose: () => { lost=true; }, loseFence: () => { fenceLost=true; },
    intent: () => client.call("getTransfer", { path: { id: "transfer" } }) };
}

test("conversion calldata independently fixes the input, spender, floor, nonce and deadline", async () => {
  const s = scenario(), store = memoryStore(), intent = await s.intent();
  expect(await convertFunding(s.client,s.signer,intent,store,()=>now)).toBe(false);
  expect(s.sent).toHaveLength(2);
  expect(s.sent[0]?.data).toBe(encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName:"approve",args:[address(chain.escrow),2_000_000n] }));
  expect(s.sent[1]?.data).toBe(encodeFunctionData({ abi: parseAbi(["function convertDeposit(uint256,uint256,uint256,uint256)"]),functionName:"convertDeposit",args:[2_000_000n,1_999_000n,42n,BigInt(s.c.deadline)] }));
  s.ready();
  expect(await convertFunding(s.client,s.signer,intent,store,()=>now)).toBe(true);
  expect(s.sent).toHaveLength(2);
  expect(intent.amount_in).toBe("1999000");
});

test("a lost conversion hash is discovered without another send, even with a fresh browser store", async () => {
  const s=scenario(), intent=await s.intent();s.lose();
  await expect(convertFunding(s.client,s.signer,intent,memoryStore(),()=>now)).rejects.toThrow("lost hash");
  expect(await convertFunding(s.client,s.signer,intent,memoryStore(),()=>now)).toBe(false);
  expect(s.sent).toHaveLength(2);
  s.ready();
  expect(await convertFunding(s.client,s.signer,intent,memoryStore(),()=>now)).toBe(true);
});

test("an unknown fencing response never prompts the conversion", async () => {
  const s=scenario(), intent=await s.intent(),store=memoryStore();s.loseFence();
  await expect(convertFunding(s.client,s.signer,intent,store,()=>now)).rejects.toThrow("lost fence");
  expect(s.sent).toHaveLength(1);
  expect(await convertFunding(s.client,s.signer,intent,store,()=>now)).toBe(false);
  expect(s.sent).toHaveLength(1);
});

test("only an explicit approval refusal before broadcast allows another prompt", async () => {
  for (const explicit of [true, false]) {
    const s = scenario(), store = memoryStore(), intent = await s.intent();
    const send = required(s.signer.sendTransaction);
    let prompts = 0;
    s.signer.sendTransaction = async (request, callback) => {
      if (prompts++ === 0) throw explicit
        ? new Error("transaction refused", { cause: Object.assign(new Error("User rejected request"), { code: 4001 }) })
        : new TypeError("connection lost");
      return send(request, callback);
    };
    await expect(convertFunding(s.client, s.signer, intent, store, () => now)).rejects.toThrow();
    expect(await convertFunding(s.client, s.signer, intent, store, () => now)).toBe(false);
    expect(prompts).toBe(explicit ? 3 : 1);
    expect(s.c.state).toBe(explicit ? "pending" : "prepared");
  }
});

test("a declined conversion retries the same nonce locally without releasing the server fence", async () => {
  const s = scenario(), store = memoryStore(), intent = await s.intent();
  const send = required(s.signer.sendTransaction);
  const calls: Hex[] = [];
  s.signer.sendTransaction = async (request, callback) => {
    if (request.to === chain.escrow) {
      calls.push(request.data);
      if (calls.length === 1) throw Object.assign(new Error("User rejected request"), { code: 4001 });
    }
    return send(request, callback);
  };
  await expect(convertFunding(s.client, s.signer, intent, store, () => now)).rejects.toThrow("User rejected");
  expect(s.c.state).toBe("pending");
  expect(await convertFunding(s.client, s.signer, intent, memoryStore(), () => now)).toBe(false);
  expect(calls).toHaveLength(1);
  expect(await convertFunding(s.client, s.signer, intent, store, () => now)).toBe(false);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toBe(calls[0]);
  expect(s.bodies["POST /v1/transfers/transfer/conversion"]?.filter(body => !body.tx_hash)).toHaveLength(1);
  const reports = s.bodies["POST /v1/transfers/transfer/conversion"]?.length;
  expect(await convertFunding(s.client, s.signer, intent, store, () => now)).toBe(false);
  expect(s.bodies["POST /v1/transfers/transfer/conversion"]?.length).toBe(reports);
});

test("a wallet error after broadcast never reopens either transaction prompt", async () => {
  for (const target of [POLYGON_USDC, chain.escrow]) {
    const s = scenario(), store = memoryStore(), intent = await s.intent();
    const send = required(s.signer.sendTransaction);
    s.signer.sendTransaction = async (request, callback) => {
      if (request.to !== target) return send(request, callback);
      await callback?.(hash);
      throw Object.assign(new Error("User rejected a later wallet request"), { code: 4001 });
    };
    await expect(convertFunding(s.client, s.signer, intent, store, () => now)).rejects.toThrow();
    expect(await convertFunding(s.client, s.signer, intent, store, () => now)).toBe(false);
    expect(await store.load(`conversion:${s.c.id}:${target === POLYGON_USDC ? "approval" : "sent"}`)).toBe(hash);
  }
});

test("a replacement shares immutable conversion terms after an explicit wallet refusal", async () => {
  const s = scenario(), store = memoryStore(), intent = await s.intent();
  const send = required(s.signer.sendTransaction);
  let prompts = 0;
  s.signer.sendTransaction = async (request, callback) => {
    if (request.to === chain.escrow && prompts++ === 0) throw Object.assign(new Error("User rejected request"), { code: 4001 });
    return send(request, callback);
  };
  await expect(convertFunding(s.client, s.signer, intent, store, () => now)).rejects.toThrow("User rejected");
  const replacement = { ...intent, id: "replacement" };
  const original = { nonce: s.c.nonce, deadline: s.c.deadline };
  for (const patch of [{ nonce: "43" }, { deadline: String(now / 1000 + 1700) }]) {
    Object.assign(s.c, original, patch);
    await expect(convertFunding(s.client, s.signer, replacement, store, () => now)).rejects.toThrow("Stored conversion changed");
    expect(prompts).toBe(1);
  }
  Object.assign(s.c, original);
  expect(await convertFunding(s.client, s.signer, replacement, store, () => now)).toBe(false);
  expect(prompts).toBe(2);
});

test("mutated prepared terms or deployments cannot reach the wallet", async () => {
  for (const patch of [{ nonce:"43" },{ converter:owner },{ token:owner },{ escrow:owner },{ payer:chain.escrow },{ chain_id:999 },{ min_out:"1998000" }]) {
    const s=scenario(),store=memoryStore(),intent=await s.intent();
    if ("nonce" in patch) { s.c.state="pending";await convertFunding(s.client,s.signer,intent,store,()=>now); }
    Object.assign(s.c,patch);
    await expect(convertFunding(s.client,s.signer,intent,store,()=>now)).rejects.toThrow();
    expect(s.sent).toHaveLength(0);
  }
});

test("conversion opt-in and conservative rounding do not alter legacy pUSD wallet funding", async () => {
  expect(conversionMinimum(10_001n)).toBe(9_996n);
  const s=scenario(),intent=await s.intent();
  expect(()=>checkConversion(intent,undefined)).toThrow("Conversion terms changed");
  const { conversion:_,...legacy }=intent;
  checkConversion(legacy,undefined);
  expect(await convertFunding(s.client,s.signer,legacy,memoryStore(),()=>now)).toBe(true);
  expect(s.sent).toHaveLength(0);
});

test("a finalized conversion rereads its pUSD funding plan before preparing the ordinary take", async () => {
  const s=scenario();s.ready();
  const intent={...(await s.intent()),client_transfer_id:"native",client_take_id:"take-native",to:"hyperliquid",min_out:"1900000",max_parts:8,
    from_chain_id:137,to_chain_id:999,payer:owner,recipient:owner,take_id:null,withdrawal:null,withdrawal_preparation:null,cancelled_at:null,
    funding_plan:null,funding_plan_error:{status:409,code:"PREFUNDING_REQUIRED",message:"Before conversion"}};
  let planReads=0;
  const {client,bodies}=mockApi({
    "POST /v1/transfers":()=>intent,
    "GET /v1/transfers/transfer":(_,query)=>{if(query.get("funding_plan")!=="true") return {...intent,funding_plan_error:null};planReads++;return {...intent,funding_plan_error:null,
      funding_plan:{venue:"polymarket",owner,amount:"1999000",deposit:"0",withdrawal_amount:"0",withdrawal_to:null,payment_setup:"done",
        observed_at:new Date(now).toISOString(),requests:[{kind:"pay_take",signer:owner,chain_id:137}]}};},
    "POST /v1/transfers/transfer/conversion/prepare":()=>s.c,
    "GET /v1/venues":()=>["polymarket","hyperliquid"].map(id=>({id,enabled:true,chain:{...required(CHAINS[id]),permit:undefined,
      wallet_funding:{token:required(CHAINS[id]).token,decimals:6}},release_minimum:null})),
    "GET /v1/balances":()=>[{venue:"hyperliquid",address:owner}],
    "GET /v1/wallets/polymarket":()=>({venue:"polymarket",address:owner,chain_id:137,escrow:chain.escrow,token:chain.token,decimals:6,
      observed_at:new Date(now).toISOString(),wallet:"0",available:"2000001",spendable_wallet:"0",spendable_available:"2000001",payment_setup:{address:owner}}),
    "GET /v1/orders":()=>[],
    "GET /v1/books":()=>({from:"polymarket",to:"hyperliquid",max_fill:"100000000",levels:[{order_id:`0x${"33".repeat(32)}`,sequence:1,supply:"10000000",receive:"10000000",available:"10000000",min_fill:"1",valid_until:new Date(now+60_000).toISOString()}]}),
    "POST /v1/takes":()=>({take:{id:"take",fills:[]},to_sign:[]}),
  });
  await transfer(client,s.signer,{client_transfer_id:"native",from:"polymarket",to:"hyperliquid",funding:"wallet",amount_in:"1999000",min_out:"1900000",recipient:owner,
    conversion:{amount_in:"2000000",min_out:"1999000"}},{now:()=>now});
  expect(planReads).toBe(1);
  expect(bodies["POST /v1/takes"]?.[0]?.amount_in).toBe("1999000");
  expect(s.sent).toHaveLength(0);
});


test("conversion uses the validated development escrow for its allowance and transaction", async () => {
  const escrow = "0xa3fca394739ec4b984e908bd7a3c3b72d0ed77d1";
  const s = scenario(escrow);
  await convertFunding(s.client, s.signer, await s.intent(), memoryStore(), () => now);
  expect(s.sent[0]?.data).toBe(encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [address(escrow), 2_000_000n] }));
  expect(s.sent[1]?.to).toBe(escrow);
});

test("conversion refuses a changed capability or funding escrow before any wallet prompt", async () => {
  for (const changed of ["capability", "funding"]) {
    const s = scenario("0xa3fca394739ec4b984e908bd7a3c3b72d0ed77d1");
    if (changed === "capability") s.advertise(chain.escrow); else s.fundingAt(chain.escrow);
    await expect(convertFunding(s.client, s.signer, await s.intent(), memoryStore(), () => now)).rejects.toThrow(/escrow changed/);
    expect(s.sent).toHaveLength(0);
  }
});

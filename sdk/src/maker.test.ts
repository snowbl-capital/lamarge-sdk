import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "./client.ts";
import { checkDeployment } from "./session.ts";
import type { SocketConstructor } from "./events.ts";
import { Maker, Quoter, type Order } from "./maker.ts";
import { array, CHAINS, EIP712Domain, ESCROW, record, required, schemas, type PreparedMaker, type SignItem } from "./protocol/index.ts";
const account=privateKeyToAccount(`0x${"11".repeat(32)}`), quoteAccount=privateKeyToAccount(`0x${"22".repeat(32)}`);
const operator=`0x${"33".repeat(20)}`, id=`0x${"aa".repeat(32)}`;
const api=(answer:(url:string,init?:RequestInit)=>Response|Promise<Response>,token?:string)=>createClient({apiUrl:"http://localhost:8080",token,fetch:Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>answer(String(input),init),{preconnect:globalThis.fetch.preconnect})});
function order(venue="hyperliquid"):Order {return {preparation_id:null,held_in:"escrow",received_by_venue:[],quotable:"0",filled:"0",margin_move:null,transactions:[],created_at:"2026-10-17T00:00:00Z",updated_at:"2026-10-17T00:00:00Z",capital_pool:true,id,venue,owner_address:account.address,quote_identity_id:"credential-1",quote_signer:quoteAccount.address,amount:"5000000",client_order_id:"persistent-1",state:"preparing",error:null,held:"5000000",delivery_fee:"0",available_to_quote:"0",revision:"1",last_sequence:0,quote_set:null};}
function fund(o:Order):SignItem {return {kind:"fund",signer:account.address,typed_data:{types:{EIP712Domain,...schemas.FundOffer},primaryType:"FundOffer",domain:{name:"LaMarge",version:"1",chainId:required(CHAINS[o.venue]).id,verifyingContract:ESCROW},message:{owner:account.address,offerId:id,amount:o.amount,deposit:o.amount,quoteSigner:quoteAccount.address,operator,minQuoteSequence:"1",nonce:"0",deadline:Math.floor(Date.now()/1000)+3600}}};}
const testDeployments = Object.values(CHAINS).map(chain=>({ version: 5 as const, chainId:chain.id, address:chain.escrow }));
const credential={id:"credential-1",quote_signer:quoteAccount.address};
function asked(o:Order) {return {venue:o.venue,amount:o.amount,client_request_id:o.client_order_id,funding_source:"wallet" as const};}
function prepared(o:Order,items=[fund(o)]):PreparedMaker & {order:Order} {return {id:"preparation-1",client_request_id:o.client_order_id,state:"preparing",venue:o.venue,order:o,to_sign:items,expires_at:new Date(Math.floor(Date.now()/1000)*1000+3600_000).toISOString(),expected_revision:o.revision,sequence:null,intent:{amount:o.amount,quote_identity_id:credential.id,funding_source:"wallet"},funding:{existing_available:"0",wallet_amount:o.amount,venue_amount:"0",idle_amount:"0"}};}
function readResponse(url:string) {if(url.endsWith("/balances"))return Response.json(["hyperliquid","polymarket"].map(venue=>({venue,address:account.address})));if(url.endsWith("/orders"))return Response.json([]);}
test("master provisioning validates both directions and persists signatures before byte-identical retry",async()=>{
  for(const venue of ["hyperliquid","polymarket"]) {
    const o=order(venue), bodies:string[]=[];
    let saved:unknown[]|undefined;
    const client=api(async(url,init)=>{
      const read=readResponse(url);if(read)return read;
      if(url.endsWith("/prepare"))return Response.json(prepared(o));
      expect(saved?.length).toBe(1);bodies.push(String(init?.body));
      if(bodies.length===1)return Response.json({error:{code:"TEMPORARY",message:"Lost acknowledgement"}},{status:503});
      return Response.json({...prepared(o),state:"accepted",order:{...o,state:"funding"}});
    });
    const result=await new Maker(client,account,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential,{store:{load:()=>undefined,save:(_key,signatures)=>{saved=array(signatures);},delete:()=>{}}});
    expect(result.state).toBe("funding");expect(bodies.length).toBe(2);expect(bodies[0]).toBe(bodies[1]);
  }
});
test("lost provisioning reply recovers submitted orders without signing expired payloads",async()=>{
  const o={...order(),state:"live" as const};let signatures=0;
  const signing={...account,signTypedData:async()=>{signatures++;return "0x00" as const;}};
  const client=api(url=>readResponse(url) ?? Response.json({...prepared(o,[]),state:"complete"}));
  expect((await new Maker(client,signing,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential)).state).toBe("live");expect(signatures).toBe(0);
});
test("malicious operator authority is rejected before the first master signature",async()=>{
  const o=order(), item=fund(o);item.typed_data.message.operator=quoteAccount.address;let signatures=0;
  const signing={...account,signTypedData:async()=>{signatures++;return "0x00" as const;}};
  const client=api(url=>readResponse(url) ?? Response.json(prepared(o,[item])));
  await expect(new Maker(client,signing,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential)).rejects.toThrow("The signing request differs from your instructions");expect(signatures).toBe(0);
});
test("funding against an unpinned escrow never reaches the financial key", async () => {
  let prompts = 0;
  const o = order(), signing = { ...account, signTypedData: async () => { prompts++; return "0x00" as const; } };
  const client = api(url => readResponse(url) ?? Response.json(prepared(o)));
  await expect(new Maker(client, signing, operator, "http://localhost:5173", []).addCapital(asked(o), credential)).rejects.toThrow("No pinned escrow");
  expect(prompts).toBe(0);
});

test("provisioning never signs a replaced destination or excessive shortfall", async () => {
  const o=order();let prompts=0;
  const signing={...account,signTypedData:async()=>{prompts++;return "0x00" as const;}};
  for(const mutate of [(p:PreparedMaker)=>{p.funding.wallet_amount="5000001";}]) {
    const p=prepared(o);mutate(p);
    const client=api(url=>readResponse(url) ?? Response.json(p));
    await expect(new Maker(client,signing,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential)).rejects.toThrow("The signing request differs from your instructions");
  }
  expect(prompts).toBe(0);
});

const lines = [{ venue: "hyperliquid", buy: null, sell: "1.0002", stock: "5000000" }, { venue: "polymarket", buy: "1", sell: null, stock: "0" }];
const lineQuotes = () => [{ venue: "polymarket", recipient: account.address, supply: "5000000", receive: "5001000", min_fill: "1000000" }];
function linesApi(signer: string, validUntil: number, quotes: ReturnType<typeof lineQuotes>, seen: (url: string, init?: RequestInit) => void) {
  const pool = { ...order(), quote_signer: signer, state: "live" as const, last_sequence: 1 }, expiresAt = validUntil + 3601;
  return api((url, init) => {
    seen(url, init);
    if (url.endsWith("/quote-lines") && !init?.body) return Response.json({ quote_identity_id: "credential-1", revision: "4", lines: [] });
    if (url.endsWith("/orders")) return Response.json([pool]);
    const body = record(JSON.parse(String(init?.body)));
    if (url.endsWith("/quote-lines/prepare")) return Response.json({ id: "preparation-1", quote_identity_id: "credential-1", expected_revision: body.expected_revision, valid_until: body.valid_until, lines, cancels: [],
      drafts: [{ order_id: id, venue: "hyperliquid", draft_id: "draft-1", sequence: 2, valid_until: validUntil, expires_at: expiresAt, quote_size: "5000000", quotes, to_sign: [{ kind: "quote_set", signer, typed_data: {
        types: { EIP712Domain, ...schemas.QuoteSet }, primaryType: "QuoteSet", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW },
        message: { owner: account.address, offerId: id, sequence: 2, expiresAt, quotes: quotes.map(q => ({ venue: q.venue, chainId: 137, token: required(CHAINS.polymarket).token, recipient: q.recipient, supply: q.supply, receive: q.receive, minFill: q.min_fill })) } } }] }] });
    return Response.json({ quote_identity_id: "credential-1", revision: "5", lines });
  }, "mk_scoped");
}

test("a quote key held elsewhere reviews its lines here and its signature goes as given", async () => {
  const elsewhere = "0x5e00000000000000000000000000000000000001" as const;
  const signature = `0x${"ab".repeat(65)}`, validUntil = Math.floor(Date.now() / 1000) + 120;
  let submitted = false;
  const client = linesApi(elsewhere, validUntil, lineQuotes(), (url, init) => {
    if (!url.endsWith("/quote-lines") || !init?.body) return;
    expect(JSON.parse(String(init.body))).toEqual({ preparation_id: "preparation-1", signatures: [{ draft_id: "draft-1", signature }] });
    submitted = true;
  });
  const quoter = new Quoter(client, { id: "credential-1", quote_signer: elsewhere }, { address: elsewhere }, testDeployments);
  const prepared = await quoter.prepareLines(lines, { polymarket: account.address }, validUntil);
  const draft = required(prepared.drafts[0]);
  expect(required(draft.to_sign[0]).signer).toBe(elsewhere);
  await quoter.client.call("publishQuoteLines", { body: { preparation_id: prepared.id, signatures: [{ draft_id: draft.draft_id, signature }] } });
  expect(submitted).toBe(true);
  await expect(new Quoter(client, { id: "credential-1", quote_signer: elsewhere }, { address: elsewhere }, []).prepareLines(lines, { polymarket: account.address }, validUntil)).rejects.toThrow("No pinned escrow");
});

test("the fill feed keeps the identity's fills from one snapshot and their events, replayed while the stream is down",async()=>{
  const fill={id:"f1",revision:"1",role:"maker",state:"PAID",from:"hyperliquid",to:"lighter",payment_verified_at:null};
  const replayed=Promise.withResolvers<void>();
  // A stream that closes at once: pages come by HTTP replay.
  class Down { onopen=()=>{};onmessage=()=>{};onclose=()=>{}; constructor(){queueMicrotask(()=>this.onclose());} send(){} close(){} }
  let reads=0;
  const client=api(url=>{
    if(url.includes("/me/snapshot")){reads++;return Response.json({cursor:"5",orders:[],fills:[fill]});}
    if(url.includes("/me/events")){replayed.resolve();return Response.json({next_cursor:"6",has_more:false,events:[{cursor:"6",kind:"fill.changed",resource_id:"f1",revision:"2",data:{...fill,payment_verified_at:"2026-10-13T00:00:00Z"}}]});}
    return new Response("unexpected",{status:500});
  },"mk_token");
  const stop=new AbortController();
  const feed=new Quoter(client,{id:"credential-1",quote_signer:quoteAccount.address},quoteAccount).fillFeed(stop.signal,()=>{},Down satisfies SocketConstructor);
  await replayed.promise;
  while((await feed.fills())[0]?.payment_verified_at===null) await Bun.sleep(1);
  stop.abort();
  await feed.done;
  const [current]=await feed.fills();
  expect(current).toMatchObject({id:"f1",from_venue:"hyperliquid",to_venue:"lighter",payment_verified_at:"2026-10-13T00:00:00Z"});
  expect(reads).toBe(1);
});

test("the fill feed takes its pages from the stream, from the cursor it processed",async()=>{
  const fill={id:"f1",revision:"1",role:"maker",state:"PAID",from:"hyperliquid",to:"lighter",payment_verified_at:null};
  const subscriptions:unknown[]=[];
  const subscription=Promise.withResolvers<void>();
  class Stream {
    onopen=()=>{};onmessage=(_:{data:unknown})=>{};onclose=()=>{};
    constructor(readonly url:string) {queueMicrotask(()=>this.onopen());}
    send(text:string) {
      subscriptions.push({url:this.url,...record(JSON.parse(text))});
      this.onmessage({data:JSON.stringify({next_cursor:"6",has_more:false,events:[{cursor:"6",kind:"fill.changed",resource_id:"f1",revision:"2",data:{...fill,payment_verified_at:"2026-10-13T00:00:00Z"}}]})});
      this.onmessage({data:JSON.stringify({next_cursor:"7",has_more:false,events:[{cursor:"7",kind:"fill.changed",resource_id:"f1",revision:"1",data:fill}]})});
      subscription.resolve();
    }
    close() {this.onclose();}
  }
  let replays=0;
  const client=api(url=>{
    if(url.includes("/me/snapshot")) return Response.json({cursor:"5",orders:[],fills:[fill]});
    if(url.includes("/me/events")){replays++;return Response.json({next_cursor:"6",has_more:false,events:[]});}
    return new Response("unexpected",{status:500});
  },"mk_token");
  const stop=new AbortController();
  const feed=new Quoter(client,{id:"credential-1",quote_signer:quoteAccount.address},quoteAccount).fillFeed(stop.signal,()=>{},Stream satisfies SocketConstructor);
  await subscription.promise;
  stop.abort();
  await feed.done;
  expect((await feed.fills())[0]).toMatchObject({id:"f1",payment_verified_at:"2026-10-13T00:00:00Z"});
  expect(subscriptions[0]).toEqual({url:"ws://localhost:8080/v1/stream",token:"mk_token",after:"5"});
  expect(replays).toBe(0);
});

test("a Lighter pool is opened for the dedicated owner linked there; escrow funding stays the financial key's",async()=>{
  const lighterOwner=privateKeyToAccount(`0x${"44".repeat(32)}`).address;
  const o={...order("lighter"),owner_address:lighterOwner,state:"live" as const};
  const client=api(url=>{
    if(url.endsWith("/balances"))return Response.json([{venue:"hyperliquid",address:account.address},{venue:"lighter",address:lighterOwner,venue_wallet:"731033"}]);
    if(url.endsWith("/orders"))return Response.json([]);
    if(url.endsWith("/prepare"))return Response.json({...prepared(o,[]),state:"complete",venue:"lighter",funding:{existing_available:"0",wallet_amount:"0",venue_amount:o.amount,idle_amount:"0"}});
    return new Response("unexpected",{status:500});
  });
  const master=new Maker(client,account,operator,"http://localhost:5173",testDeployments);
  const input={venue:"lighter",amount:o.amount,client_request_id:o.client_order_id,funding_source:"venue" as const};
  await expect(master.addCapital(input,credential)).rejects.toThrow("Link the source account");
  expect((await master.addCapital(input,credential,{owner:lighterOwner})).id).toBe(o.id);
  await expect(master.addCapital({...input,venue:"hyperliquid"},credential,{owner:lighterOwner})).rejects.toThrow("financial key");
});

test("leases report the prior completed HTTP RTT using a monotonic timer", async () => {
  const { spyOn } = await import("bun:test");
  const readings=[10,60,85,90,180];
  const clock=spyOn(performance,"now").mockImplementation(()=>readings.shift() ?? 180);
  const bodies:Record<string,unknown>[]=[];
  try {
    const client=api((_url,init)=>{bodies.push(record(JSON.parse(String(init?.body))));return Response.json({generation:"1",expires_at:"2026-10-15T14:32:00Z"});},"mk_token");
    const quoter=new Quoter(client,{id:"credential-1",quote_signer:quoteAccount.address},quoteAccount);
    await quoter.lease();
    await quoter.lease();
    expect(bodies[0]).toEqual({ttl_seconds:30});
    expect(bodies[1]).toEqual({ttl_seconds:30,api_rtt_ms:50,api_rtt_age_ms:25});
  } finally { clock.mockRestore(); }
});

test("a funding is followed by its preparation: a failed top-up throws though the order stays live",async()=>{
  const states=["accepted","failed"];
  let answer=(url:string)=>{
    if(url.includes("/maker/preparations/prep-1")) return Response.json({id:"prep-1",state:states.shift(),order:{...order(),state:"live",error:"venue refused the margin transfer"}});
    return Response.json({...order(),state:"live",preparation_id:null});
  };
  const master=new Maker(api(url=>answer(url)),account,operator,"http://localhost:5173");
  await expect(master.waitForFunding({...order(),state:"live",preparation_id:"prep-1"},10_000)).rejects.toThrow("Funding failed: venue refused the margin transfer");
  answer=url=>url.includes("/maker/preparations/") ? Response.json({id:"prep-2",state:"complete",order:{...order(),state:"live"}}) : Response.json({...order(),state:"live",preparation_id:null});
  expect((await master.waitForFunding({...order(),preparation_id:"prep-2"})).state).toBe("live");
});

test("delegated lines are checked, then every pool's set is signed and published together", async () => {
  const posted: Record<string, unknown>[] = [], headers: Headers[] = [], quotes = lineQuotes();
  const validUntil = Math.floor(Date.now() / 1000) + 25;
  const client = linesApi(quoteAccount.address, validUntil, quotes, (_url, init) => {
    headers.push(new Headers(init?.headers));
    if (init?.body) posted.push(record(JSON.parse(String(init.body))));
  });
  const quoter = new Quoter(client,{id:"credential-1",quote_signer:quoteAccount.address},quoteAccount, testDeployments);
  expect((await quoter.publishLines(lines, { polymarket: account.address }, validUntil)).revision).toBe("5");
  expect(posted[0]?.expected_revision).toBe("4");
  expect(array(posted[1]?.signatures)).toHaveLength(1);
  expect(headers.every(h => h.get("authorization") === "Bearer mk_scoped")).toBe(true);
  quotes[0] = { ...required(quotes[0]), receive: "5000999" };
  posted.length = 0;
  await expect(quoter.publishLines(lines, { polymarket: account.address }, validUntil)).rejects.toThrow();
  expect(posted).toHaveLength(1);
});

test("the environment comes from the escrows the API names, and an Aster link needs one",async()=>{
  const dev={hyperliquid:"0x948e65c40442d935d4ee990bdbd01bdd825c4873",polymarket:"0xa3fca394739ec4b984e908bd7a3c3b72d0ed77d1"};
  const calls:string[]=[];
  const named=(escrows:Record<string,string>)=>api(url=>{
    calls.push(url);
    if(!url.endsWith("/venues"))return new Response("unexpected",{status:500});
    return Response.json(Object.entries(CHAINS).map(([venue,chain])=>({id:venue,enabled:true,settlement:["aster","lighter"].includes(venue)?"venue":"escrow",chain:{id:chain.id,token:chain.token,decimals:chain.decimals,escrow:escrows[venue] ?? chain.escrow}})));
  });
  expect(await checkDeployment(named({}))).toBe("production");
  expect(await checkDeployment(named(dev))).toBe("development");
  await expect(checkDeployment(named({hyperliquid:dev.hyperliquid}))).rejects.toThrow("API deployment differs");
  calls.length=0;
  await expect(new Maker(named({}),account,operator,"http://localhost:5173",testDeployments).link("aster")).rejects.toThrow("no pinned escrow environment");
  expect(calls.every(url=>url.endsWith("/venues"))).toBe(true);
});

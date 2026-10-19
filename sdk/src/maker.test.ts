import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "./client.ts";
import type { SocketConstructor } from "./events.ts";
import { Maker, Quoter, type Order } from "./maker.ts";
import { array, CHAINS, EIP712Domain, ESCROW, record, required, schemas, type PreparedMaker, type SignItem } from "./protocol/index.ts";
const account=privateKeyToAccount(`0x${"11".repeat(32)}`), quoteAccount=privateKeyToAccount(`0x${"22".repeat(32)}`);
const operator=`0x${"33".repeat(20)}`, id=`0x${"aa".repeat(32)}`;
/** A client of the local API whose every request is answered by `answer`. */
const api=(answer:(url:string,init?:RequestInit)=>Response|Promise<Response>,token?:string)=>createClient({apiUrl:"http://localhost:8080",token,fetch:Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>answer(String(input),init),{preconnect:globalThis.fetch.preconnect})});
function order(venue="hyperliquid"):Order {return {preparation_id:null,held_in:"escrow",escrow_available:"5000000",received_by_venue:[],quotable:"0",filled:"0",margin_move:null,transactions:[],created_at:"2026-10-17T00:00:00Z",updated_at:"2026-10-17T00:00:00Z",capital_pool:true,id,venue,receive_venue:venue==="hyperliquid"?"polymarket":"hyperliquid",owner_address:account.address,quote_identity_id:"credential-1",quote_signer:quoteAccount.address,amount:"5000000",client_order_id:"persistent-1",state:"preparing",error:null,held:"5000000",delivery_fee:"0",available_to_quote:"0",revision:"1",last_sequence:0,quote_set:null};}
function fund(o:Order):SignItem {return {kind:"fund",signer:account.address,typed_data:{types:{EIP712Domain,...schemas.FundOffer},primaryType:"FundOffer",domain:{name:"LaMarge",version:"1",chainId:required(CHAINS[o.venue]).id,verifyingContract:ESCROW},message:{owner:account.address,offerId:id,amount:o.amount,deposit:o.amount,quoteSigner:quoteAccount.address,operator,minQuoteSequence:"1",nonce:"0",deadline:Math.floor(Date.now()/1000)+3600}}};}
const testDeployments = Object.values(CHAINS).map(chain=>({ version: 5 as const, chainId:chain.id, address:chain.escrow }));
const credential={id:"credential-1",quote_signer:quoteAccount.address};
function asked(o:Order) {return {venue:o.venue,amount:o.amount,client_request_id:o.client_order_id,funding_source:"wallet" as const};}
function prepared(o:Order,items=[fund(o)]):PreparedMaker & {order:Order} {return {id:"preparation-1",client_request_id:o.client_order_id,state:"preparing",venue:o.venue,order:o,to_sign:items,expires_at:new Date(Math.floor(Date.now()/1000)*1000+3600_000).toISOString(),expected_revision:o.revision,sequence:null,intent:{amount:o.amount,quote:null,quote_identity_id:credential.id,funding_source:"wallet"},funding:{existing_available:"0",added_amount:o.amount,wallet_amount:o.amount,venue_amount:"0",idle_amount:"0"}};}
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
    const result=await new Maker(client,account,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential,{load:()=>undefined,save:(_key,signatures)=>{saved=array(signatures);},delete:()=>{}});
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
  await expect(new Maker(client,signing,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential)).rejects.toThrow();expect(signatures).toBe(0);
});
test("delegated quoting validates both directions and sends only scoped authority",async()=>{
  const headers:Headers[]=[];
  const liveOrder=(venue:string):Order=>({...order(venue),id:venue==="hyperliquid"?id:`0x${"bb".repeat(32)}`,state:"live",available_to_quote:"5000000"});
  const scoped=api((url,init)=>{
    headers.push(new Headers(init?.headers));
    const body=record(JSON.parse(String(init?.body)));
    const venue=url.includes(id)?"hyperliquid":"polymarket";
    const o=liveOrder(venue), q:Record<string,unknown>={...record(array(body.quotes)[0]),recipient:account.address}, qVenue=String(q.venue), expiresAt=Number(body.valid_until)+3601;
    return Response.json({draft_id:"draft-1",sequence:2,valid_until:body.valid_until,quote_size:body.quote_size,expires_at:expiresAt,quotes:[q],to_sign:[{kind:"quote_set",signer:quoteAccount.address,typed_data:{types:{EIP712Domain,...schemas.QuoteSet},primaryType:"QuoteSet",domain:{name:"LaMarge",version:"1",chainId:required(CHAINS[venue]).id,verifyingContract:ESCROW},message:{owner:account.address,offerId:o.id,sequence:2,expiresAt,quotes:[{venue:qVenue,chainId:required(CHAINS[qVenue]).id,token:required(CHAINS[qVenue]).token,recipient:q.recipient,supply:q.supply,receive:q.receive,minFill:q.min_fill}]}}}]});
  },"mk_scoped");
  let signed=0;const signing={...quoteAccount,signTypedData:async()=>{signed++;return "0x00" as const;}};
  const client=new Quoter(scoped,"credential-1",signing,testDeployments);
  for(const venue of ["hyperliquid","polymarket"]) {
    const o=liveOrder(venue);
    const result=await client.prepare(o,[{venue:required(o.receive_venue),recipient:account.address,supply:o.amount,receive:"5000100",min_fill:"1000000"}],5_000_000n,Math.floor(Date.now()/1000)+25);
    expect(result.draft_id).toBe("draft-1");
  }
  expect(signed).toBe(2);expect(headers.every(h=>h.get("authorization")==="Bearer mk_scoped")).toBe(true);
});

test("one delegated signature covers both destinations of a shared inventory", async () => {
  const o = { ...order(), state: "live" as const, available_to_quote:"5000000" };
  const quotes = [
    { venue: "polymarket", recipient: account.address, supply: o.amount, receive: "5500000", min_fill: "1000000" },
    { venue: "aster", recipient: account.address, supply: o.amount, receive: "5000000000000000000", min_fill: "1000000" },
  ];
  let prompts = 0;
  const signing = { ...quoteAccount, signTypedData: async () => { prompts++; return "0x00" as const; } };
  const client = api((_url, init) => {
    const body = record(JSON.parse(String(init?.body))), expiresAt = Number(body.valid_until) + 3601;
    expect(body.quotes).toHaveLength(2);
    expect(body.quote_size).toBe("5000000");
    return Response.json({ draft_id: "shared", sequence: 2, valid_until: body.valid_until, quote_size: body.quote_size, expires_at: expiresAt, quotes, to_sign: [{ kind: "quote_set", signer: quoteAccount.address, typed_data: {
      types: { EIP712Domain, ...schemas.QuoteSet }, primaryType: "QuoteSet", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW },
      message: { owner: account.address, offerId: o.id, sequence: 2, expiresAt, quotes: quotes.map(q => ({ venue: q.venue, chainId: required(CHAINS[q.venue]).id, token: required(CHAINS[q.venue]).token, recipient: q.recipient, supply: q.supply, receive: q.receive, minFill: q.min_fill })) },
    } }] });
  }, "mk_scoped");
  const quoter = new Quoter(client, "credential-1", signing, testDeployments);
  expect((await quoter.prepare(o, quotes, 5_000_000n, Math.floor(Date.now() / 1000) + 25)).draft_id).toBe("shared");
  expect(prompts).toBe(1);
  await expect(quoter.prepare(o, [required(quotes[0]), required(quotes[0])], 5_000_000n, Math.floor(Date.now() / 1000) + 25)).rejects.toThrow();
  expect(prompts).toBe(1);
});

test("funding against an unpinned escrow never reaches the financial key", async () => {
  let prompts = 0;
  const o = order(), signing = { ...account, signTypedData: async () => { prompts++; return "0x00" as const; } };
  const client = api(url => readResponse(url) ?? Response.json(prepared(o)));
  await expect(new Maker(client, signing, operator, "http://localhost:5173", []).addCapital(asked(o), credential)).rejects.toThrow("balance upgrade is not available");
  expect(prompts).toBe(0);
});

test("provisioning never signs a replaced destination or excessive shortfall", async () => {
  const o=order();let prompts=0;
  const signing={...account,signTypedData:async()=>{prompts++;return "0x00" as const;}};
  for(const mutate of [(p:PreparedMaker)=>{p.funding.wallet_amount="5000001";},(p:PreparedMaker)=>{p.intent.quote={receive_venue:"aster",receive:"1",min_fill:"1"};}]) {
    const p=prepared(o);mutate(p);
    const client=api(url=>readResponse(url) ?? Response.json(p));
    await expect(new Maker(client,signing,operator,"http://localhost:5173",testDeployments).addCapital(asked(o),credential)).rejects.toThrow();
  }
  expect(prompts).toBe(0);
});

test("external contract quoting reviews its draft without an EOA key and preserves opaque signature bytes", async () => {
  const safe = "0x1271000000000000000000000000000000000001" as const;
  const o = { ...order(), quote_signer: safe, state: "live" as const, available_to_quote:"5000000" };
  const q = { venue: "polymarket", recipient: account.address, supply: o.amount, receive: "5003250", min_fill: "1000000" };
  const signature = "0x00112233445566778899aabbccddeeff";
  let submitted = false;
  const client = api((url, init) => {
    const body = record(JSON.parse(String(init?.body))), expiresAt = Number(body.valid_until) + 3601;
    if (url.endsWith("/quotes/batch")) {
      expect(body.updates).toEqual([{ order_id: o.id, draft_id: "safe-draft", signature }]);
      submitted = true;
      return Response.json({ results: [] });
    }
    return Response.json({ draft_id: "safe-draft", sequence: 2, valid_until: body.valid_until, quote_size: body.quote_size, expires_at: expiresAt, quotes: [q], to_sign: [{ kind: "quote_set", signer: safe, typed_data: {
      types: { EIP712Domain, ...schemas.QuoteSet }, primaryType: "QuoteSet", domain: { name: "LaMarge", version: "1", chainId: 999, verifyingContract: ESCROW },
      message: { owner: o.owner_address, offerId: o.id, sequence: 2, expiresAt, quotes: [{ venue: q.venue, chainId: 137, token: required(CHAINS.polymarket).token, recipient: q.recipient, supply: q.supply, receive: q.receive, minFill: q.min_fill }] },
    } }] });
  }, "mk_scoped");
  const quoter = new Quoter(client, "credential-1", { address: safe }, testDeployments);
  const draft = await quoter.prepareUnsigned(o, [q], 5_000_000n, Math.floor(Date.now() / 1000) + 120);
  expect(required(draft.to_sign[0]).signer).toBe(safe);
  await quoter.batch([{ order_id: o.id, draft_id: draft.draft_id, signature }]);
  expect(submitted).toBe(true);
  await expect(new Quoter(client, "credential-1", { address: safe }, []).prepareUnsigned(o, [q], 5_000_000n, Math.floor(Date.now() / 1000) + 120)).rejects.toThrow("balance upgrade is not available");
});

test("the fill feed keeps the identity's fills from one snapshot and their events, replayed while the stream is down",async()=>{
  const fill={id:"f1",role:"maker",state:"PAID",from:"hyperliquid",to:"lighter",payment_verified_at:null};
  const realSocket=globalThis.WebSocket;
  // A stream that closes at once: pages come by HTTP replay.
  // fillFeed opens the global WebSocket.
  Object.assign(globalThis,{WebSocket:class { onopen=()=>{};onmessage=()=>{};onclose=()=>{}; constructor(){setTimeout(()=>this.onclose(),0);} send(){} close(){} } satisfies SocketConstructor});
  let reads=0;
  const client=api(url=>{
    if(url.includes("/me/snapshot")){reads++;return Response.json({cursor:"5",orders:[],fills:[fill]});}
    if(url.includes("/me/events")) return Response.json({next_cursor:"6",has_more:false,events:[{cursor:"6",kind:"fill.changed",resource_id:"f1",revision:"2",data:{...fill,payment_verified_at:"2026-10-13T00:00:00Z"}}]});
    return new Response("unexpected",{status:500});
  },"mk_token");
  const stop=new AbortController();
  const feed=new Quoter(client,"credential-1",quoteAccount).fillFeed(stop.signal,()=>{});
  for(let tries=0;tries<50;tries++){const fills=await feed.fills().catch(()=>[]);if(fills[0]?.payment_verified_at)break;await new Promise(resolve=>setTimeout(resolve,20));}
  const [current]=await feed.fills();
  expect(current).toMatchObject({id:"f1",from_venue:"hyperliquid",to_venue:"lighter",payment_verified_at:"2026-10-13T00:00:00Z"});
  expect(reads).toBe(1);
  stop.abort();
  await feed.done;
  globalThis.WebSocket=realSocket;
});

test("the fill feed takes its pages from the stream, from the cursor it processed",async()=>{
  const fill={id:"f1",role:"maker",state:"PAID",from:"hyperliquid",to:"lighter",payment_verified_at:null};
  const realSocket=globalThis.WebSocket;
  const subscriptions:unknown[]=[];
  class Stream {
    onopen=()=>{};onmessage=(_:{data:unknown})=>{};onclose=()=>{};
    constructor(readonly url:string) {setTimeout(()=>this.onopen(),0);}
    send(text:string) {
      subscriptions.push({url:this.url,...record(JSON.parse(text))});
      setTimeout(()=>this.onmessage({data:JSON.stringify({next_cursor:"6",has_more:false,events:[{cursor:"6",kind:"fill.changed",resource_id:"f1",revision:"2",data:{...fill,payment_verified_at:"2026-10-13T00:00:00Z"}}]})}),0);
    }
    close() {setTimeout(()=>this.onclose(),0);}
  }
  Object.assign(globalThis,{WebSocket:Stream satisfies SocketConstructor});
  let replays=0;
  const client=api(url=>{
    if(url.includes("/me/snapshot")) return Response.json({cursor:"5",orders:[],fills:[fill]});
    if(url.includes("/me/events")){replays++;return Response.json({next_cursor:"6",has_more:false,events:[]});}
    return new Response("unexpected",{status:500});
  },"mk_token");
  const stop=new AbortController();
  try {
    const feed=new Quoter(client,"credential-1",quoteAccount).fillFeed(stop.signal,()=>{});
    for(let tries=0;tries<50;tries++){const fills=await feed.fills().catch(()=>[]);if(fills[0]?.payment_verified_at)break;await new Promise(resolve=>setTimeout(resolve,20));}
    expect((await feed.fills())[0]).toMatchObject({id:"f1",payment_verified_at:"2026-10-13T00:00:00Z"});
    expect(subscriptions[0]).toEqual({url:"ws://localhost:8080/v1/stream",token:"mk_token",after:"5"});
    expect(replays).toBe(0);
    stop.abort();
    await feed.done;
  } finally {globalThis.WebSocket=realSocket;}
});

test("a Lighter pool is opened for the dedicated owner linked there; escrow funding stays the financial key's",async()=>{
  const lighterOwner=privateKeyToAccount(`0x${"44".repeat(32)}`).address;
  const o={...order("lighter"),owner_address:lighterOwner,state:"live" as const};
  const client=api(url=>{
    if(url.endsWith("/balances"))return Response.json([{venue:"hyperliquid",address:account.address},{venue:"lighter",address:lighterOwner,venue_wallet:"731033"}]);
    if(url.endsWith("/orders"))return Response.json([]);
    if(url.endsWith("/prepare"))return Response.json({...prepared(o,[]),state:"complete",venue:"lighter",funding:{existing_available:"0",added_amount:o.amount,wallet_amount:"0",venue_amount:o.amount,idle_amount:"0"}});
    return new Response("unexpected",{status:500});
  });
  const master=new Maker(client,account,operator,"http://localhost:5173",testDeployments);
  const input={venue:"lighter",amount:o.amount,client_request_id:o.client_order_id,funding_source:"venue" as const};
  await expect(master.addCapital(input,credential)).rejects.toThrow("Link the source account");
  expect((await master.addCapital(input,credential,undefined,lighterOwner)).id).toBe(o.id);
  await expect(master.addCapital({...input,venue:"hyperliquid"},credential,undefined,lighterOwner)).rejects.toThrow("financial key");
});

test("leases report the prior completed HTTP RTT using a monotonic timer", async () => {
  const { spyOn } = await import("bun:test");
  const readings=[10,60,85,90,180];
  const clock=spyOn(performance,"now").mockImplementation(()=>readings.shift() ?? 180);
  const bodies:Record<string,unknown>[]=[];
  try {
    const client=api((_url,init)=>{bodies.push(record(JSON.parse(String(init?.body))));return Response.json({generation:"1",expires_at:"2026-10-15T14:32:00Z"});},"mk_token");
    const quoter=new Quoter(client,"credential-1",quoteAccount);
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

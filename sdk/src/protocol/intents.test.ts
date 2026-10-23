import { checkPermit, array, record, required, checkMakerIntent, checkTakeIntent, type PreparedMaker, type MakerOrderSnapshot, type TakeFill, CHAINS, EIP712Domain, ESCROW, MAKER_TIMEOUT_SECONDS, NEVER_VALID_UNTIL, UNLIMITED_ALLOWANCE, checkWithdrawal, schemas, type SignItem, type Typed } from "./index.ts";
import { expect, test } from "bun:test";
const owner=`0x${"11".repeat(20)}`, receiver=`0x${"22".repeat(20)}`, operator=`0x${"33".repeat(20)}`, id=`0x${"aa".repeat(32)}`;
const now=Math.floor(Date.now()/1000);
function typed(primaryType:string,message:Record<string,unknown>):Typed {return {types:{EIP712Domain,...schemas[primaryType]},primaryType,domain:{name:"LaMarge",version:"1",chainId:999,verifyingContract:ESCROW},message};}
const input={venue:"hyperliquid",amount:"10000000",client_request_id:"request-1",quote_identity_id:"delegated",funding_source:"wallet" as const};
const order:MakerOrderSnapshot={id,state:"live",venue:input.venue,owner_address:owner,quote_signer:receiver,quote_identity_id:"delegated",revision:"1",last_sequence:0,available_to_quote:"0",quote_set:null};
const funding=():SignItem=>({kind:"fund",signer:owner,typed_data:typed("FundOffer",{owner,offerId:id,amount:input.amount,deposit:input.amount,quoteSigner:receiver,operator,minQuoteSequence:"1",nonce:"4",deadline:String(now+3600)})});
const preparation=(items:SignItem[]):PreparedMaker=>({id:"preparation-1",client_request_id:input.client_request_id,state:"preparing",venue:input.venue,order,expected_revision:"1",sequence:null,to_sign:items,expires_at:new Date((now+3600)*1000).toISOString(),intent:{amount:input.amount,quote_identity_id:"delegated",funding_source:"wallet"},funding:{existing_available:"0",wallet_amount:input.amount,venue_amount:"0",idle_amount:"0"}});
const authority={owner,quoteSigner:receiver,quoteIdentityId:"delegated",operator,recipient:receiver,existingOrder:null};
const validate=(items:SignItem[],returned=preparation(items))=>checkMakerIntent(returned,input,authority,now);

test("financial provisioning permits only the requested authority, domain, capital and request id",()=>{
  expect(()=>validate([funding()])).not.toThrow();
  const differs="The signing request differs from your instructions";
  const mutations:[(item:SignItem)=>void,string][]=[[i=>i.typed_data.message.operator=owner,`${differs}: fund.operator`],[i=>i.typed_data.message.quoteSigner=operator,`${differs}: fund.quoteSigner`],[i=>i.typed_data.message.amount="10000001",`${differs}: fund.amount`],[i=>i.typed_data.domain.verifyingContract=owner,"Unexpected signing domain"],[i=>i.typed_data.domain.chainId=137,"Unexpected signing domain"],[i=>i.typed_data.types.FundOffer=required(i.typed_data.types.FundOffer).map(f=>f.name==="amount"?{...f,type:"uint64"}:f),"Unexpected signing types"],[i=>i.typed_data.message.deadline=now+7200,"Signing deadline is expired or too long"],[i=>i.signer=operator,differs]];
  for(const [mutate,reason] of mutations) {const item=funding();item.typed_data=structuredClone(item.typed_data);mutate(item);expect(()=>validate([item])).toThrow(reason);}
  expect(()=>validate([funding()],{...preparation([funding()]),client_request_id:"another-request"})).toThrow();
  expect(()=>validate([funding(),funding()])).toThrow();
  expect(()=>validate([])).toThrow();
});
test("a deposit takes the available balance first and only the rest from its source",()=>{
  const fund=funding();fund.typed_data.message.deposit="6000000";
  const idle=(patch:Partial<PreparedMaker["funding"]>)=>({...preparation([fund]),funding:{existing_available:"4000000",idle_amount:"4000000",wallet_amount:"6000000",venue_amount:"0",...patch}});
  expect(()=>validate([fund],idle({}))).not.toThrow();
  expect(()=>validate([fund],idle({existing_available:"3000000"}))).toThrow();
  expect(()=>validate([fund],idle({idle_amount:"0",wallet_amount:input.amount}))).toThrow();
});
test("only the unlimited permit for the pinned escrow is signed",()=>{
  const permit:SignItem={kind:"permit",signer:owner,typed_data:typed("Permit",{owner,spender:ESCROW,value:UNLIMITED_ALLOWANCE.toString(),nonce:"0",deadline:now+600})};
  permit.typed_data.domain={name:"USDC",version:"2",chainId:999,verifyingContract:required(CHAINS.hyperliquid).token};
  expect(()=>checkPermit(permit,"hyperliquid",owner)).not.toThrow();
  expect(()=>validate([permit,funding()])).toThrow();
  permit.typed_data.message.value=input.amount;
  expect(()=>checkPermit(permit,"hyperliquid",owner)).toThrow();
  permit.typed_data.message.value=UNLIMITED_ALLOWANCE.toString();
  permit.typed_data.message.spender=owner;
  expect(()=>checkPermit(permit,"hyperliquid",owner)).toThrow();
});
const fill:TakeFill={id:"fill-1",order_id:id,sequence:1,role:"taker",from_venue:"hyperliquid",to_venue:"polymarket",amount_in:"1000000",amount_out:"1005000",payer:owner,maker_recipient:receiver,taker_recipient:owner,swap_id:id,hashlock:`0x${"bb".repeat(32)}`,pay_by:new Date((now+45)*1000).toISOString(),t1:new Date((now+3600)*1000).toISOString(),t2:new Date((now+7200)*1000).toISOString()};
const lock=():Record<string,unknown>=>({payer:owner,swapId:id,recipient:receiver,amount:"1000000",hashlock:fill.hashlock,refundAt:now+7200,deadline:now+45,orderId:fill.order_id,sequence:fill.sequence,amountOut:fill.amount_out,receiveChainId:137,receiveToken:required(CHAINS.polymarket).token,receiveEscrow:ESCROW,receiveRecipient:owner, dex: 0});
const payTake=(payments=[lock()],deposit="0"):SignItem=>({kind:"pay_take",fill_id:fill.id,signer:owner,typed_data:typed("PayTake",{payer:owner,deposit,payments})});
const paymentOf=(item:SignItem)=>required(array(item.typed_data.message.payments).map(record)[0]);
const take={from:"hyperliquid",to:"polymarket",amount_in:"1000000",min_out:"1000000"};
test("take validates total spend, slippage, one payment per fill, deadlines and destination",()=>{
  const check=(items:SignItem[],fills=[fill])=>checkTakeIntent(items,fills,take,owner,owner,now);
  expect(()=>check([payTake()])).not.toThrow();
  expect(()=>check([payTake(),payTake()])).toThrow();
  expect(()=>check([payTake([lock(),lock()])])).toThrow();
  expect(()=>check([payTake([])])).toThrow();
  expect(()=>check([payTake()],[{...fill,amount_in:"1000001"}])).toThrow();
  expect(()=>check([payTake()],[{...fill,amount_out:"999999"}])).toThrow();
  const other=payTake();paymentOf(other).recipient=operator;expect(()=>check([other])).toThrow();
  const late=payTake();paymentOf(late).refundAt=now+86400;expect(()=>check([late])).toThrow();
  const extra=payTake();paymentOf(extra).note="hidden";expect(()=>check([extra])).toThrow();
  const payer=payTake();payer.typed_data.message.payer=receiver;expect(()=>check([payer])).toThrow();
  expect(()=>check([payTake()],[{...fill,taker_recipient:operator}])).toThrow();
  expect(()=>check([{...payTake(),kind:"margin_move"}])).toThrow();
  expect(()=>check([{...payTake(),fill_id:"another-take"}])).toThrow();
  const missingId = payTake(); delete missingId.fill_id;
  expect(()=>check([missingId])).toThrow();
  expect(()=>check([payTake()],[{...fill,delivery_to:null}])).not.toThrow();
  expect(()=>check([payTake()],[{...fill,delivery_to:"42"}])).toThrow("another account than yours");
});
test("a take deposits only its payer's shortfall with a reusable allowance",()=>{
  const check=(items:SignItem[])=>checkTakeIntent(items,[fill],take,owner,owner,now);
  const deposit=(amount="400000")=>payTake([lock()],amount);
  const permit=(value=UNLIMITED_ALLOWANCE.toString()):SignItem=>{const item:SignItem={kind:"permit",fill_id:fill.id,signer:owner,typed_data:typed("Permit",{owner,spender:ESCROW,value,nonce:"0",deadline:now+45})};item.typed_data.domain={name:"USDC",version:"2",chainId:999,verifyingContract:required(CHAINS.hyperliquid).token};return item;};
  expect(()=>check([deposit()])).not.toThrow();
  expect(()=>check([permit(),deposit()])).toThrow();
  expect(()=>check([permit(),payTake()])).toThrow();
  expect(()=>check([permit("400001"),deposit()])).toThrow();
  expect(()=>check([permit(),permit(),deposit()])).toThrow();
  expect(()=>check([deposit("1000001")])).toThrow();
  const spender=permit();spender.typed_data.message.spender=receiver;expect(()=>check([spender,deposit()])).toThrow();
  const late=permit();late.typed_data.message.deadline=now+3600;expect(()=>check([late,deposit()])).toThrow();
});
test("withdrawal pins exact schema and prevents external destinations or fee changes",()=>{
  const withdrawal=typed("Withdraw",{account:owner,token:required(CHAINS.polymarket).token,amount:"1000000",fee:"0",to:owner,salt:5,ts:now});
  withdrawal.domain={name:"Polymarket",version:"1",chainId:137,verifyingContract:"0xdca4af75705dbb50f62437045aff9921947917d2"};
  const check=()=>checkWithdrawal(withdrawal,"polymarket",owner,owner,1000000n,now);
  expect(check).not.toThrow();withdrawal.message.to=operator;expect(check).toThrow();withdrawal.message.to=owner;withdrawal.message.fee="1";expect(check).toThrow();
});

test("take signing respects the caller's limit on parts", () => {
  const second = { ...fill, id: "fill-2", swap_id: `0x${"cc".repeat(32)}` };
  const both = payTake([lock(), { ...lock(), swapId: second.swap_id }]);
  const input = { ...take, amount_in: "2000000", min_out: "2000000", max_parts: 1 };
  expect(() => checkTakeIntent([both], [fill, second], input, owner, owner, now)).toThrow();
  expect(() => checkTakeIntent([both], [fill, second], { ...input, max_parts: 2 }, owner, owner, now)).not.toThrow();
  expect(() => checkTakeIntent([payTake([lock(), lock()])], [fill, second], { ...input, max_parts: 2 }, owner, owner, now)).toThrow();
  expect(() => checkTakeIntent([payTake()], [fill, second], { ...input, max_parts: 2 }, owner, owner, now)).toThrow();
});

test("one take signature binds both amounts, destination, quote and payment of every fill before signing",()=>{
 const mutations:[(p:Record<string,unknown>)=>void,string][]=[[p=>p.amountOut="1000001","amountOut"],[p=>p.amount="1","amount"],[p=>p.receiveRecipient=receiver,"receiveRecipient"],[p=>p.receiveChainId=999,"receive"],[p=>p.receiveToken=owner,"receive"],[p=>p.receiveEscrow=owner,"receive"],[p=>p.hashlock=id,"hashlock"],[p=>p.recipient=operator,"recipient"],[p=>p.refundAt=now+86400,"refundAt"],[p=>p.orderId=fill.hashlock,"orderId"],[p=>p.sequence=2,"sequence"],[p=>p.swapId=fill.hashlock,"swapId"],[p=>p.deadline=now+60,"deadline"],[p=>p.payer=receiver,"payer"],[p=>p.dex=1,"dex"]];
 for(const [mutate,field] of mutations){const item=payTake();mutate(paymentOf(item));expect(()=>checkTakeIntent([item],[fill],take,owner,owner,now)).toThrow(new RegExp(`: payments\\.${field}$`));}
 const day={...fill,t2:new Date((now+86100)*1000).toISOString()};const dayLock={...lock(),refundAt:now+86100};expect(()=>checkTakeIntent([payTake([dayLock])],[day],take,owner,owner,now)).not.toThrow();
 const later={...fill,t2:new Date((now+86400+60)*1000).toISOString()};expect(()=>checkTakeIntent([payTake()],[later],take,owner,owner,now)).toThrow("The signing request differs from your instructions: fills.t2");
 const signer=payTake();signer.signer=receiver;expect(()=>checkTakeIntent([signer],[fill],take,owner,owner,now)).toThrow();
 const types=payTake();types.typed_data.types.LockPayment=required(types.typed_data.types.LockPayment).filter(f=>f.name!=="receiveRecipient");expect(()=>checkTakeIntent([types],[fill],take,owner,owner,now)).toThrow();
});


test("a browser top-up adds all it asks, binds only the shortfall and preserves every remaining price", () => {
  const oldQuote={venue:"aster",recipient:receiver,supply:"50000000",receive:"55000000000000000000",min_fill:"1000000",available:"30000000"};
  const existing:MakerOrderSnapshot={...order,last_sequence:7,available_to_quote:"50000000",quote_set:{sequence:7,active:true,valid_until:new Date((NEVER_VALID_UNTIL)*1000).toISOString(),expires_at:new Date((NEVER_VALID_UNTIL+MAKER_TIMEOUT_SECONDS+1)*1000).toISOString(),quotes:[oldQuote]}};
  const asked={venue:input.venue,amount:"50000000",client_request_id:"topup",funding_source:"wallet" as const};
  const fund=funding(); Object.assign(fund.typed_data.message,{amount:"50000000",deposit:"40000000",minQuoteSequence:"12"});
  const quote:SignItem={kind:"quote_set",signer:receiver,typed_data:typed("QuoteSet",{owner,offerId:id,sequence:12,expiresAt:NEVER_VALID_UNTIL+MAKER_TIMEOUT_SECONDS+1,quotes:[
    {venue:"aster",chainId:56,token:required(CHAINS.aster).token,recipient:receiver,supply:"30000000",receive:"33000000000000000000",minFill:"1000000"},
  ]})};
  const prepared:PreparedMaker={...preparation([fund,quote]),client_request_id:asked.client_request_id,order:existing,sequence:12,intent:{amount:asked.amount,quote_identity_id:"delegated",funding_source:"wallet"},funding:{existing_available:"60000000",idle_amount:"10000000",wallet_amount:"40000000",venue_amount:"0"}};
  const check=(p=prepared)=>checkMakerIntent(p,asked,{...authority,existingOrder:existing},now);
  expect(()=>check()).not.toThrow();
  const mutations:((p:PreparedMaker)=>void)[]=[
    p=>p.funding.wallet_amount="50000000",p=>p.funding.idle_amount="0",p=>required(p.to_sign[0]).typed_data.message.deposit="50000000",p=>required(p.to_sign[0]).typed_data.message.minQuoteSequence="8",p=>p.sequence=7,p=>p.order.id=owner,
    p=>{Object.assign(p.funding,{wallet_amount:"30000000"});Object.assign(required(p.to_sign[0]).typed_data.message,{amount:"40000000",deposit:"30000000"});},
    p=>record(array(required(p.to_sign[1]).typed_data.message.quotes)[0]).supply="50000000",
    p=>record(array(required(p.to_sign[1]).typed_data.message.quotes)[0]).receive="1",
    p=>record(array(required(p.to_sign[1]).typed_data.message.quotes)[0]).recipient=operator,
    p=>required(p.to_sign[1]).typed_data.message.quotes=[],
    p=>required(p.to_sign[1]).typed_data.message.quotes=[...array(required(p.to_sign[1]).typed_data.message.quotes),array(required(p.to_sign[1]).typed_data.message.quotes)[0]],
  ];
  for(const mutate of mutations){const p=structuredClone(prepared);mutate(p);expect(()=>check(p)).toThrow("The signing request differs from your instructions");}
});

test("deposit-only preparations preserve remaining quotes without extending their expiry",()=>{
  const q={venue:"polymarket",recipient:receiver,supply:"10000000",receive:"10050000",min_fill:"1000000",available:"6000000"};
  const expiry=now+120+MAKER_TIMEOUT_SECONDS+1;
  const existing:MakerOrderSnapshot={...order,last_sequence:4,available_to_quote:"10000000",quote_set:{sequence:4,active:true,valid_until:new Date((now+120)*1000).toISOString(),expires_at:new Date(expiry*1000+456).toISOString(),quotes:[q]}};
  const asked={venue:input.venue,amount:input.amount,client_request_id:input.client_request_id,funding_source:input.funding_source};
  const fund=funding();fund.typed_data.message.minQuoteSequence="5";
  const quote:SignItem={kind:"quote_set",signer:receiver,typed_data:typed("QuoteSet",{owner,offerId:id,sequence:5,expiresAt:expiry,quotes:[{venue:q.venue,chainId:137,token:required(CHAINS.polymarket).token,recipient:q.recipient,supply:q.available,receive:"6030000",minFill:q.min_fill}]})};
  const p:PreparedMaker={...preparation([fund,quote]),order:existing,sequence:5,funding:{existing_available:existing.available_to_quote,idle_amount:"0",wallet_amount:asked.amount,venue_amount:"0"}};
  const check=(prepared=p)=>checkMakerIntent(prepared,asked,{...authority,existingOrder:existing},now);
  expect(()=>check()).not.toThrow();
  const extended=structuredClone(p);required(extended.to_sign[1]).typed_data.message.expiresAt=NEVER_VALID_UNTIL+MAKER_TIMEOUT_SECONDS+1;
  expect(()=>check(extended)).toThrow();
  const inflated=structuredClone(p);record(array(required(inflated.to_sign[1]).typed_data.message.quotes)[0]).supply="20000000";
  expect(()=>check(inflated)).toThrow();
});

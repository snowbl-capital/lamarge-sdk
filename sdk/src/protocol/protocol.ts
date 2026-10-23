import { address, array, hex, record, required, type Verified } from "./validation.ts";
import { ESCROW_DEPLOYMENTS, ESCROW_PROOF_DEPLOYMENTS, escrowDeployment, type DeploymentManifest, type EscrowDeployment } from "./deployments.ts";
/**
 * Production's proxy, the same address on HyperEVM and Polygon (contracts/README.md#deployments).
 * @deprecated Production's only: a deployment's escrows are its venues' `chain.escrow` (`getVenues`), checked against `ESCROW_DEPLOYMENTS`.
 */
export const ESCROW = "0x3100b7b49c0f9631c6af25877b5a4e13a47afad6";
/**
 * Each venue's escrow chain, token decimals and permit domain, and `escrow`: production's escrow on
 * an escrow venue, the contract of its signing domain on a venue settled inside itself. A venue the
 * API enables but that is not pinned here is not traded.
 */
export const CHAINS: Record<string, { id: number; token: string; decimals: number; permit?: string; version?: string; escrow: string }> = {
  hyperliquid: { id: 999, token: "0xb88339cb7199b77e23db6e890353e22632ba630f", decimals: 6, permit: "USDC", version: "2", escrow: ESCROW },
  polymarket: { id: 137, token: "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb", decimals: 6, permit: "Polymarket USD", version: "1", escrow: ESCROW },
  // Settled inside the venue, no escrow. Quote sets and payment terms name a signing chain id,
  // contract and token: Lighter's L2 chain id, its zkLighter contract on Ethereum and its USDC;
  // BSC, Aster's vault and USDT.
  aster: { id: 56, token: "0x55d398326f99059ff775485246999027b3197955", decimals: 18, escrow: "0x128463a60784c4d3f46c23af3f65ed859ba87974" },
  lighter: { id: 304, token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, escrow: "0x3b4d794a66304f130a4db8f2551b0070dfcf5ca7" },
};
/** Venues where the maker delivers inside the venue, read by the server, instead of the operator from his escrow offer. */
export const VENUE_SETTLED = new Set(["lighter", "aster"]);
/** A route whose first take pays inside a venue and goes through an escrow venue: LaMarge can have it signed at once. */
export const groupable = (from: string, via: string) => VENUE_SETTLED.has(from) && !VENUE_SETTLED.has(via) && CHAINS[via] !== undefined;
/** The most seconds to a route's second take's `pay_by` when signed at once: the server's 180 s bound and a clock margin. */
export const ROUTE_PAY_WINDOW_SECONDS = 210;
/** A take signed at once with its withdrawal is accepted until this long before its `pay_by`, while the withdrawal can still be sent. */
export const AT_ONCE_SEND_MARGIN_SECONDS = 30;
/** Left before that cutoff for each request of a take signed at once: signed, then submitted with the others. The server offers signing at once only to windows that leave it. */
export const AT_ONCE_SIGNING_SECONDS = 30;
/**
 * Production's escrow holding a venue's commitments; Aster's former BSC escrow for Aster.
 * @deprecated Production's only: a deployment's escrows are its venues' `chain.escrow` (`getVenues`), checked against `ESCROW_DEPLOYMENTS`.
 */
export function escrowOf(venue: string): string {
  const chain = CHAINS[venue];
  insist(chain, "Unknown venue");
  return venue === "aster" ? ESCROW : chain.escrow;
}
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Aster's BSC chain, where its approvals and withdrawals are signed. */
export const ASTER_CHAIN_ID = 56;
/** Chain id of Aster's signing domain for transfers between accounts; no such chain exists. */
export const ASTER_TRANSFER_CHAIN_ID = 1666;
/** USDT on BSC. */
const ASTER_DECIMALS = 18;
/** Cap on an Aster withdrawal fee: 2 USDT (Aster quoted 0.11 in October 2026). */
const ASTER_MAX_FEE = 2n * 10n ** BigInt(ASTER_DECIMALS);
const ASTER_APPROVAL_DAYS = 365;
/**
 * LaMarge's own slots on a user's venue accounts in each environment: a new registration replaces
 * the previous one, so environments never share one. Aster: its agent's name, as approving the same
 * name from another environment's addresses revokes the other agent; Lighter: its key's index.
 */
export const ENVIRONMENT_SLOTS = {
  production: { asterAgentName: "LaMarge", lighterKeyIndex: 254 },
  development: { asterAgentName: "LaMargeDev", lighterKeyIndex: 253 },
} as const;
const ASTER_AGENT_NAMES: readonly string[] = Object.values(ENVIRONMENT_SLOTS).map(slots => slots.asterAgentName);
export const MAKER_TIMEOUT_SECONDS = 3600;
/** The allowance a permit grants, once: the escrow spends it only on actions the owner signs. */
export const UNLIMITED_ALLOWANCE = (1n << 256n) - 1n;
/** Year-9999 admission sentinel for browser orders with no expiry. */
export const NEVER_VALID_UNTIL = 253_402_214_400;
/** The latest a take's payment refunds, `T2`: the escrow's `MAX_LOCK_DURATION`, whatever shorter `FILL_TAKER_TIMEOUT` the server runs. */
export const TAKER_TIMEOUT_SECONDS = 86_400;
export type Typed = { types: Record<string, { name: string; type: string }[]>; primaryType: string; domain: { name: string; version?: string; chainId: number; verifyingContract: string }; message: Record<string, unknown> };
export type SignItem = { kind: string; signer: string; typed_data: Typed; fill_id?: string | undefined };
export function convert(types: Typed["types"], kind: string, value: unknown): unknown {
  if (kind.endsWith("[]")) return array(value).map((item) => convert(types, kind.slice(0, -2), item));
  const fields = types[kind];
  if (fields) {
    const struct = record(value);
    return Object.fromEntries(fields.map((field) => [field.name, convert(types, field.type, struct[field.name])]));
  }
  if (kind === "address") return address(value);
  if (kind === "string" && typeof value === "string" || kind === "bool" && typeof value === "boolean") return value;
  const bytes = /^bytes(\d*)$/.exec(kind);
  if (bytes) {
    const data = hex(value);
    const width = bytes[1] ? Number(bytes[1]) : null;
    if (width !== null && (width < 1 || width > 32 || data.length !== 2 + width * 2)) throw new Error("Invalid signing bytes");
    return data;
  }
  const integer = /^(u?int)(\d*)$/.exec(kind);
  if (!integer) throw new Error("Invalid signing value");
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint"
      || typeof value === "number" && !Number.isSafeInteger(value)
      || typeof value === "string" && !/^-?\d+$/.test(value)) throw new Error("Invalid signing integer");
  const width = integer[2] ? Number(integer[2]) : 256;
  if (width < 8 || width > 256 || width % 8 !== 0) throw new Error("Invalid integer width");
  const signed = integer[1] === "int";
  const limit = 1n << BigInt(width - (signed ? 1 : 0));
  const result = BigInt(value);
  if (result < (signed ? -limit : 0n) || result >= limit) throw new Error("Signing integer out of range");
  return result;
}
export const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const DIFFERS = "The signing request differs from your instructions";
export function insist(ok: unknown, message = DIFFERS): asserts ok { if (!ok) throw new Error(message); }
/** The message naming the `field` of a signing request that differs from what was asked. */
export const differs = (field: string) => `${DIFFERS}: ${field}`;
export const uint = (value: unknown): bigint => { insist(typeof value === "string" && /^\d+$/.test(value) || typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "Invalid signing integer"); return BigInt(value); };
const fields = (description: string) => description.split(",").map(pair => { const [name, type] = pair.split(":"); return { name: required(name), type: required(type) }; });
export const EIP712Domain = fields("name:string,version:string,chainId:uint256,verifyingContract:address");
const quote = fields("venue:string,chainId:uint256,token:address,recipient:address,supply:uint256,receive:uint256,minFill:uint256");
const lockPayment = fields("payer:address,swapId:bytes32,recipient:address,amount:uint256,hashlock:bytes32,refundAt:uint64,deadline:uint256,orderId:bytes32,sequence:uint64,amountOut:uint256,receiveChainId:uint256,receiveToken:address,receiveEscrow:address,receiveRecipient:address,dex:uint32");
export const schemas: Record<string, Record<string, { name: string; type: string }[]>> = {
  RefundPayment: { RefundPayment: fields("payer:address,swapId:bytes32,deadline:uint256") },
  FundOffer: { FundOffer: fields("owner:address,offerId:bytes32,amount:uint256,deposit:uint256,quoteSigner:address,operator:address,minQuoteSequence:uint64,nonce:uint256,deadline:uint256") },
  QuoteSet: { QuoteSet: fields("owner:address,offerId:bytes32,sequence:uint64,expiresAt:uint64,quotes:Quote[]"), Quote: quote },
  PayTake: { PayTake: fields("payer:address,deposit:uint256,payments:LockPayment[]"), LockPayment: lockPayment },
  CloseOrders: { CloseOrders: fields("account:address,orders:bytes32[],nonce:uint256,deadline:uint256") },
  CloseOffer: { CloseOffer: fields("owner:address,offerId:bytes32,toMargin:bool,dex:uint32,nonce:uint256,deadline:uint256") },
  Permit: { Permit: fields("owner:address,spender:address,value:uint256,nonce:uint256,deadline:uint256") },
  Withdraw: { Withdraw: fields("account:address,token:address,amount:uint256,fee:uint256,to:address,salt:uint64,ts:uint64") },
  "HyperliquidTransaction:SendAsset": { "HyperliquidTransaction:SendAsset": fields("hyperliquidChain:string,destination:string,sourceDex:string,destinationDex:string,token:string,amount:string,fromSubAccount:string,nonce:uint64") },
  Action: { Action: fields("type:string,destination:address,destination Chain:string,token:string,amount:string,fee:string,nonce:uint256,aster chain:string") },
  Message: { Message: fields("msg:string") },
};
/** A signed take's payments, each with exactly the `LockPayment` fields. */
export function takePayments(typed: Typed): Record<string, unknown>[] {
  const payments = array(typed.message.payments).map(record);
  insist(payments.length > 0 && payments.length <= 8 && payments.every(payment => Object.keys(payment).length === lockPayment.length), "Unexpected signing fields");
  return payments;
}
function checkTypes(typed: Typed) {
  const schema = schemas[typed.primaryType];
  insist(schema, "Unsupported signing request");
  const expected = { EIP712Domain: EIP712Domain, ...schema };
  insist(Object.keys(typed.types).length === Object.keys(expected).length && Object.entries(expected).every(([name, fields]) => JSON.stringify(typed.types[name]) === JSON.stringify(fields)), "Unexpected signing types");
  insist(Object.keys(typed.message).length === required(schema[typed.primaryType]).length, "Unexpected signing fields");
}
/**
 * Whether `venue`'s requests may name `contract` as their escrow: on an escrow venue, any pinned
 * deployment of its chain in `manifest`, whichever environment's; on a venue settled inside itself,
 * its one pinned signing domain.
 */
export function isPinnedEscrow(venue: string, contract: unknown, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): boolean {
  const chain = CHAINS[venue];
  if (!chain || typeof contract !== "string") return false;
  return VENUE_SETTLED.has(venue) ? same(contract, chain.escrow) : escrowDeployment(chain.id, contract, manifest) !== undefined;
}
/** Exact EIP-712 field types and a pinned domain, before any wallet prompt: `manifest` lists the escrows a request may name. */
export function checkEscrowTyped(typed: Typed, venue: string, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): void {
  insist(CHAINS[venue], "Unknown venue");
  // A venue settled inside itself signs only quote sets, in its own domain.
  insist(!VENUE_SETTLED.has(venue) || typed.primaryType === "QuoteSet", "Unexpected signing request");
  checkEscrowTypedAt(typed, venue, escrow => isPinnedEscrow(venue, escrow, manifest));
}
/** Proof verification accepts the current protocol on reviewed deployments only. */
export function checkEscrowProofTyped(typed: Typed, venue: string, manifest: DeploymentManifest = ESCROW_PROOF_DEPLOYMENTS): EscrowDeployment {
  insist(["QuoteSet", "FundOffer", "PayTake"].includes(typed.primaryType), "Unexpected signed agreement");
  const escrow = typed.domain.verifyingContract;
  const chain = CHAINS[venue];
  const deployment = chain && escrowDeployment(chain.id, escrow, manifest);
  insist(deployment && deployment.version === 5, "Unexpected signing domain");
  checkEscrowTypedAt(typed, venue, contract => same(contract, escrow));
  return deployment;
}
/** `pinned`: whether the escrow the request names, its domain's or a permit's spender, may be. */
function checkEscrowTypedAt(typed: Typed, venue: string, pinned: (escrow: unknown) => boolean): void {
  checkTypes(typed);
  const chain = CHAINS[venue];
  insist(chain, differs("venue"));
  insist(!["Withdraw", "HyperliquidTransaction:SendAsset", "Action", "Message"].includes(typed.primaryType), differs("primaryType"));
  const permit = typed.primaryType === "Permit";
  if (permit) insist(chain.permit !== undefined && chain.version !== undefined, "The token has no permit");
  insist(typed.domain.chainId === chain.id && (permit ? same(typed.domain.verifyingContract, chain.token) : pinned(typed.domain.verifyingContract)) && typed.domain.name === (permit ? chain.permit : "LaMarge") && typed.domain.version === (permit ? chain.version : "1"), "Unexpected signing domain");
  if (permit) insist(pinned(typed.message.spender), "Unexpected permit spender");
}
/**
 * A venue's chain as the API lists it: the pinned chain, token and decimals, an escrow `manifest`
 * pins on that chain (the signing domain's contract on a venue settled inside itself) and, when it
 * says one, the token's permit domain, none on a venue settled inside itself.
 */
export function checkRegistry(venue: string, chain: { id: number; token: string; decimals: number; escrow: string; permit?: { name: string; version: string } | null | undefined }, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS) {
  const known = CHAINS[venue], permit = chain.permit;
  insist(known && known.id === chain.id && same(known.token, chain.token) && known.decimals === chain.decimals && isPinnedEscrow(venue, chain.escrow, manifest)
    && (permit === undefined || (permit === null ? known.permit === undefined : permit.name === known.permit && permit.version === known.version)), "API deployment differs from the reviewed deployment");
}
export function checkDeadline(value: unknown, seconds: number, now = Date.now() / 1000) {
  const at = Number(uint(value));
  insist(at > now && at <= now + seconds + 30, "Signing deadline is expired or too long");
}
export function checkPermit(item: SignItem, venue: string, owner: string, maxSeconds = 600, now = Date.now() / 1000): asserts item is SignItem & { typed_data: Verified<Typed> } {
  checkEscrowTyped(item.typed_data, venue);
  const m = item.typed_data.message;
  insist(item.kind === "permit" && item.typed_data.primaryType === "Permit" && same(item.signer, owner) && same(m.owner, owner) && uint(m.value) === UNLIMITED_ALLOWANCE, "Unexpected token allowance");
  checkDeadline(m.deadline, maxSeconds, now);
}
/** A decimal amount with at most six decimals, in base units of a token with `decimals`. */
export function decimalUnits(value: unknown, decimals: number): bigint {
  insist(typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value), "Invalid decimal amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(required(whole)) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}
export function decimalsOf(venue: string): number {
  const chain = CHAINS[venue];
  insist(chain, "Unknown venue");
  return chain.decimals;
}
/** One millionth of `venue`'s token: venues carry six decimals at most. */
export const venueStep = (venue: string): bigint => 10n ** BigInt(Math.max(decimalsOf(venue) - 6, 0));
/** `value` rounded up to whole millionths: what `venue` moves for it. */
export function venueUnits(value: bigint, venue: string): bigint {
  const step = venueStep(venue);
  return (value + step - 1n) / step * step;
}
/** What `venue` moves for `held` to reach `needed`: an 18-decimal wallet keeps the dust past the shortfall. Never above `needed`. */
export function shortfall(needed: bigint, held: bigint, venue: string): bigint {
  if (held >= needed) return 0n;
  const rounded = venueUnits(needed - held, venue);
  return rounded < needed ? rounded : needed;
}
/** One token in native units, the automatic deposit sweep threshold. */
export const sweepMinimum = (venue: string): bigint => 10n ** BigInt(decimalsOf(venue));
/** Venue withdrawals can only move this amount to the reviewed destination. */
export function checkWithdrawal(typed: Typed, venue: string, signer: string, destination: string, amount: bigint, now = Date.now() / 1000): asserts typed is Verified<Typed> {
  checkTypes(typed);
  const m = typed.message, d = typed.domain;
  insist(amount > 0n, differs("amount"));
  if (venue === "hyperliquid") {
    insist(typed.primaryType === "HyperliquidTransaction:SendAsset", differs("primaryType"));
    insist(d.name === "HyperliquidSignTransaction" && d.version === "1" && d.chainId === 999 && same(d.verifyingContract, "0x0000000000000000000000000000000000000000"), differs("domain"));
    insist(same(destination, signer), differs("destination"));
    insist(m.hyperliquidChain === "Mainnet", differs("hyperliquidChain"));
    insist(same(m.destination, "0x2000000000000000000000000000000000000000"), differs("destination"));
    insist(["", "spot"].includes(String(m.sourceDex)), differs("sourceDex"));
    insist(m.destinationDex === "spot", differs("destinationDex"));
    insist(m.token === "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", differs("token"));
    insist(m.fromSubAccount === "", differs("fromSubAccount"));
    insist(decimalUnits(m.amount, decimalsOf(venue)) === amount, differs("amount"));
    insist(Math.abs(Number(uint(m.nonce)) / 1000 - now) <= 60, "Stale withdrawal nonce");
  } else if (venue === "aster") {
    // Aster takes the fee out of the signed amount: `amount` is what arrives on BSC.
    insist(typed.primaryType === "Action", differs("primaryType"));
    insist(d.name === "Aster" && d.version === "1" && d.chainId === ASTER_CHAIN_ID && same(d.verifyingContract, ZERO_ADDRESS), differs("domain"));
    const decimals = decimalsOf(venue);
    const fee = decimalUnits(m.fee, decimals);
    insist(same(destination, signer) && same(m.destination, signer), differs("destination"));
    insist(m.type === "Withdraw", differs("type"));
    insist(m["destination Chain"] === "BSC", differs("destination Chain"));
    insist(m.token === "USDT", differs("token"));
    insist(m["aster chain"] === "Mainnet", differs("aster chain"));
    insist(fee <= ASTER_MAX_FEE, differs("fee"));
    insist(decimalUnits(m.amount, decimals) === amount + fee, differs("amount"));
    insist(Math.abs(Number(uint(m.nonce)) / 1_000_000 - now) <= 60, "Stale withdrawal nonce");
  } else {
    insist(venue === "polymarket", differs("venue"));
    insist(typed.primaryType === "Withdraw", differs("primaryType"));
    insist(d.name === "Polymarket" && d.version === "1" && d.chainId === 137 && same(d.verifyingContract, "0xdca4af75705dbb50f62437045aff9921947917d2"), differs("domain"));
    insist(same(m.account, signer), differs("account"));
    insist(same(m.token, required(CHAINS.polymarket).token), differs("token"));
    insist(same(m.to, destination), differs("to"));
    insist(uint(m.amount) === amount, differs("amount"));
    insist(uint(m.fee) === 0n, differs("fee"));
    insist(uint(m.salt) <= 0xffffffffffffffffn, differs("salt"));
    insist(Math.abs(Number(uint(m.ts)) - now) <= 60, "Stale withdrawal timestamp");
  }
}
/** What a venue withdrawal moves out of the margin for `amount` to arrive: Aster adds its fee. */
export function withdrawalCost(venue: string, typed: Typed): bigint {
  const m = typed.message;
  if (venue === "hyperliquid") return decimalUnits(m.amount, decimalsOf(venue));
  if (venue === "aster") return decimalUnits(m.amount, decimalsOf(venue)) - decimalUnits(m.fee, decimalsOf(venue));
  return uint(m.amount);
}
export type AsterChallenge = { message: string; nonce: string; expires_at: string; typed_data?: Typed | undefined };
/** `Message{msg}` in Aster's signing domain at `chainId`: its transfers' chain, or BSC's for agent approvals and withdrawals. */
export const asterRequest = (msg: string, chainId: number): Typed => ({
  types: { EIP712Domain, ...schemas.Message }, primaryType: "Message",
  domain: { name: "AsterSignTransaction", version: "1", chainId, verifyingContract: ZERO_ADDRESS }, message: { msg },
});
export function checkAsterRequest(typed: Typed, chainId: number): asserts typed is Verified<Typed> {
  checkTypes(typed);
  const d = typed.domain;
  insist(typed.primaryType === "Message" && d.name === "AsterSignTransaction" && d.version === "1" && d.chainId === chainId && same(d.verifyingContract, ZERO_ADDRESS) && typeof typed.message.msg === "string", "Unexpected Aster request");
}
function asterMessage(typed: Typed, chainId: number): string {
  checkAsterRequest(typed, chainId);
  return String(typed.message.msg);
}
/** An Aster request's query string, its values by position under exactly `names`. */
function asterFields(msg: string, names: string[], message: string): string[] {
  const pairs = msg.split("&").map(pair => pair.split("="));
  insist(pairs.length === names.length && pairs.every((pair, index) => pair.length === 2 && pair[0] === names[index]), message);
  return pairs.map(pair => required(pair[1]));
}
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/**
 * Where an agent may be used from, as Aster's `ipWhitelist` lists it, comma- or space-separated:
 * at most eight addresses, or ranges no wider than an IPv4 /24 or an IPv6 /64, in public IPv4
 * space (first octet 1 to 223) or IPv6 global unicast (2000::/3). No set of them covers every
 * address, and no form hides another (IPv4 inside IPv6, a zone).
 */
function narrowAddresses(list: string): boolean {
  const entries = list.split(/[ ,]/);
  return entries.length <= 8 && entries.every(entry => {
    const [host = "", prefix, ...rest] = entry.split("/");
    if (rest.length || prefix !== undefined && !/^(0|[1-9]\d{0,2})$/.test(prefix)) return false;
    const width = prefix === undefined ? null : Number(prefix);
    if (IPV4.test(host)) {
      const first = Number(host.split(".")[0]);
      return first >= 1 && first <= 223 && (width === null || width >= 24 && width <= 32);
    }
    const halves = host.split("::"), groups = halves.flatMap(half => half === "" ? [] : half.split(":"));
    const first = parseInt(host.split(":")[0] ?? "", 16);
    return halves.length <= 2 && groups.every(group => /^[0-9a-f]{1,4}$/i.test(group)) && (halves.length === 2 ? groups.length < 8 : groups.length === 8)
      && first >= 0x2000 && first <= 0x3fff && (width === null || width >= 64 && width <= 128);
  });
}
/**
 * The agent approval an Aster account signs to link: LaMarge's agent for this address, valid one
 * year, on BSC, with only `canPerpTrade`, which can move margin only to the account's own Spot
 * wallet, and usable only from a few addresses when it lists them. The agent name must be one of
 * the environments' names, or `agentName`, the deployment's own, when given: approving another
 * environment's name revokes that environment's agent. Every other field is fixed.
 */
export function checkAsterApproval(challenge: AsterChallenge, address: string, now = Date.now(), agentName?: string): asserts challenge is AsterChallenge & { typed_data: Verified<Typed> } {
  insist(challenge.typed_data, "Missing agent approval");
  const msg = asterMessage(challenge.typed_data, ASTER_CHAIN_ID);
  const names = ["user", "nonce", "agentName", "agentAddress", "expired", "signatureChainId", "canSpotTrade", "canPerpTrade", "canWithdraw"];
  const whitelisted = msg.split("&").length > names.length;
  const [user, nonce, name, agent, expired, chain, spot, perp, withdraw, ips] = asterFields(msg, whitelisted ? [...names, "ipWhitelist"] : names, "Unexpected agent approval");
  insist(msg === challenge.message, "Unexpected agent approval");
  insist(same(user, address), "The approval names another account");
  insist(nonce === challenge.nonce && /^\d{16}$/.test(nonce) && Math.abs(Number(nonce) / 1_000_000 - now / 1000) <= 60, "Stale agent approval");
  insist(ASTER_AGENT_NAMES.includes(required(name)) && (agentName === undefined || name === agentName) && /^0x[0-9a-fA-F]{40}$/.test(required(agent)) && !same(agent, address), "Unexpected agent");
  insist(BigInt(required(expired)) === BigInt(nonce) / 1000n + BigInt(ASTER_APPROVAL_DAYS) * 86_400_000n, "Unexpected approval expiry");
  insist(chain === String(ASTER_CHAIN_ID) && spot === "false" && perp === "true" && withdraw === "false" && ips !== "", "The agent may only move margin to Spot");
  insist(ips === undefined || narrowAddresses(ips), "The agent may be used from too many addresses, or too wide a range");
}
/** A transfer of USDT between Aster accounts the payer's wallet signs: its decimal amount, recipient, id, microsecond nonce and payer. */
export function asterTransfer(typed: Typed) {
  const msg = asterMessage(typed, ASTER_TRANSFER_CHAIN_ID);
  const [asset, amount, to, id, nonce, user] = asterFields(msg, ["asset", "amount", "toAddress", "clientTranId", "nonce", "user"], "Unexpected Aster transfer");
  insist(asset === "USDT" && /^\d{16}$/.test(required(nonce)), "Unexpected Aster transfer");
  return { msg, amount: decimalUnits(amount, ASTER_DECIMALS), to: address(to), id: required(id), nonce: Number(nonce) / 1_000_000, user: address(user) };
}
/** The id a fill's Aster transfer carries: its UUID without dashes, 32 lowercase hex digits. A repeated request with it moves nothing more. */
export const asterClientId = (fillId: string) => fillId.replaceAll("-", "").toLowerCase();
/** Base units of USDT as Aster takes them: a decimal amount of six decimals at most, rounded up, so the recipient never gets less. */
export const asterAmount = (units: bigint): string => {
  const rounded = venueUnits(units, "aster"), unit = 10n ** BigInt(ASTER_DECIMALS);
  const fraction = (rounded % unit).toString().padStart(ASTER_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${rounded / unit}.${fraction}` : String(rounded / unit);
};
/** The transfer pays `amount_in`, as Aster carries it in six decimals rounded up, from `payer` to the maker's `recipient`, under the fill id. */
export function checkAsterTransfer(transfer: ReturnType<typeof asterTransfer>, fill: { id: string; amount_in: string; payer: string; maker_recipient: string }) {
  const owed = BigInt(fill.amount_in);
  insist(transfer.amount >= owed && transfer.amount < owed + venueStep("aster") && same(transfer.to, fill.maker_recipient) && same(transfer.user, fill.payer) && transfer.id === asterClientId(fill.id), "The Aster transfer differs from the take");
}
export type QuoteIntent = { venue: string; recipient: string; supply: string; receive: string; min_fill: string };
type QuoteOrder = { id: string; venue: string; owner_address: string; quote_signer: string };
export type PreparedQuote = { draft_id: string; sequence: number; valid_until: number; quote_size: string; expires_at: number; quotes: QuoteIntent[]; to_sign: SignItem[] };
/** The published draft metadata and signed quote must both match the requested terms. */
export function checkPreparedQuote(prepared: PreparedQuote, order: QuoteOrder & { last_sequence: number }, requested: QuoteIntent | QuoteIntent[], validUntil: number, size: string): asserts prepared is PreparedQuote & { to_sign: Verified<SignItem[]> } {
  const quotes = Array.isArray(requested) ? requested : [requested];
  insist(quotes.length > 0, differs("quotes"));
  insist(prepared.valid_until === validUntil, differs("valid_until"));
  insist(prepared.quote_size === size, differs("quote_size"));
  insist(prepared.expires_at === validUntil + MAKER_TIMEOUT_SECONDS + 1, differs("expires_at"));
  insist(Number.isSafeInteger(prepared.sequence) && prepared.sequence > order.last_sequence, differs("sequence"));
  insist(prepared.to_sign.length === 1, differs("to_sign"));
  insist(prepared.quotes.length === quotes.length, differs("quotes"));
  quotes.forEach((quote, index) => {
    const received = required(prepared.quotes[index]);
    insist(received.venue === quote.venue, differs(`quotes[${index}].venue`));
    insist(same(received.recipient, quote.recipient), differs(`quotes[${index}].recipient`));
    insist(received.supply === quote.supply, differs(`quotes[${index}].supply`));
    insist(received.receive === quote.receive, differs(`quotes[${index}].receive`));
    insist(received.min_fill === quote.min_fill, differs(`quotes[${index}].min_fill`));
  });
  checkSignedQuote(required(prepared.to_sign[0]), order, quotes, prepared.sequence, prepared.expires_at);
}
/** The entire replacement set is reviewed, in order: no extra route, recipient or amount may be
 * added, and each position is the quote index a fill names. */
export function checkSignedQuote(item: SignItem, order: QuoteOrder, asked: QuoteIntent | QuoteIntent[], sequence: number, expires: number) {
  const requested = Array.isArray(asked) ? asked : [asked];
  checkEscrowTyped(item.typed_data, order.venue);
  const m = item.typed_data.message;
  const quotes = array(m.quotes).map(record);
  insist(item.kind === "quote_set", differs("kind"));
  insist(item.typed_data.primaryType === "QuoteSet", differs("primaryType"));
  insist(same(item.signer, order.quote_signer), differs("signer"));
  insist(same(m.owner, order.owner_address), differs("owner"));
  insist(same(m.offerId, order.id), differs("offerId"));
  insist(uint(m.sequence) === BigInt(sequence), differs("sequence"));
  insist(uint(m.expiresAt) === BigInt(expires), differs("expiresAt"));
  insist(requested.length > 0 && quotes.length === requested.length, differs("quotes"));
  for (const [index, expected] of requested.entries()) {
    const q = required(quotes[index]), chain = CHAINS[expected.venue];
    const field = (name: string) => differs(`quotes[${index}].${name}`);
    insist(chain && q.venue === expected.venue && expected.venue !== order.venue, field("venue"));
    insist(Object.keys(q).length === quote.length, field("fields"));
    insist(uint(q.chainId) === BigInt(chain.id), field("chainId"));
    insist(same(q.token, chain.token), field("token"));
    insist(same(q.recipient, expected.recipient), field("recipient"));
    insist(uint(q.supply) === BigInt(expected.supply) && uint(q.supply) > 0n, field("supply"));
    insist(uint(q.receive) === BigInt(expected.receive) && uint(q.receive) > 0n, field("receive"));
    insist(uint(q.minFill) === BigInt(expected.min_fill) && uint(q.minFill) <= uint(q.supply), field("minFill"));
  }
}
export function checkCloseOrders(items: SignItem[], ids: string[], master: string): asserts items is Verified<SignItem[]> {
  insist(items.length === 1, differs("to_sign"));
  const item = required(items[0]), m = item.typed_data.message;
  // CloseOrders is an off-chain operator authorization in the HyperEVM domain.
  checkEscrowTyped(item.typed_data, "hyperliquid");
  const orders = array(m.orders);
  insist(item.kind === "close_orders", differs("kind"));
  insist(item.typed_data.primaryType === "CloseOrders", differs("primaryType"));
  insist(same(item.signer, master), differs("signer"));
  insist(same(m.account, master), differs("account"));
  insist(orders.length > 0 && new Set(orders).size === orders.length && orders.every(id => ids.some(asked => same(id, asked))), differs("orders"));
  checkDeadline(m.deadline, 3600);
}
/** SIWE intent pinned to `origin`, tolerating two minutes of local clock skew. */
export function checkLoginChallenge(challenge: { message: string; nonce: string; expires_at: string; address: string }, origin: string, now = Date.now()): void {
  const lines = challenge.message.split("\n");
  const issued = Date.parse(lines[9]?.slice("Issued At: ".length) ?? "");
  const expires = Date.parse(challenge.expires_at);
  insist(lines.length === 11 && lines[0] === `${new URL(origin).host} wants you to sign in with your Ethereum account:` && same(lines[1], challenge.address) && lines[2] === "" && lines[3] === "Sign in to LaMarge." && lines[4] === "" && lines[5] === `URI: ${origin}` && lines[6] === "Version: 1" && lines[7] === "Chain ID: 1" && lines[8] === `Nonce: ${challenge.nonce}` && lines[9]?.startsWith("Issued At: ") && lines[10] === `Expiration Time: ${challenge.expires_at}` && issued <= now + 120_000 && expires > now - 120_000 && expires > issued && expires - issued <= 600_000, "Unexpected sign-in challenge");
}

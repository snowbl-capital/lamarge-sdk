/**
 * Lighter transaction hashes and owner messages for the browser. The taker's wallet signs the
 * owner message (`L1Sig`) for what LaMarge's API key on its account signs; trade proofs are
 * checked by the transfer's Poseidon2 hash. Port of `server/src/lighter_sig`, itself ported
 * from Lighter's Go libraries and checked against their vectors.
 */
import { DIAG, EXTERNAL, INTERNAL } from "./lighter-constants.ts";
import { CHAINS } from "./protocol.ts";
import { required } from "./validation.ts";

/** Lighter's L2 chain id, which every transaction hash names. */
export const LIGHTER_CHAIN_ID = required(CHAINS.lighter).id;
/** The API key index of LaMarge's key on a taker's account in production. */
export const TAKER_API_KEY = 254;
/** LaMarge's key indexes: one per environment, as a registration replaces the key at its index (253 in development). */
export const TAKER_API_KEYS: readonly number[] = [TAKER_API_KEY, 253];
/** A maker bot's API key slot, `LIGHTER_API_KEY_INDEX`: 4 unless set, below LaMarge's taker keys. */
export function makerKeySlot(value = "4"): number {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 4 || slot > 252) throw new Error("LIGHTER_API_KEY_INDEX is a key slot from 4 to 252");
  return slot;
}
/** A taker's transfer moves USDC between collateral routes. */
export const USDC_ASSET = 3;
/** The most Lighter may charge a taker's account on top of a transfer, in USDC base units: it charges 0 or 1 USDC. */
export const LIGHTER_MAX_TAKER_FEE = 1_000_000n;
export const COLLATERAL_ROUTE = 0;
/** Lighter's public API, read directly so account data does not depend on LaMarge. */
export const LIGHTER_API = "https://mainnet.zklighter.elliot.ai";

/** The address owning Lighter account `index`, as Lighter's public API reads it. */
export async function lighterAccountOwner(index: number, signal?: AbortSignal, fetcher: ((url: string, init: RequestInit) => Promise<Response>) | undefined = fetch): Promise<string> {
  fetcher ??= fetch;
  const response = await fetcher(`${LIGHTER_API}/api/v1/account?by=index&value=${index}`, signal ? { signal } : {});
  const body: unknown = response.ok ? await response.json() as unknown : undefined;
  const accounts: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "accounts") : undefined;
  const account: unknown = Array.isArray(accounts) && accounts.length === 1 ? accounts[0] : undefined;
  const owner: unknown = typeof account === "object" && account !== null && Reflect.get(account, "index") === index ? Reflect.get(account, "l1_address") : undefined;
  if (typeof owner !== "string") throw new Error(`Lighter account #${index} is unreadable`);
  return owner;
}

/** An element of a fixed-size array; out of range is a bug. */
function at<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range`);
  return value;
}

const P = 0xffffffff00000001n;
const add = (a: bigint, b: bigint) => (a + b) % P;
const mul = (a: bigint, b: bigint) => (a * b) % P;
/** Five field elements as 40 little-endian bytes. */
const toBytes = (x: readonly bigint[]) => {
  const out = new Uint8Array(40);
  x.forEach((limb, i) => { for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((limb >> BigInt(8 * j)) & 0xffn); });
  return out;
};

// Poseidon2 over Goldilocks, width 12, rate 8, as Lighter's plonky2 variant.
function externalLayer(state: bigint[]) {
  const s = [...state];
  for (let i = 0; i < 12; i += 4) {
    const t01 = at(s, i) + at(s, i + 1), t23 = at(s, i + 2) + at(s, i + 3), t0123 = t01 + t23;
    const x0 = at(s, i), x2 = at(s, i + 2);
    s[i] = t0123 + t01 + at(s, i + 1);
    s[i + 1] = t0123 + at(s, i + 1) + 2n * x2;
    s[i + 2] = t0123 + t23 + at(s, i + 3);
    s[i + 3] = t0123 + at(s, i + 3) + 2n * x0;
  }
  const sums = [0, 1, 2, 3].map(i => at(s, i) + at(s, i + 4) + at(s, i + 8));
  for (let i = 0; i < 12; i++) state[i] = (at(s, i) + at(sums, i % 4)) % P;
}
const sbox = (x: bigint) => { const x3 = mul(mul(x, x), x); return mul(mul(x3, x3), x); };
function permute(state: bigint[]) {
  externalLayer(state);
  for (let round = 0; round < 8; round++) {
    // The partial rounds sit between the two halves of the full rounds.
    if (round === 4) for (const constant of INTERNAL) {
      state[0] = sbox(add(at(state, 0), constant));
      const sum = state.reduce(add, 0n);
      for (let i = 0; i < 12; i++) state[i] = add(sum, mul(at(state, i), at(DIAG, i)));
    }
    for (let i = 0; i < 12; i++) state[i] = sbox(add(at(state, i), at(at(EXTERNAL, round), i)));
    externalLayer(state);
  }
}
/** Hashes field elements to five, without padding: each block of 8 overwrites the rate. */
export function hashToFp5(input: readonly bigint[]): bigint[] {
  const state = Array<bigint>(12).fill(0n);
  for (let i = 0; i < input.length; i += 8) {
    input.slice(i, i + 8).forEach((x, j) => { state[j] = x; });
    permute(state);
  }
  return state.slice(0, 5);
}

/** An internal transfer, as LaMarge's key and the account's owner sign it. */
export interface LighterTransfer {
  from: number; apiKey: number; to: number; asset: number; fromRoute: number; toRoute: number;
  amount: bigint; fee: bigint; memo: Uint8Array; expiredAt: number; nonce: number;
}
/** An API key registration, which LaMarge's key and the account's owner sign. */
interface LighterKeyRegistration { account: number; apiKey: number; publicKey: Uint8Array; nonce: number }

const MASK32 = 0xffffffffn;
/** The 40-byte hash a transfer's API key signs, also its Lighter transaction hash. */
export function transferHash(t: LighterTransfer, chainId = LIGHTER_CHAIN_ID): Uint8Array {
  return toBytes(hashToFp5([BigInt(chainId), 12n, BigInt(t.nonce), BigInt(t.expiredAt), BigInt(t.from), BigInt(t.apiKey), BigInt(t.to),
    BigInt(t.asset), BigInt(t.fromRoute), BigInt(t.toRoute), t.amount & MASK32, t.amount >> 32n, t.fee & MASK32, t.fee >> 32n]));
}
const hex10 = (value: number | bigint) => `0x${BigInt(value).toString(16).padStart(16, "0")}`;
export const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16));
/** The memo naming a fill: its id's 16 bytes then 16 zero bytes, as hex. */
export const fillMemo = (fill: string) => fill.replaceAll("-", "").toLowerCase().padEnd(64, "0");
/** The text the owner signs with `personal_sign` for a transfer to another owner. */
export const transferMessage = (t: LighterTransfer, chainId = LIGHTER_CHAIN_ID) =>
  `Transfer\n\nnonce: ${hex10(t.nonce)}\nfrom: ${hex10(t.from)} (route ${hex10(t.fromRoute)})\napi key: ${hex10(t.apiKey)}\nto: ${hex10(t.to)} (route ${hex10(t.toRoute)})\nasset: ${hex10(t.asset)}\namount: ${hex10(t.amount)}\nfee: ${hex10(t.fee)}\nchainId: ${hex10(chainId)}\nmemo: ${toHex(t.memo)}\nOnly sign this message for a trusted client!`;
/** The text the owner signs with `personal_sign` to register a key. */
export const registrationMessage = (r: LighterKeyRegistration) =>
  `Register Lighter Account\n\npubkey: 0x${toHex(r.publicKey)}\nnonce: ${hex10(r.nonce)}\naccount index: ${hex10(r.account)}\napi key index: ${hex10(r.apiKey)}\nOnly sign this message for a trusted client!`;

/** A sent transfer read back from its `tx_info`, without transaction attributes. */
export function readTransferTxInfo(info: Record<string, unknown>): { transfer: LighterTransfer; l1Signature: string } {
  const integer = (name: string) => {
    const value = info[name];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Lighter transfer ${name} is unreadable`);
    return value;
  };
  const attributes = info.L2TxAttributes;
  if (attributes !== null && attributes !== undefined && Object.keys(attributes).length > 0) throw new Error("Lighter transfer attributes are not accepted");
  const memo = info.Memo, l1 = info.L1Sig;
  if (!Array.isArray(memo) || memo.length !== 32 || !memo.every(byte => Number.isInteger(byte) && byte >= 0 && byte < 256)) throw new Error("Lighter transfer memo is unreadable");
  if (typeof l1 !== "string") throw new Error("Lighter transfer owner signature is unreadable");
  return {
    transfer: { from: integer("FromAccountIndex"), apiKey: integer("ApiKeyIndex"), to: integer("ToAccountIndex"), asset: integer("AssetIndex"),
      fromRoute: integer("FromRouteType"), toRoute: integer("ToRouteType"), amount: BigInt(integer("Amount")), fee: BigInt(integer("USDCFee")),
      memo: Uint8Array.from(memo), expiredAt: integer("ExpiredAt"), nonce: integer("Nonce") },
    l1Signature: l1,
  };
}

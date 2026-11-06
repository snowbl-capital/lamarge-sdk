// LaMarge's attestations (ACC-19), checked by a signer that holds a taker's key apart from the app that asks it:
// the request it is about to sign is the one LaMarge asks, and a take's terms are the ones LaMarge committed to.
import { getAddress, hashMessage, hashTypedData, isAddress, recoverTypedDataAddress, type Hex } from "viem";
import type { components } from "../generated/api.ts";
import { address as evmAddress, hex, isRecord } from "./validation.ts";
import type { TypedDataRequest } from "../signer.ts";

export type TakeAttestation = components["schemas"]["TakeAttestation"];
export type SetupAttestation = components["schemas"]["SetupAttestation"];
export type Attestation = TakeAttestation | SetupAttestation;
export type TakeTerms = components["schemas"]["TakeTerms"];
export type Environment = "production" | "development";

/** LaMarge's attester addresses by environment, the newest first; a key rotation lists both until the old one retires. */
export const ATTESTERS: Readonly<Record<Environment, readonly Hex[]>> = Object.freeze({
  production: Object.freeze<Hex[]>([]),
  development: Object.freeze<Hex[]>(["0xf9d52b2ab0912cd972aaf545049e9c86dd74a7e9"]),
});

/** What the attestation proves: a take LaMarge commits to `terms`, or one of LaMarge's own setup steps (its Aster agent, its Lighter key). */
export type Attested = { kind: "take"; terms: TakeTerms } | { kind: "setup" };

/** The wallet request about to be signed: typed data as `signTypedData` receives it, or a `personal_sign` text. */
export type SignRequest = TypedDataRequest | { message: string };

const DOMAIN = { name: "LaMarge attestation", version: "2" } as const;
const TAKE_TYPES = {
  TakeAttestation: [{ name: "signer", type: "address" }, { name: "digest", type: "bytes32" }, { name: "terms", type: "TakeTerms" }],
  TakeTerms: [
    { name: "take", type: "bytes32" }, { name: "from", type: "string" }, { name: "to", type: "string" }, { name: "recipient", type: "address" },
    { name: "token", type: "address" }, { name: "amountOut", type: "uint256" }, { name: "payBy", type: "uint64" },
  ],
} as const;
const SETUP_TYPES = { SetupAttestation: [{ name: "signer", type: "address" }, { name: "digest", type: "bytes32" }] } as const;
/** Half the secp256k1 order: a signature with a higher `s` is the malleated twin of another. */
const HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

function refuse(reason: string): never {
  throw new Error(`Not attested by LaMarge: ${reason}`);
}

/** The hash the wallet signs for `request`, computed here: never one the caller or the API supplies. */
export function requestDigest(request: SignRequest): Hex {
  // One shape or the other, nothing else: a wallet given both may sign what was not checked.
  const fields: unknown = request;
  if (!isRecord(fields)) refuse("the request is neither typed data nor a message");
  const keys = Object.keys(fields).sort().join();
  const { domain, types, primaryType, message } = fields;
  if (keys === "message" && typeof message === "string") return hashMessage(message);
  if (keys !== "domain,message,primaryType,types" || !isRecord(domain) || !isRecord(types) || typeof primaryType !== "string" || !isRecord(message)) refuse("the request is neither typed data nor a message");
  return hashTypedData({ domain, types, primaryType, message });
}

function terms(value: unknown): TakeTerms {
  if (!isRecord(value)) refuse("no take terms");
  const t = value;
  const keys = ["take", "from", "to", "recipient", "token", "amountOut", "payBy"];
  if (Object.keys(t).length !== keys.length || !keys.every(key => key in t)) refuse("unexpected take terms");
  if (typeof t.take !== "string" || !/^0x[0-9a-f]{64}$/i.test(t.take)) refuse("take id");
  if (typeof t.from !== "string" || typeof t.to !== "string" || !t.from || !t.to) refuse("venues");
  if (typeof t.recipient !== "string" || !isAddress(t.recipient) || typeof t.token !== "string" || !isAddress(t.token)) refuse("recipient or token");
  if (typeof t.amountOut !== "string" || !/^(0|[1-9]\d*)$/.test(t.amountOut)) refuse("amount");
  if (typeof t.payBy !== "number" || !Number.isSafeInteger(t.payBy) || t.payBy < 0) refuse("payBy");
  return { take: t.take.toLowerCase(), from: t.from, to: t.to, recipient: getAddress(t.recipient).toLowerCase(), token: getAddress(t.token).toLowerCase(), amountOut: t.amountOut, payBy: t.payBy };
}

/**
 * Whether LaMarge's attester, one of `attesters` (`ATTESTERS.production`, or a local server's own), asks `address`
 * (the trusted key's own address) to sign `request`, the exact request about to be signed. A take's attestation also authenticates its terms, returned for the signer's
 * own policy (where it delivers, how much, its escrows), and is refused from `payBy` on (`now` in milliseconds). It
 * proves where a request comes from, never that it should be signed: it throws whenever it is not LaMarge's.
 */
export async function verifyAttestation({ request, address, attestation, attesters, now = Date.now() }: {
  request: SignRequest; address: string; attestation: unknown; attesters: readonly string[]; now?: number;
}): Promise<Attested> {
  if (!attesters.length) refuse("no attester pinned");
  if (!isAddress(address)) refuse("the signer's address");
  if (!isRecord(attestation)) refuse("no attestation");
  const { signature, terms: raw, ...rest } = attestation;
  if (Object.keys(rest).length) refuse("unexpected attestation fields");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) refuse("signature");
  const proof = hex(signature);
  // One encoding per signature: `v` 27 or 28, `s` in the lower half.
  if (!["1b", "1c"].includes(signature.slice(130).toLowerCase())) refuse("signature");
  if (BigInt(`0x${signature.slice(66, 130)}`) > HALF_ORDER) refuse("a high-s signature");
  const digest = requestDigest(request);
  const signer = getAddress(address);
  const take = raw === undefined ? undefined : terms(raw);
  const recovered = await (take
    ? recoverTypedDataAddress({ domain: DOMAIN, types: TAKE_TYPES, primaryType: "TakeAttestation", message: { signer, digest, terms: { ...take, take: hex(take.take), recipient: evmAddress(take.recipient), token: evmAddress(take.token), amountOut: BigInt(take.amountOut), payBy: BigInt(take.payBy) } }, signature: proof })
    : recoverTypedDataAddress({ domain: DOMAIN, types: SETUP_TYPES, primaryType: "SetupAttestation", message: { signer, digest }, signature: proof })
  ).catch(() => refuse("signature"));
  if (!attesters.some(attester => attester.toLowerCase() === recovered.toLowerCase())) refuse("another key signed it");
  if (!take) return { kind: "setup" };
  if (now >= take.payBy * 1000) refuse("its payment window closed");
  return { kind: "take", terms: take };
}

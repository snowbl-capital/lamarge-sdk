import { address, hex } from "./validation.ts";
import { insist } from "./protocol.ts";

/** `Attestation(address signer,bytes32 digest)` under a domain no chain nor contract shares. */
const ATTESTATION_TYPES = {
  EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
  Attestation: [{ name: "signer", type: "address" }, { name: "digest", type: "bytes32" }],
} as const;

export type AttestationTyped = {
  types: typeof ATTESTATION_TYPES;
  primaryType: "Attestation";
  domain: { name: "LaMarge attestation"; version: "1" };
  message: { signer: `0x${string}`; digest: `0x${string}` };
};

/**
 * What LaMarge's attester signs for an item it asks `signer` to sign, `digest` the hash the wallet signs: the item's
 * typed data's EIP-712 hash, or its message's `personal_sign` hash. A signer that holds the taker's key apart from the
 * app asking it recovers the item's `attestation` from this and signs nothing LaMarge's attester address didn't sign.
 */
export function attestationTyped(signer: string, digest: string): AttestationTyped {
  const hash = hex(digest);
  insist(hash.length === 66, "An attested digest is 32 bytes");
  return {
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    domain: { name: "LaMarge attestation", version: "1" },
    message: { signer: address(signer), digest: hash },
  };
}

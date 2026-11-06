import { describe, expect, test } from "bun:test";
import { hashTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ATTESTERS, requestDigest, verifyAttestation, type TakeTerms } from "./attestation.ts";
import { address, hex } from "./validation.ts";

// The same vector as the server's attester tests (server/src/attester.rs): key 0x0a…0a, signer 0x…a11ce, digest 0x07…07.
const attester = privateKeyToAccount(`0x${"0a".repeat(32)}`);
const SIGNER = "0x00000000000000000000000000000000000a11ce";
const DOMAIN = { name: "LaMarge attestation", version: "2" } as const;
const TAKE_TYPES = {
  TakeAttestation: [{ name: "signer", type: "address" }, { name: "digest", type: "bytes32" }, { name: "terms", type: "TakeTerms" }],
  TakeTerms: [
    { name: "take", type: "bytes32" }, { name: "from", type: "string" }, { name: "to", type: "string" }, { name: "recipient", type: "address" },
    { name: "token", type: "address" }, { name: "amountOut", type: "uint256" }, { name: "payBy", type: "uint64" },
  ],
} as const;
const SETUP_TYPES = { SetupAttestation: [{ name: "signer", type: "address" }, { name: "digest", type: "bytes32" }] } as const;
const TERMS: TakeTerms = {
  take: "0x0123456789abcdef0123456789abcdef00000000000000000000000000000000",
  from: "aster", to: "hyperliquid", recipient: SIGNER, token: "0xb88339cb7199b77e23db6e890353e22632ba630f", amountOut: "1000000", payBy: 1_800_000_000,
};
const NOW = 1_799_999_000_000;
// The Aster transfer a taker paid from Aster signs, at chain 1666.
const REQUEST = {
  domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: "0x0000000000000000000000000000000000000000" as Hex },
  types: { Message: [{ name: "msg", type: "string" }] }, primaryType: "Message", message: { msg: "asset=USDT&amount=1&toAddress=0x…&clientTranId=…&nonce=1&user=0x…" },
};

const takeMessage = (digest: Hex, terms: TakeTerms) =>
  ({ signer: SIGNER as Hex, digest, terms: { ...terms, take: hex(terms.take), recipient: address(terms.recipient), token: address(terms.token), amountOut: BigInt(terms.amountOut), payBy: BigInt(terms.payBy) } });
const signTake = (digest: Hex, terms = TERMS) =>
  attester.signTypedData({ domain: DOMAIN, types: TAKE_TYPES, primaryType: "TakeAttestation", message: takeMessage(digest, terms) });
const signSetup = (digest: Hex) => attester.signTypedData({ domain: DOMAIN, types: SETUP_TYPES, primaryType: "SetupAttestation", message: { signer: SIGNER, digest } });
const verify = (attestation: unknown, request: Parameters<typeof verifyAttestation>[0]["request"] = REQUEST, now = NOW) =>
  verifyAttestation({ request, address: SIGNER, attestation, attesters: [attester.address], now });

describe("verifyAttestation", () => {
  test("hashes the statements as the server signs them", () => {
    const digest = `0x${"07".repeat(32)}` as Hex;
    expect(hashTypedData({ domain: DOMAIN, types: TAKE_TYPES, primaryType: "TakeAttestation", message: takeMessage(digest, TERMS) }))
      .toBe("0x83b97beb0baa6c8963f9c9585d54258041f1fa77d94ce4f4d9c63e4dc3658535");
    expect(hashTypedData({ domain: DOMAIN, types: SETUP_TYPES, primaryType: "SetupAttestation", message: { signer: SIGNER, digest } }))
      .toBe("0x7136d204951a88fa2f5ba4ba302df614766121bb066de565278504db4f99d418");
  });

  test("returns a take's terms for the request it attests", async () => {
    const signature = await signTake(requestDigest(REQUEST));
    expect(await verify({ signature, terms: TERMS })).toEqual({ kind: "take", terms: TERMS });
  });

  test("refuses terms, requests, signers and keys it does not attest", async () => {
    const signature = await signTake(requestDigest(REQUEST));
    // The relink attack: the same payment shown with the signer's own address as the recipient.
    await expect(verify({ signature, terms: { ...TERMS, recipient: "0x000000000000000000000000000000000000beef" } })).rejects.toThrow("another key signed it");
    await expect(verify({ signature, terms: { ...TERMS, amountOut: "2000000" } })).rejects.toThrow("another key signed it");
    await expect(verify({ signature, terms: TERMS }, { ...REQUEST, message: { msg: "asset=USDT&amount=2" } })).rejects.toThrow("another key signed it");
    await expect(verifyAttestation({ request: REQUEST, address: "0x000000000000000000000000000000000000b0b0", attestation: { signature, terms: TERMS }, attesters: [attester.address], now: NOW }))
      .rejects.toThrow("another key signed it");
    await expect(verifyAttestation({ request: REQUEST, address: SIGNER, attestation: { signature, terms: TERMS }, attesters: ATTESTERS.development, now: NOW }))
      .rejects.toThrow("another key signed it");
    await expect(verifyAttestation({ request: REQUEST, address: SIGNER, attestation: { signature, terms: TERMS }, attesters: ATTESTERS.production, now: NOW }))
      .rejects.toThrow("another key signed it");
    await expect(verifyAttestation({ request: REQUEST, address: SIGNER, attestation: { signature, terms: TERMS }, attesters: [], now: NOW }))
      .rejects.toThrow("no attester pinned");
  });

  test("refuses a take once its payment window closed", async () => {
    const signature = await signTake(requestDigest(REQUEST));
    await expect(verify({ signature, terms: TERMS }, REQUEST, TERMS.payBy * 1000)).rejects.toThrow("payment window closed");
  });

  test("never reads a take's request as a setup step, nor a setup step's as a take", async () => {
    const digest = requestDigest(REQUEST);
    await expect(verify({ signature: await signTake(digest) })).rejects.toThrow("another key signed it");
    await expect(verify({ signature: await signSetup(digest), terms: TERMS })).rejects.toThrow("another key signed it");
  });

  test("attests a setup step's personal_sign text", async () => {
    const request = { message: "Register Lighter Account\n\npubkey: 0x…\n" };
    expect(await verify({ signature: await signSetup(requestDigest(request)) }, request)).toEqual({ kind: "setup" });
  });

  test("refuses a request that is both a message and typed data, or neither", async () => {
    const request = { message: "Register Lighter Account\n\npubkey: 0x…\n" };
    const attestation = { signature: await signSetup(requestDigest(request)) };
    // A wallet signs typed data when it gets typed data, whatever its `message` holds.
    const mixed = { ...request, domain: { name: "Unattested operation", version: "1", chainId: 1 }, types: { Empty: [] }, primaryType: "Empty" };
    const text = { ...REQUEST, message: "text" };
    const extra = { ...REQUEST, extra: 1 };
    for (const malformed of [mixed, text, extra]) await expect(verify(attestation, malformed)).rejects.toThrow("neither typed data nor a message");
  });

  test("refuses malformed and malleated signatures and unknown fields", async () => {
    const signature = await signTake(requestDigest(REQUEST));
    await expect(verify(undefined)).rejects.toThrow("no attestation");
    await expect(verify({ signature: "0x1234", terms: TERMS })).rejects.toThrow("signature");
    await expect(verify({ signature, terms: TERMS, digest: "0x" })).rejects.toThrow("unexpected attestation fields");
    await expect(verify({ signature, terms: { ...TERMS, extra: 1 } })).rejects.toThrow("unexpected take terms");
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const v = Number.parseInt(signature.slice(130), 16);
    const twin = `${signature.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
    await expect(verify({ signature: twin, terms: TERMS })).rejects.toThrow("high-s");
    // The same signature with `v` 0 or 1 is another encoding of it.
    const parity = `${signature.slice(0, 130)}${(v - 27).toString(16).padStart(2, "0")}`;
    await expect(verify({ signature: parity, terms: TERMS })).rejects.toThrow("signature");
    await expect(verify({ signature, terms: { ...TERMS, amountOut: "0001000000" } })).rejects.toThrow("amount");
  });
});

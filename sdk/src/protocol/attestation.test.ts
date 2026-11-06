import { describe, expect, test } from "bun:test";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { attestationTyped } from "./attestation.ts";

// The server's attester test key (`server/tests/common`): 32 bytes of 0x0a.
const ATTESTER = privateKeyToAccount(`0x${"0a".repeat(32)}`);
const SIGNER = "0x00000000000000000000000000000000000a11ce";
const DIGEST = `0x${"07".repeat(32)}` as const;

describe("attestationTyped", () => {
  test("is the typed data the attester signs, recoverable to its address", async () => {
    const typed = attestationTyped(SIGNER, DIGEST);
    const signature = await ATTESTER.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(ATTESTER.address);
    // Bound to its signer and its digest: another of either recovers another address.
    for (const other of [
      attestationTyped(SIGNER, `0x${"08".repeat(32)}`),
      attestationTyped("0x00000000000000000000000000000000000b0b00", DIGEST),
    ]) {
      expect(hashTypedData(other)).not.toBe(hashTypedData(typed));
      expect(await recoverTypedDataAddress({ ...other, signature })).not.toBe(ATTESTER.address);
    }
  });

  test("takes a 32-byte digest and an address only", () => {
    expect(() => attestationTyped(SIGNER, "0x07")).toThrow("32 bytes");
    expect(() => attestationTyped("alice", DIGEST)).toThrow("Invalid EVM address");
  });
});

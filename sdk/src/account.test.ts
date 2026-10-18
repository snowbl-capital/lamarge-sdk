import { expect, test } from "bun:test";
import { submitPermit } from "./account.ts";
import { createClient } from "./client.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas, UNLIMITED_ALLOWANCE } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";

const owner = `0x${"11".repeat(20)}` as const;

test("a permit the relay refuses at once stops there, before any margin moves for it", async () => {
  const chain = required(CHAINS.polymarket);
  const typed = {
    types: { EIP712Domain, ...schemas.Permit }, primaryType: "Permit",
    domain: { name: required(chain.permit), version: required(chain.version), chainId: chain.id, verifyingContract: chain.token },
    message: { owner, spender: ESCROW, value: UNLIMITED_ALLOWANCE.toString(), nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 300) },
  };
  const step = { step: "permit", status: "required", reason: null, to_sign: { kind: "permit", signer: owner, ref: "permit-1", typed_data: typed } };
  const submitted: unknown[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = await new Request(input, init).json().catch(() => ({}));
    if (typeof body === "object" && body !== null && "signature" in body) submitted.push(body);
    // Prepared, then submitted: the relay failed, and the step is required again.
    return Response.json(step);
  }, { preconnect: globalThis.fetch.preconnect });
  const signer = { address: owner, signMessage: async () => "0x00" as const, signTypedData: async () => "0x00" as const };
  await expect(submitPermit(createClient({ apiUrl: "http://localhost:8080", fetch }), "polymarket", signer)).rejects.toThrow("Payment authorization failed");
  expect(submitted).toHaveLength(1);
});

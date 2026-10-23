import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hashToFp5, lighterAccountOwner, registrationMessage, transferHash, transferMessage, type LighterTransfer } from "./index.ts";

/** Vectors Lighter's Go libraries generate (scripts/lighter-vectors), shared with the server's port. */
interface TransferCase {
  seed: string; pub_key: string; chain_id: number; from: number; api_key: number; to: number; asset: number; from_route: number; to_route: number;
  amount: number; fee: number; memo: string; expired_at: number; nonce: number; hash: string; sig: string; l1_body: string;
}
interface RegistrationCase {
  seed: string; pub_key: string; chain_id: number; account: number; api_key: number; expired_at: number; nonce: number; hash: string; sig: string; l1_body: string;
}
interface Vectors { poseidon: { input: string[]; output: string[] }[]; transfers: TransferCase[]; change_pub_keys: RegistrationCase[] }
const isVectors = (value: unknown): value is Vectors => typeof value === "object" && value !== null
  && ["poseidon", "transfers", "change_pub_keys"].every(key => Array.isArray(Reflect.get(value, key)));
// Field elements exceed 2^53: read them as text.
const parsed: unknown = JSON.parse(readFileSync(new URL("../../../server/src/lighter_sig/vectors.json", import.meta.url), "utf8").replace(/([[,:]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
if (!isVectors(parsed)) throw new Error("Unreadable vectors");
const vectors = parsed;
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

const transfer = (c: TransferCase): LighterTransfer => ({
  from: c.from, apiKey: c.api_key, to: c.to, asset: c.asset, fromRoute: c.from_route, toRoute: c.to_route,
  amount: BigInt(c.amount), fee: BigInt(c.fee), memo: bytes(c.memo), expiredAt: c.expired_at, nonce: c.nonce,
});

test("Poseidon2 matches Lighter's", () => {
  for (const { input, output } of vectors.poseidon) {
    expect(hashToFp5(input.map(BigInt))).toEqual(output.map(BigInt));
  }
});

test("transfers hash and read as Lighter signs them", () => {
  for (const c of vectors.transfers) {
    const tx = transfer(c);
    expect(hex(transferHash(tx, c.chain_id))).toBe(c.hash);
    expect(transferMessage(tx, c.chain_id)).toBe(c.l1_body);
    expect(hex(transferHash({ ...tx, amount: tx.amount + 1n }, c.chain_id))).not.toBe(c.hash);
  }
});

test("key registrations read as Lighter signs them", () => {
  for (const c of vectors.change_pub_keys) {
    expect(registrationMessage({ account: c.account, apiKey: c.api_key, publicKey: bytes(c.pub_key), nonce: c.nonce })).toBe(c.l1_body);
  }
});

test("an account's owner is read from Lighter's answer for that index only", async () => {
  const answer = (body: unknown, ok = true) => () => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 404 }));
  const owner = "0x00000000000000000000000000000000000000aa";
  expect(await lighterAccountOwner(7, undefined, answer({ code: 200, accounts: [{ index: 7, l1_address: owner }] }))).toBe(owner);
  // Bounded even when the caller gives no signal: a stalled Lighter API must not hang a take.
  let bounded: AbortSignal | null | undefined;
  await lighterAccountOwner(7, undefined, async (_, init) => { bounded = init.signal; return Response.json({ code: 200, accounts: [{ index: 7, l1_address: owner }] }); });
  expect(bounded).toBeInstanceOf(AbortSignal);
  await expect(lighterAccountOwner(7, undefined, answer({ code: 200, accounts: [{ index: 8, l1_address: owner }] }))).rejects.toThrow("unreadable");
  await expect(lighterAccountOwner(7, undefined, answer({ code: 21100 }, false))).rejects.toThrow("unreadable");
});

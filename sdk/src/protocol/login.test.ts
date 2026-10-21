import { expect, test } from "bun:test";
import { checkLoginChallenge } from "./index.ts";

const address = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`;
const now = Date.parse("2026-09-30T12:00:00Z");
const challenge = {
  address, nonce: "abcdef123456", expires_at: "2026-09-30T12:10:00Z",
  message: `localhost:5173 wants you to sign in with your Ethereum account:\n${address}\n\nSign in to LaMarge.\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 1\nNonce: abcdef123456\nIssued At: 2026-09-30T12:00:00Z\nExpiration Time: 2026-09-30T12:10:00Z`,
};

test("SIWE accepts limited clock skew but pins origin, address, nonce and lifetime", () => {
  for (const skew of [-120_000, 0, 120_000]) expect(() => checkLoginChallenge(challenge, "http://localhost:5173", now + skew)).not.toThrow();
  for (const changed of [
    { ...challenge, address: other }, { ...challenge, nonce: "other" },
    { ...challenge, message: challenge.message.replace("Chain ID: 1", "Chain ID: 137") },
    { ...challenge, message: challenge.message.replace("12:00:00Z", "11:59:00Z") },
    { ...challenge, message: challenge.message.replace("Sign in to LaMarge.", "Sign something else") },
    { ...challenge, message: challenge.message.replace("URI: http://localhost:5173", "URI: https://localhost:5173") },
  ]) expect(() => checkLoginChallenge(changed, "http://localhost:5173", now)).toThrow("Unexpected sign-in challenge");
  expect(() => checkLoginChallenge(challenge, "https://other.example", now)).toThrow("Unexpected sign-in challenge");
  expect(() => checkLoginChallenge(challenge, "http://localhost:5173", now + 13 * 60_000)).toThrow("Unexpected sign-in challenge");
});

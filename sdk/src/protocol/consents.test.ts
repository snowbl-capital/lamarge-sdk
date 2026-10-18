import { expect, test } from "bun:test";
import { checkLinkChallenge, checkRegistry, checkSetupKind, CHAINS, required } from "./index.ts";

const address = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", master = "0x14791697260E4c9A71f18484C9f997B308e59325";

test("a link challenge names the venue asked, the address and the master", () => {
  const expires = new Date(Date.now() + 300_000).toISOString();
  const challenge = (venue: string) => ({ nonce: "n1", expires_at: expires, message: [`LaMarge: link a ${venue} account`, "", `Account: ${address}`, `Master account: ${master}`, "Nonce: n1", `Expires: ${expires}`].join("\n") });
  expect(() => checkLinkChallenge(challenge("Polymarket Perps"), address, master, "polymarket")).not.toThrow();
  expect(() => checkLinkChallenge(challenge("Hyperliquid"), address, master, "polymarket")).toThrow("account-link challenge");
  expect(() => checkLinkChallenge(challenge("Polymarket Perps"), address, master, "dydx")).toThrow("account-link challenge");
});

test("a setup step asks the one kind of signature it is signed with", () => {
  for (const [step, kind] of [["permit", "permit"], ["agent", "aster_approval"], ["api_key", "lighter_api_key"]]) expect(() => checkSetupKind(required(step), required(kind))).not.toThrow();
  for (const [step, kind] of [["permit", "aster_approval"], ["agent", "permit"], ["api_key", "permit"], ["other", "permit"]]) expect(() => checkSetupKind(required(step), required(kind))).toThrow("another kind of signature");
});

test("a listed permit domain is the pinned one, and none on a venue settled inside itself", () => {
  const listed = (venue: string) => { const { id, token, decimals, escrow } = required(CHAINS[venue]); return { id, token, decimals, escrow }; };
  const hyper = listed("hyperliquid"), lighter = listed("lighter");
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: { name: "USDC", version: "2" } })).not.toThrow();
  expect(() => checkRegistry("hyperliquid", hyper)).not.toThrow();
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: { name: "USDC", version: "1" } })).toThrow("reviewed deployment");
  expect(() => checkRegistry("hyperliquid", { ...hyper, permit: null })).toThrow("reviewed deployment");
  expect(() => checkRegistry("lighter", { ...lighter, permit: null })).not.toThrow();
  expect(() => checkRegistry("lighter", { ...lighter, permit: { name: "USDC", version: "2" } })).toThrow("reviewed deployment");
});

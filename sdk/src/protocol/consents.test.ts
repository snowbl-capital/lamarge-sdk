import { expect, test } from "bun:test";
import { checkFundingPlan, checkLinkChallenge, checkRegistry, checkSetupKind, CHAINS, required } from "./index.ts";

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

test("a funding plan lists the permit first, only when a wallet deposit needs it, then the withdrawal and the payment", () => {
  const kinds = (...names: string[]) => names.map(kind => ({ kind, signer: master, chain_id: 137 }));
  const intent = (plan: Record<string, unknown>) => ({ from: "polymarket", payer: master, amount_in: "10000000", funding_plan: { observed_at: new Date().toISOString(), venue: "polymarket", owner: master,
    amount: "10000000", deposit: "7000000", withdrawal_amount: "7000000", withdrawal_to: "signer", payment_setup: "required", requests: kinds("permit", "margin_move", "pay_take"), ...plan } });
  expect(checkFundingPlan(intent({})).requests).toEqual(kinds("permit", "margin_move", "pay_take"));
  for (const plan of [
    { requests: kinds("margin_move", "permit", "pay_take") },
    { payment_setup: "done" },
    { payment_setup: "pending" },
    { requests: kinds("margin_move", "pay_take") },
    { deposit: "0", withdrawal_amount: "0", withdrawal_to: null, requests: kinds("permit", "pay_take") },
  ]) expect(() => checkFundingPlan(intent(plan))).toThrow("Funding requests differ");
});

import { expect, test } from "bun:test";
import { checkFundingPlan, gmxTransferOut } from "./index.ts";

test("transferOut moves Arbitrum USDC from the GMX Account to the sender, as GMX encodes it", () => {
  // cast calldata "transferOut((address,uint256,uint256,address,bytes))" "(<Arbitrum USDC>,2000000,0,0x0000000000000000000000000000000000000000,0x)"
  expect<string>(gmxTransferOut(2_000_000n)).toBe("0x0b9066d9"
    + "0000000000000000000000000000000000000000000000000000000000000020"
    + "000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831"
    + "00000000000000000000000000000000000000000000000000000000001e8480"
    + "0000000000000000000000000000000000000000000000000000000000000000"
    + "0000000000000000000000000000000000000000000000000000000000000000"
    + "00000000000000000000000000000000000000000000000000000000000000a0"
    + "0000000000000000000000000000000000000000000000000000000000000000");
  expect(() => gmxTransferOut(0n)).toThrow("Invalid amount");
});

test("a transfer from GMX lists its own transferOut where another venue lists a margin move", () => {
  const payer = `0x${"11".repeat(20)}`;
  const intent = (from: string, chainId: number, ...kinds: string[]) => ({ from, payer, amount_in: "2000000", funding_plan: { observed_at: new Date().toISOString(), venue: from, owner: payer,
    amount: "2000000", deposit: "2000000", withdrawal_amount: "2000000", withdrawal_to: "signer", payment_setup: "done",
    requests: kinds.map(kind => ({ kind, signer: payer, chain_id: chainId })) } });
  expect(checkFundingPlan(intent("gmx", 42161, "transfer_out", "pay_take")).requests).toHaveLength(2);
  expect(() => checkFundingPlan(intent("gmx", 42161, "margin_move", "pay_take"))).toThrow("Funding requests differ");
  expect(() => checkFundingPlan(intent("gmx", 42161, "pay_take"))).toThrow("Funding requests differ");
  expect(() => checkFundingPlan(intent("polymarket", 137, "transfer_out", "pay_take"))).toThrow("Funding requests differ");
});

import { expect, test } from "bun:test";
import { checkFee, FEE_ON_DELIVERY, FEE_ON_PAYMENT, feeOn, priceWithin, swapFee } from "./fees.ts";

// contracts/test/TakerFees.t.sol's vector: 3,000 units on the payment.
const charged = "0xde65f326692b00000000000000000bb8290decd9548b62a8d60345a988386fc8";

test("a swap id carries its fee after the escrow's tag", () => {
  expect(swapFee(charged)).toEqual({ fee: 3_000n, onDelivery: false });
  expect(swapFee(`${FEE_ON_DELIVERY}${"00".repeat(8)}0258${"ab".repeat(16)}`)).toEqual({ fee: 600n, onDelivery: true });
  expect(swapFee(`0x${"aa".repeat(32)}`)).toEqual({ fee: 0n, onDelivery: false });
  expect(FEE_ON_PAYMENT).toBe(charged.slice(0, 14));
});

test("a fee is the swap id's, where the payment says, within the taker's consent", () => {
  // 3,000 on a price of 10,000,000 is 3 basis points: the payment carries 10,003,000.
  const fill = { swap_id: charged, taker_fee: "3000", amount_in: "10003000", amount_out: "10000000" };
  expect(() => checkFee(fill, false, 3)).not.toThrow();
  expect(() => checkFee(fill, false, 2)).toThrow("above what you accepted");
  expect(() => checkFee(fill, false, undefined)).toThrow("above what you accepted");
  expect(() => checkFee(fill, true, 3)).toThrow("swap_id");
  expect(() => checkFee({ ...fill, taker_fee: "2999" }, false, 3)).toThrow("taker_fee");
  // Without a tag, no fee; a server before fees names none.
  const plain = { ...fill, swap_id: `0x${"aa".repeat(32)}`, taker_fee: undefined };
  expect(() => checkFee(plain, false, undefined)).not.toThrow();
  expect(() => checkFee({ ...plain, taker_fee: "1" }, false, 3)).toThrow("taker_fee");
});

test("the price within a budget leaves no unit its fee does not take", () => {
  for (const bps of [0n, 1n, 3n, 100n]) for (let budget = 0n; budget < 3_000n; budget++) {
    const price = priceWithin(budget, bps);
    expect(price + feeOn(price, bps) <= budget && price + 1n + feeOn(price + 1n, bps) > budget).toBe(true);
  }
  expect(priceWithin(2_001_900n, 3n)).toBe(2_001_300n);
});

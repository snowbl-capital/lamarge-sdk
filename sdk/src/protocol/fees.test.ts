import { expect, test } from "bun:test";
import { keccak256, stringToHex } from "viem";
import { checkFee, FEE_ON_DELIVERY, FEE_ON_PAYMENT, feeOn, priceWithin, swapFee, WALLET_FEE_ON_DELIVERY, WALLET_FEE_ON_PAYMENT } from "./fees.ts";
import { CHAINS, minimumReceived, WALLET_SWAP_MIN_BPS } from "./protocol.ts";

// contracts/test/TakerFees.t.sol's vector: 3,000 units on the payment.
const charged = "0xde65f326692b00000000000000000bb8290decd9548b62a8d60345a988386fc8";

test("a swap id carries its fee after the escrow's tag", () => {
  expect(swapFee(charged)).toEqual({ fee: 3_000n, onDelivery: false, wallet: false });
  expect(swapFee(`${FEE_ON_DELIVERY}${"00".repeat(8)}0258${"ab".repeat(16)}`)).toEqual({ fee: 600n, onDelivery: true, wallet: false });
  expect(swapFee(`0x${"aa".repeat(32)}`)).toEqual({ fee: 0n, onDelivery: false, wallet: false });
  expect(FEE_ON_PAYMENT).toBe(charged.slice(0, 14));
});

// contracts/test/WalletDelivery.t.sol's vectors.
test("the wallet tags and the Polygon floor are the escrow's", () => {
  expect(WALLET_FEE_ON_PAYMENT).toBe(keccak256(stringToHex("LaMarge wallet, fee on payment")).slice(0, 14));
  expect(WALLET_FEE_ON_DELIVERY).toBe(keccak256(stringToHex("LaMarge wallet, fee on delivery")).slice(0, 14));
  expect([WALLET_FEE_ON_PAYMENT, WALLET_FEE_ON_DELIVERY]).toEqual(["0x1b4c4374729e", "0xfcb0d9ddb285"]);
  expect(WALLET_SWAP_MIN_BPS).toBe(9_995);
  expect(CHAINS.polymarket?.walletToken).toBe("0x3c499c542cef5e3811e1192ce70d8cc03d5c3359");
});

test("a wallet delivery's swap id carries its fee as its twin does, zero included", () => {
  expect(swapFee(`${WALLET_FEE_ON_PAYMENT}${"00".repeat(8)}0bb8${"ab".repeat(16)}`)).toEqual({ fee: 3_000n, onDelivery: false, wallet: true });
  expect(swapFee(`${WALLET_FEE_ON_DELIVERY}${"00".repeat(10)}${"ab".repeat(16)}`)).toEqual({ fee: 0n, onDelivery: true, wallet: true });
  // Too short to be a swap id, a wallet tag is no tag.
  expect(swapFee(`${WALLET_FEE_ON_PAYMENT}${"00".repeat(8)}0bb8`)).toEqual({ fee: 0n, onDelivery: false, wallet: false });
  const fill = { swap_id: `${WALLET_FEE_ON_DELIVERY}${"00".repeat(8)}0258${"ab".repeat(16)}`, taker_fee: "600", amount_in: "2001300", amount_out: "2000000" };
  expect(() => checkFee(fill, true, 3)).not.toThrow();
  expect(() => checkFee(fill, false, 3)).toThrow("swap_id");
  expect(() => checkFee(fill, true, 2)).toThrow("above what you accepted");
});

test("a wallet delivery's least received is the escrow's floor on Polygon, rounded up, and all of it elsewhere", () => {
  expect(minimumReceived("polymarket", 1_005_000n)).toBe(1_004_498n);
  expect(minimumReceived("polymarket", 10_000n)).toBe(9_995n);
  for (let amount = 0n; amount < 3_000n; amount++) {
    const least = minimumReceived("polymarket", amount);
    // The escrow reverts below it: `paid × 10,000 < amount × WALLET_SWAP_MIN_BPS`.
    expect(least * 10_000n >= amount * 9_995n && (least === 0n || (least - 1n) * 10_000n < amount * 9_995n)).toBe(true);
  }
  expect(minimumReceived("hyperliquid", 1_005_000n)).toBe(1_005_000n);
  expect(minimumReceived("gmx", 1n)).toBe(1n);
});

test("a fee is the swap id's, where the payment says, within the taker's consent", () => {
  const fill = { swap_id: charged, taker_fee: "3000", amount_in: "10003000", amount_out: "10000000" };
  expect(() => checkFee(fill, false, 3)).not.toThrow();
  expect(() => checkFee(fill, false, 2)).toThrow("above what you accepted");
  expect(() => checkFee(fill, false, undefined)).toThrow("above what you accepted");
  expect(() => checkFee(fill, true, 3)).toThrow("swap_id");
  expect(() => checkFee({ ...fill, taker_fee: "2999" }, false, 3)).toThrow("taker_fee");
  const plain = { ...fill, swap_id: `0x${"aa".repeat(32)}`, taker_fee: "0" };
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

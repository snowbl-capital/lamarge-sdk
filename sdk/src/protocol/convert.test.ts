import { expect, test } from "bun:test";
import { convert } from "./index.ts";

const types = {
  Mail: [
    { name: "amount", type: "uint256" },
    { name: "delta", type: "int64" },
    { name: "tag", type: "string" },
    { name: "to", type: "Person[]" },
    { name: "ids", type: "bytes32[]" },
  ],
  Person: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint64" },
  ],
};

test("convert turns integers into bigints through nested structs and arrays, and leaves the rest", () => {
  const message = {
    amount: "5000000",
    delta: -3,
    tag: "x",
    to: [{ wallet: `0x${"11".repeat(20)}`, nonce: 7 }],
    ids: [`0x${"01".repeat(32)}`],
    extra: "dropped",
  };
  expect(convert(types, "Mail", message)).toEqual({
    amount: 5_000_000n,
    delta: -3n,
    tag: "x",
    to: [{ wallet: `0x${"11".repeat(20)}`, nonce: 7n }],
    ids: [`0x${"01".repeat(32)}`],
  });
});

test("convert reads integers above 2^53 exactly from their decimal text", () => {
  expect(convert({}, "uint256", "115792089237316195423570985008687907853269984665640564039457584007913129639935")).toBe(2n ** 256n - 1n);
});


test("signing conversion rejects malformed values and unsafe integers", () => {
  for (const [kind, value] of [["uint256", -1], ["uint256", Number.MAX_SAFE_INTEGER + 1], ["uint8", "256"], ["int8", "-129"], ["uint256", "0x12"], ["address", "0xabc"], ["bytes32", "0x01"], ["bool", "true"], ["Mail", null], ["Person[]", {}]] as const) {
    expect(() => convert(types, kind, value)).toThrow();
  }
  expect(convert(types, "int8", "-128")).toBe(-128n);
  expect(convert(types, "uint8", "255")).toBe(255n);
});

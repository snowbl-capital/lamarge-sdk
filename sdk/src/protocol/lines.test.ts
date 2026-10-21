import { expect, test } from "bun:test";
import { checkPreparedLines, formatPrice, lineReceive, priceUnits, type LinePool, type PreparedLines, type PriceLine } from "./lines.ts";
import { CHAINS, EIP712Domain, ESCROW, schemas, type QuoteIntent } from "./protocol.ts";
import { required } from "./validation.ts";

const maker = `0x${"11".repeat(20)}`, signer = `0x${"22".repeat(20)}`;
const identity = "identity-1", validUntil = 253_402_214_400;
const pools: LinePool[] = ["hyperliquid", "polymarket"].map((venue, index) => ({
  id: `0x${(index ? "bb" : "aa").repeat(32)}`, venue, owner_address: maker, quote_signer: signer, quote_identity_id: identity, last_sequence: 1, state: "live", capital_pool: true,
}));
const recipients = { hyperliquid: maker, polymarket: maker };
const nico: PriceLine[] = [
  { venue: "hyperliquid", buy: "0.9994", sell: "1.0002", stock: "1000000000" },
  { venue: "polymarket", buy: "1", sell: "1.0014", stock: "100000000" },
];

/** What the server prepares for `lines`, `edit` changing a pool's quotes. */
function prepare(lines: PriceLine[], edit: (venue: string, quotes: QuoteIntent[]) => QuoteIntent[] = (_, quotes) => quotes): PreparedLines {
  const drafts = pools.flatMap((pool, index) => {
    const line = lines.find(each => each.venue === pool.venue);
    if (!line || line.stock === "0") return [];
    const quotes = edit(pool.venue, lines.filter(other => other.venue !== pool.venue && other.buy !== null).map(other => ({
      venue: other.venue, recipient: maker, supply: line.stock, min_fill: "1000000",
      receive: String(lineReceive(BigInt(line.stock), required(priceUnits(required(line.sell))), required(priceUnits(required(other.buy))), other.venue, pool.venue)),
    })));
    const expiresAt = validUntil + 3601;
    return [{ order_id: pool.id, venue: pool.venue, draft_id: `draft-${index}`, sequence: 2, valid_until: validUntil, expires_at: expiresAt, quote_size: line.stock, quotes,
      to_sign: [{ kind: "quote_set", signer, typed_data: { types: { EIP712Domain, ...schemas.QuoteSet }, primaryType: "QuoteSet", domain: { name: "LaMarge", version: "1", chainId: required(CHAINS[pool.venue]).id, verifyingContract: ESCROW },
        message: { owner: maker, offerId: pool.id, sequence: 2, expiresAt, quotes: quotes.map(q => ({ venue: q.venue, chainId: required(CHAINS[q.venue]).id, token: required(CHAINS[q.venue]).token, recipient: q.recipient, supply: q.supply, receive: q.receive, minFill: q.min_fill })) } } }] }];
  });
  return { id: "preparation-1", quote_identity_id: identity, expected_revision: "3", valid_until: validUntil, lines, drafts, cancels: [] };
}
const check = (prepared: PreparedLines, lines = nico) =>
  checkPreparedLines(prepared, { lines, validUntil, expectedRevision: "3" }, { identity, quoteSigner: signer, pools, recipients });

test("prices are exact decimals between 0.90 and 1.10 USDC", () => {
  expect(priceUnits("0.9994")).toBe(99_940_000n);
  expect(priceUnits("1.10000000")).toBe(110_000_000n);
  for (const wrong of ["", "1.", ".99", "0.89999999", "1.10000001", "01.1", "1e0", "1,0", " 1"]) expect(priceUnits(wrong)).toBeNull();
  expect(formatPrice(100_000_000n)).toBe("1");
  expect(formatPrice(99_940_000n)).toBe("0.9994");
});

test("the compiled terms match the server's vectors", () => {
  expect(lineReceive(100_000_000n, 100_140_000n, 99_940_000n, "hyperliquid", "polymarket")).toBe(100_200_121n);
  expect(lineReceive(10n ** 20n, 100_120_000n, 100_000_000n, "hyperliquid", "aster")).toBe(100_120_000n);
  expect(lineReceive(100_000_000n, 100_120_000n, 99_950_000n, "aster", "polymarket")).toBe(100_170_085_042_521_260_631n);
});

test("every pool's set is rebuilt from the lines before signing", () => {
  expect(() => check(prepare(nico))).not.toThrow();
  expect(() => check(prepare(nico, () => []))).toThrow();
  // A receiving venue left out quotes less; it never pays the maker less.
  const lighter: PriceLine[] = [...nico, { venue: "lighter", buy: "0.9997", sell: null, stock: "0" }];
  expect(() => checkPreparedLines(prepare(lighter, (_, quotes) => quotes.filter(q => q.venue !== "lighter")), { lines: lighter, validUntil, expectedRevision: "3" },
    { identity, quoteSigner: signer, pools, recipients: { ...recipients, lighter: maker } })).not.toThrow();
});

test("a price, recipient, budget or pool other than the lines' is refused", () => {
  const cheaper = (_: string, quotes: QuoteIntent[]) => quotes.map(q => ({ ...q, receive: String(BigInt(q.receive) - 1n) }));
  expect(() => check(prepare(nico, cheaper))).toThrow();
  const elsewhere = (_: string, quotes: QuoteIntent[]) => quotes.map(q => ({ ...q, recipient: signer }));
  expect(() => check(prepare(nico, elsewhere))).toThrow();
  const larger = (_: string, quotes: QuoteIntent[]) => quotes.map(q => ({ ...q, supply: String(BigInt(q.supply) * 2n) }));
  expect(() => check(prepare(nico, larger))).toThrow();
  const changed = prepare(nico);
  changed.lines = [{ ...required(nico[0]), sell: "1.0001" }, required(nico[1])];
  expect(() => check(changed)).toThrow("The prepared lines differ from yours");
  const unstocked = nico.map(line => line.venue === "polymarket" ? { ...line, stock: "0" } : line);
  expect(() => check(prepare(nico), unstocked)).toThrow();
  const cancelled = prepare(nico);
  cancelled.cancels = [required(pools[0]).id];
  expect(() => check(cancelled)).toThrow("A cancellation names a pool with stock");
});

test("a line's minimum fill is signed as asked, one token by default", () => {
  const larger = nico.map(line => line.venue === "hyperliquid" ? { ...line, min_fill: "25000000" } : line);
  const prepared = prepare(larger, (venue, quotes) => venue === "hyperliquid" ? quotes.map(q => ({ ...q, min_fill: "25000000" })) : quotes);
  expect(() => check(prepared, larger)).not.toThrow();
  expect(() => check(prepare(larger), larger)).toThrow();
});

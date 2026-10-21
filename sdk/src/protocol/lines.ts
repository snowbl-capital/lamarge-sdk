import { checkPreparedQuote, decimalsOf, insist, same, VENUE_SETTLED, type PreparedQuote, type QuoteIntent, type SignItem } from "./protocol.ts";
import { required, type Verified } from "./validation.ts";

/** A venue's prices in USDC per unit of its token, the stock its pool offers there and its smallest fill, in base units (one token when unset). */
export type PriceLine = { venue: string; buy: string | null; sell: string | null; stock: string; min_fill?: string | null };
export type PreparedLineDraft = PreparedQuote & { order_id: string; venue: string };
export type PreparedLines = {
  id: string; quote_identity_id: string; expected_revision: string; valid_until: number;
  lines: PriceLine[]; drafts: PreparedLineDraft[]; cancels: string[];
};
/** A capital pool as `GET /v1/orders` shows it. */
export type LinePool = { id: string; venue: string; owner_address: string; quote_signer: string; quote_identity_id: string; last_sequence: number; state: string; capital_pool: boolean };

/** Prices are integers of 10⁻⁸ USDC. */
const PRICE_UNIT = 100_000_000n;
/** Stablecoins trade near 1 USDC: a price outside 0.90–1.10 is a typing error. */
export const MIN_PRICE = 90_000_000n;
export const MAX_PRICE = 110_000_000n;

/** A price of at most eight decimals in 0.90–1.10 USDC, as 10⁻⁸ USDC units; null when invalid. */
export function priceUnits(text: string): bigint | null {
  const match = /^([01])(?:\.(\d{1,8}))?$/.exec(text);
  if (!match) return null;
  const units = BigInt(required(match[1])) * PRICE_UNIT + BigInt((match[2] ?? "").padEnd(8, "0"));
  return units >= MIN_PRICE && units <= MAX_PRICE ? units : null;
}

export function formatPrice(units: bigint): string {
  const text = `${units / PRICE_UNIT}.${(units % PRICE_UNIT).toString().padStart(8, "0")}`;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

/** What `stock` base units sold on `supply` at `sell` cost on `paying` bought at `buy`, rounded up for the maker. */
export function lineReceive(stock: bigint, sell: bigint, buy: bigint, paying: string, supply: string): bigint {
  const numerator = stock * sell * 10n ** BigInt(decimalsOf(paying));
  const denominator = buy * 10n ** BigInt(decimalsOf(supply));
  return (numerator + denominator - 1n) / denominator;
}

/** Lighter and Aster settle inside themselves and never trade directly with each other. */
export const directPair = (paying: string, supply: string) => paying !== supply && !(VENUE_SETTLED.has(paying) && VENUE_SETTLED.has(supply));

type Line = { buy: bigint | null; sell: bigint | null; stock: bigint; minFill: bigint | null };
function parsed(lines: readonly PriceLine[]): Map<string, Line> {
  const result = new Map<string, Line>();
  for (const line of lines) {
    insist(!result.has(line.venue), "A venue appears twice");
    const price = (text: string | null) => text === null ? null : required(priceUnits(text), "Prices are from 0.90 to 1.10 USDC");
    const buy = price(line.buy), sell = price(line.sell);
    insist(/^\d+$/.test(line.stock), "Invalid stock");
    const stock = BigInt(line.stock);
    insist(buy === null || sell === null || buy <= sell, "A buy price is above its sell price");
    insist(stock === 0n || sell !== null, "Stock needs a sell price");
    insist(line.min_fill === null || line.min_fill === undefined || /^\d+$/.test(line.min_fill), "Invalid minimum fill");
    const minFill = line.min_fill === null || line.min_fill === undefined ? null : BigInt(line.min_fill);
    result.set(line.venue, { buy, sell, stock, minFill });
  }
  return result;
}

/**
 * Rebuilds every draft from the requested lines before any signature: one set per live pool of
 * the identity with stock, each quote at the line ratio with the stock as supply and budget, the
 * recipient pinned per venue. A receiving venue the server leaves out lowers what is quoted, never
 * what the maker gets; any other difference throws.
 */
export function checkPreparedLines(prepared: PreparedLines, input: { lines: readonly PriceLine[]; validUntil: number; expectedRevision: string },
  authority: { identity: string; quoteSigner: string; pools: readonly LinePool[]; recipients: Readonly<Record<string, string>> }): asserts prepared is PreparedLines & { drafts: (PreparedLineDraft & { to_sign: Verified<SignItem[]> })[] } {
  const asked = parsed(input.lines), echoed = parsed(prepared.lines);
  insist(prepared.quote_identity_id === authority.identity && prepared.expected_revision === input.expectedRevision && prepared.valid_until === input.validUntil);
  insist(asked.size === echoed.size && [...asked].every(([venue, line]) => {
    const other = echoed.get(venue);
    return other !== undefined && other.buy === line.buy && other.sell === line.sell && other.stock === line.stock && other.minFill === line.minFill;
  }), "The prepared lines differ from yours");
  const pools = authority.pools.filter(pool => pool.capital_pool && pool.quote_identity_id === authority.identity && !["closed", "failed"].includes(pool.state));
  const stocked = pools.filter(pool => (asked.get(pool.venue)?.stock ?? 0n) > 0n);
  insist(prepared.drafts.length === stocked.length && new Set(prepared.drafts.map(draft => draft.order_id.toLowerCase())).size === stocked.length, "Each pool with stock signs one set");
  for (const draft of prepared.drafts) {
    const pool = required(stocked.find(pool => same(pool.id, draft.order_id)), "A draft names another pool");
    const line = required(asked.get(pool.venue));
    const sell = required(line.sell), minFill = line.minFill ?? 10n ** BigInt(decimalsOf(pool.venue));
    insist(draft.venue === pool.venue && pool.state === "live" && same(pool.quote_signer, authority.quoteSigner));
    insist(draft.quotes.length > 0 && new Set(draft.quotes.map(quote => quote.venue)).size === draft.quotes.length);
    const quotes: QuoteIntent[] = draft.quotes.map(quote => {
      const buy = asked.get(quote.venue)?.buy;
      insist(buy !== undefined && buy !== null && directPair(quote.venue, pool.venue), "A quote receives where you do not buy");
      const recipient = required(authority.recipients[quote.venue], `No recipient on ${quote.venue}`);
      return { venue: quote.venue, recipient, supply: line.stock.toString(), receive: lineReceive(line.stock, sell, buy, quote.venue, pool.venue).toString(), min_fill: minFill.toString() };
    });
    checkPreparedQuote(draft, pool, quotes, input.validUntil, line.stock.toString());
  }
  const idle = pools.filter(pool => !stocked.includes(pool));
  insist(prepared.cancels.every(id => idle.some(pool => same(pool.id, id))), "A cancellation names a pool with stock");
}

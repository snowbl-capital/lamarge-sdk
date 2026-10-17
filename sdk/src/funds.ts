import { sweepMinimum } from "./protocol/protocol.ts";

/** A balance read under two minutes old; a missing or unparsable time is stale. */
export const FRESH_MS = 120_000;
export const fresh = (at: string | null | undefined, now = Date.now()) => Boolean(at) && now - Date.parse(at ?? "") < FRESH_MS;

type Held = { venue: string; chain_balance: string | null; chain_error?: string | null | undefined; chain_read_at: string | null; escrow_balance: string | null; deposit_balance?: string | null | undefined };

/** What the deposit address holds that the relayer sweeps without a withdrawal to it. */
export function sweepable(balance: Held | undefined): bigint {
  const held = BigInt(balance?.deposit_balance ?? 0);
  return balance && held >= sweepMinimum(balance.venue) ? held : 0n;
}

/**
 * What a take pays without moving margin, from a recent, successful escrow-chain read: the
 * available balance, and the linked address, whose funds the take deposits. Null when unknown.
 */
export function prefunded(balance: Held | undefined, now = Date.now()): bigint | null {
  return balance?.chain_balance !== null && balance?.chain_balance !== undefined && !balance.chain_error && fresh(balance.chain_read_at, now)
    ? BigInt(balance.chain_balance) + BigInt(balance.escrow_balance ?? 0) : null;
}

import { CHAINS, insist, minimumReceived, same } from "./protocol.ts";
import { required } from "./validation.ts";

/** Input token and minimum shared by the direct sender and isolated transaction inspection. */
export function checkDirectAmounts(venue: string, token: string, amount: bigint, minimum: bigint, deposit: boolean) {
  const chain = required(CHAINS[venue], "Unknown direct chain");
  insist(amount > 0n && minimum > 0n, "Invalid direct amount");
  if (same(token, chain.token)) insist(amount === minimum, "Direct amount changed");
  else insist(deposit && venue === "polymarket" && same(token, chain.walletToken)
    && amount >= 10_000n && minimum >= minimumReceived(venue, amount), "Unsupported direct token or conversion floor");
}

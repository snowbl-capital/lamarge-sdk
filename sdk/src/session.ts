import type { Client } from "./client.ts";
import { checkLoginChallenge, checkRegistry, insist, VENUE_SETTLED } from "./protocol/protocol.ts";
import type { Signer } from "./signer.ts";

/** Every chain the API names must be a reviewed deployment pinned in this release of the SDK, settled as pinned; only a disabled venue names none. */
export async function checkDeployment(client: Client, signal?: AbortSignal): Promise<void> {
  for (const venue of await client.call("getVenues", { signal })) {
    insist(venue.chain || !venue.enabled, "API deployment differs from the reviewed deployment");
    if (!venue.chain) continue;
    checkRegistry(venue.id, venue.chain);
    insist(venue.settlement === (VENUE_SETTLED.has(venue.id) ? "venue" : "escrow"), "API deployment differs from the reviewed deployment");
  }
}

/**
 * Sign-In with Ethereum for `origin`, the app the challenge names (`https://app.lamarge.trade`).
 * The deployment is checked before anything is signed; the client then carries the session.
 */
export async function signIn(client: Client, signer: Pick<Signer, "address" | "signMessage">, origin: string, signal?: AbortSignal, now: () => number = Date.now) {
  const address = signer.address;
  // Asked while the deployment is checked; that check still decides first, before any signature.
  const asked = client.call("postAuthChallenge", { body: { address }, signal });
  asked.catch(() => undefined);
  await checkDeployment(client, signal);
  const challenge = await asked;
  checkLoginChallenge({ ...challenge, address }, origin, now());
  const signature = await signer.signMessage({ message: challenge.message });
  const session = await client.call("postAuthVerify", { body: { address, nonce: challenge.nonce, signature }, signal });
  client.token = session.token;
  return session;
}

export async function signOut(client: Client, sessionId: string): Promise<void> {
  await client.call("deleteV1AuthSessionsId", { path: { id: sessionId } });
  client.token = undefined;
}

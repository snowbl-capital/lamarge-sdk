import type { Client } from "./client.ts";
import { checkLoginChallenge, checkRegistry } from "./protocol/protocol.ts";
import type { Signer } from "./signer.ts";

/** Every chain the API names must be the reviewed deployment pinned in this release of the SDK. */
export async function checkDeployment(client: Client, signal?: AbortSignal): Promise<void> {
  for (const venue of await client.call("getVenues", { signal })) if (venue.chain) checkRegistry(venue.id, venue.chain);
}

/**
 * Sign-In with Ethereum for `origin`, the app the challenge names (`https://app.lamarge.trade`).
 * The deployment is checked before anything is signed; the client then carries the session.
 */
export async function signIn(client: Client, signer: Pick<Signer, "address" | "signMessage">, origin: string, signal?: AbortSignal) {
  const address = signer.address;
  // Asked while the deployment is checked; that check still decides first, before any signature.
  const asked = client.call("postAuthChallenge", { body: { address }, signal });
  asked.catch(() => undefined);
  await checkDeployment(client, signal);
  const challenge = await asked;
  checkLoginChallenge({ ...challenge, address }, origin);
  const signature = await signer.signMessage({ message: challenge.message });
  const session = await client.call("postAuthVerify", { body: { address, nonce: challenge.nonce, signature }, signal });
  client.token = session.token;
  return session;
}

export async function signOut(client: Client, sessionId: string): Promise<void> {
  await client.call("deleteV1AuthSessionsId", { path: { id: sessionId } });
  client.token = undefined;
}

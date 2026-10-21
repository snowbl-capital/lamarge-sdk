import { LaMargeError, wait, type Answer, type Client } from "./client.ts";
import { checkLinkChallenge, checkSetupKind } from "./protocol/consents.ts";
import { requireV5Deployment } from "./protocol/deployments.ts";
import { fromHex, lighterAccountOwner, registrationMessage, TAKER_API_KEYS } from "./protocol/lighter.ts";
import { CHAINS, checkAsterApproval, checkPermit, insist, same } from "./protocol/protocol.ts";
import { required } from "./protocol/validation.ts";
import { signTyped, type BeforeSigning, type Signer } from "./signer.ts";

type SetupStep = Answer<"postVenueSetupStep">;
/** A step starting, or submitted and awaited until the venue shows it, with its transaction when it has one. */
export interface SetupProgress { step: string; confirming?: boolean; hash?: string }
/**
 * Links `owner`'s account on `venue` under the signed-in `master`: the master's own address needs
 * no proof, any other signs the link message once it is checked. Its setup steps follow (`setUpVenue`).
 */
export async function linkAccount(client: Client, master: Pick<Signer, "address">, venue: string, owner: Pick<Signer, "address" | "signMessage"> = { ...master, signMessage: () => Promise.reject(new Error("Unreachable")) }, signal?: AbortSignal) {
  let proof: { nonce: string; signature: string } | undefined;
  if (!same(owner.address, master.address)) {
    const challenge = await client.call("postLinkChallenge", { body: { venue, address: owner.address }, signal });
    checkLinkChallenge(challenge, owner.address, master.address, venue);
    proof = { nonce: challenge.nonce, signature: await owner.signMessage({ message: challenge.message }) };
  }
  const linked = await client.call("postLink", { body: { venue, address: owner.address, ...proof }, signal, retry: true });
  insist(linked.venue === venue && same(linked.address, owner.address), "Linked another account");
  return linked;
}

/** A prepared step's request, checked against what LaMarge may ask of the account, then signed. */
async function signStep(client: Client, step: SetupStep, venue: string, owner: Signer, wallet: string | null, now: () => number, signal?: AbortSignal, agentName?: string, before?: BeforeSigning) {
  const request = required(step.to_sign, "Prepare the setup again");
  insist(same(request.signer, owner.address), "Setup asks another account to sign");
  checkSetupKind(step.step, request.kind);
  if (request.kind === "permit") {
    const chain = required(CHAINS[venue]);
    requireV5Deployment(chain.id, chain.escrow);
    const item = { kind: request.kind, signer: request.signer, typed_data: required(request.typed_data) };
    checkPermit(item, venue, owner.address, 600, now() / 1000);
    await before?.({ kind: "setup", venue, step });
    return signTyped(owner, item.typed_data);
  }
  if (request.kind === "aster_approval") {
    const typed = required(request.typed_data);
    const approval = { message: String(typed.message.msg), nonce: request.ref, expires_at: required(request.expires_at), typed_data: typed };
    checkAsterApproval(approval, owner.address, now(), agentName);
    await before?.({ kind: "setup", venue, step });
    return signTyped(owner, approval.typed_data);
  }
  // Lighter's own owner message: LaMarge's key at its index, for the linked account, at the key's nonce.
  // The account is an index: Lighter itself says whose it is, LaMarge's record of the link doesn't.
  const message = required(request.message);
  const account = Number(required(wallet, "Link the Lighter account again"));
  const key = /^Register Lighter Account\n\npubkey: 0x([0-9a-f]{80})\n/.exec(message)?.[1];
  insist(key && TAKER_API_KEYS.some(apiKey => message === registrationMessage({ account, apiKey, publicKey: fromHex(key), nonce: Number(request.ref) })), "Unexpected Lighter key registration");
  insist(same(await lighterAccountOwner(account, signal, client.fetch), owner.address), "The Lighter key registration names another account than yours");
  await before?.({ kind: "setup", venue, step });
  return owner.signMessage({ message });
}

/** Prepares and, when it is still required, signs and submits one step; an unanswered submission is sent again unchanged. */
async function runStep(client: Client, venue: string, step: string, owner: Signer, wallet: string | null, now: () => number, sleep: (ms: number) => Promise<void>, signal?: AbortSignal, agentName?: string, before?: BeforeSigning): Promise<SetupStep> {
  // Signed once: a stale Aster approval is the only one prepared and signed again.
  for (let retried = false; ; retried = true) {
    const prepared = await client.call("postVenueSetupStep", { path: { venue, step }, body: {}, signal });
    if (prepared.status !== "required") return prepared;
    const body = { ref: required(prepared.to_sign).ref, signature: await signStep(client, prepared, venue, owner, wallet, now, signal, agentName, before) };
    try {
      for (let attempt = 1; ; attempt++) {
        try { return await client.call("postVenueSetupStep", { path: { venue, step }, body, signal }); } catch (error) {
          if (!(error instanceof LaMargeError && error.code === "VENUE_UNAVAILABLE") || attempt === 3) throw error;
          await sleep(2_000 * attempt);
        }
      }
    } catch (error) {
      // Aster names a stale approval only in its message; the API has no reason for it yet.
      if (retried || !(error instanceof LaMargeError && error.code === "VENUE_REJECTED" && /nonce|expired/i.test(error.message))) throw error;
    }
  }
}

/**
 * Does each step of the linked account that the venue does not show yet (a permit, Aster's agent
 * approval, Lighter's key) and waits until the venue shows it. A step submitted before is awaited,
 * never signed twice. `owner` is the account linked on `venue`; `steps` limits the run to those
 * steps, as a maker pool needs only Aster's agent and none of a taker's payment setup.
 * `asterAgentName`, the deployment's own (`LaMarge` in production), refuses another environment's agent.
 * `onProgress` names each step as it starts, then while the venue has yet to show it.
 */
export async function setUpVenue(client: Client, venue: string, owner: Signer, options: {
  steps?: readonly string[] | undefined; signal?: AbortSignal | undefined; asterAgentName?: string | undefined; beforeSigning?: BeforeSigning | undefined;
  onProgress?: ((progress: SetupProgress) => void) | undefined; now?: (() => number) | undefined; sleep?: ((ms: number) => Promise<void>) | undefined;
} = {}) {
  const { steps, signal, asterAgentName, beforeSigning, onProgress, now = Date.now, sleep = (ms: number) => wait(ms, signal) } = options;
  // Lighter's key registration names the linked account's index.
  let [setup, wallet] = await Promise.all([client.call("getVenueSetup", { path: { venue }, signal }),
    venue === "lighter" ? client.call("getBalances", { signal }).then(rows => rows.find(row => row.venue === venue)?.venue_wallet ?? null) : null]);
  insist(same(setup.address, owner.address), "Setup returned another account");
  const todo = setup.steps.filter(row => row.status !== "done" && (!steps || steps.includes(row.step)));
  for (const { step } of todo) {
    onProgress?.({ step });
    let current: { status: string; hash?: string | null } = await runStep(client, venue, step, owner, wallet, now, sleep, signal, asterAgentName, beforeSigning);
    for (let read = 0; current.status === "pending"; read++) {
      insist(read < 60, "Setup is awaiting the venue's confirmation. Check again.");
      onProgress?.({ step, confirming: true, ...(current.hash ? { hash: current.hash } : {}) });
      await sleep(2_000);
      setup = await client.call("getVenueSetup", { path: { venue }, signal });
      current = required(setup.steps.find(row => row.step === step));
    }
    insist(current.status === "done", `${venue} setup failed`);
  }
  if (todo.length) setup = await client.call("getVenueSetup", { path: { venue }, signal });
  insist(same(setup.address, owner.address) && (steps ? setup.steps.every(row => row.status === "done" || !steps.includes(row.step)) : setup.ready), "Setup is incomplete");
  return setup;
}

/** The permit a transfer from wallet funds asks for; one already submitted or final needs nothing. One the relay refused at once stops here, before any margin moves for it. */
export async function submitPermit(client: Client, venue: string, owner: Signer, signal?: AbortSignal, beforeSigning?: BeforeSigning, now: () => number = Date.now): Promise<void> {
  insist((await runStep(client, venue, "permit", owner, null, now, ms => wait(ms, signal), signal, undefined, beforeSigning)).status !== "required", "Payment authorization failed");
}

/** Whether the account's submitted permit is final; a failed one stops the transfer. */
export async function permitDone(client: Client, venue: string, owner: Pick<Signer, "address">, signal?: AbortSignal): Promise<boolean> {
  const setup = await client.call("getVenueSetup", { path: { venue }, signal });
  insist(same(setup.address, owner.address), "Setup returned another account");
  const permit = required(setup.steps.find(step => step.step === "permit"));
  if (permit.status === "required") throw new Error("Payment authorization failed");
  return permit.status === "done";
}

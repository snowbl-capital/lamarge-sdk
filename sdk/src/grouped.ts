import { LaMargeError, type Answer, type Client } from "./client.ts";
import { checkRouteIntent } from "./protocol/intents.ts";
import { groupable, insist, ROUTE_PAY_WINDOW_SECONDS, same } from "./protocol/protocol.ts";
import { isRecord, required } from "./protocol/validation.ts";
import { withoutAttestation, type BeforeSigning, type SignedItem, type Signer } from "./signer.ts";
import { canonical, memoryStore, signedItems, type SignatureStore } from "./store.ts";
import { signPayment, type TakeOptions } from "./take.ts";
import { takeInput, type TransferIntent } from "./transfer.ts";

export type GroupedPreparation = Answer<"prepareGroupedRoute">;
export type GroupedRoute = Answer<"commitGroupedRoute">;

/** Least time left before `commit_by` to ask the wallet for another signature. */
const REQUEST_MARGIN_MS = 5_000;

export interface GroupedOptions {
  store?: SignatureStore | undefined;
  signal?: AbortSignal | undefined;
  beforeSigning?: BeforeSigning | undefined;
  now?: (() => number) | undefined;
  lock?: TakeOptions["lock"];
}

/** Refusals that confirm no grouped commit was accepted. */
const refused = (error: unknown): error is LaMargeError => error instanceof LaMargeError
  && (error.reason === "grouped_unavailable" || error.code === "TAKE_EXPIRED" || error.status === 404 && error.code === "NOT_FOUND");

/** A requested grouped route could not commit; the caller decides whether to start another attempt. */
export class RouteAbandoned extends Error {
  override readonly name = "RouteAbandoned";
  readonly lateByMs: number | null;
  constructor(readonly transferId: string, readonly reason: "unavailable" | "expired" | "aborted", readonly commitBy: string | null, now = Date.now(), cause?: unknown) {
    super(`Grouped route ${reason}. Review the route before trying again.`, { cause });
    this.lateByMs = commitBy === null ? null : Math.max(0, now - Date.parse(commitBy));
  }
}

/**
 * Signs every request of a route at once: reserves the first take, has the server reserve the
 * second, checks both against the route and the linked accounts, signs the first take's payment
 * and the second take's payment back to back and commits them together, inside `lock` throughout.
 * A refused or expired attempt throws `RouteAbandoned`; nothing is signed again automatically.
 * `signer` pays on `first.from`, `hub` on `via`.
 */
export async function signRoute(client: Client, signer: Signer, hub: Signer, first: TransferIntent, options: GroupedOptions = {}): Promise<GroupedRoute> {
  const { lock, ...unlocked } = options;
  if (lock) return lock(() => signRoute(client, signer, hub, first, unlocked));
  const { store = memoryStore(), signal, now = Date.now } = options;
  insist(first.then && groupable(first.from, first.to) && same(first.payer, signer.address) && same(first.recipient, hub.address), "This route is not signed at once");
  if (!first.take_id) await client.call("postTake", { body: takeInput(first), signal, retry: true });
  const key = `route:${first.id}`;
  let preparation: GroupedPreparation;
  try {
    preparation = await client.call("prepareGroupedRoute", { path: { id: first.id }, signal });
  } catch (error) {
    if (refused(error)) {
      await store.delete(key);
      throw new RouteAbandoned(first.id, error.code === "TAKE_EXPIRED" ? "expired" : "unavailable", first.grouped?.commit_by ?? null, now(), error);
    }
    throw error;
  }
  const { route } = preparation;
  if (route.state !== "prepared") {
    await store.delete(key);
    if (route.state === "aborted") throw new RouteAbandoned(first.id, "aborted", route.commit_by, now());
    return route;
  }
  const abandon = async () => {
    // Cleanup must release the second reservation even after the flow's signal aborts.
    await client.call("abortGroupedRoute", { path: { id: first.id } });
    await store.delete(key);
  };
  let signed: SignedItem[] | null;
  try {
    const [second, balances] = await Promise.all([client.call("getTransfer", { path: { id: route.second_transfer_id }, signal }), client.call("getBalances", { signal })]);
    insist(preparation.first.take.id === route.first_take_id && (!first.take_id || first.take_id === route.first_take_id) && preparation.second.take.id === route.second_take_id
      && second.take_id === route.second_take_id, "The route's takes differ from its transfers");
    checkRouteIntent(first, preparation.first.take.fills, second, hub.address);
    const account = (venue: string, owner: Signer) => {
      const linked = required(balances.find(balance => balance.venue === venue), "Link both venues first");
      insist(same(linked.address, owner.address), "The signer is not the account paying on this venue");
      return linked;
    };
    const payer = account(first.from, signer), between = account(second.from, hub);
    const kept: unknown = await store.load(key);
    // Signatures already made for this very route are kept, one by one: a restart asks only the rest.
    const partial: Partial<Signed> = isRecord(kept) && isRecord(kept.requests) && canonical(keptRequests(kept.requests)) === canonical(requests(preparation)) ? stored(kept) : {};
    const left = () => Date.parse(route.commit_by) - now() > REQUEST_MARGIN_MS;
    const save = async (progress: Partial<Signed>) => { signal?.throwIfAborted(); await store.save(key, { requests: requests(preparation), ...progress }); };
    const before = options.beforeSigning;
    const progress = { ...partial };
    signed = null;
    if (left()) {
      if (!progress.first || !progress.second) await before?.({ kind: "route", preparation, second, signed: { first: !!progress.first, withdrawal: false, second: !!progress.second } });
      const payment = { signal, before, route: true };
      // The first take's request first: its venue nonce is the shortest-lived.
      if (!progress.first && left()) {
        progress.first = await signPayment(client, preparation.first, takeInput(first), signer, payer, first.recipient, { ...payment, at: now() / 1000 });
        await save(progress);
      }
      if (!progress.second && left()) {
        progress.second = await signPayment(client, preparation.second, takeInput(second), hub, between, second.recipient, { ...payment, at: now() / 1000, payWindow: ROUTE_PAY_WINDOW_SECONDS });
        await save(progress);
      }
      if (progress.first && progress.second) signed = [...progress.first, ...progress.second];
    }
  } catch (error) {
    // Keep stored signatures if the abort cannot be confirmed; preserve the signing error.
    await abandon().catch(() => null);
    throw error;
  }
  if (!signed || now() >= Date.parse(route.commit_by)) {
    await abandon();
    throw new RouteAbandoned(first.id, "expired", route.commit_by, now());
  }
  try {
    const committed = await client.call("commitGroupedRoute", { path: { id: first.id }, body: { signatures: signed }, signal, retry: true });
    insist(committed.state === "committed" || committed.state === "closed", "Unreadable answer to the route's commit");
    await store.delete(key);
    return committed;
  } catch (error) {
    // A confirmed refusal ends this attempt; an uncertain outcome is recovered on the next run.
    if (refused(error)) {
      await abandon();
      throw new RouteAbandoned(first.id, error.code === "TAKE_EXPIRED" ? "expired" : "aborted", route.commit_by, now(), error);
    }
    if (error instanceof LaMargeError && error.status === 400) await abandon();
    throw error;
  }
}

interface Signed { first: SignedItem[]; second: SignedItem[] }

const requests = (preparation: GroupedPreparation) => ({ first: withoutAttestation(preparation.first.to_sign), second: withoutAttestation(preparation.second.to_sign) });

/** Requests a checkpoint kept, as `requests` writes them: earlier SDKs saved a null withdrawal, and attestations. */
const keptRequests = (kept: Record<string, unknown>) =>
  kept.withdrawal == null ? { first: withoutAttestation(kept.first), second: withoutAttestation(kept.second) } : null;

function stored(kept: Record<string, unknown>): Partial<Signed> {
  const first = signedItems(kept.first), second = signedItems(kept.second);
  return { ...first ? { first } : {}, ...second ? { second } : {} };
}

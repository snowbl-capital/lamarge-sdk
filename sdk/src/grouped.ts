import { LaMargeError, type Answer, type Client } from "./client.ts";
import { checkRouteIntent } from "./protocol/intents.ts";
import { groupable, insist, ROUTE_PAY_WINDOW_SECONDS, same } from "./protocol/protocol.ts";
import { isHex, isRecord, required } from "./protocol/validation.ts";
import { signTyped, type BeforeSigning, type SignedItem, type Signer } from "./signer.ts";
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

/** The route goes leg by leg: LaMarge does not sign it at once now, it was aborted, or the server predates routes signed at once. */
const sequential = (error: unknown) => error instanceof LaMargeError
  && (error.reason === "grouped_unavailable" || error.code === "TAKE_EXPIRED" || error.status === 404 && error.code === "NOT_FOUND");

/**
 * Signs every request of a route at once: reserves the first take, has the server reserve the
 * second, checks both against the route and the linked accounts, signs the first take's payment,
 * the withdrawal from `via` and the second take's payment back to back and commits them together,
 * inside `lock` throughout. Null when the route goes leg by leg, nothing of its second leg sent:
 * the first take stays reserved for `transfer` to sign alone. `signer` pays on `first.from`, `hub`
 * on `via`.
 */
export async function signRoute(client: Client, signer: Signer, hub: Signer, first: TransferIntent, options: GroupedOptions = {}): Promise<GroupedRoute | null> {
  const { lock, ...unlocked } = options;
  if (lock) return lock(() => signRoute(client, signer, hub, first, unlocked));
  const { store = memoryStore(), signal, now = Date.now } = options;
  insist(first.then && groupable(first.from, first.to) && same(first.payer, signer.address) && same(first.recipient, hub.address), "This route is not signed at once");
  // The first take reserved again returns the same one: its client id is the transfer's.
  if (!first.take_id) await client.call("postTake", { body: takeInput(first), signal });
  let preparation: GroupedPreparation;
  try {
    preparation = await client.call("prepareGroupedRoute", { path: { id: first.id }, signal });
  } catch (error) {
    if (sequential(error)) return null;
    throw error;
  }
  const { route } = preparation;
  const key = `route:${first.id}`;
  if (route.state !== "prepared") {
    await store.delete(key);
    return route.state === "aborted" ? null : route;
  }
  // Ends the route before its commit, its second take released, even once the flow itself was aborted.
  const abandon = async () => {
    await client.call("abortGroupedRoute", { path: { id: first.id } }).catch(() => null);
    await store.delete(key);
  };
  let signed: SignedItem[] | null;
  try {
    const [second, balances] = await Promise.all([client.call("getTransfer", { path: { id: route.second_transfer_id }, signal }), client.call("getBalances", { signal })]);
    insist(preparation.first.take.id === route.first_take_id && (!first.take_id || first.take_id === route.first_take_id) && preparation.second.take.id === route.second_take_id
      && second.take_id === route.second_take_id, "The route's takes differ from its transfers");
    checkRouteIntent(first, preparation.first.take.fills, second, hub.address, now() / 1000);
    const account = (venue: string, owner: Signer) => {
      const linked = required(balances.find(balance => balance.venue === venue), "Link both venues first");
      insist(same(linked.address, owner.address), "The signer is not the account paying on this venue");
      return linked;
    };
    const payer = account(first.from, signer), between = account(second.from, hub);
    const kept: unknown = await store.load(key);
    // Signatures already made for this very route are kept, one by one: a restart asks only the rest.
    const partial: Partial<Signed> = isRecord(kept) && canonical(kept.requests) === canonical(requests(preparation, second)) ? stored(kept) : {};
    const left = () => Date.parse(route.commit_by) - now() > REQUEST_MARGIN_MS;
    const save = async (progress: Partial<Signed>) => { signal?.throwIfAborted(); await store.save(key, { requests: requests(preparation, second), ...progress }); };
    const before = options.beforeSigning;
    const progress = { ...partial };
    signed = null;
    if (left()) {
      if (!progress.first || !progress.second || second.withdrawal_preparation && !progress.withdrawal) await before?.({ kind: "route", preparation, second, signed: { first: !!progress.first, withdrawal: !!progress.withdrawal, second: !!progress.second } });
      const payment = { signal, before, route: true };
      // The first take's request first: its venue nonce is the shortest-lived.
      if (!progress.first && left()) {
        progress.first = await signPayment(client, preparation.first, takeInput(first), signer, payer, first.recipient, { ...payment, at: now() / 1000 });
        await save(progress);
      }
      const withdrawal = second.withdrawal_preparation;
      if (withdrawal && !progress.withdrawal && left()) {
        await before?.({ kind: "withdrawal", venue: second.from, destination: hub.address, amount: BigInt(withdrawal.amount), typed: withdrawal.typed_data, route: true });
        progress.withdrawal = await signTyped(hub, withdrawal.typed_data);
        await save(progress);
      }
      if (!progress.second && left()) {
        progress.second = await signPayment(client, preparation.second, takeInput(second), hub, between, second.recipient, { ...payment, at: now() / 1000, payWindow: ROUTE_PAY_WINDOW_SECONDS });
        await save(progress);
      }
      if (progress.first && progress.second && (!withdrawal || progress.withdrawal)) {
        signed = [...progress.first, ...progress.withdrawal ? [{ kind: "margin_move", signature: progress.withdrawal }] : [], ...progress.second];
      }
    }
  } catch (error) {
    // Refused or unsigned before the commit: the route ends there.
    await abandon();
    throw error;
  }
  // Too little time left to sign it all: the route goes leg by leg.
  if (!signed) { await abandon(); return null; }
  try {
    const committed = await client.call("commitGroupedRoute", { path: { id: first.id }, body: { signatures: signed }, signal, retry: true });
    insist(committed.state === "committed" || committed.state === "closed", "Unreadable answer to the route's commit");
    await store.delete(key);
    return committed;
  } catch (error) {
    // Refused, nothing of it accepted: aborted or late, it goes leg by leg; a bad signature is never sent again. Any other outcome is read again on the next run.
    if (sequential(error)) { await abandon(); return null; }
    if (error instanceof LaMargeError && error.status === 400) await abandon();
    throw error;
  }
}

interface Signed { first: SignedItem[]; second: SignedItem[]; withdrawal?: `0x${string}` | undefined }

const requests = (preparation: GroupedPreparation, second: TransferIntent) =>
  ({ first: preparation.first.to_sign, second: preparation.second.to_sign, withdrawal: second.withdrawal_preparation?.typed_data ?? null });

function stored(kept: Record<string, unknown>): Partial<Signed> {
  const first = signedItems(kept.first), second = signedItems(kept.second);
  const withdrawal = isHex(kept.withdrawal) ? kept.withdrawal : undefined;
  return { ...first ? { first } : {}, ...second ? { second } : {}, ...withdrawal ? { withdrawal } : {} };
}

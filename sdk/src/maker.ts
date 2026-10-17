import { linkAccount, setUpVenue } from "./account.ts";
import { wait, type Client } from "./client.ts";
import { errorText } from "./delivery.ts";
import { changes } from "./events.ts";
import type { components } from "./generated/api.ts";
import { ESCROW_DEPLOYMENTS, requireSigningDomains, type DeploymentManifest } from "./protocol/deployments.ts";
import { checkMakerIntent, type FundingSource } from "./protocol/intents.ts";
import { checkCloseOrders, checkPreparedQuote, insist, same, VENUE_SETTLED, type QuoteIntent } from "./protocol/protocol.ts";
import { signIn, signOut } from "./session.ts";
import { signItems, type Signer } from "./signer.ts";
import { signedItems, type SignatureStore } from "./store.ts";

export type Order = components["schemas"]["Order"];
export type Credential = components["schemas"]["CredentialCreated"];
/** An EOA key, or a deployed ERC-1271 delegate whose signature is collected elsewhere (`prepareUnsigned`). */
export type QuoteSigner = Pick<Signer, "address" | "signTypedData">;
/** A fill as the event journal shows it, its venues named as in REST fills. */
export type FeedFill = Omit<components["schemas"]["FillPreview"], "from" | "to"> & { from_venue: string; to_venue: string };
/** A fill as delivery needs it, from the REST list or the event feed alike. */
export type DeliveryFill = Pick<components["schemas"]["Fill"], "id" | "role" | "state" | "payment_leg" | "maker_leg" | "to_venue" | "amount_out"
  | "deliver_by" | "report_by" | "delivery_to" | "delivery_hash" | "payment_verified_at">;


/** The financial key: provisioning and release of capital only. Never give it to the quoting host. */
export class Maker {
  private sessionId = "";
  /** `operator` and `appOrigin` come from reviewed deployment configuration, never from the API. */
  constructor(readonly client: Client, private account: Signer, private operator: string, private appOrigin: string, private manifest: DeploymentManifest = ESCROW_DEPLOYMENTS) {}
  async login() { this.sessionId = (await signIn(this.client, this.account, this.appOrigin)).session_id; }
  async logout() { if (this.sessionId) await signOut(this.client, this.sessionId); }
  balances() { return this.client.call("getBalances"); }
  order(id: string) { return this.client.call("getOrder", { path: { id } }); }
  /**
   * Links the financial key's own account on `venue`, or `owner`'s, which signs the link message,
   * then the setup step a maker pool needs: on Aster, approving LaMarge's agent.
   */
  async link(venue: string, owner?: Signer) {
    const linked = await linkAccount(this.client, this.account, venue, owner ?? this.account);
    if (venue === "aster") await setUpVenue(this.client, venue, owner ?? this.account, { steps: ["agent"] });
    return linked;
  }
  async createCredential(name: string, quoteSigner: string, days = 30): Promise<Credential> {
    const credential = await this.client.call("postV1Credentials", { body: { name, quote_signer: quoteSigner, scopes: ["read", "quote", "cancel"], expires_at: Math.floor(Date.now() / 1000) + days * 86_400 } });
    insist(same(credential.quote_signer, quoteSigner) && credential.scopes.join(",") === "read,quote,cancel");
    return credential;
  }
  /**
   * Persist `client_request_id`, and keep `store`: each signed preparation is saved there before its first submission. `owner`,
   * for a pool held inside its venue (Lighter, Aster), is the dedicated address linked there;
   * escrow funding always comes from the financial key.
   */
  async addCapital(input: { venue: string; amount: string; client_request_id: string; funding_source: FundingSource }, credential: Pick<Credential, "id" | "quote_signer">,
    store?: SignatureStore, expectedOwner: string = this.account.address): Promise<Order> {
    insist(Boolean(input.client_request_id), "Provide a persistent client_request_id");
    insist(same(expectedOwner, this.account.address) || VENUE_SETTLED.has(input.venue), "Escrow capital is funded by the financial key's own account");
    const [balances, orders] = await Promise.all([this.balances(), this.client.call("getOrders")]);
    const owner = balances.find(balance => balance.venue === input.venue)?.address;
    insist(owner && same(owner, expectedOwner), "Link the source account before provisioning");
    const existingOrder = orders.find(order => order.capital_pool && order.venue === input.venue && order.quote_identity_id === credential.id && same(order.owner_address, owner)) ?? null;
    const { venue, ...body } = input;
    const asked = { ...body, quote_identity_id: credential.id };
    const prepared = await this.client.call("prepareMaker", { path: { venue }, body: asked, retry: true });
    if (prepared.state === "accepted" || prepared.state === "complete") return prepared.order;
    insist(prepared.state === "preparing", "Preparation ended; review a new request");
    const key = `maker:${prepared.id}`;
    let signatures = signedItems(await store?.load(key));
    if (!signatures) {
      checkMakerIntent(prepared, { ...asked, venue }, { owner, quoteSigner: credential.quote_signer, quoteIdentityId: credential.id, operator: this.operator, existingOrder });
      signatures = await signItems(this.account, prepared.to_sign, this.manifest);
      await store?.save(key, signatures);
    }
    const { order } = await this.client.call("submitMakerSignatures", { path: { id: prepared.id }, body: { signatures }, retry: true });
    await store?.delete(key);
    return order;
  }
  async closeOrders(ids: string[]): Promise<Order[]> {
    const result: Order[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      const chunk = ids.slice(start, start + 50);
      const close = await this.client.call("postCloses", { body: { orders: chunk } });
      if (!close.id) continue;
      checkCloseOrders(close.to_sign, chunk, this.account.address);
      const signatures = await signItems(this.account, close.to_sign, this.manifest);
      result.push(...(await this.client.call("postCloseSignatures", { path: { id: close.id }, body: { signatures }, retry: true })).orders);
    }
    return result;
  }
  /**
   * Waits for the funding `addCapital` submitted: its preparation, not the order, says whether it
   * landed, since a failed top-up returns the order to its prior state. Throws when it failed.
   */
  async waitForFunding(order: Order, timeoutMs = 600_000): Promise<Order> {
    const end = Date.now() + timeoutMs;
    for (const id = order.preparation_id; id;) {
      const preparation = await this.client.call("getMakerPreparation", { path: { id } });
      if (preparation.state === "complete") break;
      if (preparation.state === "failed" || preparation.state === "cancelled") throw new Error(`Funding ${preparation.state}: ${preparation.order.error ?? "no reason given"}`);
      if (Date.now() >= end) throw new Error(`Funding of order ${order.id} still pending; recover it by the same client_request_id`);
      await wait(2_000);
    }
    return this.waitFor(order.id, ["live"], end - Date.now());
  }
  /** Waits until the order reaches one of `states`; for a funding, `waitForFunding`. */
  async waitFor(id: string, states: Order["state"][], timeoutMs = 600_000): Promise<Order> {
    const end = Date.now() + timeoutMs;
    // Read at least once, however little time is left.
    for (;;) {
      const order = await this.order(id);
      if (states.includes(order.state)) return order;
      if (order.state === "failed") throw new Error(`Order failed: ${order.error}`);
      if (Date.now() >= end) throw new Error(`Order ${id} still pending; recover it by the same client_request_id`);
      await wait(2_000);
    }
  }
}

/** A scoped credential (`mk_`) quotes and cancels only its own orders; this key cannot withdraw capital. */
export class Quoter {
  private lastRtt: { ms: number; at: number } | undefined;
  constructor(readonly client: Client, readonly identity: string, private account: QuoteSigner, private manifest: DeploymentManifest = ESCROW_DEPLOYMENTS) {
    insist(client.token?.startsWith("mk_"), "Use a scoped maker credential");
  }
  /** Each answer's round trip, reported with the next lease. */
  private async timed<T>(run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const answer = await run();
    const completed = performance.now();
    this.lastRtt = { ms: Math.round(completed - started), at: completed };
    return answer;
  }
  order(id: string) { return this.timed(() => this.client.call("getOrder", { path: { id } })); }
  lease(ttlSeconds = 30) {
    const sample = this.lastRtt;
    const age = sample ? Math.round(performance.now() - sample.at) : 0;
    const telemetry = sample && sample.ms <= 60_000 && age <= 120_000 ? { api_rtt_ms: sample.ms, api_rtt_age_ms: age } : {};
    return this.timed(() => this.client.call("putV1QuoteIdentitiesIdLease", { path: { id: this.identity }, body: { ttl_seconds: ttlSeconds, ...telemetry }, retry: true }));
  }
  cancelAll() { return this.timed(() => this.client.call("deleteV1QuoteIdentitiesIdQuotes", { path: { id: this.identity } })); }
  /** Prepares `order`'s quote set and checks it; signing is the caller's, as for a contract delegate. */
  async prepareUnsigned(order: Order, quotes: QuoteIntent[], size: bigint, validUntil: number) {
    insist(order.quote_identity_id === this.identity && same(order.quote_signer, this.account.address) && order.state === "live" && size > 0n && size <= BigInt(order.available_to_quote));
    insist(quotes.length > 0);
    const asks = quotes.map(({ recipient: _, ...ask }) => ask);
    const prepared = await this.timed(() => this.client.call("prepareQuotes", { path: { id: order.id }, body: { valid_until: validUntil, quote_size: String(size), quotes: asks } }));
    checkPreparedQuote(prepared, order, quotes, validUntil, String(size));
    requireSigningDomains(prepared.to_sign, this.manifest);
    return prepared;
  }
  async prepare(order: Order, quotes: QuoteIntent[], size: bigint, validUntil: number) {
    const prepared = await this.prepareUnsigned(order, quotes, size, validUntil);
    const [signed] = await signItems(this.account, prepared.to_sign, this.manifest);
    insist(signed, "Nothing to sign");
    return { order_id: order.id, draft_id: prepared.draft_id, signature: signed.signature };
  }
  /** All distinct order updates and cancels commit atomically; a cancel is never replayed, as it would void the sequence that follows. */
  batch(updates: { order_id: string; draft_id: string; signature: string }[], cancels: string[] = []) {
    insist(updates.length + cancels.length > 0 && updates.length + cancels.length <= 50);
    return this.timed(() => this.client.call("postV1QuotesBatch", { body: { updates, cancels }, retry: cancels.length === 0 }));
  }
  /** The identity's fills, current and the last final ones. */
  fills() { return this.timed(() => this.client.call("getFills")); }
  /** Reports the venue transaction delivering a fill (a Lighter hash or an Aster transfer id); the server verifies it before paying the maker. Exact retries return the fill. */
  deliver(fillId: string, txHash: string) {
    return this.timed(() => this.client.call("submitDelivery", { path: { id: fillId }, body: { tx_hash: txHash }, retry: true }));
  }
  /**
   * The identity's open fills kept current from its event journal: a snapshot, then only the
   * changes, pushed over the stream. `fills()` throws until the first snapshot is in.
   */
  fillFeed(signal: AbortSignal, log: (line: string) => void = console.error) {
    const current = new Map<string, FeedFill>();
    let synced = false;
    // The journal names the venues `from` and `to`; REST fills, `from_venue` and `to_venue`.
    const put = (fill: components["schemas"]["SnapshotFill"] | components["schemas"]["FillPreview"]) => {
      const { from, to, ...rest } = fill;
      current.set(fill.id, { ...rest, from_venue: from, to_venue: to });
    };
    const done = (async () => {
      while (!signal.aborted) {
        try {
          for await (const change of changes(this.client, { scope: "private", signal })) {
            if ("resync" in change) {
              current.clear();
              if ("fills" in change.resync) for (const fill of change.resync.fills) put(fill);
            } else for (const event of change.events) if (event.kind === "fill.changed" && "role" in event.data) put(event.data);
            synced = true;
          }
        } catch (error) {
          synced = false;
          log(`fills: ${errorText(error)}`);
          await wait(2_000, signal).catch(() => undefined);
        }
      }
    })();
    return {
      done,
      fills: async () => { insist(synced, "Fills are not synced yet"); return [...current.values()]; },
      deliver: (id: string, hash: string) => this.deliver(id, hash),
    };
  }
}

// Delivery inside Aster: one transfer per fill from the pool's Spot wallet to the taker's,
// signed by the account's own key, persisted before it is sent and never signed twice.
import { getAddress, parseUnits } from "viem";
import { errorText, Refused, VenueDeliverer, type DeliveryJournal, type FillSource, type Log } from "./delivery.ts";
import type { DeliveryFill } from "./maker.ts";
import { asterAmount, asterClientId, asterRequest, ASTER_TRANSFER_CHAIN_ID, insist, venueUnits } from "./protocol/protocol.ts";
import { isRecord } from "./protocol/validation.ts";
import { signTyped, type Signer } from "./signer.ts";

export const ASTER_MAINNET = { chain: "https://chainapi.asterdex.com", futures: "https://fapi.asterdex.com", spot: "https://sapi.asterdex.com" };
/** The pool's own address, whose key signs its transfers: a dedicated address, never the master. */
export type AsterConfig = { account: string };
/** Aster takes a signed request while its nonce is within about a minute of its clock: the same bytes are resent for 50 seconds at most. */
const WINDOW_MS = 50_000;
/** No request is sent closer than this to `deliver_by`: each one reaches Aster within its 10-second timeout, and Aster transfers synchronously. */
const SEND_MARGIN_MS = 15_000;

/**
 * A delivery's signed request, persisted before its first send. `attempted` is set before any
 * send, `transfer_id` once Aster answered. `outcome` once settled: `reported` to LaMarge;
 * `failed`, LaMarge will not take it; `refused` by Aster on the first send; `dropped`, never sent
 * before the deadline; `unknown`, never answered within the nonce window, never signed again.
 */
export type AsterDelivery = { fill_id: string; query: string; nonce: number; amount: string; to: string; attempted: boolean; transfer_id?: string; outcome?: "reported" | "failed" | "dropped" | "refused" | "unknown"; created_at: string };

/** `Message{msg}` in Aster's signing domain: its transfers' chain for requests, BSC's for an agent approval. */
export const signAster = (account: Pick<Signer, "signTypedData">, msg: string, chainId = ASTER_TRANSFER_CHAIN_ID) => signTyped(account, asterRequest(msg, chainId));
const query = (fields: [string, string][]) => fields.map(([name, value]) => `${name}=${value}`).join("&");

export class AsterDeliverer extends VenueDeliverer<AsterDelivery> {
  private lastNonce = 0;
  /** When each fill's next send may be tried. */
  private sendAt = new Map<string, { at: number; wait: number }>();
  /**
   * `owner` signs transfers; `agent`, an agent of the same account allowed only to trade,
   * moves its margin to Spot first.
   */
  constructor(private owner: Signer, private agent: Signer, store: DeliveryJournal<AsterDelivery>, private api = ASTER_MAINNET, now = () => Date.now()) {
    super("aster", SEND_MARGIN_MS, store, now);
  }
  /** Microseconds, distinct for each request. */
  private nonce() { this.lastNonce = Math.max(this.now() * 1000, this.lastNonce + 1); return this.lastNonce; }
  /** Aster's JSON answer; a `{code<0}` answer to a request it read is a refusal, anything else unanswered is an error. */
  private async request(method: "GET" | "POST", url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, { method, headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, signal: AbortSignal.timeout(10_000) });
    const answer: unknown = await response.json().catch(() => null);
    const body = isRecord(answer) ? answer : null;
    if (body && typeof body.code === "number" && body.code < 0 && response.status < 500 && response.status !== 429) throw new Refused(`Aster refused: ${body.code} ${String(body.msg ?? "")}`);
    if (!response.ok || !body) throw new Error(`Aster ${new URL(url).pathname}: HTTP ${response.status}`);
    return body;
  }
  /** A request of the agent for the account: the parameters, then nonce, user and signer. */
  private async byAgent(method: "GET" | "POST", url: string, params: [string, string][]) {
    const message = query([...params, ["nonce", String(this.nonce())], ["user", this.owner.address], ["signer", this.agent.address]]);
    return this.request(method, `${url}?${message}&signature=${await signAster(this.agent, message)}`);
  }
  /** The USDT the account's Spot wallet holds, in base units. */
  private async spot(): Promise<bigint> {
    const account = await this.byAgent("GET", `${this.api.spot}/api/v3/account`, []);
    insist(Array.isArray(account.balances), "Aster answered no Spot balances");
    const balances: unknown[] = account.balances;
    const free = balances.filter(isRecord).find(balance => balance.asset === "USDT")?.free ?? "0";
    insist(typeof free === "string" && /^\d+(\.\d+)?$/.test(free), "Unexpected Aster Spot balance");
    return parseUnits(free, 18);
  }
  /**
   * Moves what the Spot wallet lacks for the fill from the margin; the move's id makes a retry a
   * no-op. `held` is Spot's balance when known, otherwise it is read. Returns what Spot keeps
   * after the fill's transfer, or undefined after a margin move.
   */
  async fundSpot(fill: DeliveryFill, held?: bigint): Promise<bigint | undefined> {
    const needed = venueUnits(BigInt(fill.amount_out), "aster");
    held ??= await this.spot();
    if (held >= needed) return held - needed;
    await this.byAgent("POST", `${this.api.futures}/fapi/v3/asset/wallet/transfer`, [["amount", asterAmount(needed - held)], ["asset", "USDT"], ["clientTranId", `m${asterClientId(fill.id)}`], ["kindType", "FUTURE_SPOT"]]);
    return undefined;
  }
  /** The fill's transfer at `nonce`, signed by the account's key over the request. */
  async sign(fill: DeliveryFill, nonce: number): Promise<AsterDelivery> {
    insist(fill.to_venue === "aster" && fill.delivery_to !== null && /^0x[0-9a-fA-F]{40}$/.test(fill.delivery_to), "Not an Aster delivery");
    const message = query([["asset", "USDT"], ["amount", asterAmount(BigInt(fill.amount_out))], ["toAddress", getAddress(fill.delivery_to)], ["clientTranId", asterClientId(fill.id)], ["nonce", String(nonce)], ["user", this.owner.address]]);
    return { fill_id: fill.id, query: `${message}&signature=${await signAster(this.owner, message)}`, nonce, amount: fill.amount_out, to: fill.delivery_to, attempted: false, created_at: new Date(this.now()).toISOString() };
  }
  /** Sends persisted bytes; returns the transfer id, executed or pending. */
  async send(delivery: AsterDelivery): Promise<string> {
    const reply = await this.request("POST", `${this.api.chain}/aster-chain/v3/transfer?${delivery.query}`);
    const id = typeof reply.transferId === "number" ? String(reply.transferId) : reply.transferId;
    insist(typeof id === "string" && /^\d+$/.test(id) && ["SUCCESS", "PENDING"].includes(String(reply.status)), "Unexpected Aster transfer answer");
    return id;
  }
  /**
   * Signs and sends due fills whose payment is locked, one at a time, while each transfer gets
   * an answer from Aster. Spot is read once and each amount deducted locally; it is read again
   * after a margin move.
   */
  protected async deliver(quoter: FillSource, due: DeliveryFill[], deliveries: Record<string, AsterDelivery>, log: Log): Promise<boolean> {
    let spot: bigint | undefined;
    for (const fill of due.filter(fill => fill.payment_leg === "LOCKED")) {
      try {
        if (!this.turn(this.sendAt, fill.id)) return false;
        // Sign only once Spot holds the amount, so the whole nonce window is left for sending.
        spot = await this.fundSpot(fill, spot);
        const delivery = await this.sign(fill, this.nonce());
        deliveries[fill.id] = delivery;
        await this.store.save(deliveries);
        this.sendAt.delete(fill.id);
        if (!(await this.settle(quoter, delivery, fill, deliveries, log))) return false;
      } catch (error) { log(`${fill.id}: ${errorText(error)}`); return false; }
    }
    return true;
  }
  /** Moves one persisted delivery forward; false while Aster has not answered its request. */
  protected async settle(quoter: FillSource, delivery: AsterDelivery, fill: DeliveryFill | undefined, deliveries: Record<string, AsterDelivery>, log: Log): Promise<boolean> {
    const id = delivery.fill_id;
    const save = async () => { await this.store.save(deliveries); };
    const reported = delivery.transfer_id !== undefined && fill?.delivery_hash === delivery.transfer_id;
    if (!this.awaits(fill) || reported) {
      delivery.outcome = reported ? "reported" : "failed";
      await save();
      log(`${id}: fill no longer awaits this delivery`);
      return true;
    }
    if (delivery.transfer_id === undefined) {
      if (this.now() >= delivery.nonce / 1000 + WINDOW_MS || Date.parse(fill.deliver_by ?? "") - this.now() <= SEND_MARGIN_MS) {
        // Past its window Aster refuses these bytes; an attempted one may have executed, and
        // another request for the fill could pay twice.
        delivery.outcome = delivery.attempted ? "unknown" : "dropped";
        await save();
        log(delivery.attempted
          ? `${id}: Aster never answered transfer ${asterClientId(id)}; not signed again: report its transferId if the account's history shows it`
          : `${id}: too close to the delivery deadline, transfer not sent`);
        return true;
      }
      if (!this.turn(this.sendAt, id)) return false;
      // Recorded before the request: a lost answer is never taken for a refusal.
      const first = !delivery.attempted;
      delivery.attempted = true;
      await save();
      try { delivery.transfer_id = await this.send(delivery); }
      catch (error) {
        // Only a first send's refusal is final: after a lost answer, the earlier send may have
        // executed, and the resend's refusal says nothing of it.
        if (!(error instanceof Refused) || !first) throw error;
        // Private account (-5124) or Spot short (032209): left to its refund, never signed again.
        delivery.outcome = "refused";
        await save();
        log(`${id}: ${error.message}`);
        return true;
      }
      this.sendAt.delete(id);
      await save();
      log(`${id}: transfer ${delivery.transfer_id} sent`);
    }
    if (!this.reportDue(id)) return true;
    // Executed or pending on Aster: reported until the server takes it or never will.
    const outcome = await this.report(quoter, id, delivery.transfer_id, log);
    if (outcome) { delivery.outcome = outcome; await save(); }
    return true;
  }
}

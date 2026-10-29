// Persist Lighter deliveries signed by both the API key and owner key before sending; never sign a fill twice.
import { errorText, Refused, VenueDeliverer, type DeliveryJournal, type FillSource, type Log } from "./delivery.ts";
import type { DeliveryFill } from "./maker.ts";
import { fillMemo, USDC_ASSET } from "./protocol/lighter.ts";
import { insist } from "./protocol/protocol.ts";
import { record } from "./protocol/validation.ts";
import type { Signer } from "./signer.ts";

// Lighter transaction status: 0 failed, 1 pending, 2 executed, 3 final (minutes after 2);
// above 3, failed.
const TRANSFER = 12, FAILED = 0, EXECUTED = 2, FINAL = 3;
/** The signer cannot expire a transfer at `deliver_by`; a late execution is the maker's loss. */
const SEND_MARGIN_MS = 60_000;
/** A Standard Lighter account allows 60 requests a minute, reads and sends alike; this bot makes at most 50. */
const REQUESTS_PER_MINUTE = 50;

/** `max_fee`: the most Lighter may charge per transfer, in USDC base units; 0 unless set. */
export type LighterConfig = { api: string; chain_id: number; account_index: number; api_key_index: number; max_fee?: number };
/**
 * Persist before sending; set `attempted` before the call and `sent` when Lighter knows it.
 * Outcomes: `reported` to LaMarge; `failed`, rejected there; `refused`, first send rejected;
 * `dropped`, unsent, failed or expired. Refused/dropped nonces follow Lighter's count.
 */
export type LighterDelivery = { fill_id: string; tx_hash: string; tx_type: number; tx_info: string; nonce: number; expires_at: number; amount: string; fee: number; to: number; attempted: boolean; sent: boolean; outcome?: "reported" | "failed" | "dropped" | "refused"; created_at: string };

/** A transfer as Lighter's signers take it (`signTransfer` of lighter-ts-sdk's wallet, or Lighter's Go signer). */
export type LighterTransferParams = { toAccountIndex: number; asset_id: number; is_spot_account: boolean; from_is_spot_account: boolean; usdcAmount: number; fee: number; memo: string; skipNonce: number; nonce: number; apiKeyIndex: number; accountIndex: number };
/** The caller owns the Go/WASM signer; the SDK never loads it or sees its API key. */
export interface LighterSigner {
  /** A token authenticating the account's reads, as `createAuthTokenWithExpiry` returns it. */
  authToken(): Promise<string>;
  signTransfer(params: LighterTransferParams): Promise<{ txType: number; txInfo: string; txHash: string; messageToSign?: string | undefined; error?: string | undefined }>;
}

export class LighterDeliverer extends VenueDeliverer<LighterDelivery> {
  /** When each pending transfer's status may be read again. */
  private readAt = new Map<string, { at: number; wait: number }>();
  /** Transfers seen executed: their status is not read again. */
  private executed = new Set<string>();
  private requests: number[] = [];
  /** `signer` holds the pool account's API key; `owner`, its owner's key, signs each transfer to another owner's account. */
  constructor(readonly config: LighterConfig, private signer: LighterSigner, private owner: Pick<Signer, "signMessage">, store: DeliveryJournal<LighterDelivery>, now = () => Date.now()) {
    super("lighter", SEND_MARGIN_MS, store, now);
  }
  private spend() {
    const now = this.now();
    this.requests = this.requests.filter(at => now - at < 60_000);
    if (this.requests.length >= REQUESTS_PER_MINUTE) throw new Error("Lighter request budget spent for this minute");
    this.requests.push(now);
  }
  private async get(path: string, authorization?: string): Promise<Record<string, unknown>> {
    this.spend();
    const response = await fetch(`${this.config.api}/api/v1/${path}`, { headers: { accept: "application/json", ...(authorization ? { authorization } : {}) }, signal: AbortSignal.timeout(10_000) });
    const answer: unknown = await response.json();
    const body = record(answer);
    if (!response.ok && body.code !== 21500) throw new Error(`Lighter ${path}: HTTP ${response.status} ${typeof body.message === "string" ? body.message : ""}`);
    return body;
  }
  /** Lighter's status of a transaction; null only when Lighter answers that it does not know it. Any other answer throws: the delivery stays pending. */
  async status(txHash: string): Promise<number | null> {
    const tx = await this.get(`tx?by=hash&value=${encodeURIComponent(txHash)}`);
    if (tx.code === 21500) return null;
    if (tx.code !== 200 || typeof tx.status !== "number" || !Number.isInteger(tx.status)) throw new Error(`Lighter answered no status for ${txHash}`);
    return tx.status;
  }
  /** Signs the fill's transfer at `nonce`: API key signature, then the owner's wallet signature of the message Lighter requires for another owner's account. */
  async sign(fill: DeliveryFill, nonce: number): Promise<LighterDelivery> {
    const to = Number(fill.delivery_to);
    insist(fill.to_venue === "lighter" && /^\d+$/.test(fill.delivery_to ?? "") && Number.isSafeInteger(to), "Not a Lighter delivery");
    // The sending account's fee, in base units, charged on top of the amount; Lighter refuses
    // a transfer whose fee differs. Read with the account's token, as Lighter documents it.
    const token = await this.signer.authToken();
    const fee = await this.get(`transferFeeInfo?account_index=${this.config.account_index}&to_account_index=${to}&auth=${encodeURIComponent(token)}`, token);
    const usdcFee = Number(fee.transfer_fee_usdc);
    insist(fee.code === 200 && Number.isSafeInteger(usdcFee) && usdcFee >= 0, "Unexpected Lighter transfer fee");
    insist(usdcFee <= (this.config.max_fee ?? 0), `Lighter charges this account ${usdcFee} per transfer, above max_fee`);
    const signed = await this.signer.signTransfer({ toAccountIndex: to, asset_id: USDC_ASSET, is_spot_account: false, from_is_spot_account: false, usdcAmount: Number(fill.amount_out), fee: usdcFee, memo: `0x${fillMemo(fill.id)}`, skipNonce: 0, nonce, apiKeyIndex: this.config.api_key_index, accountIndex: this.config.account_index });
    if (signed.error) throw new Error(`Lighter signer: ${signed.error}`);
    insist(signed.txType === TRANSFER && signed.messageToSign, "Unexpected Lighter transaction");
    const parsed: unknown = JSON.parse(signed.txInfo);
    const info = record(parsed);
    insist(info.ToAccountIndex === to && info.FromAccountIndex === this.config.account_index && info.Amount === Number(fill.amount_out) && info.USDCFee === usdcFee && info.AssetIndex === USDC_ASSET && info.ToRouteType === 0 && info.Nonce === nonce && typeof info.ExpiredAt === "number", "The signed transfer differs from the fill");
    info.L1Sig = await this.owner.signMessage({ message: signed.messageToSign });
    return { fill_id: fill.id, tx_hash: signed.txHash, tx_type: signed.txType, tx_info: JSON.stringify(info), nonce, expires_at: Number(info.ExpiredAt), amount: fill.amount_out, fee: usdcFee, to, attempted: false, sent: false, created_at: new Date(this.now()).toISOString() };
  }
  /** Sends persisted bytes; Lighter accepts a nonce once, so a resend after a crash cannot pay twice. */
  async send(delivery: LighterDelivery): Promise<void> {
    const params = new URLSearchParams({ tx_type: String(delivery.tx_type), tx_info: delivery.tx_info, account_index: String(this.config.account_index), api_key_index: String(this.config.api_key_index), price_protection: "false" });
    this.spend();
    const response = await fetch(`${this.config.api}/api/v1/sendTx`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: params, signal: AbortSignal.timeout(15_000) });
    const answer: unknown = await response.json().catch(() => ({}));
    const body = record(answer);
    if (body.code !== 200) {
      if ((await this.status(delivery.tx_hash)) !== null) return;
      const reason = `Lighter refused the transfer: ${typeof body.message === "string" ? body.message : `HTTP ${response.status}`}`;
      // An answered refusal is final; an overloaded or failing API may still take the bytes.
      if (response.status >= 400 && response.status < 500 && response.status !== 429 && typeof body.code === "number") throw new Refused(reason);
      throw new Error(reason);
    }
    insist(!body.tx_hash || body.tx_hash === delivery.tx_hash, "Lighter answered another transaction hash");
  }
  /**
   * Signs at most one new fill, and only while no transfer is of unknown outcome: one unresolved
   * nonce at a time, never reused for another fill.
   */
  protected async deliver(quoter: FillSource, due: DeliveryFill[], deliveries: Record<string, LighterDelivery>, log: Log): Promise<boolean> {
    const next = due[0];
    if (!next) return true;
    const { nonce: remote } = await this.get(`nextNonce?account_index=${this.config.account_index}&api_key_index=${this.config.api_key_index}`);
    insist(typeof remote === "number" && Number.isSafeInteger(remote), "Lighter answered no nonce");
    // Lighter's next nonce, or one past the last transfer it may know, whichever is higher.
    const known = Object.values(deliveries).filter(delivery => (delivery.attempted || delivery.sent) && delivery.outcome !== "dropped" && delivery.outcome !== "refused").map(delivery => delivery.nonce + 1);
    const delivery = await this.sign(next, Math.max(remote, ...known));
    deliveries[next.id] = delivery;
    await this.store.save(deliveries);
    try { return await this.settle(quoter, delivery, next, deliveries, log); }
    catch (error) { log(`${next.id}: ${errorText(error)}`); return false; }
  }
  /** Moves one persisted delivery forward; false while its outcome on Lighter is unknown. */
  protected async settle(quoter: FillSource, delivery: LighterDelivery, fill: DeliveryFill | undefined, deliveries: Record<string, LighterDelivery>, log: Log): Promise<boolean> {
    if (!this.awaits(fill) || fill.delivery_hash === delivery.tx_hash) {
      delivery.outcome = fill?.delivery_hash === delivery.tx_hash ? "reported" : "failed";
      await this.store.save(deliveries);
      log(`${delivery.fill_id}: fill no longer awaits this delivery`);
      return true;
    }
    const id = delivery.fill_id;
    if (!this.reportDue(id)) return true;
    // Back off between reads and sends whatever the outcome, failures included.
    if (!this.executed.has(id) && !this.turn(this.readAt, id)) return false;
    let status = this.executed.has(id) ? EXECUTED : await this.status(delivery.tx_hash);
    if (status !== null && !delivery.sent) {
      // Lighter knows it, whatever became of the acknowledgement: its nonce is spent.
      delivery.sent = true;
      await this.store.save(deliveries);
    }
    if (status === null && !delivery.sent) {
      const deadline = fill.deliver_by ? Date.parse(fill.deliver_by) : 0;
      if (deadline - this.now() > SEND_MARGIN_MS) {
        // Recorded before the request: a lost answer never lets these bytes be dropped as unsent.
        const first = !delivery.attempted;
        delivery.attempted = true;
        await this.store.save(deliveries);
        try { await this.send(delivery); }
        catch (error) {
          // Only a first send's refusal is final: after a lost answer, the earlier send may
          // still execute, and the resend's refusal says nothing of it.
          if (!(error instanceof Refused) || !first) throw error;
          // Never executed: the fill is left to its refund rather than signed again.
          delivery.outcome = "refused";
          await this.store.save(deliveries);
          log(`${delivery.fill_id}: ${error.message}`);
          return true;
        }
        delivery.sent = true;
        await this.store.save(deliveries);
        log(`${delivery.fill_id}: transfer ${delivery.tx_hash} sent`);
        status = await this.status(delivery.tx_hash);
      } else if (!delivery.attempted) {
        delivery.outcome = "dropped";
        await this.store.save(deliveries);
        log(`${delivery.fill_id}: too close to the delivery deadline, transfer not sent`);
        return true;
      }
    }
    if (status !== null && status >= EXECUTED && status <= FINAL) {
      this.executed.add(id);
      this.readAt.delete(id);
    }
    if (status === FAILED || status !== null && status > FINAL) {
      // Never executes; Lighter knows it, so its next nonce accounts for it.
      delivery.outcome = "dropped"; await this.store.save(deliveries); log(`${delivery.fill_id}: transfer ${delivery.tx_hash} failed (status ${status})`); return true;
    }
    if (status === null || status < EXECUTED) {
      // Unknown to Lighter, or not executed, past its own expiry: it can no longer execute.
      if (this.now() > delivery.expires_at + 60_000) { delivery.outcome = "dropped"; await this.store.save(deliveries); log(`${delivery.fill_id}: transfer expired without executing (status ${status})`); return true; }
      return false;
    }
    const outcome = await this.report(quoter, id, delivery.tx_hash, log);
    if (outcome) { delivery.outcome = outcome; await this.store.save(deliveries); }
    return true;
  }
}

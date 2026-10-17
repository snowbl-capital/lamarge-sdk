// Shared by deliveries inside a venue: one pass at a time, persisted deliveries settled before new
// fills are signed, stuck pools stop quoting, delivery reports and shutdown draining. The journal's
// storage is the caller's: a file synced on each save, a database.
import { LaMargeError } from "./client.ts";
import type { DeliveryFill } from "./maker.ts";
import { insist } from "./protocol/protocol.ts";

/** The deliveries a deliverer persisted, by fill: read whole, saved whole; nothing is sent before a save resolves, and a failed save sends nothing. */
export type DeliveryJournal<T> = { load: () => Record<string, T> | Promise<Record<string, T>>; save: (deliveries: Record<string, T>) => void | Promise<void> };
/** Where the deliverer reads the identity's fills and reports deliveries: a `Quoter` or its `fillFeed`. */
export interface FillSource {
  fills(): Promise<DeliveryFill[]>;
  deliver(id: string, hash: string): Promise<{ fill: { delivery_hash: string | null; state: string } }>;
}
export type Log = (line: string) => void;
/** Deliveries stuck this long stop the pool's quotes: a new fill could not be delivered. */
const STUCK_MS = 15_000;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
/** The venue answered the send and refused it: these bytes never execute. */
export class Refused extends Error {}

export abstract class VenueDeliverer<D extends { fill_id: string; outcome?: string | undefined }> {
  private running: Promise<void> | null = null;
  private stuckSince: number | null = null;
  /** When each fill's report may be retried. */
  private reportAt = new Map<string, { at: number; wait: number }>();
  /** `sendMargin`: no transfer is first sent closer than this to `deliver_by`. */
  constructor(private venue: string, protected sendMargin: number, protected store: DeliveryJournal<D>, protected now: () => number) {}
  /** Moves one persisted delivery forward; false while its outcome on the venue is unknown. */
  protected abstract settle(quoter: FillSource, delivery: D, fill: DeliveryFill | undefined, deliveries: Record<string, D>, log: Log): Promise<boolean>;
  /** Delivers fills of `due`, the earliest deadline first; false while one's outcome on the venue is unknown. */
  protected abstract deliver(quoter: FillSource, due: DeliveryFill[], deliveries: Record<string, D>, log: Log): Promise<boolean>;
  /** One pass at a time: overlapping calls share the pass in progress. */
  run(quoter: FillSource, log: Log = console.log): Promise<void> {
    this.running ??= this.pass(quoter, log).then(
      progressed => { this.stuckSince = progressed ? null : this.stuckSince ?? this.now(); },
      error => { this.stuckSince ??= this.now(); throw error; },
    ).finally(() => { this.running = null; });
    return this.running;
  }
  /** True while deliveries have been stuck for a while: the pool must stop taking fills. */
  get blocked(): boolean {
    return this.stuckSince !== null && this.now() - this.stuckSince >= STUCK_MS;
  }
  /**
   * Settles persisted deliveries first, then, only if no outcome is unknown, delivers paid fills
   * whose payment the server has re-read. Returns true when the pass left no outcome unknown.
   */
  private async pass(quoter: FillSource, log: Log): Promise<boolean> {
    const deliveries = await this.store.load();
    const fills = (await quoter.fills()).filter(fill => fill.role === "maker" && fill.to_venue === this.venue && fill.delivery_to !== null);
    const byId = new Map(fills.map(fill => [fill.id, fill]));
    let unknown = false;
    for (const delivery of Object.values(deliveries).filter(delivery => !delivery.outcome)) {
      try { unknown = !(await this.settle(quoter, delivery, byId.get(delivery.fill_id), deliveries, log)) || unknown; }
      catch (error) { unknown = true; log(`${delivery.fill_id}: ${errorText(error)}`); }
    }
    if (unknown) return false;
    const due = fills
      .filter(fill => !deliveries[fill.id] && fill.state === "PAID" && fill.maker_leg === "NONE" && !fill.delivery_hash && fill.payment_verified_at && fill.deliver_by && Date.parse(fill.deliver_by) - this.now() > this.sendMargin)
      .sort((a, b) => Date.parse(a.deliver_by ?? "") - Date.parse(b.deliver_by ?? ""));
    return this.deliver(quoter, due, deliveries, log);
  }
  /**
   * Whether the server still accepts a delivery for `fill`: until `report_by`, while the payment
   * is locked, even after the maker leg was abandoned for lack of a report.
   */
  protected awaits(fill: DeliveryFill | undefined): fill is DeliveryFill {
    return fill !== undefined && fill.payment_leg === "LOCKED" && ["NONE", "ABANDONED"].includes(fill.maker_leg)
      && (!fill.report_by || Date.parse(fill.report_by) > this.now());
  }
  /** False while `id` waits for its next try; otherwise schedules the next one with a growing backoff. */
  protected turn(map: Map<string, { at: number; wait: number }>, id: string): boolean {
    const last = map.get(id);
    if (last && last.at > this.now()) return false;
    const wait = Math.min((last?.wait ?? 250) * 2, 5_000);
    map.set(id, { at: this.now() + wait, wait });
    return true;
  }
  /** False while the fill's report waits for its retry. */
  protected reportDue(id: string): boolean {
    const retry = this.reportAt.get(id);
    return !retry || retry.at <= this.now();
  }
  /**
   * Reports `hash` as the fill's delivery. Returns `failed` when the server will never take it,
   * or undefined to retry, less often while the server says the venue does not show it final yet.
   */
  protected async report(quoter: FillSource, id: string, hash: string, log: Log): Promise<"reported" | "failed" | undefined> {
    try {
      const { fill } = await quoter.deliver(id, hash);
      insist(fill.delivery_hash === hash, "The server recorded another delivery");
      this.reportAt.delete(id);
      log(`${id}: delivered, ${fill.state}`);
      return "reported";
    } catch (error) {
      const code = error instanceof LaMargeError ? error.code : undefined;
      const reason = error instanceof LaMargeError ? error.reason : undefined;
      if (code === "VALIDATION_ERROR" || code === "STATE_CONFLICT") {
        // The server will never take this transfer as the delivery: `reason` says why.
        log(`${id}: delivery refused (${String(reason ?? code)}): ${errorText(error)}`);
        return "failed";
      }
      const retry = this.reportAt.get(id);
      const wait = code === "DELIVERY_PENDING" ? Math.min((retry?.wait ?? 500) * 2, 30_000) : 1_000;
      this.reportAt.set(id, { at: this.now() + wait, wait });
      log(`${id}: report pending: ${errorText(error)}`);
      return undefined;
    }
  }
  /** Unsettled deliveries plus fills this bot can still send; a shutdown waits for zero. */
  async outstanding(quoter: FillSource): Promise<number> {
    const open = Object.values(await this.store.load()).filter(delivery => !delivery.outcome).length;
    const fills = (await quoter.fills()).filter(fill => fill.role === "maker" && fill.to_venue === this.venue && fill.maker_leg === "NONE"
      && ["RESERVED", "PAID"].includes(fill.state) && fill.deliver_by && Date.parse(fill.deliver_by) - this.sendMargin > this.now());
    return open + fills.length;
  }
}


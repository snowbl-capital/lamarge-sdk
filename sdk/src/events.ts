import { LaMargeError, wait, type Answer, type Client } from "./client.ts";
import type { components } from "./generated/api.ts";
import { insist } from "./protocol/protocol.ts";

export type EventPage = components["schemas"]["EventPage"];
type Control = components["schemas"]["StreamControl"];
/** `private` snapshots add the signed-in user's or credential's orders, fills and leases. */
export type Snapshot = Answer<"getV1Snapshot"> | Answer<"getV1MeSnapshot">;
export type Change = EventPage | { resync: Snapshot };

/** What the feed needs of a WebSocket: the browser's, Bun's and Node 22's global, or `ws`. */
export type SocketConstructor = new (url: string) => {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  /** `ws` throws an error event nobody listens to; a close follows it anyway. */
  onerror?: (() => void) | null;
  send(data: string): void;
  close(): void;
};

export interface ChangeOptions {
  /** `private`: the signed-in user's or credential's orders, fills, leases, balances and withdrawals. */
  scope: "public" | "private";
  signal: AbortSignal;
  WebSocket?: SocketConstructor | undefined;
}

/** A stream frame, typed like every answer and not validated: a page says what to read again. */
function decode(frame: string): EventPage | Control;
function decode(frame: string): unknown {
  const value: unknown = JSON.parse(frame);
  return value;
}

/**
 * The journal after `after` over the WebSocket stream: each page as the server publishes it, at
 * least every half second, or a control frame. Ends with the connection, or after five seconds
 * without a frame.
 */
async function* stream(client: Client, after: string, scope: "public" | "private", signal: AbortSignal, Socket: SocketConstructor | typeof WebSocket): AsyncGenerator<EventPage | Control> {
  const socket = new Socket(`${client.apiUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/v1/stream`);
  const frames: (string | null)[] = [];
  let wake = () => {};
  const push = (frame: string | null) => { frames.push(frame); wake(); };
  // The token travels in the first frame, never in the URL.
  socket.onopen = () => socket.send(JSON.stringify(scope === "private" ? { token: client.token, after } : { after }));
  socket.onmessage = (event: { data: unknown }) => push(typeof event.data === "string" ? event.data : null);
  socket.onclose = () => push(null);
  socket.onerror = () => {};
  const close = () => socket.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    for (;;) {
      if (!frames.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 5_000); });
        clearTimeout(timer);
      }
      const frame = frames.shift();
      if (frame === undefined || frame === null) return;
      yield decode(frame);
    }
  } finally {
    signal.removeEventListener("abort", close);
    socket.close();
  }
}

/**
 * What changed, durably: a snapshot first, then each page of events after it, pushed over the
 * stream; between connections, HTTP replay catches up from the last page yielded. `{ resync }`
 * replaces all local state. Events say what to read again; they are no settlement ledger.
 */
export async function* changes(client: Client, options: ChangeOptions): AsyncGenerator<Change> {
  const { scope, signal } = options;
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const snapshot = (): Promise<Snapshot> => scope === "private" ? client.call("getV1MeSnapshot", { signal }) : client.call("getV1Snapshot", { signal });
  const replay = (after: string) => scope === "private"
    ? client.call("getV1MeEvents", { query: { after, limit: 500 }, signal })
    : client.call("getV1Events", { query: { after, limit: 500 }, signal });
  const initial = await snapshot();
  let cursor = initial.cursor;
  yield { resync: initial };
  const page = (next: EventPage) => {
    insist(BigInt(next.next_cursor) >= BigInt(cursor), "Event cursor moved backwards");
    cursor = next.next_cursor;
    return next;
  };
  while (!signal.aborted) {
    let resync = false;
    for await (const frame of stream(client, cursor, scope, signal, Socket)) {
      if ("type" in frame) {
        if (frame.type === "authentication_required") throw new LaMargeError(401, "UNAUTHENTICATED", frame.reason);
        resync = frame.type === "resync_required";
        break;
      }
      yield page(frame);
    }
    if (signal.aborted) break;
    try {
      if (resync) throw new LaMargeError(410, "RESYNC_REQUIRED", "The stream asked for a snapshot");
      for (;;) {
        const next = page(await replay(cursor));
        yield next;
        if (!next.has_more) break;
      }
    } catch (error) {
      if (!(error instanceof LaMargeError && error.code === "RESYNC_REQUIRED")) throw error;
      const fresh = await snapshot();
      cursor = fresh.cursor;
      yield { resync: fresh };
    }
    await wait(500, signal).catch(() => undefined);
  }
}

import { expect, test } from "bun:test";
import { createClient } from "./client.ts";
import { changes, type Change } from "./events.ts";

const page = (next: string, more = false) => ({ events: [], next_cursor: next, has_more: more, oldest_cursor: "0", server_time: "2026-10-17T00:00:00Z" });

test("a private feed sends its token in the first frame, follows the stream, then catches up over HTTP", async () => {
  const sent: unknown[] = [];
  const urls: string[] = [];
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      urls.push(url);
      queueMicrotask(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify(page("5")) });
        this.onclose?.();
      });
    }
    send(data: string) { sent.push(JSON.parse(data)); }
    close() { this.onclose?.(); }
  }
  const fetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/me/snapshot") return Response.json({ cursor: "3", orders: [], fills: [] });
    expect(url.pathname).toBe("/v1/me/events");
    expect(url.searchParams.get("after")).toBe("5");
    return Response.json(page("9"));
  }, { preconnect: globalThis.fetch.preconnect });
  const client = createClient({ apiUrl: "http://localhost:8080", fetch, token: "mk_scoped" });
  const controller = new AbortController();
  const seen: Change[] = [];
  for await (const change of changes(client, { scope: "private", signal: controller.signal, WebSocket: Socket })) {
    seen.push(change);
    if (seen.length === 3) controller.abort();
  }
  expect(seen.map(change => "resync" in change ? `resync ${change.resync.cursor}` : change.next_cursor)).toEqual(["resync 3", "5", "9"]);
  expect(urls).toEqual(["ws://localhost:8080/v1/stream"]);
  expect(sent).toEqual([{ token: "mk_scoped", after: "3" }]);
});

test("a page behind the cursor stops the feed", async () => {
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor() { queueMicrotask(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify(page("1")) }); }); }
    send() {}
    close() { this.onclose?.(); }
  }
  const fetch = Object.assign(async () => Response.json({ cursor: "3", books: [] }), { preconnect: globalThis.fetch.preconnect });
  const feed = changes(createClient({ apiUrl: "http://localhost:8080", fetch }), { scope: "public", signal: new AbortController().signal, WebSocket: Socket });
  await feed.next();
  await expect(feed.next()).rejects.toThrow("cursor moved backwards");
});

test("a refused connection ends the stream without the unhandled error `ws` raises", async () => {
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      queueMicrotask(() => {
        if (!this.onerror) throw new Error("Unhandled error event");
        this.onerror();
        this.onclose?.();
      });
    }
    send() {}
    close() { this.onclose?.(); }
  }
  const fetch = Object.assign(async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/v1/snapshot"
    ? Response.json({ cursor: "3", books: [] }) : Response.json(page("4")), { preconnect: globalThis.fetch.preconnect });
  const controller = new AbortController();
  const seen: Change[] = [];
  for await (const change of changes(createClient({ apiUrl: "http://localhost:8080", fetch }), { scope: "public", signal: controller.signal, WebSocket: Socket })) {
    seen.push(change);
    if (seen.length === 2) controller.abort();
  }
  expect(seen.map(change => "resync" in change ? `resync ${change.resync.cursor}` : change.next_cursor)).toEqual(["resync 3", "4"]);
});


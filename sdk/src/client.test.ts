import { expect, test } from "bun:test";
import { createClient, exchange, LaMargeError, type CallArguments } from "./client.ts";

const send = async (...args: Parameters<typeof exchange>) => (await exchange(...args)).body;
import { CHAINS } from "./protocol/protocol.ts";
import { signIn } from "./session.ts";

const answering = (...answers: (() => Response)[]) => {
  const seen: Request[] = [];
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    const next = answers.shift();
    if (!next) throw new Error("No more answers");
    return next();
  }, { preconnect: globalThis.fetch.preconnect });
  return { fetch, seen };
};

test("a refusal keeps its code, reason, correlation, retry hint and setup step", async () => {
  const { fetch } = answering(() => Response.json({ error: {
    code: "SETUP_REQUIRED", message: "wording may change", reason: "permit", request_id: "request-1", retryable: false, venue: "polymarket", step: "permit",
  } }, { status: 409, headers: { "retry-after": "2" } }));
  const error = await send({ apiUrl: "http://localhost:8080", fetch }, { method: "GET", path: "/v1/me" }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(LaMargeError);
  expect(error).toMatchObject({ status: 409, code: "SETUP_REQUIRED", reason: "permit", requestId: "request-1", retryable: false, retryAfterMs: 2000, venue: "polymarket", step: "permit" });
});

test("an answer without the error envelope is UNKNOWN, with the server's request id", async () => {
  const { fetch } = answering(() => new Response("bad gateway", { status: 502, headers: { "x-request-id": "edge-1" } }));
  await expect(send({ apiUrl: "http://localhost:8080", fetch }, { method: "GET", path: "/v1/me" })).rejects.toMatchObject({ code: "UNKNOWN", requestId: "edge-1" });
});

test("only a request marked retryable is repeated, with the identical body", async () => {
  const busy = () => Response.json({ error: { code: "RATE_LIMITED", message: "", request_id: "r", retryable: true } }, { status: 429, headers: { "retry-after": "0" } });
  const once = answering(busy);
  await expect(send({ apiUrl: "http://localhost:8080", fetch: once.fetch }, { method: "POST", path: "/v1/quotes/batch", body: { cancels: ["a"] } })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(once.seen).toHaveLength(1);
  const retried = answering(busy, () => Response.json({ ok: true }));
  expect(await send({ apiUrl: "http://localhost:8080", fetch: retried.fetch }, { method: "POST", path: "/v1/fills/{id}/delivery", params: { id: "f/1" }, body: { tx_hash: "0x1" }, retry: true })).toEqual({ ok: true });
  expect(retried.seen.map(request => request.url)).toEqual(["http://localhost:8080/v1/fills/f%2F1/delivery", "http://localhost:8080/v1/fills/f%2F1/delivery"]);
  expect(await Promise.all(retried.seen.map(request => request.text()))).toEqual(['{"tx_hash":"0x1"}', '{"tx_hash":"0x1"}']);
});

test("a client refusal is never retried", async () => {
  const { fetch, seen } = answering(() => Response.json({ error: { code: "VALIDATION_ERROR", message: "", request_id: "r", retryable: false } }, { status: 400 }));
  await expect(send({ apiUrl: "http://localhost:8080", fetch }, { method: "GET", path: "/v1/orders", retry: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(seen).toHaveLength(1);
});

test("the client refuses plain HTTP outside localhost and carries its token", async () => {
  expect(() => createClient({ apiUrl: "http://api.lamarge.trade" })).toThrow("HTTPS");
  const { fetch, seen } = answering(() => Response.json({ status: "degraded", ready: false }, { status: 503 }));
  const client = createClient({ apiUrl: "http://localhost:8080", fetch, token: "mk_scoped" });
  expect(await client.call("getHealth")).toMatchObject({ ready: false });
  expect(seen[0]?.headers.get("authorization")).toBe("Bearer mk_scoped");
});

const venues = () => Response.json(Object.entries(CHAINS).map(([id, chain]) => ({ id, chain: { id: chain.id, token: chain.token, decimals: chain.decimals, escrow: chain.escrow } })));
const signer = { address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" as const, signMessage: async () => { signed++; return "0x00" as const; } };
let signed = 0;

test("sign-in checks the deployment before signing anything", async () => {
  signed = 0;
  // The challenge is asked while the deployment is read; the deployment decides first.
  const { fetch } = answering(() => Response.json({ message: "", nonce: "n1", expires_at: "" }), () => Response.json([{ id: "polymarket", chain: { ...CHAINS.polymarket, escrow: "0x0000000000000000000000000000000000000001" } }]));
  await expect(signIn(createClient({ apiUrl: "http://localhost:8080", fetch }), signer, "http://localhost:5173")).rejects.toThrow("reviewed deployment");
  expect(signed).toBe(0);
});

test("sign-in refuses a challenge for another origin, then signs only the expected one", async () => {
  signed = 0;
  const issued = new Date();
  const expires = new Date(issued.getTime() + 300_000).toISOString();
  const message = (host: string) => [`${host} wants you to sign in with your Ethereum account:`, signer.address, "", "Sign in to LaMarge.", "", `URI: http://${host}`, "Version: 1", "Chain ID: 1", "Nonce: n1", `Issued At: ${issued.toISOString()}`, `Expiration Time: ${expires}`].join("\n");
  const phishing = answering(() => Response.json({ message: message("evil.example"), nonce: "n1", expires_at: expires }), venues);
  await expect(signIn(createClient({ apiUrl: "http://localhost:8080", fetch: phishing.fetch }), signer, "http://localhost:5173")).rejects.toThrow("sign-in challenge");
  expect(signed).toBe(0);
  const genuine = answering(() => Response.json({ message: message("localhost:5173"), nonce: "n1", expires_at: expires }), venues, () => Response.json({ token: "session", session_id: "s1" }));
  const client = createClient({ apiUrl: "http://localhost:8080", fetch: genuine.fetch });
  expect(await signIn(client, signer, "http://localhost:5173")).toMatchObject({ session_id: "s1" });
  expect(signed).toBe(1);
  expect(client.token).toBe("session");
});

/** True when the operation can be called without options; checked by the compiler. */
type Optional<A extends unknown[]> = [] extends A ? true : false;
test("options are required exactly when the operation has a path, a required query or a body", () => {
  const order: Optional<CallArguments<"getOrder">> = false;
  const takes: Optional<CallArguments<"postTake">> = false;
  const balances: Optional<CallArguments<"getBalances">> = true;
  expect([order, takes, balances]).toEqual([false, false, true]);
});

test("cancelling stops a retry's wait at once", async () => {
  const { fetch } = answering(() => Response.json({ error: { code: "RATE_LIMITED", message: "", request_id: "r", retryable: true } }, { status: 429, headers: { "retry-after": "60" } }));
  const controller = new AbortController();
  const pending = send({ apiUrl: "http://localhost:8080", fetch }, { method: "GET", path: "/v1/orders", retry: true, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  await expect(pending).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(5_000);
});

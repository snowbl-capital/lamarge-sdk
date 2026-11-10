import { createClient } from "./client.ts";
import { WALLET_FEE_ON_PAYMENT } from "./protocol/fees.ts";
import { record } from "./protocol/validation.ts";

/** A third party's address a wallet delivery goes to, and a wallet take's swap id, fee zero. */
export const bybit = `0x${"55".repeat(20)}`, walletId = `${WALLET_FEE_ON_PAYMENT}${"00".repeat(10)}${"cc".repeat(16)}`;

const API = "http://localhost:8080";
/** A mocked route's answer: a Response as is, null as a 204, anything else as JSON. */
export type Handler = (body: Record<string, unknown>, query: URLSearchParams) => unknown;

export const apiError = (status: number, code: string, message = code, extra: Record<string, unknown> = {}) =>
  Response.json({ error: { code, message, request_id: "r", retryable: false, ...extra } }, { status });

/**
 * A client of an API answering `routes`, keyed `METHOD /path`, then `fallback`; any other route is a 404. Lighter's
 * reads go through it too. `calls` lists the API's own routes in order, `bodies` what each was sent.
 */
export function mockApi(routes: Record<string, Handler>, fallback: (route: string) => Handler | undefined = () => undefined) {
  const calls: string[] = [], bodies: Record<string, Record<string, unknown>[]> = {};
  const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url), route = `${request.method} ${url.pathname}`;
    if (url.origin === API) calls.push(route);
    const body = record(await request.json().catch(() => ({})));
    (bodies[route] ??= []).push(body);
    const handler = routes[route] ?? fallback(route);
    const answer = handler ? await handler(body, url.searchParams) : apiError(404, "NOT_FOUND", route);
    return answer instanceof Response ? answer : answer === null ? new Response(null, { status: 204 }) : Response.json(answer);
  }, { preconnect: globalThis.fetch.preconnect });
  return { client: createClient({ apiUrl: API, fetch }), calls, bodies };
}

/** A signer counting its typed-data signatures, by primary type; it refuses those `decline` names. */
export function countingSigner(address: `0x${string}`, decline: (type: string) => boolean = () => false) {
  const signer = { address, signed: 0, kinds: [] as string[], signMessage: async () => "0x00" as const, signTypedData: async ({ primaryType }: { primaryType: string }) => {
    if (decline(primaryType)) throw new Error("User rejected the request");
    signer.signed++;
    signer.kinds.push(primaryType);
    return "0x00" as const;
  } };
  return signer;
}

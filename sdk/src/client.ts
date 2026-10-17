import { routes, type operations } from "./generated/api.ts";
import { isRecord, required } from "./protocol/validation.ts";
import { retryAfterMs } from "./retry-after.ts";

/** An API refusal or an unusable answer. `code` and `reason` are stable; `message` is for people. */
export class LaMargeError extends Error {
  override readonly name = "LaMargeError";
  readonly requestId: string | undefined;
  readonly retryable: boolean | undefined;
  readonly retryAfterMs: number | undefined;
  readonly reason: string | undefined;
  /** With `SETUP_REQUIRED`: the venue and the setup step to do first. */
  readonly venue: string | undefined;
  readonly step: string | undefined;
  constructor(readonly status: number, readonly code: string, message: string, details: {
    requestId?: string | undefined; retryable?: boolean | undefined; retryAfterMs?: number | undefined;
    reason?: string | undefined; venue?: string | undefined; step?: string | undefined;
  } = {}) {
    super(message);
    this.requestId = details.requestId;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.reason = details.reason;
    this.venue = details.venue;
    this.step = details.step;
  }
}

export interface Request {
  method: string;
  /** Path template, such as `/v1/takes/{id}`. */
  path: string;
  params?: Record<string, string | number> | undefined;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: unknown;
  token?: string | null | undefined;
  signal?: AbortSignal | undefined;
  /** Retry a 429, a 5xx or a network failure with the identical request, at most twice. Only for an
   * operation that repeating cannot change: a read, or an exact replay of a client id or signed operation. */
  retry?: boolean | undefined;
  /** Statuses whose JSON body is the answer, as `/health`'s 503 while it is not ready. */
  accept?: readonly number[] | undefined;
}

export interface Transport {
  apiUrl: string;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

const text = (value: unknown) => typeof value === "string" ? value : undefined;

function refusal(status: number, raw: unknown, headers: Headers): LaMargeError {
  const error = isRecord(raw) && isRecord(raw.error) ? raw.error : undefined;
  const code = text(error?.code);
  const message = text(error?.message);
  return new LaMargeError(status, code && message !== undefined ? code : "UNKNOWN", code && message !== undefined ? message : `HTTP ${status}`, {
    requestId: text(error?.request_id) ?? headers.get("x-request-id") ?? undefined,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
    retryAfterMs: retryAfterMs(headers.get("retry-after")),
    reason: text(error?.reason),
    venue: text(error?.venue),
    step: text(error?.step),
  });
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** One HTTP exchange with the API: the answer's status and decoded JSON, or a `LaMargeError`. */
export async function exchange(transport: Transport, request: Request): Promise<{ status: number; body: unknown }> {
  const path = request.path.replace(/\{([^}]+)\}/g, (_match: string, key: string) => encodeURIComponent(required(request.params?.[key], `Missing path parameter ${key}`)));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) query.set(key, String(value));
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.token) headers.authorization = `Bearer ${request.token}`;
  const url = `${transport.apiUrl.replace(/\/+$/, "")}${path}${query.size ? `?${query}` : ""}`;
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  const timeoutMs = transport.timeoutMs ?? 30_000;
  for (let attempt = 0; ; attempt++) {
    request.signal?.throwIfAborted();
    try {
      const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const response = await (transport.fetch ?? globalThis.fetch)(url, { method: request.method, headers, signal, ...(body === undefined ? {} : { body }) });
      const raw: unknown = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok && !request.accept?.includes(response.status)) throw refusal(response.status, raw, response.headers);
      return { status: response.status, body: raw };
    } catch (error) {
      request.signal?.throwIfAborted();
      // The server says what may be retried; an answer without its envelope, from a proxy, only for a 429 or 5xx.
      const transient = !(error instanceof LaMargeError) || (error.retryable ?? (error.status === 429 || error.status >= 500));
      if (!request.retry || attempt >= 2 || !transient) throw error;
      const delay = error instanceof LaMargeError && error.retryAfterMs !== undefined ? error.retryAfterMs : 250 * 2 ** attempt;
      await wait(delay, request.signal);
    }
  }
}

/** An operation's path and query parameters, and its body, as a generated `operations` entry types them. */
export type OperationInput<Op> = (Op extends { parameters: infer P } ? Pick<P, Extract<keyof P, "path" | "query">> : never)
  & (Op extends { requestBody: { content: { "application/json": infer B } } } ? { body: B } : { body?: never });
type SuccessBody<R> = R extends { content: { "application/json": infer B } } ? B : null;
/** An operation's success answer, as a generated `operations` entry types it. */
export type OperationAnswer<Op> = Op extends { responses: infer R } ? SuccessBody<R[Extract<keyof R, 200 | 201 | 202 | 204>]> : never;
export type Answer<O extends keyof operations> = OperationAnswer<operations[O]>;
export type CallOptions<O extends keyof operations> = OperationInput<operations[O]> & {
  signal?: AbortSignal | undefined;
  retry?: boolean | undefined;
};

/** The options, required when the operation has a path parameter, a required query or a body. */
export type CallArguments<O extends keyof operations> = object extends CallOptions<O> ? [options?: CallOptions<O>] : [options: CallOptions<O>];

export interface ClientConfig extends Transport {
  /** A session token or a maker credential (`mk_…`). */
  token?: string | undefined;
}

export interface Client {
  readonly apiUrl: string;
  token: string | undefined;
  /** Any public operation by its `operationId`, typed by the API reference. Answers are typed, not validated:
   * what gets signed is checked by `@lamarge/sdk/protocol`. */
  call<O extends keyof operations>(operation: O, ...options: CallArguments<O>): Promise<Answer<O>>;
}

interface RawOptions {
  path?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  retry?: boolean | undefined;
}

export function createClient(config: ClientConfig): Client {
  const url = new URL(config.apiUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Use HTTPS outside localhost");
  function call<O extends keyof operations>(operation: O, ...options: CallArguments<O>): Promise<Answer<O>>;
  async function call(operation: keyof operations, options: RawOptions = {}): Promise<unknown> {
    const route: { path: string; method: string; accept?: readonly number[] } = routes[operation];
    const answer = await exchange(config, {
      method: route.method, path: route.path, params: options.path, query: options.query, body: options.body, token: client.token,
      signal: options.signal, retry: options.retry ?? route.method === "GET", accept: route.accept,
    });
    return answer.body;
  }
  const client: Client = { apiUrl: config.apiUrl, token: config.token, call };
  return client;
}

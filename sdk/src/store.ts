import type { Typed } from "./protocol/protocol.ts";
import { array, hex, isRecord, record } from "./protocol/validation.ts";
import type { SignedItem } from "./signer.ts";

/**
 * Where a flow keeps what it signed until the server has it: a restart then submits the same bytes
 * instead of signing again. Persist it (a file, a database) wherever a process can stop mid-flow.
 * One process writes a store: calls in that process are serialized per operation, another
 * process sharing it would sign apart.
 */
export interface SignatureStore {
  load(key: string): unknown | Promise<unknown>;
  save(key: string, value: unknown): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** The same JSON whatever its keys' order: what a request is, to compare it with the one signed. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, field: unknown) => isRecord(field) ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a < b ? -1 : 1)) : field);

/** A stored bundle of signed items, read back as such or refused. */
export function signedItems(value: unknown): SignedItem[] | undefined {
  if (value === undefined) return undefined;
  return array(value).map(entry => {
    const item = record(entry);
    return { kind: String(item.kind), ...(typeof item.fill_id === "string" ? { fill_id: item.fill_id } : {}), signature: hex(item.signature) };
  });
}

/** Typed data read back from a store, in the shape the checks take; the checks still decide whether it may be submitted. */
export function typedData(value: unknown): Typed {
  const typed = record(value);
  const domain = record(typed.domain);
  if (typeof typed.primaryType !== "string" || typeof domain.name !== "string" || typeof domain.chainId !== "number" || typeof domain.verifyingContract !== "string") throw new Error("Unreadable typed data");
  const types = Object.fromEntries(Object.entries(record(typed.types)).map(([name, fields]) => [name, array(fields).map(field => {
    const { name: key, type } = record(field);
    if (typeof key !== "string" || typeof type !== "string") throw new Error("Unreadable typed data");
    return { name: key, type };
  })]));
  return { types, primaryType: typed.primaryType, message: record(typed.message),
    domain: { name: domain.name, chainId: domain.chainId, verifyingContract: domain.verifyingContract, ...(typeof domain.version === "string" ? { version: domain.version } : {}) } };
}

/** Lost with the process: enough for one run, not for recovery after a restart. */
export function memoryStore(): SignatureStore {
  const values = new Map<string, unknown>();
  return { load: key => values.get(key), save: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); } };
}

const running = new WeakMap<SignatureStore, Map<string, Promise<unknown>>>();

/** Runs `run` alone among this process's calls on `store` for `key`: a second call waits, then reads what the first stored. */
export async function exclusive<T>(store: SignatureStore, key: string, run: () => Promise<T>): Promise<T> {
  const queue = running.get(store) ?? new Map<string, Promise<unknown>>();
  running.set(store, queue);
  const previous = queue.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  queue.set(key, current);
  try { return await current; } finally { if (queue.get(key) === current) queue.delete(key); }
}

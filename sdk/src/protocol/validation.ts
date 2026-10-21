declare const verifiedIntent: unique symbol;
export type Verified<T> = T & { readonly [verifiedIntent]: true };

export function required<T>(value: T | null | undefined, message = "Required value is missing"): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected an object");
  return value;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected an array");
  return value;
}

export function address(value: unknown): `0x${string}` {
  if (!isAddress(value)) throw new Error("Invalid EVM address");
  return value;
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function hex(value: unknown): `0x${string}` {
  if (!isHex(value)) throw new Error("Invalid hexadecimal bytes");
  return value;
}

export function isHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

import { requireSigningDomains, type DeploymentManifest, ESCROW_DEPLOYMENTS } from "./protocol/deployments.ts";
import { convert, insist, same, type SignItem, type TransferTyped } from "./protocol/protocol.ts";
import { address, record } from "./protocol/validation.ts";
import type { Answer } from "./client.ts";
import type { components } from "./generated/api.ts";

export type Hex = `0x${string}`;
export interface TypedDataRequest {
  domain: { name: string; version?: string; chainId: number; verifyingContract?: Hex };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Whatever holds the key: a viem `LocalAccount` (a private key, or KMS through `toAccount`) fits as
 * is; a browser wallet wraps its client. The SDK hands it only data its checks already accepted.
 */
export interface Signer {
  readonly address: Hex;
  signMessage(request: { message: string }): Promise<Hex>;
  signTypedData(request: TypedDataRequest): Promise<Hex>;
}
/** A quote key that may sign elsewhere (`Quoter.prepareLines`). */
export type QuoteSigner = Pick<Signer, "address"> & Partial<Pick<Signer, "signTypedData">>;

/** Wallet payload: omit EIP712Domain from types and Polymarket op metadata; include a contract only when the domain has one. */
export function typedDataRequest(typed: TransferTyped): TypedDataRequest {
  const { EIP712Domain: _, ...types } = typed.types;
  const { domain } = typed;
  return {
    domain: "verifyingContract" in domain ? { ...domain, verifyingContract: address(domain.verifyingContract) } : domain,
    types,
    primaryType: typed.primaryType,
    message: record(convert(types, typed.primaryType, typed.message)),
  };
}

export async function signTyped(signer: Partial<Pick<Signer, "signTypedData">>, typed: TransferTyped): Promise<Hex> {
  insist(signer.signTypedData, "This signer cannot sign typed data");
  return signer.signTypedData(typedDataRequest(typed));
}

/**
 * Called after validation, before new signatures; throwing aborts signing. Stored signatures bypass it.
 * Grouped routes are shown whole first, then each unsigned request with `route: true`.
 */
export type Signing =
  | { kind: "take"; input: components["schemas"]["TakeInput"]; prepared: Answer<"postTake">; route?: true }
  /** `move`: a received transfer's move from the perps to the signer's own trade.xyz. */
  | { kind: "withdrawal"; venue: string; destination: string; amount: bigint; typed: TransferTyped; route?: true; move?: true }
  | { kind: "setup"; venue: string; step: Answer<"postVenueSetupStep"> }
  /** `signed`: what a resumed route already signed, never asked again. */
  | { kind: "route"; preparation: Answer<"prepareGroupedRoute">; second: Answer<"getTransfer">; signed: { first: boolean; withdrawal: boolean; second: boolean } };
export type BeforeSigning = (signing: Signing) => void | Promise<void>;

export interface SignedItem { kind: string; fill_id?: string; signature: Hex }

export const signedItem = (item: { kind: string; fill_id?: string | undefined }, signature: Hex): SignedItem =>
  ({ kind: item.kind, ...(item.fill_id === undefined ? {} : { fill_id: item.fill_id }), signature });

/** A checked bundle, signed item by item once every domain is a pinned deployment. */
export async function signItems(signer: QuoteSigner, items: readonly SignItem[], manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): Promise<SignedItem[]> {
  requireSigningDomains(items, manifest);
  insist(items.every(item => same(item.signer, signer.address)), "This key cannot sign for a different linked account");
  insist(signer.signTypedData, "Prepare unsigned and submit the collected contract signature");
  const signed: SignedItem[] = [];
  for (const item of items) signed.push(signedItem(item, await signTyped(signer, item.typed_data)));
  return signed;
}

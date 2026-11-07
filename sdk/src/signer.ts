import { requireSigningDomains, type DeploymentManifest, ESCROW_DEPLOYMENTS } from "./protocol/deployments.ts";
import { convert, insist, same, type SignItem, type TransferTyped } from "./protocol/protocol.ts";
import { address, isRecord, record } from "./protocol/validation.ts";
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
 * What comes with a request LaMarge asks to sign: its `attestation`, for a signer that holds the key apart from the
 * app, which checks it with `verifyAttestation` from `@lamarge/sdk/attestation` before signing.
 */
export interface SignContext { attestation?: components["schemas"]["TakeAttestation"] | components["schemas"]["SetupAttestation"] }

/**
 * Whatever holds the key: a viem `LocalAccount` (a private key, or KMS through `toAccount`) fits as
 * is, except to pay from GMX, which takes `sendTransaction`; a browser wallet wraps its client. The SDK
 * hands it only data its checks already accepted.
 */
export interface Signer {
  readonly address: Hex;
  signMessage(request: { message: string }, context?: SignContext): Promise<Hex>;
  signTypedData(request: TypedDataRequest, context?: SignContext): Promise<Hex>;
  /**
   * Sends a transaction from `address`: calls `sent` with its hash once broadcast, then resolves with it once mined
   * successfully, rejecting if it is refused or reverts. Only a transfer paying from GMX needs it: GMX Account funds
   * leave by their owner's own `transferOut`.
   */
  sendTransaction?(request: { chainId: number; to: Hex; data: Hex }, sent?: (hash: Hex) => void | Promise<void>): Promise<Hex>;
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

export async function signTyped(signer: Partial<Pick<Signer, "signTypedData">>, typed: TransferTyped, context?: SignContext): Promise<Hex> {
  insist(signer.signTypedData, "This signer cannot sign typed data");
  return context?.attestation ? signer.signTypedData(typedDataRequest(typed), context) : signer.signTypedData(typedDataRequest(typed));
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
  /** A transaction, not a signature: GMX Account funds to the signer's own address on Arbitrum. */
  | { kind: "transfer_out"; venue: "gmx"; amount: bigint }
  /** `signed`: what a resumed route already signed, never asked again. */
  | { kind: "route"; preparation: Answer<"prepareGroupedRoute">; second: Answer<"getTransfer">; signed: { first: boolean; withdrawal: boolean; second: boolean } };
export type BeforeSigning = (signing: Signing) => void | Promise<void>;

/** An item's attestation, when it carries one, to hand the signer. */
export const attested = (item: object): SignContext | undefined => {
  const attestation = "attestation" in item ? item.attestation : undefined;
  return isProof(attestation) ? { attestation } : undefined;
};
const isProof = (value: unknown): value is NonNullable<SignContext["attestation"]> => isRecord(value) && typeof value.signature === "string";

/** An item as recovery compares it: its request, never its attestation, whose bytes change whenever LaMarge signs it again. */
export const withoutAttestation = (items: unknown): unknown =>
  Array.isArray(items) ? items.map((item: unknown) => isRecord(item) ? (({ attestation: _, ...rest }) => rest)(item) : item) : items;

export interface SignedItem { kind: string; fill_id?: string; signature: Hex }

export const signedItem = (item: { kind: string; fill_id?: string | undefined }, signature: Hex): SignedItem =>
  ({ kind: item.kind, ...(item.fill_id === undefined ? {} : { fill_id: item.fill_id }), signature });

/** A checked bundle, signed item by item once every domain is a pinned deployment. */
export async function signItems(signer: QuoteSigner, items: readonly SignItem[], manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): Promise<SignedItem[]> {
  requireSigningDomains(items, manifest);
  insist(items.every(item => same(item.signer, signer.address)), "This key cannot sign for a different linked account");
  insist(signer.signTypedData, "Prepare unsigned and submit the collected contract signature");
  const signed: SignedItem[] = [];
  for (const item of items) signed.push(signedItem(item, await signTyped(signer, item.typed_data, attested(item))));
  return signed;
}

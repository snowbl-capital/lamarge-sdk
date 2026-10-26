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
  /** Optional for a quote key that signs elsewhere (`Quoter.prepareLinesUnsigned`). */
  signTypedData?(request: TypedDataRequest): Promise<Hex>;
}

/**
 * `typed` as the API sends it, in the form wallets sign: the domain's type implied, values
 * converted, a contract only where the domain has one, and nothing else (a Polymarket `op` stays
 * out of the wallet's request).
 */
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

export async function signTyped(signer: Pick<Signer, "signTypedData">, typed: TransferTyped): Promise<Hex> {
  insist(signer.signTypedData, "This signer cannot sign typed data");
  return signer.signTypedData(typedDataRequest(typed));
}

/**
 * What a flow is about to sign for the first time, once its own checks passed: a take's payment,
 * a venue withdrawal or a setup step. The caller's checks run on it, and one that throws signs
 * nothing. A stored signature submitted again runs none. A route signed at once is shown whole
 * (`route`: its two takes, and the second transfer with its withdrawal) before any of its requests
 * still to sign, then each request as any other, marked `route`.
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
export async function signItems(signer: Pick<Signer, "address" | "signTypedData">, items: readonly SignItem[], manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): Promise<SignedItem[]> {
  requireSigningDomains(items, manifest);
  insist(items.every(item => same(item.signer, signer.address)), "This key cannot sign for a different linked account");
  insist(signer.signTypedData, "Prepare unsigned and submit the collected contract signature");
  const signed: SignedItem[] = [];
  for (const item of items) signed.push(signedItem(item, await signTyped(signer, item.typed_data)));
  return signed;
}

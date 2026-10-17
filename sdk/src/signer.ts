import { requireSigningDomains, type DeploymentManifest, ESCROW_DEPLOYMENTS } from "./protocol/deployments.ts";
import { convert, insist, same, type SignItem, type Typed } from "./protocol/protocol.ts";
import { address, record } from "./protocol/validation.ts";

export type Hex = `0x${string}`;
export interface TypedDataRequest {
  domain: { name: string; version?: string; chainId: number; verifyingContract: Hex };
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
  /** Optional for a contract quote delegate (ERC-1271), whose signature is collected elsewhere. */
  signTypedData?(request: TypedDataRequest): Promise<Hex>;
}

/** `typed` as the API sends it, in the form wallets sign: the domain's type implied, values converted. */
export function typedDataRequest(typed: Typed): TypedDataRequest {
  const { EIP712Domain: _, ...types } = typed.types;
  return {
    domain: { ...typed.domain, verifyingContract: address(typed.domain.verifyingContract) },
    types,
    primaryType: typed.primaryType,
    message: record(convert(types, typed.primaryType, typed.message)),
  };
}

export async function signTyped(signer: Pick<Signer, "signTypedData">, typed: Typed): Promise<Hex> {
  insist(signer.signTypedData, "This signer cannot sign typed data");
  return signer.signTypedData(typedDataRequest(typed));
}

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

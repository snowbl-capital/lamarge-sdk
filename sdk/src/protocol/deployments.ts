/** Addresses identify reviewed UUPS proxies, never implementations or values supplied by the API. */
export type EscrowDeployment = Readonly<{ version: 5; chainId: number; address: string; environment?: "production" | "development" }>;
export type DeploymentManifest = readonly EscrowDeployment[];

/**
 * Reviewed deployments of every active environment, one proxy per chain each
 * (contracts/README.md#deployments). Environments share none: a deployment's own are its venues'
 * `chain.escrow` (`getVenues`), each one of these.
 */
export const ESCROW_DEPLOYMENTS: DeploymentManifest = Object.freeze([
  { version: 5, chainId: 999, address: "0x3100b7b49c0f9631c6af25877b5a4e13a47afad6", environment: "production" },
  { version: 5, chainId: 137, address: "0x3100b7b49c0f9631c6af25877b5a4e13a47afad6", environment: "production" },
  { version: 5, chainId: 999, address: "0x948e65c40442d935d4ee990bdbd01bdd825c4873", environment: "development" },
  { version: 5, chainId: 137, address: "0xa3fca394739ec4b984e908bd7a3c3b72d0ed77d1", environment: "development" },
]);

/** Retired v5 proxies are trusted for existing proofs, never new signatures. */
export const RETIRED_V5_DEPLOYMENTS = Object.freeze([
  { version: 5, chainId: 56, address: "0x3100b7b49c0f9631c6af25877b5a4e13a47afad6" },
  { version: 5, chainId: 999, address: "0xea5ba9e1c0f5dde572bc08f3af6a3e8b9db73734" },
  { version: 5, chainId: 137, address: "0xea5ba9e1c0f5dde572bc08f3af6a3e8b9db73734" },
  { version: 5, chainId: 56, address: "0xea5ba9e1c0f5dde572bc08f3af6a3e8b9db73734" },
] as const);

export const ESCROW_PROOF_DEPLOYMENTS: DeploymentManifest = Object.freeze([...ESCROW_DEPLOYMENTS, ...RETIRED_V5_DEPLOYMENTS]);

export function escrowDeployment(chainId: number, address: string, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): EscrowDeployment | undefined {
  return manifest.find(deployment => deployment.chainId === chainId && deployment.address.toLowerCase() === address.toLowerCase());
}

/** Never derive or fund a receiver against an unpinned escrow, even if the API names it. */
export function requireV5Deployment(chainId: number, address: string, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): EscrowDeployment {
  const deployment = escrowDeployment(chainId, address, manifest);
  if (deployment?.version !== 5) throw new Error("The balance upgrade is not available on this venue yet");
  return deployment;
}

/** Signing domains of venues without escrow: Lighter's L2 chain id and zkLighter contract, BSC and Aster's vault. Quote sets of inventory held there are signed in them; nothing is ever sent to them. */
export const VENUE_DOMAINS = Object.freeze([
  { venue: "lighter", chainId: 304, address: "0x3b4d794a66304f130a4db8f2551b0070dfcf5ca7" },
  { venue: "aster", chainId: 56, address: "0x128463a60784c4d3f46c23af3f65ed859ba87974" },
] as const);

/** A quote set's domain: a reviewed escrow, or a pinned venue domain. */
export function requireSigningDomain(chainId: number, address: string, manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): void {
  if (VENUE_DOMAINS.some(domain => domain.chainId === chainId && domain.address === address.toLowerCase())) return;
  requireV5Deployment(chainId, address, manifest);
}

/** A whole bundle is checked before its first prompt: each quote set's domain, and each funding or payment's escrow. */
export function requireSigningDomains(items: readonly { kind: string; typed_data: { domain: { chainId: number; verifyingContract: string } } }[], manifest: DeploymentManifest = ESCROW_DEPLOYMENTS): void {
  for (const { kind, typed_data: { domain } } of items) {
    if (kind === "quote_set") requireSigningDomain(domain.chainId, domain.verifyingContract, manifest);
    else if (kind === "fund" || kind === "pay_take") requireV5Deployment(domain.chainId, domain.verifyingContract, manifest);
  }
}

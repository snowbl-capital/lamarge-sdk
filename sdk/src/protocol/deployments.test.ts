import { expect, test } from "bun:test";
import { CHAINS, checkEscrowTyped, checkRegistry, EIP712Domain, ESCROW, ESCROW_DEPLOYMENTS, ESCROW_PROOF_DEPLOYMENTS, isPinnedEscrow, RETIRED_V5_DEPLOYMENTS, schemas, VENUE_DOMAINS, escrowDeployment, requireSigningDomains, requireV5Deployment, type DeploymentManifest, required, type Typed } from "./index.ts";

test("only the reviewed proxy permits balances and deposit receivers", () => {
  expect(new Set(ESCROW_DEPLOYMENTS.map(deployment => deployment.chainId))).toEqual(new Set([999, 137]));
  for (const deployment of ESCROW_DEPLOYMENTS) expect(requireV5Deployment(deployment.chainId, deployment.address).version).toBe(5);
  // Earlier proxies: v4 on HyperEVM, Polygon and BSC, and v1 at the address BSC's v4 reuses.
  for (const [chainId, address] of [[999, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca"], [137, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca"], [56, "0xf0946794b2932ca342e68a9fd54ad30e5ff952e3"], [999, "0xf0946794b2932ca342e68a9fd54ad30e5ff952e3"]] as const) {
    expect(() => requireV5Deployment(chainId, address)).toThrow("No pinned escrow");
    expect(escrowDeployment(chainId, address)).toBeUndefined();
  }
  expect(() => requireV5Deployment(137, "0x5000000000000000000000000000000000000001")).toThrow("No pinned escrow");
});

test("each pinned deployment names its environment, which has one escrow on each chain", () => {
  for (const environment of ["production", "development"]) {
    const escrows = ESCROW_DEPLOYMENTS.filter(deployment => deployment.environment === environment);
    expect(escrows.map(deployment => deployment.chainId).sort()).toEqual([137, 999]);
  }
  expect(ESCROW_DEPLOYMENTS.every(deployment => deployment.environment !== undefined)).toBe(true);
});

test("pure deployment validation accepts only a reviewed chain and address pair", () => {
  const local: DeploymentManifest = [{ version: 5, chainId: 137, address: "0x5000000000000000000000000000000000000001" }];
  expect(requireV5Deployment(137, required(local[0]).address, local).version).toBe(5);
  expect(() => requireV5Deployment(999, required(local[0]).address, local)).toThrow();
  expect(() => requireV5Deployment(137, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca", local)).toThrow();
});

test("retired v5 deployments remain provable but cannot receive new funding", () => {
  for (const deployment of RETIRED_V5_DEPLOYMENTS) {
    expect(() => requireV5Deployment(deployment.chainId, deployment.address)).toThrow("No pinned escrow");
    expect(escrowDeployment(deployment.chainId, deployment.address, ESCROW_PROOF_DEPLOYMENTS)).toEqual(deployment);
  }
});

test("a signing bundle is refused whole when one quote set, funding or payment names an unpinned domain", () => {
  const [escrow] = ESCROW_DEPLOYMENTS, [venue] = VENUE_DOMAINS, retired = required(RETIRED_V5_DEPLOYMENTS[1]);
  const item = (kind: string, chainId: number, verifyingContract: string) => ({ kind, typed_data: { domain: { chainId, verifyingContract } } });
  const pinned = [item("quote_set", required(venue).chainId, required(venue).address), item("fund", required(escrow).chainId, required(escrow).address), item("pay_take", required(escrow).chainId, required(escrow).address)];
  expect(() => requireSigningDomains(pinned)).not.toThrow();
  // A venue's signing domain names quote sets only: nothing is ever funded or paid there.
  for (const kind of ["fund", "pay_take"]) expect(() => requireSigningDomains([...pinned, item(kind, required(venue).chainId, required(venue).address)])).toThrow("No pinned escrow");
  for (const kind of ["quote_set", "fund", "pay_take"]) expect(() => requireSigningDomains([...pinned, item(kind, retired.chainId, retired.address)])).toThrow("No pinned escrow");
});

test("each environment's pinned escrow may be named, on its own chain; a venue settled inside itself keeps its one domain", () => {
  const development = "0xde00000000000000000000000000000000000001";
  const both: DeploymentManifest = [...ESCROW_DEPLOYMENTS, { version: 5, chainId: 999, address: development }, { version: 5, chainId: 56, address: development }];
  const typed = (primaryType: string, verifyingContract: string, chainId = 999): Typed => ({ types: { EIP712Domain, ...schemas[primaryType] }, primaryType, domain: { name: "LaMarge", version: "1", chainId, verifyingContract }, message: {} });
  const fund = (escrow: string) => ({ ...typed("FundOffer", escrow), message: { owner: development, offerId: `0x${"01".repeat(32)}`, amount: "1", deposit: "0", quoteSigner: development, operator: development, minQuoteSequence: "1", nonce: "0", deadline: "1" } });
  const permit = (spender: string) => ({ ...typed("Permit", required(CHAINS.hyperliquid).token), domain: { name: "USDC", version: "2", chainId: 999, verifyingContract: required(CHAINS.hyperliquid).token }, message: { owner: development, spender, value: "1", nonce: "0", deadline: "1" } });
  for (const escrow of [ESCROW, development]) {
    expect(() => checkEscrowTyped(fund(escrow), "hyperliquid", both)).not.toThrow();
    expect(() => checkEscrowTyped(permit(escrow), "hyperliquid", both)).not.toThrow();
    expect(() => checkRegistry("hyperliquid", { ...required(CHAINS.hyperliquid), permit: undefined, escrow }, both)).not.toThrow();
    expect(isPinnedEscrow("hyperliquid", escrow, both)).toBe(true);
  }
  expect(() => checkEscrowTyped(fund(development), "hyperliquid")).toThrow("Unexpected signing domain");
  expect(() => checkEscrowTyped(permit(development), "hyperliquid")).toThrow("Unexpected permit spender");
  expect(() => checkRegistry("hyperliquid", { ...required(CHAINS.hyperliquid), permit: undefined, escrow: development })).toThrow("API deployment differs");
  expect(isPinnedEscrow("polymarket", development, both)).toBe(false);
  expect(() => checkRegistry("polymarket", { ...required(CHAINS.polymarket), permit: undefined, escrow: development }, both)).toThrow("API deployment differs");
  const { id, token, decimals, escrow: domain } = required(CHAINS.aster), aster = { id, token, decimals, escrow: domain };
  expect(isPinnedEscrow("aster", development, both)).toBe(false);
  expect(() => checkEscrowTyped({ ...typed("QuoteSet", development, id), message: { owner: development, offerId: `0x${"01".repeat(32)}`, sequence: "1", expiresAt: "1", quotes: [] } }, "aster", both)).toThrow("Unexpected signing domain");
  expect(() => checkRegistry("aster", { ...aster, escrow: development }, both)).toThrow("API deployment differs");
  expect(() => checkRegistry("aster", aster, both)).not.toThrow();
});

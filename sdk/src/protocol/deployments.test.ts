import { expect, test } from "bun:test";
import { ESCROW_DEPLOYMENTS, ESCROW_PROOF_DEPLOYMENTS, RETIRED_V5_DEPLOYMENTS, VENUE_DOMAINS, escrowDeployment, requireSigningDomains, requireV5Deployment, type DeploymentManifest, required } from "./index.ts";

test("only the reviewed proxy permits balances and deposit receivers", () => {
  expect(ESCROW_DEPLOYMENTS.map(deployment => deployment.chainId)).toEqual([999, 137]);
  for (const deployment of ESCROW_DEPLOYMENTS) expect(requireV5Deployment(deployment.chainId, deployment.address).version).toBe(5);
  // Earlier proxies: v4 on HyperEVM, Polygon and BSC, and v1 at the address BSC's v4 reuses.
  for (const [chainId, address] of [[999, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca"], [137, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca"], [56, "0xf0946794b2932ca342e68a9fd54ad30e5ff952e3"], [999, "0xf0946794b2932ca342e68a9fd54ad30e5ff952e3"]] as const) {
    expect(() => requireV5Deployment(chainId, address)).toThrow("not available");
    expect(escrowDeployment(chainId, address)).toBeUndefined();
  }
  expect(() => requireV5Deployment(137, "0x5000000000000000000000000000000000000001")).toThrow("not available");
});

test("pure deployment validation accepts only a reviewed chain and address pair", () => {
  const local: DeploymentManifest = [{ version: 5, chainId: 137, address: "0x5000000000000000000000000000000000000001" }];
  expect(requireV5Deployment(137, required(local[0]).address, local).version).toBe(5);
  expect(() => requireV5Deployment(999, required(local[0]).address, local)).toThrow();
  expect(() => requireV5Deployment(137, "0xe0384a3026d52120c20c12ceb33e73096e1d2eca", local)).toThrow();
});

test("retired v5 deployments remain provable but cannot receive new funding", () => {
  for (const deployment of RETIRED_V5_DEPLOYMENTS) {
    expect(() => requireV5Deployment(deployment.chainId, deployment.address)).toThrow("not available");
    expect(escrowDeployment(deployment.chainId, deployment.address, ESCROW_PROOF_DEPLOYMENTS)).toEqual(deployment);
  }
});

test("a signing bundle is refused whole when one quote set, funding or payment names an unpinned domain", () => {
  const [escrow] = ESCROW_DEPLOYMENTS, [venue] = VENUE_DOMAINS, retired = required(RETIRED_V5_DEPLOYMENTS[1]);
  const item = (kind: string, chainId: number, verifyingContract: string) => ({ kind, typed_data: { domain: { chainId, verifyingContract } } });
  const pinned = [item("quote_set", required(venue).chainId, required(venue).address), item("fund", required(escrow).chainId, required(escrow).address), item("pay_take", required(escrow).chainId, required(escrow).address)];
  expect(() => requireSigningDomains(pinned)).not.toThrow();
  // A venue's signing domain names quote sets only: nothing is ever funded or paid there.
  for (const kind of ["fund", "pay_take"]) expect(() => requireSigningDomains([...pinned, item(kind, required(venue).chainId, required(venue).address)])).toThrow("not available");
  for (const kind of ["quote_set", "fund", "pay_take"]) expect(() => requireSigningDomains([...pinned, item(kind, retired.chainId, retired.address)])).toThrow("not available");
});

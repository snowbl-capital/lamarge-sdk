# @lamarge/sdk

The TypeScript client of the [LaMarge API](https://docs.lamarge.trade): sign-in, transfers and market making, each signature checked before it is asked for. Browsers, Bun and Node 22.12+, ESM only.

```sh
npm install @lamarge/sdk viem
```

```ts
import { createClient, linkAccount, memoryStore, setUpVenue, signIn, transfer } from "@lamarge/sdk";
import { privateKeyToAccount } from "viem/accounts";

const client = createClient({ apiUrl: "https://api.lamarge.trade" });
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
await signIn(client, account, "https://app.lamarge.trade");
for (const venue of ["hyperliquid", "polymarket"]) {
  await linkAccount(client, account, venue);
  await setUpVenue(client, venue, account);
}

// 250 USDC from Hyperliquid to Polymarket, at least 249.5 pUSD. A durable store instead of memoryStore() resumes after a restart.
const fills = await transfer(client, account, {
  client_transfer_id: "rebalance-1", from: "hyperliquid", to: "polymarket",
  amount_in: "250000000", min_out: "249500000", recipient: account.address, funding: "venue",
}, { store: memoryStore() });
console.log(fills.map(fill => `${fill.id} ${fill.state}`));
```

Documentation, a resumable taker script and a maker bot: [docs.lamarge.trade/sdk](https://docs.lamarge.trade/sdk).

The SDK is developed in LaMarge's repository, next to the server and the API contract. [snowbl-capital/lamarge-sdk](https://github.com/snowbl-capital/lamarge-sdk) mirrors each release; issues are welcome there. Before 1.0 a minor version may break.

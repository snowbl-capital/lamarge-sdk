# @lamarge/sdk

The TypeScript client of the [LaMarge API](https://docs.lamarge.trade), for apps, takers and makers. It runs in browsers, Bun and Node 22.12+, ships ESM only and has no runtime dependency.

| Entry | Contents |
| --- | --- |
| `@lamarge/sdk` | `createClient`, every public operation by its `operationId` (`client.call`), `LaMargeError`, sign-in, signing of checked items, taker flows, `Maker`, `Quoter`, the event feed, `VenueDeliverer` |
| `@lamarge/sdk/protocol` | The reviewed deployments and every check run before a signature: EIP-712 schemas and domains, intents, withdrawals, Aster and Lighter messages, units |
| `@lamarge/sdk/aster` | `AsterDeliverer`: an active maker's transfers inside Aster. Needs `viem`, an optional peer dependency |
| `@lamarge/sdk/lighter` | `LighterDeliverer`: an active maker's transfers inside Lighter, signed by a `LighterSigner` the application holds (lighter-ts-sdk or Lighter's Go signer) |

```ts
import { createClient, signIn, signItems } from "@lamarge/sdk";
import { privateKeyToAccount } from "viem/accounts";

const client = createClient({ apiUrl: "https://api.lamarge.trade" });
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
await signIn(client, account, "https://app.lamarge.trade");
const balances = await client.call("getBalances");
```

A transfer, as a server-side taker runs it. Persist `client_transfer_id`, the transfer id `onIntent` names and the store's contents: running the same request again resumes it and submits what was signed rather than signing again.

```ts
import { transfer } from "@lamarge/sdk";

const fills = await transfer(client, account, {
  client_transfer_id: "rebalance-2026-10-17-1", from: "hyperliquid", to: "polymarket",
  amount_in: "250000000", min_out: "249500000", recipient: account.address,
  funding: "wallet", // never withdraws from the venue; "venue" withdraws the shortfall first
}, { store, onIntent: intent => save(intent.id) });
```

| Flow | Does |
| --- | --- |
| `signIn`, `checkDeployment` | SIWE for the app's origin, after checking every chain the API names against the pinned deployment |
| `linkAccount`, `setUpVenue` | Links an account, by the link message when it is not the master's; runs its setup steps (permit, Aster agent, Lighter key) |
| `transfer` | Funding, the take, its payment; recovery by client id; `TransferPending` when funds or a permit have not arrived yet |
| `take` | Reserves quotes, checks and signs the payment (escrow, Aster or Lighter), submits it |
| `changes` | Snapshot, then every page of events over the WebSocket, HTTP replay between connections, `{ resync }` when the journal moved on |

Making a market takes two keys on two hosts. `Maker` holds the financial key and only provisions and releases capital; `Quoter` holds a scoped credential (`mk_`) and the quote key, and only quotes, cancels and reports deliveries.

```ts
import { createClient, Maker, Quoter } from "@lamarge/sdk";

const master = new Maker(createClient({ apiUrl }), financialAccount, operatorAddress, "https://app.lamarge.trade");
await master.login();
const credential = await master.createCredential("quoter", quoteAccount.address);
const order = await master.waitForFunding(await master.addCapital({ venue: "hyperliquid", amount: "5000000", client_request_id, funding_source: "venue" }, credential, store));

const quoter = new Quoter(createClient({ apiUrl, token: credential.token }), credential.id, quoteAccount);
await quoter.lease(30);
await quoter.batch([await quoter.prepare(await quoter.order(order.id), quotes, 5_000_000n, Math.floor(Date.now() / 1000) + 25)]);
```

A passive maker's pools sit in the escrow (Hyperliquid, Polymarket): the operator settles every fill. An active maker's pools sit inside a venue (Lighter, Aster): its agent also runs a deliverer, which sends each paid fill's transfer, persists it in a `DeliveryJournal` before sending, never signs a fill twice and reports the transfer. The agent itself (its loop, configuration, journal storage, single-writer lock and shutdown) is the application's; LaMarge's maker example is one, available on request.

A `Signer` is an address with `signMessage` and `signTypedData`: a viem `LocalAccount`, a KMS key through viem's `toAccount`, or a browser wallet's client wrapped in those two methods. The SDK hands it only what its checks accepted; never sign a `to_sign` item that a check of `@lamarge/sdk/protocol` has not compared with your own request.

Answers are typed from the public API reference, not validated: enums stay open to values a newer server adds. A refusal is a `LaMargeError` whose `code` and `reason` are stable. Only reads and calls marked `retry` are repeated, with the identical request; never retry a write by building a new one.

## Development

```sh
bun install --frozen-lockfile
bun run check      # generated types are current, typecheck, tests, build
bun run api:generate
```

`src/generated/api.ts` comes from `docs/api/api-reference/openapi.yaml`, the API's public contract. The SDK is developed in LaMarge's repository, next to the server, the app and that contract; [snowbl-capital/lamarge-sdk](https://github.com/snowbl-capital/lamarge-sdk) mirrors each release, with the public contract and the Lighter test vectors its checks need. Changes are made upstream; issues are welcome there.

Each release `sdk-vX.Y.Z` is cut from the commit production runs, so the server keeps every operation and field it uses. Before 1.0 a minor release may break.

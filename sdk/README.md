# @lamarge/sdk

The TypeScript client of the [LaMarge API](https://docs.lamarge.trade), for apps, takers and makers. It runs in browsers, Bun and Node 22.12+, ships ESM only and has no runtime dependency. Usage, with examples: [docs.lamarge.trade/sdk](https://docs.lamarge.trade/sdk).

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

| Flow | Does |
| --- | --- |
| `signIn`, `checkDeployment` | SIWE for the app's origin, after checking every chain the API names, its permit and its settlement against the pinned deployment |
| `linkAccount`, `setUpVenue` | Links an account, by the link message when it is not the master's; runs its setup steps (permit, Aster agent, Lighter key) |
| `transfer` | Funding, the take, its payment; recovery by client id; `TransferPending` when funds or a permit have not arrived yet |
| `take` | Reserves quotes, checks and signs the payment (escrow, Aster or Lighter), submits it |
| `route` | A route of two takes through an intermediate venue, as `GET /v1/routes` plans it: two transfers, the second continuing what the first delivered; with `grouped`, signed at once where LaMarge can (`checkRouteIntent`) |
| `changes` | Snapshot, then every page of events over the WebSocket, HTTP replay between connections, `{ resync }` when the journal moved on |
| `Maker`, `Quoter` | Capital with the financial key; quote lines, cancellation and delivery reports with a scoped credential |

Making a market takes two keys on two hosts: `Maker` holds the financial key and only provisions and releases capital; `Quoter` holds a scoped credential (`mk_`) and the quote key, and only quotes, cancels and reports deliveries. An active maker's pools sit inside Lighter or Aster: its agent also runs a deliverer, which persists each paid fill's transfer in a `DeliveryJournal` before sending it, never signs a fill twice and reports it. The agent itself (loop, configuration, journal storage, single-writer lock, shutdown) is the application's.

A `Signer` is an address with `signMessage` and `signTypedData`: a viem `LocalAccount`, a KMS key through viem's `toAccount`, or a browser wallet's client wrapped in those two methods. The SDK hands it only what its checks accepted; never sign a `to_sign` item that a check of `@lamarge/sdk/protocol` has not compared with your own request.

Answers are typed from the public API reference, not validated: enums stay open to values a newer server adds. A refusal is a `LaMargeError` whose `code` and `reason` are stable. Only reads and calls marked `retry` are repeated, with the identical request; never retry a write by building a new one.

## Development

```sh
bun install --frozen-lockfile
bun run check      # generated types are current, typecheck, tests, build
bun run api:generate
```

`src/generated/api.ts` comes from `docs/api/api-reference/openapi.yaml`, the API's public contract. The SDK is developed in LaMarge's repository, next to the server, the app and that contract; [snowbl-capital/lamarge-sdk](https://github.com/snowbl-capital/lamarge-sdk) mirrors each release, with the public contract and the Lighter test vectors its checks need. Changes are made upstream; issues are welcome there.

Each release `sdk-vX.Y.Z` is cut from LaMarge's `main`, apart from the server's releases: it may call what production doesn't serve yet, which works once a server release ships it. Before 1.0 a minor release may break.

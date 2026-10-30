export interface paths {
    "/share/v1/{filename}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a site sharing image
         * @description Public 1200 by 630 PNG; both filenames return the same image. Cacheable for one hour.
         */
        get: operations["getSiteShareImage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/share/v1/trades/{id}/image.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a transfer sharing image
         * @description Public 1200 by 630 PNG of a published trade: venues, settlement time and amounts rounded to four decimals. Cacheable for one hour.
         */
        get: operations["getTradeShareImage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/share/trade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get explorer sharing metadata
         * @description HTML head tags for a trade's explorer page, absolute URLs on the primary app origin; generic tags for a missing, invalid or unpublished trade or a lookup over two seconds. Not cached.
         */
        get: operations["getTradeShareMetadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/venues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List venues
         * @description Every venue in display order, with its settlement terms, token, permit domain, margin-transfer format and deposit minimum, all null when disabled. Check them against the [deployment values](/how-it-works#deployment-values) before signing.
         */
        get: operations["getVenues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/venues/aster/rpc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aster signing network
         * @description RPC URL of chain 1666 (`0x682`), which a wallet adds with `wallet_addEthereumChain` to sign an Aster transfer: wallets sign typed data only for their current chain. It answers only `eth_chainId` and `net_version`; other methods get JSON-RPC error -32601.
         */
        post: operations["postAsterSigningRpc"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/books": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a book
         * @description Levels the taker pays on `from` and receives on `to`, best price first, then oldest; they are not reservations. A level is a quote that [admits takes](/how-it-works#quotes), with a signed expiry at least the maker timeout away and `min(available, max_fill)` at least `min_fill`. With a Hyperliquid `from`, or a Lighter or Aster pool (approved makers only), the maker's balance must have been read within two minutes. Over 1000 candidate levels: 503 `SNAPSHOT_TOO_LARGE`.
         */
        get: operations["getBook"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the best route
         * @description What takes would pay now on `to` for `amount_in` on `from`: one take, or two through another venue when no direct take is possible (Lighter and Aster) or finds nothing, or when two pay at least 10 bps more and spend no less. The second take pays what the first delivers, less the Lighter account's transfer fee, rounded down to millionths; where it carries less, the first shrinks to fit. With `min_out`, a route delivering under that price for its amount shrinks to the largest amount that meets it, rather than none. `capped`: the route spends less than `amount_in` beyond rounding; `amount_in` can be short of the request by less than a base unit of output per part without it. Takes are admitted as `POST /v1/takes` admits them, your own orders excluded; no route goes through Lighter without a linked account and a known fee. The error is what refuses the direct take, or every route; an unusable intermediate venue only drops its routes. Nothing is reserved.
         */
        get: operations["getRoute"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/trades/{id}/proof": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get signed trade proof
         * @description The settled trade's signed maker `QuoteSet`, funding authorization (`FundOffer`, or the delivery for a Lighter or Aster pool) and taker `PayTake` (or the executed `payment` when paid from Lighter or Aster), with digests and relayed transactions. Public once all three are recorded.
         */
        get: operations["getTradeProof"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/volume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get 24h volume
         * @description Public trades between `a` and `b`, either way, settled in the last 24 hours, in `b` base units.
         */
        get: operations["getVolume"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/markets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get venue prices
         * @description Per enabled venue: the best price lines of the quote identities whose quotes the books show (`best_buy` the highest price a maker pays to receive the venue's token there, `best_sell` the lowest it asks to deliver it there, in USDC), the liquidity those books draw from each pool once, and the volume delivered there in the last 24 hours. Prices are indicative: the best buy and the best sell may come from different makers, and a route always prices one maker's pair ([quote lines](/how-it-works#quote-lines)). Pools quoted without lines count in `liquidity` only. An answer is reused for two seconds. Over 1000 eligible orders: 503 `SNAPSHOT_TOO_LARGE`.
         */
        get: operations["getMarkets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Settlement readiness; 503 with the same body when a chain is not `ready`.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get deployment info
         * @description API version, limits, settlement timings, operator, deployments and access mode. Not a signing trust root: compare with independently reviewed configuration.
         */
        get: operations["getV1Info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a sign-in message
         * @description A one-use EIP-4361 message for the master address, valid ten minutes, on the request's `Origin` if allowed, else the main app origin. Check domain, URI, address and expiry before `personal_sign`.
         */
        post: operations["postAuthChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify a signed message
         * @description Consumes the challenge and returns a revocable master session; a failed attempt leaves the challenge usable. The first sign-in creates the user; beyond 32 active sessions, the oldest are revoked.
         */
        post: operations["postAuthVerify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a master session
         * @description Revokes one of the user's sessions, the current one included; a repeat answers 204. Credentials are unaffected.
         */
        delete: operations["deleteV1AuthSessionsId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get my account
         * @description The master address, its linked venue accounts and its access.
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/link/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a link message
         * @description The EIP-191 message `address` signs to prove it controls the venue account: single use, valid ten minutes, not needed for the master address.
         */
        post: operations["postLinkChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{venue}/setup": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
            };
            cookie?: never;
        };
        /**
         * Read account setup
         * @description The linked account's setup steps, each read from the venue now: a step the venue shows is recorded `done`, one it no longer accepts is `required` again with its `reason`. A permit prepared but not signed carries its `to_sign`. `ready` once every step is done ([setup](/quickstart#set-up-venue-accounts)).
         */
        get: operations["getVenueSetup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{venue}/setup/{step}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
                /** @description One of the venue's steps (`permit`, `agent`, `api_key`). */
                step: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare or submit a setup step
         * @description With `{}`, the request the linked address signs for the step, in `to_sign`; a step already done or pending answers without one. With its `ref` and the `signature`, submits it: Aster registers the agent at once (`done`), the permit and Lighter's key are relayed (`pending`) until the venue shows them. Read the [setup](/api-reference/account/setup) until `done`.
         */
        post: operations["postVenueSetupStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Link a venue account
         * @description One account per venue. The master address links without `nonce` or `signature`; another address sends the link challenge's. `setup` lists the steps left ([setup](/api-reference/account/setup)); relinking another address drops the steps done for the previous one. `venue_wallet` is the signer's Polymarket wallet or the Lighter master account index; without one, `WALLET_NOT_FOUND` ([venues](/how-it-works#venues-and-balances)).
         */
        post: operations["postLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{venue}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Unlink a venue account
         * @description `ACCOUNT_IN_USE` while an order on or quoting the venue is not `closed` (close `failed` ones too) or a fill or withdrawal is unfinished. Works on a disabled venue.
         */
        delete: operations["deleteLink"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/balances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get balances
         * @description Cached balances per linked venue, in venue order ([fields](/how-it-works#balances)); a read 15 seconds old queues a refresh. Unknown values are null; a value with its `error` or `chain_error` set is stale.
         */
        get: operations["getBalances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get my trading stats
         * @description Settled output volume of the last 30 days per venue, Lighter and Aster included, and what the user's orders received and delivered since the first fill ([maker results](/how-it-works#maker-results)). Fees are zero.
         */
        get: operations["getStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/exposure": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get my exposure
         * @description A consistent snapshot per venue, Lighter and Aster included; a credential sees its identity's amounts. On escrow venues, check `chain_observation.current`; it is null on Lighter and Aster. Credential scope: `read`.
         */
        get: operations["getV1MeExposure"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/quote-lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read quote lines
         * @description The quote identity's published lines ([quote lines](/how-it-works#quote-lines)) and their `revision`, `0` before any. A credential reads its own identity. Credential scope: `read`.
         */
        get: operations["getQuoteLines"];
        put?: never;
        /**
         * Publish quote lines
         * @description Accepts every draft and cancellation of a preparation and replaces the identity's lines, in one transaction, or none ([quotes](/how-it-works#quotes)). `STATE_CONFLICT` when the lines' revision moved since the preparation or a draft was accepted with another signature; `STALE_QUOTE` once the preparation is five minutes old, or unless each draft's pool is `live`, its lease current, before `valid_until`, at the current generation and `cancel_epoch`; `STALE_SEQUENCE` unless each draft's sequence exceeds every published one. A cancellation is an unguarded `DELETE /v1/orders/{id}/quotes`. Retries never restore a cancelled set. A superseded set stops admitting takes, but the takes prepared under it still execute under it until their `pay_by`; cancel to withdraw them. The quote signer signs with its key: a contract's (ERC-1271) signature is refused, as the escrow refuses it at delivery. Publishing an accepted preparation again returns the lines. Credential scope: `quote`, and `cancel` when it cancels.
         */
        post: operations["publishQuoteLines"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/quote-lines/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare quote lines
         * @description Compiles a complete replacement of the identity's lines into one draft per live pool with stock, each quoting every other line with a buy price whose venue can pay into the pool's, and one cancellation per other quoted pool. A draft's quotes share the line's `stock` as their `supply` and `quote_size`, with its `min_fill`, at `receive = ceil(stock × sell × 10^dA / (buy × 10^dB))` ([quote lines](/how-it-works#quote-lines)). Stock needs a pool on its venue (else `VALIDATION_ERROR`), at least one token and its minimum fill, a sell price and a buy price elsewhere that can pay for it; any pool of the identity moving capital is `STATE_CONFLICT`. Each draft takes its pool's next sequence and needs it `live` under a current lease, else `STATE_CONFLICT`, and each quote a linked, set-up account on its venue. At most 100 unpublished, unexpired drafts per identity, else `RATE_LIMITED`. Publish them within five minutes. Credential scope: `quote`, and `cancel` when it cancels.
         */
        post: operations["prepareQuoteLines"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/maker/{venue}/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare maker funds
         * @description Funds the quote identity's capital pool on `venue` ([maker capital](/how-it-works#maker-capital)); prices go through [quote lines](/how-it-works#quote-lines). A browser identity's pool has what is left of its current quotes re-signed. Idempotent on `client_request_id`. Lighter and Aster pools ([active market making](/market-making#active-market-making)): approved makers only (`MAKER_NOT_APPROVED`), one pool per account and `funding_source: venue`; the preparation is `complete` at once. An unreadable Lighter transfer fee is `VENUE_UNAVAILABLE`.
         */
        post: operations["prepareMaker"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/maker/preparations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a maker preparation */
        get: operations["getMakerPreparation"];
        put?: never;
        post?: never;
        /**
         * Cancel an unsigned maker preparation
         * @description Cancels a `preparing` preparation and restores its order's state; repeating returns it, other states are `STATE_CONFLICT`. An unsigned preparation also cancels at expiry.
         */
        delete: operations["cancelMakerPreparation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/maker/preparations/{id}/signatures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit maker signatures
         * @description Accepts every requested signature at once, before `expires_at`. A `margin_move` signed over ten minutes ago is `WITHDRAWAL_EXPIRED`; a funding is refused while a fill of the order is reserved; a changed order revision cancels the preparation. Once accepted, a retry returns it.
         */
        post: operations["submitMakerSignatures"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my orders
         * @description Capital pools, nonterminal orders and orders holding funds, plus the 50 latest empty `closed` or `failed` ones, oldest first; a credential sees its identity's only. Over 1000 is 503 `SNAPSHOT_TOO_LARGE`: page with `/v1/orders/history`. Credential scope: `read`.
         */
        get: operations["getOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an order
         * @description Credential scope: `read`.
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Pull the quotes
         * @description Removes the order from admission and advances `cancel_epoch` on every call; drafts prepared before the receipt cannot be published. Earlier reservations continue and the signed set stays valid on chain ([cancellation](/how-it-works#cancellation)). Capital is not withdrawn. Credential scope: `cancel`.
         */
        delete: operations["deleteQuotes"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/quotes/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically cancel quotes
         * @deprecated
         * @description Cancels every order's quotes, or none, each as an unguarded `DELETE /v1/orders/{id}/quotes`. Results are sorted by order id. Credential scope: `cancel`. Use `DELETE /v1/quote-identities/{id}/quotes` instead.
         */
        post: operations["postV1QuotesBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/quote-identities/{id}/lease": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Renew quote lease
         * @description Dead-man switch for new admissions, in server time: `ttl_seconds` for a credential identity, 9999-12-31T00:00:00Z for a browser one. Renewing after expiry advances the generation, so older quotes and drafts never return. Expiry cancels neither reserved fills nor signed sets on chain. Credential scope: `quote`.
         */
        put: operations["putV1QuoteIdentitiesIdLease"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/quote-identities/{id}/quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Cancel all identity quotes
         * @description Atomically advances the identity's generation and every one of its orders' `cancel_epoch`; `orders` counts them, in any state. Reserved fills continue. Credential scope: `cancel`.
         */
        delete: operations["deleteV1QuoteIdentitiesIdQuotes"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/closes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a close
         * @description Closes 1 to 50 of the user's orders (repeated ids count once) into their owners' venue margin. Empty orders close at once and `closing` ones are skipped; the rest need one `CloseOrders`, in the Hyperliquid escrow's domain, that the master signs and [submits](/api-reference/closes/submit-signature) within an hour. `STATE_CONFLICT` while an order is `preparing`, `moving` or `funding`. To release part of a pool and keep it quoting, [withdraw](/api-reference/escrow/prepare-withdrawal).
         */
        post: operations["postCloses"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/closes/{id}/signatures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit close signature
         * @description The master's `CloseOrders` signature, before its deadline: the orders become `closing` and leave the books. Once their reserved fills end, LaMarge releases the unlocked funds into the owner's margin, or into the available escrow balance if the venue refuses the deposit ([releasing capital](/how-it-works#releasing-capital)); a Lighter or Aster pool just closes. A retry returns the same orders.
         */
        post: operations["postCloseSignatures"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/escrow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my funds in escrow
         * @description Orders with unlocked funds that your linked addresses own in each venue's current escrow, under any operator; close `managed` ones with `POST /v1/closes`, withdraw any by signature ([releasing capital](/how-it-works#releasing-capital)). Per address, at most 50 unmanaged orders are read: the available balance (order ID zero), then the latest funded.
         */
        get: operations["getEscrow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/escrow/close/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a close by signature
         * @deprecated
         * @description The `CloseOffer` your linked address signs to release an order's unlocked funds into your margin, or with `to_margin: false` into your wallet: escrow domain, random nonce, valid one hour. `STATE_CONFLICT` while a close of the order is pending, while a reserved fill or capital operation on a recorded order is pending, or for an unrecorded order under 1 token (the available balance excepted). `VALIDATION_ERROR` for an available-balance release to margin below `release_minimum`. Use [`POST /v1/escrow/withdraw/prepare`](/api-reference/escrow/prepare-withdrawal) instead, with the order's `available`.
         */
        post: operations["postEscrowClosePrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/escrow/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Close by signature
         * @deprecated
         * @description Relays the prepared terms, signed by the linked address, as `closeOfferBySig`; LaMarge pays gas. The terms are rechecked as at preparation (a stale `dex` is `VALIDATION_ERROR`). A refused venue deposit stays in your available escrow balance. A recorded order is `closing`, off the books, until the transaction is final or a minute past its deadline; after a revert or expiry, sign again. `STATE_CONFLICT` during a financial operation on the venue, while a close of the order is pending, at 10 pending closes per owner and chain, or for a nonce reused with other terms; the same terms return the same close. Use [`POST /v1/escrow/withdraw`](/api-reference/escrow/withdraw) instead.
         */
        post: operations["postEscrowClose"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/escrow/withdraw/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a withdrawal
         * @description The `Withdrawal` your linked address signs to release `amount` of an order's unlocked funds into your margin, or with `to_margin: false` into your wallet: escrow domain, random nonce, valid one hour. A recorded order releases only what its reserved fills and pending withdrawals leave (`available_to_quote`) and keeps quoting the rest. `VALIDATION_ERROR` above the order's funds, under 1 token unless all of them, or for an available-balance release to margin below `release_minimum`. `STATE_CONFLICT` while a release of the order or a capital operation on it is pending, above what is free of reserved fills, or for an unrecorded order under 1 token (the available balance excepted).
         */
        post: operations["postEscrowWithdrawPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/escrow/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Withdraw
         * @description Relays the prepared terms, signed by the linked address, as `withdrawBySig`; LaMarge pays gas. The terms are rechecked as at preparation (a stale `dex` is `VALIDATION_ERROR`). A refused venue deposit stays in your available escrow balance. The order quotes without its `amount` until the withdrawal lands, reverts, or the finalized chain is past its deadline; after a revert or expiry, sign again. `STATE_CONFLICT` during a financial operation on the venue, while a release of the order is pending, at 10 pending releases per owner and chain, or for a nonce reused with other terms; the same terms return the same withdrawal.
         */
        post: operations["postEscrowWithdraw"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my recoverable transfers
         * @description Newest first, cancelled and completed included; follow `next_cursor` until null. Status lives in the linked withdrawal and take.
         */
        get: operations["getTransfers"];
        put?: never;
        /**
         * Create a recoverable transfer
         * @description Records a route that withdraws from venue margin (not Lighter or Aster), then takes; moves no funds and reserves nothing. No payment setup needed; `funding_plan` asks for a permit when wallet funds need one. Retrying with the same `client_transfer_id` returns the intent; changed terms are `STATE_CONFLICT`.
         */
        post: operations["postTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Recover a transfer
         * @description The intent and its linked operations; read before preparing more funding.
         */
        get: operations["getTransfer"];
        put?: never;
        post?: never;
        /**
         * Dismiss a transfer without a take
         * @description Blocks the intent's take and prepared withdrawal; repeats answer 204. Refused with a take or a `queued`, `submitting` or `unknown` withdrawal; relayed funds stay put. A route's first transfer (with `then`) whose take is final can be dismissed: its continuations that neither took nor hold a withdrawal in flight are cancelled with it, and what it delivered stays on the intermediate venue.
         */
        delete: operations["cancelTransfer"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/withdrawal/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare this transfer's funding
         * @description One withdrawal of `amount`, at most `amount_in`, from the payer's `from` margin to its escrow-chain address, for the take to deposit; none from Lighter or Aster, which pay inside the venue (`VALIDATION_ERROR`). Retries return the same typed data until ten minutes after the first preparation, then `WITHDRAWAL_EXPIRED`: cancel and create another transfer. Another amount conflicts.
         */
        post: operations["prepareTransferWithdrawal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/withdrawal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit this transfer's funding signature
         * @description Submits the signed preparation, recorded before the venue is called; answers 200 with the withdrawal, even `refused`, and retries return it. Never sign another for an `unknown` one.
         */
        post: operations["submitTransferWithdrawal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/move/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare this transfer's move to trade.xyz
         * @description For a transfer with `to_dex: xyz` once its take is reserved: a Hyperliquid `SendAsset` of what the take delivered or may still deliver to the perps, from the recipient's perps (`sourceDex` `""`) to its own trade.xyz (`destinationDex` `xyz`), signed by the recipient. Retries return the same typed data for 45 seconds, then a renewed one, which a signature of the earlier no longer matches (`BAD_SIGNATURE`). After its move was `refused`, a new one replaces it.
         */
        post: operations["prepareTransferMove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit this transfer's move to trade.xyz
         * @description Records the signed move, `kind` `move`, held: LaMarge relays it once the take delivered its amount to the perps and a fresh read of the account after the delivery shows the perps can move it, within ten minutes of its nonce; else it is `refused` unsent and the funds stay on the perps. Retries return it.
         */
        post: operations["submitTransferMove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/grouped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a grouped route
         * @description For a route's first transfer whose take is prepared and unsigned, paid from Lighter or Aster and through an escrow venue: creates the second transfer, prepares its take without reserving inventory and answers both takes to sign; the second pays from the available balance the first is delivered into, with no withdrawal. Sign in order: the first take's request, then the second take's `pay_take`. For Aster, refreshes the still-live unsigned first take with about 90 seconds until `commit_by` and a nonce 20 seconds later; sign the returned requests. Requires a route payment window of at least 150 seconds. Idempotent while prepared: another preparation changes neither the requests nor the deadline. `STATE_CONFLICT` with `reason` `grouped_unavailable`: the route cannot be grouped (not eligible, the book or the accounts on the intermediate venue do not carry it now, too little time left, or it was aborted); the caller decides whether to try leg by leg. With `reason` `grouped_route`: another request is preparing this route.
         */
        post: operations["prepareGroupedRoute"];
        /**
         * Abort a prepared route
         * @description Ends a route not committed: its second take and second transfer are released at once. The first take stays prepared, to sign alone. Idempotent. `STATE_CONFLICT` for a committed route, which runs to its end.
         */
        delete: operations["abortGroupedRoute"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfers/{id}/grouped/signatures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Commit a route's signatures
         * @description Every signature of a prepared route at once: each take's items by `fill_id`. Accepted together before `commit_by`, or none; the first take is then delivered into the payer's available balance on the intermediate chain, and the operator pays the second take from it. A retry answers the committed route. `TAKE_EXPIRED`: `commit_by` passed and the route is aborted. `STATE_CONFLICT` with `reason` `grouped_unavailable`: the route was aborted. Either way, sign the first take alone.
         */
        post: operations["commitGroupedRoute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/takes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Take at market
         * @description Prepares up to `max_parts` fills in `PREPARED`, without reserving maker liquidity, paid from the payer's available balance in the `from` escrow ([takes](/how-it-works#takes)). After signatures and payment preflight, all parts reserve atomically just before payment, each under the quote set it was prepared under: the maker's newer sets do not retract it. A cancelled, expired or consumed offer expires it unpaid with a reason: prepare and sign again. No bond is required. One `pay_take` signature covers every payment and a wallet deposit of any shortfall; the deposit needs the payer's `permit` step (`SETUP_REQUIRED`). `PREFUNDING_REQUIRED`, reserving nothing, when balance and wallet together fall short: fund the wallet with a [transfer](/api-reference/transfers/create). Several takes may await payment at once: from an escrow venue, each is admitted against what the others hold of the same funds (`holdings.committed` of `/v1/balances`); a Lighter or Aster account pays one at a time. `STATE_CONFLICT` while a maker preparation or an escrow close is open on `from`. Persist `client_take_id`: the same body returns the same take. A transfer's take with its withdrawal prepared, not submitted, is signed at once with it (funding plan `signed_at_once`): its `pay_by` is a route's (`limits.route_pay_window_seconds` of `/v1/info`), its deposit what the wallet lacks once the withdrawal arrives; `PREFUNDING_REQUIRED` when the wallet and the withdrawal fall short, `WITHDRAWAL_EXPIRED` when the preparation leaves too little time to sign. Paid from Lighter or Aster: one fill and one `lighter_transfer` or `aster_transfer` signature; `PREFUNDING_REQUIRED` when that account cannot cover it with its fee, `VALIDATION_ERROR` when it backs a pool, `FORBIDDEN` while paying from a venue is suspended.
         */
        post: operations["postTake"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/takes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Recover a take and its signing intents
         * @description The taker's take, with its typed data while unsigned, also after expiry. Never sign an expired payment.
         */
        get: operations["getV1TakesId"];
        put?: never;
        post?: never;
        /**
         * Cancel a take
         * @description Allowed until its signature is accepted, a take signed at once's included, also after an unsigned expiry; repeats answer 204. Its unsigned fills expire (`declined`), releasing their source commitments.
         */
        delete: operations["deleteTake"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/takes/{id}/signatures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit take signatures
         * @description The payer's `pay_take` signature, with the take id as `fill_id`, before `pay_by`; the deposit and every payment go in one transaction, all or none, mined by `pay_by`. A take paid from Lighter sends the `personal_sign` of the `lighter_transfer` message instead, one paid from Aster the EIP-712 signature of the `aster_transfer` request; LaMarge sends that transfer once every maker accepted. A take signed at once (funding plan `signed_at_once`) also carries its transfer's prepared withdrawal as a `margin_move` item without `fill_id` (`VALIDATION_ERROR` without it), until 30 seconds before `pay_by` (`TAKE_EXPIRED`): both are accepted together and the withdrawal sent at once; the payment is sent once a chain read shows its funds in the wallet, with ten seconds left before `pay_by`, else the take expires unpaid. A refused withdrawal ends the take at once (`EXPIRED`, reason `the withdrawal was refused`). Once accepted, retries return the current fills.
         */
        post: operations["postTakeSignatures"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills/{id}/refund/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare an early payment refund
         * @description Maker master session only. For a fill delivered inside its venue (Lighter, Aster): requires the payment `LOCKED` and the fill's own delivery `ABANDONED`. An escrow venue's abandoned delivery needs no consent: LaMarge refunds it after `t1`. Returns the `RefundPayment` consent for the beneficiary, valid one hour at most and until `t2` ([deadlines](/how-it-works#deadlines-and-outcomes)); `STATE_CONFLICT` while one is active.
         */
        post: operations["preparePaymentRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills/{id}/refund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authorize an early payment refund
         * @description Submits the beneficiary's `RefundPayment` signature; exact retries answer 204, even after settlement. The operator returns only this payment to the payer's available balance (finalized `Refunded` event); without consent it refunds after `t2`. For a fill delivered inside its venue, consent ends delivery reports (`refund_authorized`), even of a transfer executed in time.
         */
        post: operations["submitPaymentRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept an active delivery before taker funding
         * @description Commits the maker to deliver this fill, before `maker_accept_by`. The taker's payment waits for every acceptance of the take (both takes of a grouped route); a missing one expires the unpaid take. Accepted, the fill is owed even if the maker cancels its quotes or closes the pool afterwards; it cannot be accepted once they were cancelled. Retries of an accepted fill return 204, also after the deadline.
         */
        post: operations["acceptFill"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills/{id}/delivery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report an in-venue delivery
         * @description Reports the venue transfer that delivers a fill on Lighter or Aster ([active market making](/market-making#active-market-making)), with the maker's master session or a `quote` credential of the order's identity. The transfer moves at least `amount_out` from the maker's linked account to `delivery_to`, executes after the take and by `deliver_by`, and delivers only this fill. Lighter: the hash of an internal USDC transfer into collateral, memo the fill id's 16 bytes, zero-padded to 32, at least at status `settlement.delivery.min_status` from `/v1/info` (2 or 3). Aster: the `transferId` of a USDT transfer from the Spot wallet, as both accounts' Spot histories show. Accepted while the payment is `LOCKED` and `maker_leg` is `NONE` or `ABANDONED`, before `report_by` and any refund consent; the operator then claims the payment. Exact retries return the fill.
         */
        post: operations["submitDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my fills
         * @description Nonfinal fills plus the latest 50 final, newest first: a session's taker and maker fills, a credential's identity's maker fills (scope `read`). Over 1000: 503 `SNAPSHOT_TOO_LARGE`; page with `/v1/fills/history`.
         */
        get: operations["getFills"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/withdrawals/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a withdrawal or a send
         * @description Polymarket, Hyperliquid and Aster only ([margin transfers](/how-it-works#margin-transfers)). `amount` must fit a fresh read of the withdrawable balance less what left the account since, else `VALIDATION_ERROR`; a `queued`, `submitting` or `unknown` withdrawal or send on the venue is `STATE_CONFLICT`. On Aster a withdrawal's signed amount adds the venue fee; a send has none. `to: account` sends to `recipient`, another existing account on the same venue: never your own address, venue wallet or deposit address; on Hyperliquid a user or sub-account in mode `default`, `disabled`, `dexAbstraction`, `unifiedAccount` or `portfolioMargin`, without code on HyperEVM. A Polymarket send is an `OpTypedData`: the wallet signs only a hash, so rebuild it from `op` before signing. An Aster send goes out within 50 s of its nonce. Relay within ten minutes.
         */
        post: operations["postWithdrawalPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/withdrawals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Relay a withdrawal
         * @description Records the exact signed operation, then sends it; retries return the record and never resend. A `refused` withdrawal answers 502 `VENUE_REJECTED`, also on retry. Never replace an `unknown` one (transport loss or ambiguous answer): the venue stays blocked until the operator reconciles it.
         */
        post: operations["postWithdrawal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a maker credential
         * @description Creates a maker credential and its quote identity (same `id`) with an immutable `quote_signer`; at most 32 active. Scopes: `read`, `quote`, `cancel`; none reaches financial routes. After a lost response, revoke the credential and create another. `FORBIDDEN` when an admin disabled or archived the maker.
         */
        post: operations["postV1Credentials"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/credentials/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a credential
         * @description Atomically revokes bearer and identity, expires the lease, advances the generation and removes current quotes; reserved fills still settle. Irreversible; repeats answer 204.
         */
        delete: operations["deleteV1CredentialsId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/credentials/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate credential bearer
         * @description Replaces the bearer, keeping signer and identity; advances the generation and expires the lease, removing current quotes (renew the lease, prepare new drafts). Works on expired, not revoked, credentials. Returns the new bearer once.
         */
        post: operations["postV1CredentialsIdRotate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page orders history
         * @description Newest first by creation; a `read` credential sees its identity's orders. Rows show current state ([history](/streaming#history)).
         */
        get: operations["getV1OrdersHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/takes/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page complete takes
         * @description The taker's takes, newest first, each with all its fills; pages never split a take. Rows show current state ([history](/streaming#history)).
         */
        get: operations["getTakeHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fills/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page fills history
         * @description Newest first by creation; a `read` credential sees its identity's maker fills. Rows show current state ([history](/streaming#history)).
         */
        get: operations["getV1FillsHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/withdrawals/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page withdrawals history
         * @description Newest first by creation. Rows show current state ([history](/streaming#history)).
         */
        get: operations["getV1WithdrawalsHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/trades/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page trade history
         * @description Settled trades, newest first by settlement. `a` and `b` together filter a pair, either direction. `scope=mine` needs a session.
         */
        get: operations["getV1TradesHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Replay public events
         * @description Events in commit order ([HTTP replay](/streaming#http-replay)). Persist `next_cursor` after every page, even an empty one with `has_more: true`, until `has_more` is false. A cursor outside retention (seven days or the last million events) or ahead of the journal: 410 `RESYNC_REQUIRED`; take a snapshot.
         */
        get: operations["getV1Events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read public snapshot
         * @description Public books and a committed cursor to replay strictly after.
         */
        get: operations["getV1Snapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Replay private and public events
         * @description Public plus your private events; a credential gets only its identity's orders, maker fills and lease. Credential scope: `read`.
         */
        get: operations["getV1MeEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read private and public snapshot
         * @description Your nonterminal orders and fills and unrevoked quote identities, with a replay cursor; `books` stays empty. Credential scope: `read`.
         */
        get: operations["getV1MeSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * WebSocket event replay
         * @description First text frame, within five seconds: a `StreamSubscription`, else the socket closes; never put `token` in the URL ([WebSocket](/streaming#websocket)). Private streams need a session or `read` credential, rechecked about every 500 ms. Frames are `EventPage`s of up to 100 events, empty about every 500 ms when idle. A `StreamControl` precedes closure on authorization, capacity, resync or journal failure. Any later client message other than ping or pong, or a send blocked five seconds, closes the socket.
         */
        get: operations["getV1Stream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description A venue id from `GET /v1/venues`. */
        VenueId: string;
        /** @description Basis points; the escrow refuses more than 100. */
        FeeBps: number;
        /** @description Decimal base units of the venue's token (`decimals` in `GET /v1/venues`), below 2^256: with 6 decimals, `"1000000"` is 1 token. */
        Amount: string;
        /** @description Any case accepted; responses are lowercase except inside typed data and signed messages. */
        Address: string;
        Bytes32: string;
        /** @description A 65-byte signature `r ‖ s ‖ v`, `v` 0, 1, 27 or 28, `s` low (EIP-2). */
        Signature: string;
        /** @description An EOA signature. Trade proofs of older fills may carry an opaque ERC-1271 signature (up to 16384 bytes) from a quote delegate. */
        QuoteSignature: string;
        /**
         * Format: date-time
         * @description RFC 3339 UTC (`Z` or `+00:00`), fractional seconds optional.
         */
        Timestamp: string;
        Error: {
            error: {
                /** @description Stable; see [errors](/api-reference/overview#errors). */
                code: string;
                /** @description Human-readable; do not parse. */
                message: string;
                /** @description Stable sub-case of `code`, where the route lists its values. */
                reason?: string;
                /** @description `SETUP_REQUIRED`: the venue whose account needs setup. */
                venue?: components["schemas"]["VenueId"];
                /**
                 * @description `SETUP_REQUIRED`: the step to do, by [setup](/api-reference/account/setup).
                 * @enum {string}
                 */
                step?: "permit" | "agent" | "api_key" | (string & {});
                request_id: components["schemas"]["Uuid"];
                /** @description True for 425, 429, 503 and 502 except `VENUE_REJECTED`. Retry with the same client id, draft or signed operation; an uncertain withdrawal may have succeeded. */
                retryable: boolean;
            };
        };
        Venue: {
            id: components["schemas"]["VenueId"];
            name: string;
            /** @description Enabled and configured in this deployment. */
            enabled: boolean;
            /**
             * @description `escrow`: the maker's side of each fill locks in the escrow on `chain`. `venue` (Lighter, Aster): the maker delivers inside the venue ([active market making](/market-making#active-market-making)); `chain` only names signing terms. Null for a disabled venue.
             * @enum {string|null}
             */
            settlement: "escrow" | "venue" | null;
            /** @description Null for a disabled venue. */
            chain: components["schemas"]["EscrowChain"] | null;
            /** @description Margin-transfer format; null when disabled or without margin transfers (Lighter). */
            margin_move: components["schemas"]["MarginMoveSpec"] | null;
            /** @description Smallest amount the venue credits (deposit contract, or Lighter's 1 USDC transfer); a smaller escrow release stays in escrow. Null when none. */
            release_minimum: string | null;
        };
        EscrowChain: {
            /** @description 999 HyperEVM, 137 Polygon; on Lighter or Aster its signing chain id, 304 for Lighter (`escrow` its zkLighter contract, `token` Ethereum's USDC), 56 for Aster (`escrow` its vault, `token` BSC's USDT). */
            id: number;
            escrow: components["schemas"]["Address"];
            token: components["schemas"]["Address"];
            symbol: string;
            decimals: number;
            /** @description EIP-2612 domain name and version; the chain id and token complete it. Null on Lighter and Aster. */
            permit: {
                name: string;
                version: string;
            } | null;
        };
        MarginMoveSpec: {
            /** @description `primaryType` of a `margin_move` item. */
            primary_type: string;
            types: components["schemas"]["Eip712Types"];
            domain: components["schemas"]["Eip712Domain"];
            /** @description Fields every transfer signs with these values; addresses compare case-insensitively. Fields that vary: amount, nonce or salt and time; Hyperliquid `sourceDex`; Polymarket `account` (your signer) and `to` (`venue_wallet`, signer or deposit address per destination); Aster `destination` (your signer) and `fee`. */
            fixed: {
                [key: string]: unknown;
            };
            /**
             * @description Signed amount format: integer base units, or decimal tokens such as `"5.25"`.
             * @enum {string}
             */
            amount: "base_units" | "decimal" | (string & {});
            /** @description `to` values `POST /v1/withdrawals/prepare` accepts on this venue. */
            destinations: ("wallet" | "signer" | "escrow")[];
        };
        Book: {
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            /** @description Most one fill takes from one level, in `to` base units. */
            max_fill: components["schemas"]["Amount"];
            /** @description The pair's taker fee now, for a take consenting to it with `max_fee_bps`. Levels show the makers' prices without it. */
            taker_fee_bps: components["schemas"]["FeeBps"];
            levels: components["schemas"]["Level"][];
        };
        Route: {
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            /** @description What the first take pays, in `from` base units. */
            amount_in: components["schemas"]["Amount"];
            /** @description True when the route spends less than the request beyond rounding: what it leaves buys a base unit of output or more per part. */
            capped: boolean;
            /** @description What the last take delivers, in `to` base units. */
            amount_out: components["schemas"]["Amount"];
            /** @description The takes in order. Of two, the first delivers on the intermediate venue, from where the second pays; its `amount_in` is less than the first's `amount_out` by what that venue keeps. */
            legs: {
                from: components["schemas"]["VenueId"];
                to: components["schemas"]["VenueId"];
                amount_in: components["schemas"]["Amount"];
                amount_out: components["schemas"]["Amount"];
                /** @description Price levels the take goes through. */
                parts: number;
                /** @description The take's fee at `taker_fee_bps`, included in its amounts: in `from` base units, or in `to` base units when it pays from Lighter or Aster. */
                taker_fee: components["schemas"]["Amount"];
                /** @description The pair's fee now, which the take's `max_fee_bps` must accept; 0 without the request's `max_fee_bps`. */
                taker_fee_bps: components["schemas"]["FeeBps"];
            }[];
        };
        /** @description One quote of an order: the taker pays `receive` on `from` per `supply` on `to`. */
        Level: {
            order_id: components["schemas"]["Bytes32"];
            /** @description The quote's position in the order's signed set. */
            quote_index: number;
            /** @description Price denominator and this quote's budget in the sequence, in `to` base units. */
            supply: components["schemas"]["Amount"];
            /** @description Price numerator, in `from` base units. */
            receive: components["schemas"]["Amount"];
            /** @description Least of: unlocked funds less reserved fills and delivery fees; `quote_size` less this sequence's fills; `supply` less this quote's fills (abandoned maker legs excluded). An order's levels in a book share the first two, best price first. */
            available: components["schemas"]["Amount"];
            /** @description Executable minimum, `to` base units: the signed minimum, raised so the payment meets the `from` venue's `release_minimum`. The `to` venue's minimum applies to a take's total. */
            min_fill: components["schemas"]["Amount"];
            /** @description Signed on-chain settlement deadline, after `valid_until`. */
            expires_at: components["schemas"]["Timestamp"];
            quoted_at: components["schemas"]["Timestamp"];
            sequence: number;
            /** @description Last admission time. */
            valid_until: components["schemas"]["Timestamp"];
        };
        SignedAgreement: {
            signer: components["schemas"]["Address"];
            typed_data: components["schemas"]["TypedData"];
            signature: components["schemas"]["QuoteSignature"];
            digest: components["schemas"]["Bytes32"];
        };
        TradeProof: {
            /**
             * @description 2 for a trade with a taker fee, which `taker_fee` and `taker_fee_venue` give.
             * @enum {integer}
             */
            version: 1 | 2;
            /** Format: uuid */
            id: string;
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            /** @description Version 2: the fee the `swap_id` carries. Paid from an escrow, `amount_in` less it pays the maker's price for `amount_out`; paid from Lighter or Aster, `amount_in` pays the price of `amount_out` plus it, which the maker's offer delivered to the fee recipient. */
            taker_fee?: components["schemas"]["Amount"];
            /** @description Version 2: the venue whose token `taker_fee` is in. */
            taker_fee_venue?: components["schemas"]["VenueId"];
            swap_id: components["schemas"]["Bytes32"];
            order_id: components["schemas"]["Bytes32"];
            sequence: number;
            /** @description The priced quote's position in the maker's signed set. */
            quote_index: number;
            maker_owner: components["schemas"]["Address"];
            payer: components["schemas"]["Address"];
            maker_recipient: components["schemas"]["Address"];
            taker_recipient: components["schemas"]["Address"];
            settled_at: components["schemas"]["Timestamp"];
            maker: components["schemas"]["SignedAgreement"];
            /** @description The owner's `FundOffer`; null for in-venue inventory, whose maker authority LaMarge attests. */
            maker_authorization: components["schemas"]["SignedAgreement"] | null;
            /** @description The delivery of a fill to Lighter or Aster; null otherwise. */
            delivery: {
                venue: components["schemas"]["VenueId"];
                /** @description The Lighter transaction hash, or the Aster `transferId`. */
                tx_hash: string;
                /** @description The taker's account on the venue: a Lighter index in decimal, an Aster address. */
                account: string | null;
                /** Format: date-time */
                executed_at: string | null;
            } | null;
            /** @description The payer's `PayTake`; this trade's payment is its `LockPayment` with this `swap_id`. Null for a take paid from Lighter or Aster (see `payment`). */
            taker: components["schemas"]["SignedAgreement"] | null;
            /** @description The taker's executed transfer, for a take paid from Lighter or Aster; null otherwise. */
            payment: {
                venue: components["schemas"]["VenueId"];
                /** @description Lighter's transaction hash, without `0x`, or Aster's `transferId`. */
                tx_hash: string;
                executed_at: components["schemas"]["Timestamp"] | null;
                /** @description The transfer as sent: Lighter's transaction, or on Aster `{msg, signature}`, the request the payer's wallet signed as `Message{msg}` at chain 1666. */
                tx_info: {
                    [key: string]: unknown;
                };
            } | null;
            transactions: components["schemas"]["Transaction"][];
        };
        Volume: {
            a: components["schemas"]["VenueId"];
            b: components["schemas"]["VenueId"];
            /** @description In `b` base units. */
            volume_24h: components["schemas"]["Amount"];
            trades_24h: number;
        };
        Health: {
            /** @enum {string} */
            status: "ok" | "degraded" | (string & {});
            ready: boolean;
            server_time: components["schemas"]["Timestamp"];
            /** @description Relay transactions pending on all chains. */
            pending_transactions: number;
            /** @description Events committed but not yet given a cursor. */
            journal_unpublished: number;
            journal_oldest_unpublished_seconds: number | null;
            chains: components["schemas"]["ChainHealth"][];
        };
        Challenge: {
            /** @description Sign with `personal_sign` exactly as given. */
            message: string;
            nonce: string;
            expires_at: components["schemas"]["Timestamp"];
            /** @description Not returned: Aster's agent approval is the `agent` setup step's `to_sign`. */
            typed_data?: components["schemas"]["TypedData"];
        };
        Session: {
            token: string;
            expires_at: components["schemas"]["Timestamp"];
            session_id: components["schemas"]["Uuid"];
        };
        LinkedAccount: {
            setup: components["schemas"]["SetupSteps"];
            venue: components["schemas"]["VenueId"];
            /** @description Owner of the venue account; signs its transfers. */
            address: components["schemas"]["Address"];
            /** @description Polymarket: the signer's Deposit Wallet or Safe. Lighter: the account index. Null elsewhere. */
            venue_wallet: string | null;
            linked_at: components["schemas"]["Timestamp"];
        };
        /** @description The account's setup steps as recorded, without reading the venue: Hyperliquid and Polymarket `permit`, Aster `agent`, Lighter `api_key` (when paying from Lighter is on). A use whose steps are not `done` answers `SETUP_REQUIRED` naming the venue and step: making needs `permit` and `agent`, paying `agent` and `api_key` (wallet funds also the permit, read when used), receiving `agent`. An Aster account without its agent is not read. */
        SetupSteps: components["schemas"]["SetupStatus"][];
        SetupStatus: {
            /** @enum {string} */
            step: "permit" | "agent" | "api_key" | (string & {});
            /**
             * @description `pending`: submitted, not yet shown by the venue (ten minutes at most).
             * @enum {string}
             */
            status: "done" | "pending" | "required" | (string & {});
            /** @description Why a step done before is required again: the venue refused it, it expired, the linked address or LaMarge's escrow, agent or key changed. */
            reason: string | null;
            /** @description When the step lapses (Aster's agent approval, 365 days). */
            expires_at: components["schemas"]["Timestamp"] | null;
            needed_for: ("make" | "pay" | "receive")[];
        };
        SetupStep: components["schemas"]["SetupStatus"] & {
            /** @description The request to sign, returned by preparing a required step: `permit` (EIP-712 `typed_data`), `aster_approval` (EIP-712 `typed_data`, valid 60 seconds) or `lighter_api_key` (`message`, signed with `personal_sign`). Submit it with its `ref`. */
            to_sign: null | {
                /** @enum {string} */
                kind: "permit" | "aster_approval" | "lighter_api_key" | (string & {});
                signer: components["schemas"]["Address"];
                ref: string;
                typed_data?: components["schemas"]["TypedData"];
                message?: string;
                expires_at?: components["schemas"]["Timestamp"];
            };
            /** @description The permit's relay transaction, while one is known. */
            hash: string | null;
        };
        VenueSetup: {
            venue: components["schemas"]["VenueId"];
            address: components["schemas"]["Address"];
            /** @description Every step is done. */
            ready: boolean;
            steps: components["schemas"]["SetupStep"][];
        };
        Me: {
            master_address: components["schemas"]["Address"];
            created_at: components["schemas"]["Timestamp"];
            accounts: components["schemas"]["LinkedAccount"][];
            quote_identity_id: components["schemas"]["Uuid"];
            access: components["schemas"]["AccessState"];
            admin: boolean;
        };
        /**
         * @description Whether the user may make new commitments: `required` in invite mode until a code is redeemed or an admin admits the user; admins always `granted`.
         * @enum {string}
         */
        AccessState: "granted" | "required" | "suspended" | (string & {});
        Balance: {
            setup: components["schemas"]["SetupSteps"];
            holdings: components["schemas"]["Holdings"];
            portfolio: components["schemas"]["PortfolioObservation"];
            venue: components["schemas"]["VenueId"];
            address: components["schemas"]["Address"];
            /** @description Null on venues without one. */
            venue_wallet: string | null;
            /** @description Null before the first read. */
            equity: string | null;
            /** @description What can leave the venue margin, less transfers relayed since `read_at` and, at Lighter and Aster, payments and deliveries made since then. */
            withdrawable: string | null;
            /** @description Estimated venue withdrawal fee; 0 when none, null when unavailable. Rechecked at preparation. */
            withdrawal_fee: string | null;
            /** @description True when `withdrawable` is only an upper bound from the venue's public data; false while `read_at` is null ([venues](/how-it-works#venues-and-balances)). */
            withdrawable_estimated: boolean;
            /** @description Account mode on venues with several ([venues](/how-it-works#venues-and-balances)). */
            mode: string | null;
            /** @description False while the venue knows no account for the address; true while `read_at` is null. */
            has_account: boolean;
            /** @description Venue token outside the margin, where the venue has one ([venues](/how-it-works#venues-and-balances)). */
            wallet: string | null;
            /** @description A standard Hyperliquid account's trade.xyz balance (HIP-3 dex `xyz`), apart from `equity` and `withdrawable`; `withdrawable` less transfers from there relayed since `read_at`; in the holdings' `total`, not their `available`. Null elsewhere and on a unified account, whose one balance includes it. */
            xyz: {
                /** @description Base units; negative when losses exceed the deposits there. */
                equity: string;
                withdrawable: components["schemas"]["Amount"];
                /**
                 * Format: date-time
                 * @description trade.xyz's own last read, null (with zero amounts) until the first; a failed one keeps the previous values. A payment from there needs it within two minutes.
                 */
                read_at: string | null;
            } | null;
            /** @description Token balance of the linked address on the escrow chain, less what a payment locked since `chain_read_at` took beyond `escrow_balance`. */
            chain_balance: string | null;
            /** @description The available balance (order ID zero), which takes pay from first, less payments locked since `chain_read_at`. Read with `chain_balance`. */
            escrow_balance: string | null;
            /** @description Waiting at `deposit_address` to be swept into the available balance ([balances](/how-it-works#balances)). Read with `chain_balance`. */
            deposit_balance: string | null;
            /** @description Tokens sent here become the linked address's available balance; null on Lighter and Aster. */
            deposit_address: components["schemas"]["Address"] | null;
            /**
             * Format: date-time
             * @description Last successful venue read.
             */
            read_at: string | null;
            /** @description Why the last venue read failed; null on success. */
            error: string | null;
            chain_read_at: components["schemas"]["Timestamp"] | null;
            chain_error: string | null;
        };
        /**
         * @description Where `held` is: `escrow`, unlocked in the escrow; `venue`, a Lighter or Aster pool's share of its account's balance, part of that venue's `equity`.
         * @enum {string}
         */
        HeldIn: "escrow" | "venue" | (string & {});
        /** @description The account's funds on the venue, in its wallets and in the escrow, from the same snapshot as `portfolio`, each counted once, in the venue token's base units. */
        Holdings: {
            /** @description Movable or committable now: the venue's withdrawable margin less what a pool still owes, the wallets, and the escrow's available balance, less `committed`. */
            available: string;
            /** @description `total` − `available`: escrow orders, fills in progress, `committed`, deposits awaiting the sweep, what a pool owes and the margin positions use. */
            locked: string;
            /** @description What the account's takes not paid yet will spend of its escrow chain's wallet and available balance: held for them, in `locked`, counted once in `total`; 0 on Lighter and Aster, which pay one take at a time. */
            committed: components["schemas"]["Amount"];
            /** @description Unlocked escrow of the account's orders this deployment operates, Lighter and Aster pools excluded. */
            orders: components["schemas"]["Amount"];
            /** @description A Lighter or Aster pool's inventory: part of `equity`, never added to it. */
            pool: components["schemas"]["Amount"];
            /** @description Legs of the account's fills locked in escrow, as maker or taker. */
            trades: components["schemas"]["Amount"];
            /** @description `equity` + `wallet` + `chain_balance` + `escrow_balance` + `deposit_balance` + `orders` + `trades`, an unread value counting as zero; signed, as `equity` can be negative. */
            total: string;
        };
        Stats: {
            maker: components["schemas"]["MakerResults"];
            /** @description One per venue (escrow chains, then Lighter and Aster), by output venue. */
            assets: components["schemas"]["StatsAsset"][];
            trades_30d: number;
        };
        /** @description EIP-712 typed data for `eth_signTypedData_v4`. Keep each integer as prepared, JSON number or decimal string. */
        TypedData: {
            types: components["schemas"]["Eip712Types"];
            primaryType: string;
            domain: components["schemas"]["Eip712Domain"];
            message: {
                [key: string]: unknown;
            };
        };
        /** @description A Polymarket Perps operation (`primaryType` `Op`, a domain without `verifyingContract`): `message.data` is `keccak256` of the MessagePack of `[op.type, [op.args.account, op.args.token, op.args.amount, op.args.to]]`, those exact strings. Sign `domain`, `types`, `primaryType` and `message` only. */
        OpTypedData: {
            types: components["schemas"]["Eip712Types"];
            /** @enum {string} */
            primaryType: "Op" | (string & {});
            domain: {
                name: string;
                version: string;
                chainId: number;
            };
            message: {
                data: string;
                salt: number;
                /** @description Milliseconds. */
                ts: number;
            };
            op: {
                /** @enum {string} */
                type: "internalTransfer" | (string & {});
                args: {
                    /** @description Checksummed. */
                    account: string;
                    /** @description Checksummed. */
                    token: string;
                    /** @description Decimal pUSD. */
                    amount: string;
                    /** @description Checksummed. */
                    to: string;
                };
            };
        };
        Eip712Types: {
            [key: string]: {
                name: string;
                type: string;
            }[];
        };
        Eip712Domain: {
            name: string;
            version?: string;
            chainId: number;
            verifyingContract: components["schemas"]["Address"];
        };
        /** @description An order of a linked address in an escrow, with its unlocked funds. */
        EscrowOrder: {
            venue: components["schemas"]["VenueId"];
            /** @description Zero is the owner's available balance; other ids are funded orders. */
            order_id: components["schemas"]["Bytes32"];
            owner: components["schemas"]["Address"];
            /** @description Unlocked; what a close releases. */
            available: components["schemas"]["Amount"];
            /** @description Operator named at funding. */
            operator: components["schemas"]["Address"];
            /** @description Funded with this deployment's operator; `POST /v1/closes` can close it. */
            managed: boolean;
            /** @description Your own order operated by this deployment, already in `/v1/balances` `holdings.orders`. Order zero is `escrow_balance` there; other orders add to it. */
            in_balances: boolean;
            /** @description A withdrawal or close by signature is pending. */
            closing: boolean;
        };
        /** @description One item to sign with `eth_signTypedData_v4`. */
        ToSign: {
            /**
             * @description Signer: the quote signer for `quote_set`, the master for `close_orders`, else the linked owner.
             * @enum {string}
             */
            kind: "margin_move" | "fund" | "quote_set" | "close_orders" | "pay_take" | "close_offer" | "escrow_withdrawal" | "refund_payment" | (string & {});
            signer: components["schemas"]["Address"];
            /**
             * Format: uuid
             * @description The take id for `pay_take`; the fill id for `refund_payment`.
             */
            fill_id?: string;
            typed_data: components["schemas"]["TypedData"];
        };
        /** @description A take paid from Lighter: sign Lighter's owner message for the transfer `typed_data` names with `personal_sign`, not EIP-712. */
        LighterTransferItem: {
            /** @enum {string} */
            kind: "lighter_transfer" | (string & {});
            /** @description The taker's linked Lighter address, which signs `L1Sig`. */
            signer: components["schemas"]["Address"];
            /**
             * Format: uuid
             * @description The take id.
             */
            fill_id: string;
            typed_data: components["schemas"]["LighterTransferTerms"];
        };
        /** @description The internal transfer LaMarge sends from your Lighter account once every maker accepted, signed by its key at `api_key_index` and `nonce`: USDC (asset 3) between collateral routes (0), on chain 304. Build Lighter's transfer message from these terms and sign it. */
        LighterTransferTerms: {
            /**
             * @description The index of LaMarge's key on your account, 254 in production and 253 in development.
             * @enum {integer}
             */
            api_key_index: 254 | 253;
            /** @description The taker's linked Lighter account. */
            from_account_index: number;
            /** @description The maker's linked Lighter account. */
            to_account_index: number;
            amount: components["schemas"]["Amount"];
            /** @description What Lighter charges the taker's account on top. */
            usdc_fee: components["schemas"]["Amount"];
            /** @description The fill id's 16 bytes then 16 zero bytes, as 64 hexadecimal characters. */
            memo: string;
            /** @description The nonce of LaMarge's key the transfer uses. */
            nonce: number;
        };
        /** @description A take paid from Aster: the transfer request itself, which your wallet signs with `eth_signTypedData_v4` at chain 1666 ([add that network](/api-reference/market-data/aster-signing-network)). LaMarge relays it once the maker is locked; Aster refuses it from about a minute after its nonce. Nothing else can be sent with it. */
        AsterTransferItem: {
            /** @enum {string} */
            kind: "aster_transfer" | (string & {});
            /** @description The taker's linked Aster address. */
            signer: components["schemas"]["Address"];
            /**
             * Format: uuid
             * @description The take id.
             */
            fill_id: string;
            /** @description `Message{msg}`, `AsterSignTransaction` domain, chain 1666, where `msg` is `asset=USDT&amount=…&toAddress=…&clientTranId=…&nonce=…&user=…`: `amount_in` with six decimals at most, rounded up, to the maker's linked Aster address, the take id in 32 hexadecimal characters, a microsecond nonce 55 seconds ahead, from your address, addresses checksummed. */
            typed_data: components["schemas"]["TypedData"];
        };
        /** @description Aster only, required until the withdrawal is recorded (exact retries need none): the account's own signature over this withdrawal request, relayed as is within 50 seconds of `nonce`. */
        AsterEnvelope: {
            /** @description The account itself. */
            signer: components["schemas"]["Address"];
            /** @description The current time in microseconds. */
            nonce: string;
            /** @description The account's EIP-712 signature of `Message{msg}`, `AsterSignTransaction` domain, chain 56, where `msg` is `chainId=56&asset=USDT&amount=…&fee=…&receiver=…&userNonce=…&userSignature=…&signatureChainId=56&nonce=…&user=…&signer=…`: the withdrawal's `amount`, `fee`, destination and `nonce`, its signature lowercase with v 27 or 28, then this nonce and the account twice, addresses checksummed. */
            signature: components["schemas"]["Signature"];
        };
        Signatures: {
            /** @description One per requested (`kind`, `fill_id`), no extras or duplicates; a close uses its first `close_orders` item. */
            signatures: {
                kind: string;
                /**
                 * Format: uuid
                 * @description Take items only.
                 */
                fill_id?: string;
                signature: components["schemas"]["QuoteSignature"];
                /** @description An Aster `margin_move` only. */
                envelope?: components["schemas"]["AsterEnvelope"];
            }[];
        };
        /**
         * @description Where the deposit, the added capital the available balance does not cover, comes from ([maker capital](/how-it-works#maker-capital)). `wallet`: the linked address on the escrow chain; `VALIDATION_ERROR` if it holds less than the deposit. `venue`: one `margin_move` of the whole deposit to the linked address; the funding goes once that address holds the deposit, and fails if it does not within 10 minutes of the move.
         * @enum {string}
         */
        FundingSource: "wallet" | "venue" | (string & {});
        MakerInput: {
            client_request_id: components["schemas"]["ClientId"];
            /** @description Default the browser identity; an API identity needs an active credential. */
            quote_identity_id?: components["schemas"]["Uuid"];
            /** @description Capital to add. A pool's first funding is at least 5 tokens. */
            amount: components["schemas"]["Amount"];
            funding_source: components["schemas"]["FundingSource"];
        };
        MakerPreparation: {
            id: components["schemas"]["Uuid"];
            client_request_id: components["schemas"]["ClientId"];
            /** @enum {string} */
            state: "preparing" | "accepted" | "complete" | "cancelled" | "failed" | (string & {});
            venue: components["schemas"]["VenueId"];
            order: components["schemas"]["Order"];
            to_sign: components["schemas"]["ToSign"][];
            sequence: number | null;
            /** @description One hour after preparation, ten minutes with a `margin_move`; then cancelled if unsigned. */
            expires_at: components["schemas"]["Timestamp"];
            expected_revision: components["schemas"]["Cursor"];
            intent: {
                amount: components["schemas"]["Amount"];
                quote_identity_id: components["schemas"]["Uuid"];
                funding_source: components["schemas"]["FundingSource"];
            };
            funding: {
                existing_available: components["schemas"]["Amount"];
                wallet_amount: components["schemas"]["Amount"];
                venue_amount: components["schemas"]["Amount"];
                idle_amount: components["schemas"]["Amount"];
            };
        };
        Order: {
            preparation_id: components["schemas"]["Uuid"] | null;
            /** @description Current pool of its quote identity, venue and owner. */
            capital_pool: boolean;
            held_in: components["schemas"]["HeldIn"];
            /** @description The escrow's `offerId`. */
            id: components["schemas"]["Bytes32"];
            /** @description Supply venue. */
            venue: components["schemas"]["VenueId"];
            /** @description The escrow offer's owner, the maker's linked address on `venue`. */
            owner_address: components["schemas"]["Address"];
            state: components["schemas"]["OrderState"];
            /** @description Why the order, its funding or its last close failed. */
            error: string | null;
            /** @description Funded amount; on Lighter or Aster, the maker's cap that deliveries consume. */
            amount: components["schemas"]["Amount"];
            /** @description What the order holds, where `held_in` says: unlocked escrow; for a Lighter or Aster pool, its account's transferable balance at the last read less deliveries since, within the cap left. */
            held: components["schemas"]["Amount"];
            /** @description Inside a venue, the last-read per-delivery fee, held back per reserved fill and for the next; `0` for an escrow order. */
            delivery_fee: components["schemas"]["Amount"];
            revision: components["schemas"]["Cursor"];
            /** @description `held` less unlocked admitted fills, their delivery fees and the next fill's, and your withdrawals on their way; ignores quotes. Shared across receiving venues. */
            available_to_quote: components["schemas"]["Amount"];
            /** @description Settled fills' payments per paying venue, in its base units. */
            received_by_venue: {
                venue: components["schemas"]["VenueId"];
                amount: components["schemas"]["Amount"];
            }[];
            /** @description `quote_size` left in the current sequence, capped by `available_to_quote`. Check `quote_set.active` too. */
            quotable: components["schemas"]["Amount"];
            /** @description Taken by settled fills, in `venue` base units. */
            filled: components["schemas"]["Amount"];
            /** @description Highest stored quote sequence; 0 without one. */
            last_sequence: number;
            /** @description Null without a current quote set; `active` covers its validity, the lease and the identity. */
            quote_set: components["schemas"]["QuoteSet"] | null;
            margin_move: components["schemas"]["MarginMove"] | null;
            /** @description Relayed transactions, oldest first: `fund`, `close`. */
            transactions: components["schemas"]["Transaction"][];
            created_at: components["schemas"]["Timestamp"];
            updated_at: components["schemas"]["Timestamp"];
            /** @description `client_request_id` of the creating preparation. */
            client_order_id: components["schemas"]["ClientId"];
            quote_identity_id: components["schemas"]["Uuid"];
            quote_signer: components["schemas"]["Address"];
        };
        QuoteSet: {
            sequence: number;
            expires_at: components["schemas"]["Timestamp"];
            quotes: (components["schemas"]["Quote"] & {
                /** @description What this quote alone can still fill. */
                available: components["schemas"]["Amount"];
                /** @description What its book level shows once the order's better levels draw on shared funds; zero when hidden. */
                offered: components["schemas"]["Amount"];
            })[];
            signature: components["schemas"]["QuoteSignature"];
            created_at: components["schemas"]["Timestamp"];
            valid_until: components["schemas"]["Timestamp"];
            /** @description Admission budget of this sequence; not signed on chain. */
            quote_size: components["schemas"]["Amount"];
            identity_generation: components["schemas"]["Cursor"];
            active: boolean;
        };
        /** @description As signed; price is `receive` on `venue` per `supply` of the order's venue. */
        Quote: {
            venue: components["schemas"]["VenueId"];
            chain_id: number;
            token: components["schemas"]["Address"];
            recipient: components["schemas"]["Address"];
            supply: components["schemas"]["Amount"];
            receive: components["schemas"]["Amount"];
            min_fill: components["schemas"]["Amount"];
        };
        /** @description Move out of the venue margin, relayed as a withdrawal. */
        MarginMove: {
            venue: components["schemas"]["VenueId"];
            amount: components["schemas"]["Amount"];
            /** @description The venue's transfer reference, if any. */
            venue_ref: string | null;
            state: components["schemas"]["WithdrawalState"];
            error: string | null;
            at: components["schemas"]["Timestamp"];
        };
        Transaction: {
            /**
             * @description `maker_lock`, `taker_claim` and `refund_maker`: fills settled before deliveries.
             * @enum {string}
             */
            kind: "fund" | "close" | "payment" | "deliver" | "maker_claim" | "refund_payment" | "maker_lock" | "taker_claim" | "refund_maker" | (string & {});
            chain_id: number;
            /** @description Null if never broadcast. */
            hash: string | null;
            /**
             * @description `pending`: no finalized receipt; `replaced`: its nonce taken by a replacement, still watched; `reverted`: reverted on chain; `failed`: never broadcast (failed gas estimation included) or its nonce went to another transaction.
             * @enum {string}
             */
            status: "pending" | "replaced" | "mined" | "reverted" | "failed" | (string & {});
            error: string | null;
            at: components["schemas"]["Timestamp"];
        };
        TransferInput: {
            client_transfer_id: components["schemas"]["ClientId"];
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            amount_in: components["schemas"]["Amount"];
            min_out: components["schemas"]["Amount"];
            /** @default 8 */
            max_parts?: number;
            /** @description The linked account on `from`. */
            payer: components["schemas"]["Address"];
            /** @description The linked account on `to`. */
            recipient: components["schemas"]["Address"];
            /** @description A route through `to`: where it ends. Its second transfer, from `to`, names this one in `previous_transfer_id`. */
            then?: components["schemas"]["TransferThen"];
            /** @description The transfer with `then` this one continues, from its `to` and `recipient` to its `then`, once no part of its take can deliver more: at most its `continuable`. It replaces an earlier continuation that neither took nor sent a withdrawal still in flight. */
            previous_transfer_id?: components["schemas"]["Uuid"];
            /** @description The highest taker fee its take accepts: a pair whose fee is higher is `VALIDATION_ERROR` with reason `fee_above_max`. Without it, its take pays no fee. Its take must send the same; a route's second take accepts `then.max_fee_bps`. */
            max_fee_bps?: components["schemas"]["FeeBps"];
            /**
             * @description From Hyperliquid, a standard account: its withdrawal leaves its trade.xyz balance instead of its perps. Never with `previous_transfer_id`, which pays what was delivered.
             * @enum {string}
             */
            from_dex?: "xyz";
            /**
             * @description To Hyperliquid, a standard account, without `then`: the delivery lands on the perps, then the recipient's move to its own trade.xyz, signed after the take ([prepare](/api-reference/transfers/prepare-move)), is relayed as soon as a read shows the delivery there.
             * @enum {string}
             */
            to_dex?: "xyz";
        };
        TransferThen: {
            to: components["schemas"]["VenueId"];
            /** @description The linked account on `to`. */
            recipient: components["schemas"]["Address"];
            /** @description What the second transfer was to pay, in the intermediate venue's base units. */
            amount_in: components["schemas"]["Amount"];
            /** @description Least the route accepts on `to` for that `amount_in`; a continuation paying another amount scales it. */
            min_out: components["schemas"]["Amount"];
            /** @description The highest taker fee the second take accepts, a route signed at once's included. A continuation sends its own. Without it, that take pays no fee. */
            max_fee_bps?: components["schemas"]["FeeBps"];
            /** @description `to`'s chain id, in an intent. */
            readonly chain_id?: number;
        };
        TakeHistoryPage: {
            data: {
                id: components["schemas"]["Uuid"];
                fills: components["schemas"]["Fill"][];
            }[];
            next_cursor: string | null;
            has_more: boolean;
        };
        /** @description Change counter: keep the prior observation while `revision` moves across portfolio reads or `pending` is true. */
        PortfolioObservation: {
            /** @description `<count>:<microseconds>`. */
            revision: string;
            changed_at: components["schemas"]["Timestamp"] | null;
            pending: boolean;
        };
        TransferIntent: {
            id: components["schemas"]["Uuid"];
            client_transfer_id: components["schemas"]["ClientId"];
            /** @description `transfer:<id>`, for the take. */
            client_take_id: components["schemas"]["ClientId"];
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            amount_in: components["schemas"]["Amount"];
            min_out: components["schemas"]["Amount"];
            max_parts: number;
            /** @description As sent; absent when the transfer consented to no fee. */
            max_fee_bps?: components["schemas"]["FeeBps"];
            /**
             * @description As sent; absent when the withdrawal leaves the perps.
             * @enum {string}
             */
            from_dex?: "xyz" | (string & {});
            /**
             * @description As sent; absent when the delivery stays on the perps.
             * @enum {string}
             */
            to_dex?: "xyz" | (string & {});
            /** @description With `to_dex`, the signed move once submitted; null before. */
            move: components["schemas"]["Withdrawal"] | null;
            payer: components["schemas"]["Address"];
            recipient: components["schemas"]["Address"];
            from_chain_id: number;
            to_chain_id: number;
            withdrawal_preparation: {
                amount: components["schemas"]["Amount"];
                typed_data: components["schemas"]["TypedData"];
                created_at: components["schemas"]["Timestamp"];
            } | null;
            withdrawal: components["schemas"]["Withdrawal"] | null;
            /** @description Returned on creation and with `funding_plan=true` while the transfer has no take and is not cancelled: before a withdrawal, or once a relayed withdrawal's funds at the wallet plus the available balance cover `amount_in`. Null otherwise, when paying from Lighter or Aster, or when it cannot be computed. */
            funding_plan: components["schemas"]["FundingPlan"] | null;
            /** @description Why `funding_plan` could not be computed when it was asked for, as the refusal would carry it: such as `VALIDATION_ERROR` for a withdrawable balance short of the amount, `VENUE_UNAVAILABLE` while a chain does not answer, or `STATE_CONFLICT` with `retry_after` while an earlier withdrawal of the account is being sent. Null otherwise. */
            funding_plan_error: {
                /** @description The [error](/api-reference/overview#errors) code. */
                code: string;
                /** @description Human-readable, such as the balance missing; do not parse. */
                message: string;
                /** @description Stable sub-case of `code`, as the refusal would carry it. */
                reason?: string;
                venue?: components["schemas"]["VenueId"];
                /** @enum {string} */
                step?: "permit" | "agent" | "api_key" | (string & {});
                /** @description The HTTP status the refusal would have. */
                status: number;
                /** @description Seconds after which the plan may be computed, as `Retry-After` would say. */
                retry_after?: number;
            } | null;
            take_id: components["schemas"]["Uuid"] | null;
            /** @description True once all its take's fills are final; null without a take. */
            take_final: boolean | null;
            then?: components["schemas"]["TransferThen"];
            /** @description The transfer this one continues. */
            previous_transfer_id: components["schemas"]["Uuid"] | null;
            /** @description With `then`, once no part of its take can deliver more and unless cancelled: what a continuation may still pay, in `to` base units: what the take delivered, less what continuations may pay or paid (fees included) and the next payment's fee, in whole millionths. Null otherwise, or while Lighter's fee is unknown. */
            continuable: components["schemas"]["Amount"] | null;
            cancelled_at: components["schemas"]["Timestamp"] | null;
            created_at: components["schemas"]["Timestamp"];
            /** @description The grouped route this transfer belongs to, as its first or second. */
            grouped: components["schemas"]["GroupedRoute"] | null;
        };
        /** @description A grouped route, signed at once: its first transfer pays from Lighter or Aster, through an escrow venue. `prepared`: its takes hold no maker inventory; sign and commit before `commit_by`. `committed`: the operator reserves both inventories just before the first payment, then runs the route; nothing is left to sign. `aborted`: never committed, its second take released; the caller decides whether to sign the first alone. `closed`: committed, and nothing of it can move any more; what is left continues from `continuable`. */
        GroupedRoute: {
            /** @enum {string} */
            state: "prepared" | "committed" | "aborted" | "closed" | (string & {});
            second_transfer_id: components["schemas"]["Uuid"];
            first_take_id: components["schemas"]["Uuid"];
            second_take_id: components["schemas"]["Uuid"] | null;
            /** @description Every signature must be committed before it. */
            commit_by: components["schemas"]["Timestamp"];
        };
        GroupedPreparation: {
            route: components["schemas"]["GroupedRoute"];
            /** @description The first take and its request, signed first. */
            first: components["schemas"]["TakePreparation"];
            /** @description The second take and its `pay_take`, signed last. */
            second: components["schemas"]["TakePreparation"];
        };
        TransferPage: {
            data: components["schemas"]["TransferIntent"][];
            next_cursor: string | null;
            has_more: boolean;
        };
        TakeInput: {
            /** @description The venue the taker pays on. */
            from: components["schemas"]["VenueId"];
            /** @description The venue the taker receives on. */
            to: components["schemas"]["VenueId"];
            /** @description Most the taker pays, in `from` base units. */
            amount_in: components["schemas"]["Amount"];
            /** @description Least to reserve, in `to` base units, else `SLIPPAGE`; fills settle independently, so less may arrive. */
            min_out: components["schemas"]["Amount"];
            /** @description Take for this transfer: same terms and `client_take_id`, not cancelled, and any prepared withdrawal `relayed`. */
            transfer_intent_id?: components["schemas"]["Uuid"];
            client_take_id: components["schemas"]["ClientId"];
            /**
             * @description Most maker fills; part of the request's identity for retries.
             * @default 8
             */
            max_parts?: number;
            /** @description The highest taker fee accepted, as the book's `taker_fee_bps`: a higher one is `VALIDATION_ERROR` with reason `fee_above_max`, before anything is reserved. Without it the take pays no fee. Part of the request's identity for retries. */
            max_fee_bps?: components["schemas"]["FeeBps"];
        };
        /** @description One order's share of a take, as its taker or maker sees it. */
        Fill: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            take_id: string;
            role: components["schemas"]["FillRole"];
            order_id: components["schemas"]["Bytes32"];
            /** @description Quote sequence it was accepted under. */
            sequence: number;
            /** @description Its quote's index in that set. */
            quote_index: number;
            /** @description Names the payment and its delivery. */
            swap_id: components["schemas"]["Bytes32"];
            /** @description sha256 of the secret that releases the payment to the maker. */
            hashlock: components["schemas"]["Bytes32"];
            /** @description The maker's once the fill is delivered (`maker_leg` `CLAIMED`): with it, anyone can claim the payment into `maker_recipient` before `t2`, without LaMarge. Null for the taker. */
            secret: string | null;
            from_venue: components["schemas"]["VenueId"];
            to_venue: components["schemas"]["VenueId"];
            /** @description What the taker receives on `to_venue`. */
            amount_out: components["schemas"]["Amount"];
            /** @description What the taker pays on `from_venue`: `ceil(maker_out × receive / supply)`, plus `taker_fee` when it is in `from_venue`'s token. */
            amount_in: components["schemas"]["Amount"];
            /** @description The taker fee, fixed at acceptance, in `taker_fee_venue` base units and carried by `swap_id`: paid from an escrow, part of the payment, which the claim pays to the fee recipient; paid from Lighter or Aster, delivered by the maker's offer on top of `amount_out`. `0` without a fee. */
            taker_fee: components["schemas"]["Amount"];
            taker_fee_bps: components["schemas"]["FeeBps"];
            /** @description `from_venue`, or `to_venue` when the taker pays from Lighter or Aster; null without fee. */
            taker_fee_venue: components["schemas"]["VenueId"] | null;
            /** @description What leaves the maker's order, in `to_venue` base units, against its funds and quotes. */
            maker_out: components["schemas"]["Amount"];
            /** @description What the maker receives of the payment, in `from_venue` base units. */
            maker_in: components["schemas"]["Amount"];
            /** @description The taker's linked address on `from_venue`. */
            payer: components["schemas"]["Address"];
            /** @description The order's owner on `to_venue`. */
            maker_owner: components["schemas"]["Address"];
            /** @description The quote's payment recipient. */
            maker_recipient: components["schemas"]["Address"];
            /** @description The taker's linked address on `to_venue`. */
            taker_recipient: components["schemas"]["Address"];
            payment_leg: components["schemas"]["PaymentLeg"];
            /**
             * @description Where the maker's claimed payment was released; null until observed.
             * @enum {string|null}
             */
            payment_destination: "venue" | "escrow" | null;
            /**
             * @description Where the taker's claimed output was released; null until observed.
             * @enum {string|null}
             */
            maker_destination: "venue" | "escrow" | null;
            /**
             * Format: date-time
             * @description When the taker's signatures were accepted; null before.
             */
            signed_at?: string | null;
            /**
             * Format: date-time
             * @description Block time of the finalized payment lock; null before it is observed, and for a payment from Lighter or Aster.
             */
            payment_locked_at?: string | null;
            /**
             * Format: date-time
             * @description Block time of the finalized claim releasing the taker's output; on Lighter or Aster, the accepted delivery's execution time. Null until observed or without historical timing.
             */
            maker_claimed_at?: string | null;
            maker_leg: components["schemas"]["MakerLeg"];
            state: components["schemas"]["FillState"];
            /** @description Why the fill expired or stopped. */
            reason: string | null;
            /** @description Payment must lock by then. */
            pay_by: components["schemas"]["Timestamp"];
            /** @description On an escrow venue, the delivery's deadline: LaMarge's delivery names it and the escrow refuses it after; still undelivered then, the payment returns at once. Before deliveries, the maker lock's refund time. */
            t1: components["schemas"]["Timestamp"];
            /** @description Payment refund time. */
            t2: components["schemas"]["Timestamp"];
            /**
             * Format: date-time
             * @description Delivery on Lighter or Aster (`to_venue` settled `venue`): when the maker's transfer must execute. Paid and unreported ten minutes later, the maker leg is `ABANDONED` ([timeline](/market-making#active-market-making)). Null on an escrow venue.
             */
            deliver_by: string | null;
            /**
             * Format: date-time
             * @description Delivery on Lighter or Aster: deadline to report a transfer executed by `deliver_by` (`t2` less ten minutes), unless a refund is authorized first. Null on an escrow venue.
             */
            report_by: string | null;
            /** @description The taker's account on `to_venue`, where the transfer goes: a Lighter account index in decimal, an Aster address; null on an escrow venue. */
            delivery_to: string | null;
            /** @description The venue transaction accepted as delivery; it claims the maker leg. */
            delivery_hash: string | null;
            /** @description Venue fee charged to the maker's account on top of the delivery, in `to_venue` base units: as read at reservation, then the delivery's actual fee. `0` on an escrow venue. */
            delivery_fee: components["schemas"]["Amount"];
            /**
             * Format: date-time
             * @description Deadline of the maker's acceptance, at most 15 seconds after signing; null when none is asked.
             */
            maker_accept_by: string | null;
            /**
             * Format: date-time
             * @description When the maker accepted the fill.
             */
            maker_accepted_at: string | null;
            /**
             * Format: date-time
             * @description When the server verified the locked payment; an in-venue maker transfers only once it is set.
             */
            payment_verified_at: string | null;
            created_at: components["schemas"]["Timestamp"];
            updated_at: components["schemas"]["Timestamp"];
            /** Format: date-time */
            settled_at: string | null;
            /** @description Relayed transactions; each fill lists its take's `payment`. */
            transactions: components["schemas"]["Transaction"][];
        };
        Withdrawal: {
            /** Format: uuid */
            id: string;
            venue: components["schemas"]["VenueId"];
            /**
             * @description `xyz` when it left a standard Hyperliquid account's trade.xyz balance (a move from there goes to the perps); null otherwise.
             * @enum {string|null}
             */
            from_dex: "xyz" | null;
            /**
             * @description `send`: to another account on the same venue (`to: account`). `move`: between your own Hyperliquid perps and trade.xyz (`to: xyz` or `perps`).
             * @enum {string}
             */
            kind: "withdrawal" | "send" | "move" | (string & {});
            /** @description On an Aster withdrawal, the venue fee included. */
            amount: components["schemas"]["Amount"];
            /** @description A send: its recipient. A withdrawal: on Polymarket the linked wallet, signer or deposit address; elsewhere the linked address. A move: the linked address. */
            destination: components["schemas"]["Address"];
            state: components["schemas"]["WithdrawalState"];
            /** @description Polymarket's withdrawal or transfer id, or Aster's withdrawal or transfer id, once relayed; null on Hyperliquid. */
            venue_ref: string | null;
            error: string | null;
            created_at: components["schemas"]["Timestamp"];
            relayed_at: components["schemas"]["Timestamp"] | null;
        };
        /** Format: uuid */
        Uuid: string;
        /** @description Non-negative 64-bit integer as a decimal string; keep it lossless. */
        Cursor: string;
        /** @description Persist before the first attempt. Unique per user and resource type; reuse with other parameters returns 409 `STATE_CONFLICT`. */
        ClientId: string;
        /** @description Unix seconds. */
        UnixTime: number;
        /** @enum {string} */
        OrderState: "preparing" | "moving" | "funding" | "live" | "closing" | "closed" | "failed" | (string & {});
        /**
         * @description `PREPARED`: no maker inventory is claimed. `RESERVED`: execution was admitted and inventory is held for payment. `PAID`: the payment is locked, or executed on Lighter or Aster, and the delivery pending. `CLAIMING`: delivered, the payment still locked. `REFUNDING`: the delivery abandoned, the payment still locked. `PAYING` and `LOCKED`: fills settled with maker locks, before deliveries.
         * @enum {string}
         */
        FillState: "PREPARED" | "RESERVED" | "PAID" | "PAYING" | "LOCKED" | "CLAIMING" | "SETTLED" | "EXPIRED" | "REFUNDING" | "REFUNDED" | "MAKER_LOSS" | "TAKER_LOSS" | (string & {});
        /**
         * @description The taker's lock on the `from_venue` chain; paid from Lighter or Aster, `CLAIMED` once the transfer executed.
         * @enum {string}
         */
        PaymentLeg: "NONE" | "LOCKED" | "CLAIMED" | "REFUNDED" | (string & {});
        /**
         * @description The delivery on `to_venue`, from the order's escrow offer or, on Lighter or Aster, by the maker's transfer: `CLAIMED` once delivered, `ABANDONED` once it can no longer be. `LOCKED` and `REFUNDED`: maker locks, before deliveries.
         * @enum {string}
         */
        MakerLeg: "NONE" | "LOCKED" | "CLAIMED" | "REFUNDED" | "ABANDONED" | (string & {});
        /**
         * @description `relayed`: acknowledged by the venue; arrival unconfirmed. `refused`: rejected by the venue, or `queued` and unstarted after two minutes (Aster: 50 s after its envelope). `submitting` becomes `unknown` after a minute. `unknown`: maybe submitted; never resend.
         * @enum {string}
         */
        WithdrawalState: "queued" | "submitting" | "unknown" | "relayed" | "refused" | (string & {});
        ChainHealth: {
            venue: components["schemas"]["VenueId"];
            chain_id: number;
            /** @description `observations_ready`, no integrity mismatch, under 32 pending transactions, none pending over 60 s. */
            ready: boolean;
            /** @description No watcher error; watched block is the finalized head, read within 30 s; head within the chain's finality age; operator gas at least the chain minimum. */
            observations_ready: boolean;
            /** @description Oldest pending relay transaction's age; null without one. */
            oldest_pending_seconds: number | null;
            pending_transactions: number;
            integrity_checked_at: components["schemas"]["Timestamp"] | null;
            integrity_completed_at: components["schemas"]["Timestamp"] | null;
            integrity_error: string | null;
            /** @description A latched discrepancy; blocks admission until supervised verification. */
            integrity_mismatch: boolean;
            block: components["schemas"]["Cursor"] | null;
            finalized_block: components["schemas"]["Cursor"] | null;
            checked_at: components["schemas"]["Timestamp"] | null;
            finalized_at: components["schemas"]["Timestamp"] | null;
            error: string | null;
            operator_gas: components["schemas"]["Amount"] | null;
        };
        Info: {
            /** @constant */
            api_version: "v1";
            server_time: components["schemas"]["Timestamp"];
            operator: components["schemas"]["Address"];
            limits: components["schemas"]["Limits"];
            settlement: components["schemas"]["SettlementTiming"];
            chains: components["schemas"]["DeploymentChain"][];
            access: {
                /**
                 * @description `invite`: new commitments need access granted (see `AccessState`).
                 * @enum {string}
                 */
                mode: "open" | "invite" | (string & {});
                /** @description Captcha site key of the access page; null without captcha. */
                captcha_site_key: string | null;
            };
        };
        Limits: {
            /** @description Per user's sessions or per credential, on authenticated routes. */
            requests_per_second: number;
            request_burst: number;
            body_bytes: number;
            batch_orders: number;
            lease_seconds_min: number;
            lease_seconds_max: number;
            quote_validity_seconds_max: number;
            take_parts_max: number;
            pay_window_seconds: number;
            /** @description A grouped route's second take, and a take signed at once with its withdrawal. */
            route_pay_window_seconds: number;
            /** @description Takes one taker may hold awaiting payment at once. */
            max_unpaid_takes: number;
            /** @description Most one fill takes from one level, in millionths of a token (books' `max_fill`, in base units). */
            fill_max: components["schemas"]["Amount"];
        };
        SettlementTiming: {
            maker_timeout_seconds: number;
            taker_timeout_seconds: number;
            /** @description Deliveries on Lighter and Aster; null when neither is enabled. Fills carry their `deliver_by` and `report_by`. */
            delivery: null | {
                /** @description `deliver_by` is `pay_by` plus this. */
                window_seconds: number;
                /** @description After `deliver_by`, when an unreported paid fill's maker leg turns `ABANDONED`. */
                abandon_after_seconds: number;
                /** @description `report_by` is `t2` less this. */
                report_margin_seconds: number;
                /**
                 * @description Lighter status a delivery needs; null without Lighter.
                 * @enum {integer|null}
                 */
                min_status: 2 | 3 | null;
            };
        };
        DeploymentChain: {
            venue: components["schemas"]["VenueId"];
            chain_id: number;
            token: components["schemas"]["Address"];
            symbol: string;
            decimals: number;
            escrow: components["schemas"]["Address"];
            deployment_block: components["schemas"]["Cursor"];
        };
        /** @description US dollars, signed, at most eight decimals. */
        Usd: string;
        /** @description Basis points, signed, at most two decimals. */
        Bps: string;
        /** @description What the user's orders received less what they delivered, from every fill with a claimed leg: a payment counts once claimed, a delivery and its fee once delivered ([maker results](/how-it-works#maker-results)). A fill taken under a set compiled from recorded lines values each token at the maker's mark there, the mid of the line's buy and sell or its one price; any other fill at 1 USD per token. */
        MakerResults: {
            fills: number;
            /** @description Fills valued at the maker's marks. */
            marked_fills: number;
            /** @description Delivered, every token at 1 USD. */
            volume_usd: components["schemas"]["Usd"];
            pnl_usd: components["schemas"]["Usd"];
            /** @description `pnl_usd` over the delivered value, valued as the fills; null without a delivery. */
            pnl_bps: components["schemas"]["Bps"] | null;
            /** @description By paying venue, then delivering venue. */
            pairs: {
                from: components["schemas"]["VenueId"];
                to: components["schemas"]["VenueId"];
                fills: number;
                /** @description In `to`'s token. */
                delivered: components["schemas"]["Amount"];
                pnl_usd: components["schemas"]["Usd"];
                pnl_bps: components["schemas"]["Bps"] | null;
            }[];
            /** @description By UTC day a fill was taken, days without one left out. */
            daily: {
                /** Format: date */
                day: string;
                fills: number;
                pnl_usd: components["schemas"]["Usd"];
                /** @description Since the first fill. */
                cumulative_usd: components["schemas"]["Usd"];
            }[];
        };
        StatsAsset: {
            venue: components["schemas"]["VenueId"];
            /** @description Escrow chain; null on Lighter and Aster. */
            chain_id: number | null;
            /** @description Escrow token; null on Lighter and Aster. */
            token: components["schemas"]["Address"] | null;
            symbol: string;
            decimals: number;
            volume_30d: components["schemas"]["Amount"];
            taker_volume_30d: components["schemas"]["Amount"];
            maker_volume_30d: components["schemas"]["Amount"];
            trades_30d: number;
        };
        ChainObservation: {
            block: components["schemas"]["Cursor"];
            finalized_block: components["schemas"]["Cursor"] | null;
            checked_at: components["schemas"]["Timestamp"];
            finalized_at: components["schemas"]["Timestamp"] | null;
            /** @description As `ChainHealth.observations_ready` without the gas check; null without a finalized head. */
            current: boolean | null;
        };
        ExposureAsset: {
            venue: components["schemas"]["VenueId"];
            /** @description Escrow chain; null on Lighter and Aster. */
            chain_id: number | null;
            /** @description Escrow token; null on Lighter and Aster. */
            token: components["schemas"]["Address"] | null;
            symbol: string;
            decimals: number;
            chain_observation: components["schemas"]["ChainObservation"] | null;
            /** @description Orders' unlocked escrow, Lighter and Aster pools excluded. */
            maker_escrow: components["schemas"]["Amount"];
            /** @description Lighter or Aster pool: the account's transferable balance at the last read less deliveries since, within the cap left. Part of the venue account's equity, never added to it. */
            maker_pool_inventory: components["schemas"]["Amount"];
            /** @description Output of the maker's reserved or paid fills not yet delivered; can exceed observed inventory. */
            maker_reserved: components["schemas"]["Amount"];
            /** @description Output delivered to the taker with the payment still locked. */
            maker_delivered_unpaid: components["schemas"]["Amount"];
            maker_payment_locked: components["schemas"]["Amount"];
            taker_payment_locked: components["schemas"]["Amount"];
        };
        Exposure: {
            assets: components["schemas"]["ExposureAsset"][];
            server_time: components["schemas"]["Timestamp"];
        };
        /** @description USDC per unit of the venue's token, from 0.90 to 1.10, at most eight decimals. */
        Price: string;
        QuoteLine: {
            venue: components["schemas"]["VenueId"];
            /** @description What the maker pays to receive one unit on `venue`; null receives nothing there. */
            buy: components["schemas"]["Price"] | null;
            /** @description What the maker asks to deliver one unit on `venue`, at least `buy`; null delivers nothing there. */
            sell: components["schemas"]["Price"] | null;
            /** @description What the identity's pool on `venue` offers to deliver; `0` without a sell price. */
            stock: components["schemas"]["Amount"];
            /** @description The smallest fill of the pool's quotes, at least 1 token, at most `stock` and `fill_max`; null or omitted is 1 token. */
            min_fill?: components["schemas"]["Amount"] | null;
        };
        QuoteLines: {
            quote_identity_id: components["schemas"]["Uuid"];
            /** @description Advances at each publication. */
            revision: components["schemas"]["Cursor"];
            lines: components["schemas"]["QuoteLine"][];
        };
        QuoteLinesInput: {
            /** @description The identity; the browser identity by default, a credential's own with a credential. */
            quote_identity_id?: components["schemas"]["Uuid"];
            /** @description The lines' `revision`; `STATE_CONFLICT` if it changed by preparation or publication. */
            expected_revision: components["schemas"]["Cursor"];
            /** @description Last admission time, within the next 300 s; `253402214400` (never) for the browser identity. */
            valid_until: components["schemas"]["UnixTime"];
            /** @description Every line of the identity, one per venue; a venue left out is removed. */
            lines: components["schemas"]["QuoteLine"][];
        };
        QuoteLineDraft: {
            order_id: components["schemas"]["Bytes32"];
            venue: components["schemas"]["VenueId"];
            draft_id: components["schemas"]["Uuid"];
            sequence: number;
            valid_until: components["schemas"]["UnixTime"];
            expires_at: components["schemas"]["UnixTime"];
            /** @description The line's stock; not signed on chain. */
            quote_size: components["schemas"]["Amount"];
            quotes: components["schemas"]["Quote"][];
            to_sign: components["schemas"]["ToSign"][];
        };
        QuoteLinesPreparation: {
            id: components["schemas"]["Uuid"];
            quote_identity_id: components["schemas"]["Uuid"];
            expected_revision: components["schemas"]["Cursor"];
            valid_until: components["schemas"]["UnixTime"];
            /** @description The lines, normalized and sorted by venue id. */
            lines: components["schemas"]["QuoteLine"][];
            drafts: components["schemas"]["QuoteLineDraft"][];
            /** @description The pools whose quotes publication pulls. */
            cancels: components["schemas"]["Bytes32"][];
        };
        QuoteLinesPublication: {
            preparation_id: components["schemas"]["Uuid"];
            /** @description One per draft. */
            signatures: {
                draft_id: components["schemas"]["Uuid"];
                signature: components["schemas"]["QuoteSignature"];
            }[];
        };
        Markets: {
            as_of: components["schemas"]["Timestamp"];
            venues: {
                venue: components["schemas"]["VenueId"];
                symbol: string;
                decimals: number;
                best_buy: components["schemas"]["Price"] | null;
                best_sell: components["schemas"]["Price"] | null;
                /** @description What the books show of the pools supplying the venue, each pool once. */
                liquidity: components["schemas"]["Amount"];
                /** @description Settled public trades delivered on the venue in the last 24 hours. */
                volume_24h: components["schemas"]["Amount"];
            }[];
        };
        QuoteCancellation: {
            order_id: components["schemas"]["Bytes32"];
            cancel_epoch: components["schemas"]["Cursor"];
        };
        /** @description 1 to 50 distinct orders. */
        QuoteBatchInput: {
            cancels?: components["schemas"]["Bytes32"][];
        };
        QuoteBatch: {
            results: {
                order_id: components["schemas"]["Bytes32"];
                cancel_epoch: components["schemas"]["Cursor"];
            }[];
        };
        /** @description Expected wallet requests from current balances and allowances; recheck each preparation before signing. */
        FundingPlan: {
            observed_at: components["schemas"]["Timestamp"];
            venue: components["schemas"]["VenueId"];
            owner: components["schemas"]["Address"];
            amount: components["schemas"]["Amount"];
            deposit: components["schemas"]["Amount"];
            withdrawal_amount: components["schemas"]["Amount"];
            /**
             * @description Where the withdrawal goes; `escrow` when the prepared withdrawal goes to the payer's deposit address.
             * @enum {string|null}
             */
            withdrawal_to: "signer" | "escrow" | null;
            /**
             * @description `required` lists a `permit` request first: prepare it with `POST /v1/accounts/{venue}/setup/permit`, sign and submit it; take once `done`. `pending`: submitted, not yet effective.
             * @enum {string}
             */
            payment_setup: "done" | "pending" | "required" | (string & {});
            /** @description The take is signed at once with the withdrawal: prepare the withdrawal, reserve the take, then submit the `pay_take` and `margin_move` signatures together to `POST /v1/takes/{id}/signatures`. LaMarge sends the withdrawal, then the payment as soon as its funds reach the wallet. False: submit the withdrawal and take once its funds arrived. */
            signed_at_once: boolean;
            requests: {
                /**
                 * @description `move`: received for trade.xyz, the recipient's move, signed after the take ([POST /v1/transfers/{id}/move](/api-reference/transfers/submit-move)).
                 * @enum {string}
                 */
                kind: "permit" | "margin_move" | "pay_take" | "move" | (string & {});
                signer: components["schemas"]["Address"];
                chain_id: number;
            }[];
        };
        Take: {
            /** @description First fill's id. */
            id: components["schemas"]["Uuid"];
            client_take_id: components["schemas"]["ClientId"];
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            /** @description Its fills' `taker_fee`, in their `taker_fee_venue` base units. */
            taker_fee: components["schemas"]["Amount"];
            fills: components["schemas"]["Fill"][];
        };
        TakePreparation: {
            take: components["schemas"]["Take"];
            /** @description Unsigned requests; empty once signatures are accepted. */
            to_sign: (components["schemas"]["ToSign"] | components["schemas"]["LighterTransferItem"] | components["schemas"]["AsterTransferItem"])[];
        };
        /** @enum {string} */
        CredentialScope: "read" | "quote" | "cancel" | (string & {});
        CredentialInput: {
            /** @description Not blank. */
            name: string;
            /** @description Nonzero. */
            quote_signer: components["schemas"]["Address"];
            scopes: components["schemas"]["CredentialScope"][];
            /** @description Within the next 90 days. */
            expires_at: components["schemas"]["UnixTime"];
        };
        CredentialCreated: {
            id: components["schemas"]["Uuid"];
            name: string;
            quote_signer: components["schemas"]["Address"];
            scopes: components["schemas"]["CredentialScope"][];
            expires_at: components["schemas"]["Timestamp"];
            /** @description Returned once. */
            token: string;
        };
        CredentialRotationInput: {
            /** @description Within the next 90 days. */
            expires_at: components["schemas"]["UnixTime"];
        };
        CredentialRotated: {
            id: components["schemas"]["Uuid"];
            token: string;
            expires_at: components["schemas"]["Timestamp"];
        };
        LeaseInput: {
            /** @description Ignored for a browser identity. */
            ttl_seconds: number;
            /** @description Round-trip time of your latest successful request, in ms; send with `api_rtt_age_ms`. Ignored for a browser identity. */
            api_rtt_ms?: number;
            /** @description How long before this renewal that request completed, in ms; send with `api_rtt_ms`. */
            api_rtt_age_ms?: number;
        };
        Lease: {
            identity_id: components["schemas"]["Uuid"];
            generation: components["schemas"]["Cursor"];
            expires_at: components["schemas"]["Timestamp"];
        };
        IdentityCancellation: {
            identity_id: components["schemas"]["Uuid"];
            generation: components["schemas"]["Cursor"];
            orders: number;
        };
        /** @description `from` → `to` books changed, all when empty; reload, not a quantity delta. */
        BookInvalidation: {
            from?: components["schemas"]["VenueId"];
            to?: components["schemas"]["VenueId"];
        };
        OrderPreview: {
            id: components["schemas"]["Bytes32"];
            state: components["schemas"]["OrderState"];
            venue: components["schemas"]["VenueId"];
            held: components["schemas"]["Amount"];
            held_in: components["schemas"]["HeldIn"];
            sequence: number | null;
            cancel_epoch: components["schemas"]["Cursor"];
            client_order_id: components["schemas"]["ClientId"];
        };
        FillPreview: {
            id: components["schemas"]["Uuid"];
            take_id: components["schemas"]["Uuid"];
            order_id: components["schemas"]["Bytes32"];
            sequence: number;
            quote_index: number;
            state: components["schemas"]["FillState"];
            payment_leg: components["schemas"]["PaymentLeg"];
            maker_leg: components["schemas"]["MakerLeg"];
            /** @enum {string|null} */
            payment_destination: "venue" | "escrow" | null;
            /** @enum {string|null} */
            maker_destination: "venue" | "escrow" | null;
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            /** @description The taker fee, in `taker_fee_venue` base units. */
            taker_fee: components["schemas"]["Amount"];
            taker_fee_bps: components["schemas"]["FeeBps"];
            taker_fee_venue: components["schemas"]["VenueId"] | null;
            /** @description What the maker receives of the payment. */
            maker_in: components["schemas"]["Amount"];
            /** @description What leaves the maker's order. */
            maker_out: components["schemas"]["Amount"];
            /**
             * @deprecated
             * @description Former name of `from_venue`.
             */
            from: components["schemas"]["VenueId"];
            /**
             * @deprecated
             * @description Former name of `to_venue`.
             */
            to: components["schemas"]["VenueId"];
            from_venue: components["schemas"]["VenueId"];
            to_venue: components["schemas"]["VenueId"];
            pay_by: components["schemas"]["Timestamp"];
            t1: components["schemas"]["Timestamp"];
            t2: components["schemas"]["Timestamp"];
            /** Format: date-time */
            deliver_by: string | null;
            /** Format: date-time */
            report_by: string | null;
            delivery_to: string | null;
            delivery_hash: string | null;
            delivery_fee: components["schemas"]["Amount"];
            /** Format: date-time */
            maker_accept_by: string | null;
            /** Format: date-time */
            maker_accepted_at: string | null;
            /** Format: date-time */
            payment_verified_at: string | null;
            reason: string | null;
            role: components["schemas"]["FillRole"];
        };
        LeasePreview: {
            id: components["schemas"]["Uuid"];
            generation: components["schemas"]["Cursor"];
            lease_expires_at: components["schemas"]["Timestamp"];
            revoked_at: components["schemas"]["Timestamp"] | null;
            credential_expires_at: components["schemas"]["Timestamp"] | null;
            active: boolean;
        };
        WithdrawalPreview: {
            id: components["schemas"]["Uuid"];
            venue: components["schemas"]["VenueId"];
            state: components["schemas"]["WithdrawalState"];
            amount: components["schemas"]["Amount"];
            venue_ref: string | null;
        };
        BalancePreview: {
            venue: components["schemas"]["VenueId"];
            read_at: components["schemas"]["Timestamp"] | null;
            chain_read_at: components["schemas"]["Timestamp"] | null;
            venue_available: boolean;
            chain_available: boolean;
        };
        TradeEvent: {
            id: components["schemas"]["Uuid"];
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            settled_at: components["schemas"]["Timestamp"];
        };
        BookInvalidationEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "book.changed";
            data: components["schemas"]["BookInvalidation"];
        };
        OrderPreviewEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "order.changed";
            data: components["schemas"]["OrderPreview"];
        };
        FillPreviewEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "fill.changed";
            data: components["schemas"]["FillPreview"];
        };
        LeasePreviewEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "lease.changed";
            data: components["schemas"]["LeasePreview"];
        };
        WithdrawalPreviewEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "withdrawal.changed";
            data: components["schemas"]["WithdrawalPreview"];
        };
        BalancePreviewEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "balance.changed";
            data: components["schemas"]["BalancePreview"];
        };
        TradeEventEvent: {
            cursor: components["schemas"]["Cursor"];
            resource_id: string;
            revision: components["schemas"]["Cursor"];
            occurred_at: components["schemas"]["Timestamp"];
            /** @constant */
            kind: "trade";
            data: components["schemas"]["TradeEvent"];
        };
        /** @description Committed cursor order. Payloads are previews at publication, not a transition log; events can repeat, so skip applied revisions ([event kinds](/streaming#event-kinds)). */
        Event: components["schemas"]["BookInvalidationEvent"] | components["schemas"]["OrderPreviewEvent"] | components["schemas"]["FillPreviewEvent"] | components["schemas"]["LeasePreviewEvent"] | components["schemas"]["WithdrawalPreviewEvent"] | components["schemas"]["BalancePreviewEvent"] | components["schemas"]["TradeEventEvent"];
        EventPage: {
            events: components["schemas"]["Event"][];
            /** @description A journal position, not contiguous per subscriber. */
            next_cursor: components["schemas"]["Cursor"];
            has_more: boolean;
            oldest_cursor: components["schemas"]["Cursor"];
            server_time: components["schemas"]["Timestamp"];
        };
        SnapshotBook: {
            order_id: components["schemas"]["Bytes32"];
            sequence: number;
            revision: components["schemas"]["Cursor"];
            to: components["schemas"]["VenueId"];
            /** @description Quotes with capacity, `available` capped at `fill_max`; a venue's levels, best price first, show at most what better ones leave of the order's `available`. */
            quotes: (components["schemas"]["Quote"] & {
                /** @description Position in the signed set. */
                quote_index: number;
                available: components["schemas"]["Amount"];
            })[];
            available: components["schemas"]["Amount"];
            valid_until: components["schemas"]["Timestamp"];
            expires_at: components["schemas"]["Timestamp"];
        };
        SnapshotOrder: {
            id: components["schemas"]["Bytes32"];
            state: components["schemas"]["OrderState"];
            venue: components["schemas"]["VenueId"];
            held: components["schemas"]["Amount"];
            held_in: components["schemas"]["HeldIn"];
            sequence: number | null;
            cancel_epoch: components["schemas"]["Cursor"];
            client_order_id: components["schemas"]["ClientId"];
            quote_identity_id: components["schemas"]["Uuid"];
            revision: components["schemas"]["Cursor"];
            amount: components["schemas"]["Amount"];
        };
        SnapshotFill: {
            id: components["schemas"]["Uuid"];
            take_id: components["schemas"]["Uuid"];
            order_id: components["schemas"]["Bytes32"];
            sequence: number;
            quote_index: number;
            state: components["schemas"]["FillState"];
            payment_leg: components["schemas"]["PaymentLeg"];
            maker_leg: components["schemas"]["MakerLeg"];
            /** @enum {string|null} */
            payment_destination: "venue" | "escrow" | null;
            /** @enum {string|null} */
            maker_destination: "venue" | "escrow" | null;
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            /** @description The taker fee, in `taker_fee_venue` base units. */
            taker_fee: components["schemas"]["Amount"];
            taker_fee_bps: components["schemas"]["FeeBps"];
            taker_fee_venue: components["schemas"]["VenueId"] | null;
            /** @description What the maker receives of the payment. */
            maker_in: components["schemas"]["Amount"];
            /** @description What leaves the maker's order. */
            maker_out: components["schemas"]["Amount"];
            /**
             * @deprecated
             * @description Former name of `from_venue`.
             */
            from: components["schemas"]["VenueId"];
            /**
             * @deprecated
             * @description Former name of `to_venue`.
             */
            to: components["schemas"]["VenueId"];
            from_venue: components["schemas"]["VenueId"];
            to_venue: components["schemas"]["VenueId"];
            pay_by: components["schemas"]["Timestamp"];
            t1: components["schemas"]["Timestamp"];
            t2: components["schemas"]["Timestamp"];
            /** Format: date-time */
            deliver_by: string | null;
            /** Format: date-time */
            report_by: string | null;
            delivery_to: string | null;
            delivery_hash: string | null;
            delivery_fee: components["schemas"]["Amount"];
            /** Format: date-time */
            maker_accept_by: string | null;
            /** Format: date-time */
            maker_accepted_at: string | null;
            /** Format: date-time */
            payment_verified_at: string | null;
            reason: string | null;
            role: components["schemas"]["FillRole"];
            revision: components["schemas"]["Cursor"];
        };
        SnapshotIdentity: {
            id: components["schemas"]["Uuid"];
            generation: components["schemas"]["Cursor"];
            lease_expires_at: components["schemas"]["Timestamp"];
            revoked_at: components["schemas"]["Timestamp"] | null;
            credential_expires_at: components["schemas"]["Timestamp"] | null;
            revision: components["schemas"]["Cursor"];
        };
        Snapshot: {
            cursor: components["schemas"]["Cursor"];
            /** @description Public books; empty in a private snapshot. */
            books: components["schemas"]["SnapshotBook"][];
            server_time: components["schemas"]["Timestamp"];
        };
        PrivateSnapshot: {
            cursor: components["schemas"]["Cursor"];
            books: components["schemas"]["SnapshotBook"][];
            server_time: components["schemas"]["Timestamp"];
            orders: components["schemas"]["SnapshotOrder"][];
            fills: components["schemas"]["SnapshotFill"][];
            quote_identities: components["schemas"]["SnapshotIdentity"][];
        };
        StreamSubscription: {
            after: components["schemas"]["Cursor"];
            token?: string | null;
        };
        StreamControl: {
            /** @enum {string} */
            type: "resync_required" | "authentication_required" | "unavailable" | (string & {});
            reason: string;
        };
        OrderHistoryRow: {
            id: components["schemas"]["Bytes32"];
            venue: components["schemas"]["VenueId"];
            state: components["schemas"]["OrderState"];
            amount: components["schemas"]["Amount"];
            held: components["schemas"]["Amount"];
            held_in: components["schemas"]["HeldIn"];
            quotable: components["schemas"]["Amount"];
            created_at: components["schemas"]["Timestamp"];
            updated_at: components["schemas"]["Timestamp"];
            client_order_id: components["schemas"]["ClientId"];
            quote_identity_id: components["schemas"]["Uuid"];
            quote_signer: components["schemas"]["Address"];
            revision: components["schemas"]["Cursor"];
            sequence: number | null;
        };
        FillHistoryRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            take_id: string;
            role: components["schemas"]["FillRole"];
            order_id: components["schemas"]["Bytes32"];
            sequence: number;
            from_venue: components["schemas"]["VenueId"];
            to_venue: components["schemas"]["VenueId"];
            amount_out: components["schemas"]["Amount"];
            amount_in: components["schemas"]["Amount"];
            /** @description The taker fee, in `taker_fee_venue` base units. */
            taker_fee: components["schemas"]["Amount"];
            taker_fee_bps: components["schemas"]["FeeBps"];
            taker_fee_venue: components["schemas"]["VenueId"] | null;
            /** @description What the maker receives of the payment. */
            maker_in: components["schemas"]["Amount"];
            /** @description What leaves the maker's order. */
            maker_out: components["schemas"]["Amount"];
            payment_leg: components["schemas"]["PaymentLeg"];
            maker_leg: components["schemas"]["MakerLeg"];
            state: components["schemas"]["FillState"];
            pay_by: components["schemas"]["Timestamp"];
            t1: components["schemas"]["Timestamp"];
            t2: components["schemas"]["Timestamp"];
            created_at: components["schemas"]["Timestamp"];
            updated_at: components["schemas"]["Timestamp"];
            /** Format: date-time */
            settled_at: string | null;
            revision: components["schemas"]["Cursor"];
        };
        WithdrawalHistoryRow: {
            /** Format: uuid */
            id: string;
            venue: components["schemas"]["VenueId"];
            /** @enum {string} */
            kind: "withdrawal" | "send" | "move" | (string & {});
            amount: components["schemas"]["Amount"];
            destination: components["schemas"]["Address"];
            /**
             * @description As in `Withdrawal`.
             * @enum {string|null}
             */
            from_dex: "xyz" | null;
            state: components["schemas"]["WithdrawalState"];
            venue_ref: string | null;
            error: string | null;
            created_at: components["schemas"]["Timestamp"];
            relayed_at: components["schemas"]["Timestamp"] | null;
            revision: components["schemas"]["Cursor"];
        };
        TradeHistoryRow: {
            id: components["schemas"]["Uuid"];
            from: components["schemas"]["VenueId"];
            to: components["schemas"]["VenueId"];
            amount_in: components["schemas"]["Amount"];
            amount_out: components["schemas"]["Amount"];
            /** @description The taker fee, in `taker_fee_venue` base units. */
            taker_fee: components["schemas"]["Amount"];
            taker_fee_bps: components["schemas"]["FeeBps"];
            taker_fee_venue: components["schemas"]["VenueId"] | null;
            /** @description What the maker receives of the payment. */
            maker_in: components["schemas"]["Amount"];
            /** @description What leaves the maker's order. */
            maker_out: components["schemas"]["Amount"];
            settled_at: components["schemas"]["Timestamp"];
            /** @description The taker's master address, not a linked venue address. */
            taker_address: components["schemas"]["Address"];
        };
        OrderHistoryPage: {
            data: components["schemas"]["OrderHistoryRow"][];
            next_cursor: string | null;
            has_more: boolean;
        };
        FillHistoryPage: {
            data: components["schemas"]["FillHistoryRow"][];
            next_cursor: string | null;
            has_more: boolean;
        };
        WithdrawalHistoryPage: {
            data: components["schemas"]["WithdrawalHistoryRow"][];
            next_cursor: string | null;
            has_more: boolean;
        };
        TradeHistoryPage: {
            data: components["schemas"]["TradeHistoryRow"][];
            next_cursor: string | null;
            has_more: boolean;
        };
        /** @enum {string} */
        FillRole: "taker" | "maker" | (string & {});
    };
    responses: {
        /** @description `VALIDATION_ERROR`: malformed or refused input; `message` names what was refused. */
        ValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `VALIDATION_ERROR`, or `BAD_SIGNATURE`: malformed, by another address, or unknown, used or expired nonce. */
        BadSignature: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `UNAUTHENTICATED`: missing, invalid, expired or revoked bearer, or a credential on a session-only route. */
        Unauthenticated: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `ACCESS_REQUIRED`: access not granted, or suspended. */
        AccessRequired: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `FORBIDDEN`: credential without the route's scope, quote identity unavailable, or admin-only route. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `ACCESS_REQUIRED`, or `FORBIDDEN`: credential without the scope, or quote identity unavailable. */
        QuoteForbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `NOT_FOUND`: unknown or foreign resource. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `STATE_CONFLICT`: the resource's state forbids this, or a client id reused with other terms. */
        StateConflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `ACCOUNT_IN_USE`: another user's address, or an open or quoting order, a nonfinal fill or a queued, submitting or unknown withdrawal uses the account. */
        AccountInUse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `RESYNC_REQUIRED`: cursor outside the retained journal; take a fresh snapshot. */
        ResyncRequired: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `PAYLOAD_TOO_LARGE`: body over 64 KiB. */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `VENUE_DISABLED`. An unknown venue is a `VALIDATION_ERROR`. */
        VenueDisabled: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `ACCOUNT_NOT_LINKED`: a needed venue account is unlinked or changed since preparation; `SETUP_REQUIRED` with `venue` and `step` when a setup step it needs is not done; `VENUE_DISABLED` if disabled. */
        AccountNotLinked: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `RATE_LIMITED`: retry the same request after `Retry-After` seconds. */
        RateLimited: {
            headers: {
                /** @description Seconds. */
                "Retry-After"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `INTERNAL`: server fault; keep the request id. */
        Internal: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `VENUE_UNAVAILABLE`: a venue or chain node did not answer; retry. */
        VenueUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `OPERATOR_UNAVAILABLE`: chain observations, integrity, operator gas, relay queue or Hyperliquid account mode not ready for new commitments. */
        OperatorUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description `SNAPSHOT_TOO_LARGE`: over 1000 orders, fills, quote identities or book levels; never partial. */
        SnapshotTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        OrderId: components["schemas"]["Bytes32"];
        PairA: components["schemas"]["VenueId"];
        PairB: components["schemas"]["VenueId"];
        Id: components["schemas"]["Uuid"];
        /** @description `next_cursor` from the same route and filters; omit for the newest page. */
        HistoryAfter: string;
        Limit: number;
        /** @description Replay strictly after this cursor; 0 when omitted. */
        ReplayAfter: components["schemas"]["Cursor"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getSiteShareImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                filename: "landing.png" | "app.png";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Social card image. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            /** @description Unknown image. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getTradeShareImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Public transfer receipt image. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            400: components["responses"]["ValidationError"];
            /** @description Unknown or unpublished trade. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getTradeShareMetadata: {
        parameters: {
            query?: {
                trade?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Escaped title, description, canonical URL, Open Graph and card tags. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
        };
    };
    getVenues: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every venue, enabled or not. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Venue"][];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postAsterSigningRpc: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": unknown;
            };
        };
        responses: {
            /** @description The JSON-RPC answer, or answers for a batch. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            400: components["responses"]["ValidationError"];
            413: components["responses"]["PayloadTooLarge"];
            /** @description Body not sent as `Content-Type: application/json`. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getBook: {
        parameters: {
            query: {
                /** @description The venue the taker pays on. */
                from: components["schemas"]["VenueId"];
                /** @description The venue the taker receives on. */
                to: components["schemas"]["VenueId"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The book. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Book"];
                };
            };
            400: components["responses"]["ValidationError"];
            422: components["responses"]["VenueDisabled"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    getRoute: {
        parameters: {
            query: {
                /** @description The venue the taker pays on. */
                from: components["schemas"]["VenueId"];
                /** @description The venue the taker receives on. */
                to: components["schemas"]["VenueId"];
                /** @description Most the taker pays, in `from` base units. */
                amount_in: components["schemas"]["Amount"];
                /** @description Least the taker receives for `amount_in`, in `to` base units: the worst price it takes. A smaller amount is held to the same price, in proportion. */
                min_out?: components["schemas"]["Amount"];
                /** @description The highest taker fee the takes would accept: each leg is priced at its pair's fee, a leg whose fee is higher left out, as the take would refuse it. Without it, legs pay no fee, as takes without `max_fee_bps` do. */
                max_fee_bps?: components["schemas"]["FeeBps"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The route. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Route"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `FORBIDDEN`: paying from a venue is suspended after failed payments. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `INSUFFICIENT_LIQUIDITY`: no route takes this amount. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            422: components["responses"]["VenueDisabled"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description `OPERATOR_UNAVAILABLE`, retryable: settlement is not ready for new commitments; or `SNAPSHOT_TOO_LARGE`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTradeProof: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed maker and taker agreements. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TradeProof"];
                };
            };
            400: components["responses"]["ValidationError"];
            /** @description `NOT_FOUND`: unknown, unsettled or unpublished trade. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getVolume: {
        parameters: {
            query: {
                a: components["parameters"]["PairA"];
                b: components["parameters"]["PairB"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The pair's 24-hour volume. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Volume"];
                };
            };
            400: components["responses"]["ValidationError"];
            422: components["responses"]["VenueDisabled"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getMarkets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The venues in registry order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Markets"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every chain is ready. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description Not ready for new settlement commitments. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getV1Info: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deployment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Info"];
                };
            };
        };
    };
    postAuthChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The master address. */
                    address: components["schemas"]["Address"];
                };
            };
        };
        responses: {
            /** @description The message to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Challenge"];
                };
            };
            400: components["responses"]["ValidationError"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postAuthVerify: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: components["schemas"]["Address"];
                    nonce: string;
                    signature: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The session. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadSignature"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    deleteV1AuthSessionsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postLinkChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    /** @description Owner of the venue account; signs its transfers. */
                    address: components["schemas"]["Address"];
                };
            };
        };
        responses: {
            /** @description The message to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Challenge"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["VenueDisabled"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getVenueSetup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The steps. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueSetup"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    postVenueSetupStep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
                /** @description One of the venue's steps (`permit`, `agent`, `api_key`). */
                step: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The prepared request's `ref`. */
                    ref?: string;
                    signature?: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The step. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupStep"];
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            /** @description `NOT_FOUND`: the venue has no such step, or no such prepared permit. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `STATE_CONFLICT` once the permit expired, or `FILL_IN_PROGRESS` while a payment from Lighter may still use its key's nonce. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description `VENUE_UNAVAILABLE`, or `VENUE_REJECTED` when the venue refuses the step. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postLink: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    address: components["schemas"]["Address"];
                    /** @description From the link challenge; omitted for the master address. */
                    nonce?: string;
                    /** @description The link message signed by `address`; omitted for the master address. */
                    signature?: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The linked account. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedAccount"];
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            409: components["responses"]["AccountInUse"];
            413: components["responses"]["PayloadTooLarge"];
            /** @description `WALLET_NOT_FOUND` or `VENUE_DISABLED`. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    deleteLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unlinked. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: no account linked on that venue. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["AccountInUse"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getBalances: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One entry per linked venue. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Balance"][];
                };
            };
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stats. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Stats"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1MeExposure: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The exposure. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Exposure"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getQuoteLines: {
        parameters: {
            query?: {
                /** @description The identity; the browser identity by default, a credential's own with a credential. */
                quote_identity_id?: components["schemas"]["Uuid"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The lines. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuoteLines"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    publishQuoteLines: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuoteLinesPublication"];
            };
        };
        responses: {
            /** @description The published lines. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuoteLines"];
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["QuoteForbidden"];
            404: components["responses"]["NotFound"];
            /** @description `STALE_QUOTE`, `STALE_SEQUENCE` or `STATE_CONFLICT`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    prepareQuoteLines: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuoteLinesInput"];
            };
        };
        responses: {
            /** @description The drafts to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuoteLinesPreparation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `ACCESS_REQUIRED`, `FORBIDDEN` (no `quote` or `cancel` scope, quote identity revoked, or quoting disabled by an admin), or `MAKER_NOT_APPROVED` for a Lighter or Aster pool. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    prepareMaker: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue: components["schemas"]["VenueId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MakerInput"];
            };
        };
        responses: {
            /** @description The preparation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MakerPreparation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `ACCESS_REQUIRED`, `FORBIDDEN` when the quote identity is unavailable, or `MAKER_NOT_APPROVED` for a Lighter or Aster pool. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `STATE_CONFLICT`: the order's state forbids it, a `client_request_id` reused with other terms, or another funding, take payment or escrow close pending on the venue. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    getMakerPreparation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The preparation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MakerPreparation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    cancelMakerPreparation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The preparation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MakerPreparation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    submitMakerSignatures: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Signatures"];
            };
        };
        responses: {
            /** @description The preparation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MakerPreparation"];
                };
            };
            /** @description `VALIDATION_ERROR`, `BAD_SIGNATURE` or `WITHDRAWAL_EXPIRED`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            /** @description `ACCESS_REQUIRED`, or `FORBIDDEN` when the quote identity changed or, with a `quote_set` item, its lease expired. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`, or `STALE_QUOTE` after the quote's `valid_until`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    getOrders: {
        parameters: {
            query?: {
                /** @description Exact match: zero or one order. */
                client_order_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The orders. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"][];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    deleteQuotes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The cancellation receipt. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuoteCancellation"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postV1QuotesBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuoteBatchInput"];
            };
        };
        responses: {
            /** @description One result per order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuoteBatch"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["QuoteForbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    putV1QuoteIdentitiesIdLease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeaseInput"];
            };
        };
        responses: {
            /** @description The lease. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Lease"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["QuoteForbidden"];
            /** @description `NOT_FOUND`: a credential named another identity. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    deleteV1QuoteIdentitiesIdQuotes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The cancellation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityCancellation"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            /** @description `NOT_FOUND`: a credential named another identity. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postCloses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    orders: components["schemas"]["Bytes32"][];
                };
            };
        };
        responses: {
            /** @description The close to sign, or none. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * Format: uuid
                         * @description Null when no order needs a signature.
                         */
                        id: string | null;
                        to_sign: components["schemas"]["ToSign"][];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: an unknown, malformed or foreign order. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postCloseSignatures: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Signatures"];
            };
        };
        responses: {
            /** @description The orders of the close. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        orders: components["schemas"]["Order"][];
                    };
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: no close with this id, or an expired one removed by a later `POST /v1/closes`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `STATE_CONFLICT`: the close expired. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getEscrow: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Orders holding funds. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscrowOrder"][];
                };
            };
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    postEscrowClosePrepare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    order_id: components["schemas"]["Bytes32"];
                    /** @description False withdraws to the owner wallet. */
                    to_margin: boolean;
                };
            };
        };
        responses: {
            /** @description The terms for `POST /v1/escrow/close` and the item to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        venue: components["schemas"]["VenueId"];
                        order_id: components["schemas"]["Bytes32"];
                        to_margin: boolean;
                        /** @description Hyperliquid destination: `0` perps, `4294967295` spot; `0` elsewhere. */
                        dex: number;
                        /** @description Decimal integer. */
                        nonce: string;
                        /** @description Unix seconds, one hour ahead. */
                        deadline: number;
                        to_sign: components["schemas"]["ToSign"][];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: unknown or malformed order, or no unlocked funds. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    postEscrowClose: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    order_id: components["schemas"]["Bytes32"];
                    /** @description False withdraws to the owner wallet. */
                    to_margin: boolean;
                    dex: number;
                    /** @description Decimal unsigned 64-bit integer. */
                    nonce: string;
                    /** @description Unix seconds, in the future and at most 3660 s ahead. */
                    deadline: number;
                    signature: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The order as `GET /v1/escrow` shows it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscrowOrder"];
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: unknown or malformed order, or no unlocked funds. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    postEscrowWithdrawPrepare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    order_id: components["schemas"]["Bytes32"];
                    amount: components["schemas"]["Amount"];
                    /** @description False withdraws to the owner wallet. */
                    to_margin: boolean;
                };
            };
        };
        responses: {
            /** @description The terms for `POST /v1/escrow/withdraw` and the item to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        venue: components["schemas"]["VenueId"];
                        order_id: components["schemas"]["Bytes32"];
                        amount: components["schemas"]["Amount"];
                        to_margin: boolean;
                        /** @description Hyperliquid destination: `0` perps, `4294967295` spot; `0` elsewhere. */
                        dex: number;
                        /** @description Decimal integer. */
                        nonce: string;
                        /** @description Unix seconds, one hour ahead. */
                        deadline: number;
                        to_sign: components["schemas"]["ToSign"][];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: unknown or malformed order, or no unlocked funds. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    postEscrowWithdraw: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    order_id: components["schemas"]["Bytes32"];
                    amount: components["schemas"]["Amount"];
                    /** @description False withdraws to the owner wallet. */
                    to_margin: boolean;
                    dex: number;
                    /** @description Decimal unsigned 64-bit integer. */
                    nonce: string;
                    /** @description Unix seconds, in the future and at most 3660 s ahead. */
                    deadline: number;
                    signature: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The order as `GET /v1/escrow` shows it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscrowOrder"];
                };
            };
            400: components["responses"]["BadSignature"];
            401: components["responses"]["Unauthenticated"];
            /** @description `NOT_FOUND`: unknown or malformed order, or no unlocked funds. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    getTransfers: {
        parameters: {
            query?: {
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of intents. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransferInput"];
            };
        };
        responses: {
            /** @description Existing identical intent. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferIntent"];
                };
            };
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferIntent"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            /** @description `NOT_FOUND`: unknown `previous_transfer_id`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `STATE_CONFLICT`: the resource's state forbids this, or a client id reused with other terms; reason `no_deposit`: the Aster account it or its route delivers to never received a deposit, which Aster refuses transfers to; reason `grouped_route`: an open grouped route holds it until it ends (a continuation of its first transfer). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            /** @description `ACCOUNT_NOT_LINKED`, `VENUE_DISABLED`, or `SETUP_REQUIRED` for the `agent` step of an Aster account it delivers to. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description `VENUE_UNAVAILABLE`: the Lighter transfer fee a continuation (`previous_transfer_id`) pays is unknown, or the Aster account it delivers to could not be read. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTransfer: {
        parameters: {
            query?: {
                /** @description Compute `funding_plan` from fresh balances and allowances, for a wallet review; not when polling. */
                funding_plan?: boolean;
            };
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The intent. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferIntent"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    cancelTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`; with `reason` `grouped_route`: an open grouped route holds it until it ends. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    prepareTransferWithdrawal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount: components["schemas"]["Amount"];
                };
            };
        };
        responses: {
            /** @description The typed data to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        typed_data: components["schemas"]["TypedData"];
                    };
                };
            };
            /** @description `VALIDATION_ERROR`, or `WITHDRAWAL_EXPIRED` ten minutes after the first preparation. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`; with `reason` `grouped_route`: an open grouped route holds it until it ends; with `reason` `funds_arriving`: an earlier withdrawal of the route is still arriving, nothing more is withdrawn. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            /** @description `ACCOUNT_NOT_LINKED`, `SETUP_REQUIRED` for the payer's `permit`, or `VENUE_DISABLED`. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    submitTransferWithdrawal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    signature: components["schemas"]["Signature"];
                    envelope?: components["schemas"]["AsterEnvelope"];
                };
            };
        };
        responses: {
            /** @description The withdrawal. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Withdrawal"];
                };
            };
            /** @description `VALIDATION_ERROR`, `BAD_SIGNATURE`, or `WITHDRAWAL_EXPIRED` ten minutes after preparation. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`; with `reason` `grouped_route`: an open grouped route holds it until it ends; with `reason` `funds_arriving`: an earlier withdrawal of the route is still arriving, nothing more is withdrawn. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    prepareTransferMove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The typed data to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        typed_data: components["schemas"]["TypedData"];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    submitTransferMove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    signature: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description The move. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Withdrawal"];
                };
            };
            /** @description `VALIDATION_ERROR`, `BAD_SIGNATURE`, or `WITHDRAWAL_EXPIRED` ten minutes after preparation. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    prepareGroupedRoute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The route and its two takes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupedPreparation"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    abortGroupedRoute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Aborted, or never prepared. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    commitGroupedRoute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Signatures"];
            };
        };
        responses: {
            /** @description The committed route. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupedRoute"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postTake: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TakeInput"];
            };
        };
        responses: {
            /** @description Existing take for this `client_take_id`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TakePreparation"];
                };
            };
            /** @description The take and the items to sign. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TakePreparation"];
                };
            };
            /** @description `VALIDATION_ERROR`, or `WITHDRAWAL_EXPIRED` for a take signed at once whose withdrawal was prepared too long ago to be signed with it: create another transfer. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            /** @description `PREFUNDING_REQUIRED`, `STALE_QUOTE`, `INSUFFICIENT_LIQUIDITY`, `SLIPPAGE`, `FILL_IN_PROGRESS` or `STATE_CONFLICT` (reason `no_deposit`: the Aster account it delivers to never received a deposit; reason `withdrawal_submitted`: the transfer's prepared withdrawal was submitted meanwhile, take again once it arrived). `FILL_IN_PROGRESS` with `reason` `too_many`: `limits.max_unpaid_takes` takes already await payment; `venue_payment`: the Lighter or Aster account pays another take, one at a time, retry after `Retry-After`; `withdrawal_unsigned`: another transfer signed at once from this venue awaits its signatures, retry after `Retry-After`. `STATE_CONFLICT` with `reason` `funds_changed`: another payment took the funds this take was sized on, retry after `Retry-After`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
            503: components["responses"]["OperatorUnavailable"];
        };
    };
    getV1TakesId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The take. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TakePreparation"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    deleteTake: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`; with `reason` `grouped_route`: an open grouped route holds it until it ends: abort the route instead. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postTakeSignatures: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Signatures"];
            };
        };
        responses: {
            /** @description The take's fills. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fills: components["schemas"]["Fill"][];
                    };
                };
            };
            /** @description `BAD_SIGNATURE`, `VALIDATION_ERROR`, or `WITHDRAWAL_EXPIRED` for a take signed at once whose withdrawal is too old to send. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            /** @description `TAKE_EXPIRED`: `pay_by` passed (for a take signed at once, its last 30 seconds began) or a fill is no longer awaiting payment; take again. `STATE_CONFLICT` with `reason` `grouped_route`: an open grouped route holds it until it ends: commit or abort the route instead. For a take signed at once, `STATE_CONFLICT` also when another withdrawal on the venue is unresolved or the margin no longer covers the withdrawal. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    preparePaymentRefund: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Consent for the payment beneficiary to sign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: int64 */
                        deadline: number;
                        to_sign: components["schemas"]["ToSign"][];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    submitPaymentRefund: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: int64 */
                    deadline: number;
                    signature: components["schemas"]["Signature"];
                };
            };
        };
        responses: {
            /** @description Consent accepted or already recorded. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `VALIDATION_ERROR`: deadline past, over one hour or after `t2`; `BAD_SIGNATURE`: not the beneficiary's. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    acceptFill: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Acceptance recorded, also on a retry. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description No pending request, the acceptance window closed, or the fill's quotes were cancelled. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    submitDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tx_hash: string;
                };
            };
        };
        responses: {
            /** @description The fill, its maker leg claimed by the delivery. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fill: components["schemas"]["Fill"];
                    };
                };
            };
            /** @description `VALIDATION_ERROR`: this transaction never delivers the fill. `reason`: `not_a_transfer`; on Lighter `transfer_failed` (status 0 or above 3), `wrong_sender`, `wrong_recipient`, `wrong_asset` (not USDC collateral) or `wrong_memo`; `amount_short`, `executed_late`, `before_fill` (an Aster transfer older than the fill) or `transfer_used` (it already settles another fill). No `reason`: a malformed request or an escrow-settled fill. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            /** @description `FORBIDDEN`: a credential without `quote` scope; suspension does not block reports. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description `STATE_CONFLICT`. `reason`: `not_due` (payment not locked yet, or fill delivered, refunded or expired), `refund_authorized` (refund consented) or `report_window_closed` (past `report_by`); final except `not_due` before the lock. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            /** @description `ACCOUNT_NOT_LINKED`: the maker's venue account is unlinked or changed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `DELIVERY_PENDING`: report the same hash after `Retry-After` (1 s). `reason`: `unknown_transaction` (unknown to the venue; on Aster, until both Spot histories show this id as a USDT transfer from the maker to `delivery_to`) or `not_final` (Lighter, below the required status). */
            425: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description `VENUE_UNAVAILABLE`: the venue did not answer, or Lighter's per-minute read budget is spent. Report the same hash again. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFills: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The fills. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Fill"][];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    postWithdrawalPrepare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    amount: components["schemas"]["Amount"];
                    /**
                     * @description Polymarket: `wallet` (the linked venue wallet), `signer`, or `escrow` (the signer's deposit address, swept into the available balance). Hyperliquid and Aster: `signer`. All three: `account`, a send to `recipient`. A standard Hyperliquid account: `xyz`, a move from its perps to its own trade.xyz balance, or `perps`, back from trade.xyz; free, without `dex`.
                     * @enum {string}
                     */
                    to: "wallet" | "signer" | "escrow" | "account" | "xyz" | "perps";
                    /** @description With `to: account` only: the other account. On Polymarket, its Perps owner (signer) address, not its wallet. */
                    recipient?: components["schemas"]["Address"];
                    /**
                     * @description Hyperliquid, a standard account: its trade.xyz balance pays the withdrawal or send instead of its perps. A unified account's one balance includes it: `VALIDATION_ERROR`.
                     * @enum {string}
                     */
                    dex?: "xyz";
                };
            };
        };
        responses: {
            /** @description The typed data to sign with `eth_signTypedData_v4`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        typed_data: components["schemas"]["TypedData"] | components["schemas"]["OpTypedData"];
                    };
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["VenueUnavailable"];
        };
    };
    postWithdrawal: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    venue: components["schemas"]["VenueId"];
                    /** @description Exactly as `POST /v1/withdrawals/prepare` returned it. */
                    typed_data: components["schemas"]["TypedData"] | components["schemas"]["OpTypedData"];
                    signature: components["schemas"]["Signature"];
                    envelope?: components["schemas"]["AsterEnvelope"];
                };
            };
        };
        responses: {
            /** @description The withdrawal. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Withdrawal"];
                };
            };
            /** @description `VALIDATION_ERROR`, `BAD_SIGNATURE`, or `WITHDRAWAL_EXPIRED` ten minutes after preparation. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            /** @description `STATE_CONFLICT`; with `reason` `funds_arriving`: an earlier withdrawal of a route is still arriving, nothing more is withdrawn. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["AccountNotLinked"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            /** @description `VENUE_REJECTED`: refused by the venue or before sending; not retryable. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postV1Credentials: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CredentialInput"];
            };
        };
        responses: {
            /** @description The credential and its bearer. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CredentialCreated"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            409: components["responses"]["StateConflict"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    deleteV1CredentialsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    postV1CredentialsIdRotate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CredentialRotationInput"];
            };
        };
        responses: {
            /** @description The new bearer. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CredentialRotated"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["AccessRequired"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1OrdersHistory: {
        parameters: {
            query?: {
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of orders. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderHistoryPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getTakeHistory: {
        parameters: {
            query?: {
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Complete takes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TakeHistoryPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1FillsHistory: {
        parameters: {
            query?: {
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of fills. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FillHistoryPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1WithdrawalsHistory: {
        parameters: {
            query?: {
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of withdrawals. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WithdrawalHistoryPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1TradesHistory: {
        parameters: {
            query?: {
                /** @description `mine`: trades where you are maker or taker. */
                scope?: "all" | "mine";
                /** @description `next_cursor` from the same route and filters; omit for the newest page. */
                after?: components["parameters"]["HistoryAfter"];
                limit?: components["parameters"]["Limit"];
                a?: components["schemas"]["VenueId"];
                b?: components["schemas"]["VenueId"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of trades. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TradeHistoryPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            422: components["responses"]["VenueDisabled"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1Events: {
        parameters: {
            query?: {
                /** @description Replay strictly after this cursor; 0 when omitted. */
                after?: components["parameters"]["ReplayAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            410: components["responses"]["ResyncRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1Snapshot: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The snapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Snapshot"];
                };
            };
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    getV1MeEvents: {
        parameters: {
            query?: {
                /** @description Replay strictly after this cursor; 0 when omitted. */
                after?: components["parameters"]["ReplayAfter"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventPage"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            410: components["responses"]["ResyncRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getV1MeSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The snapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrivateSnapshot"];
                };
            };
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            503: components["responses"]["SnapshotTooLarge"];
        };
    };
    getV1Stream: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Upgraded to WebSocket. */
            101: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not a WebSocket upgrade request. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `RATE_LIMITED`: connection limit reached. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}

export const routes = {
  "getSiteShareImage": {
    "path": "/share/v1/{filename}",
    "method": "GET"
  },
  "getTradeShareImage": {
    "path": "/share/v1/trades/{id}/image.png",
    "method": "GET"
  },
  "getTradeShareMetadata": {
    "path": "/share/trade",
    "method": "GET"
  },
  "getVenues": {
    "path": "/v1/venues",
    "method": "GET"
  },
  "postAsterSigningRpc": {
    "path": "/v1/venues/aster/rpc",
    "method": "POST"
  },
  "getBook": {
    "path": "/v1/books",
    "method": "GET"
  },
  "getRoute": {
    "path": "/v1/routes",
    "method": "GET"
  },
  "getTradeProof": {
    "path": "/v1/trades/{id}/proof",
    "method": "GET"
  },
  "getVolume": {
    "path": "/v1/volume",
    "method": "GET"
  },
  "getMarkets": {
    "path": "/v1/markets",
    "method": "GET"
  },
  "getHealth": {
    "path": "/health",
    "method": "GET",
    "accept": [
      503
    ]
  },
  "getV1Info": {
    "path": "/v1/info",
    "method": "GET"
  },
  "postAuthChallenge": {
    "path": "/v1/auth/challenge",
    "method": "POST"
  },
  "postAuthVerify": {
    "path": "/v1/auth/verify",
    "method": "POST"
  },
  "deleteV1AuthSessionsId": {
    "path": "/v1/auth/sessions/{id}",
    "method": "DELETE"
  },
  "getMe": {
    "path": "/v1/me",
    "method": "GET"
  },
  "postLinkChallenge": {
    "path": "/v1/accounts/link/challenge",
    "method": "POST"
  },
  "getVenueSetup": {
    "path": "/v1/accounts/{venue}/setup",
    "method": "GET"
  },
  "postVenueSetupStep": {
    "path": "/v1/accounts/{venue}/setup/{step}",
    "method": "POST"
  },
  "postLink": {
    "path": "/v1/accounts/link",
    "method": "POST"
  },
  "deleteLink": {
    "path": "/v1/accounts/{venue}",
    "method": "DELETE"
  },
  "getBalances": {
    "path": "/v1/balances",
    "method": "GET"
  },
  "getStats": {
    "path": "/v1/me/stats",
    "method": "GET"
  },
  "getV1MeExposure": {
    "path": "/v1/me/exposure",
    "method": "GET"
  },
  "getQuoteLines": {
    "path": "/v1/quote-lines",
    "method": "GET"
  },
  "publishQuoteLines": {
    "path": "/v1/quote-lines",
    "method": "POST"
  },
  "prepareQuoteLines": {
    "path": "/v1/quote-lines/prepare",
    "method": "POST"
  },
  "prepareMaker": {
    "path": "/v1/maker/{venue}/prepare",
    "method": "POST"
  },
  "getMakerPreparation": {
    "path": "/v1/maker/preparations/{id}",
    "method": "GET"
  },
  "cancelMakerPreparation": {
    "path": "/v1/maker/preparations/{id}",
    "method": "DELETE"
  },
  "submitMakerSignatures": {
    "path": "/v1/maker/preparations/{id}/signatures",
    "method": "POST"
  },
  "getOrders": {
    "path": "/v1/orders",
    "method": "GET"
  },
  "getOrder": {
    "path": "/v1/orders/{id}",
    "method": "GET"
  },
  "deleteQuotes": {
    "path": "/v1/orders/{id}/quotes",
    "method": "DELETE"
  },
  "postV1QuotesBatch": {
    "path": "/v1/quotes/batch",
    "method": "POST"
  },
  "putV1QuoteIdentitiesIdLease": {
    "path": "/v1/quote-identities/{id}/lease",
    "method": "PUT"
  },
  "deleteV1QuoteIdentitiesIdQuotes": {
    "path": "/v1/quote-identities/{id}/quotes",
    "method": "DELETE"
  },
  "postCloses": {
    "path": "/v1/closes",
    "method": "POST"
  },
  "postCloseSignatures": {
    "path": "/v1/closes/{id}/signatures",
    "method": "POST"
  },
  "getEscrow": {
    "path": "/v1/escrow",
    "method": "GET"
  },
  "postEscrowClosePrepare": {
    "path": "/v1/escrow/close/prepare",
    "method": "POST"
  },
  "postEscrowClose": {
    "path": "/v1/escrow/close",
    "method": "POST"
  },
  "postEscrowWithdrawPrepare": {
    "path": "/v1/escrow/withdraw/prepare",
    "method": "POST"
  },
  "postEscrowWithdraw": {
    "path": "/v1/escrow/withdraw",
    "method": "POST"
  },
  "postTransfer": {
    "path": "/v1/transfers",
    "method": "POST"
  },
  "getTransfers": {
    "path": "/v1/transfers",
    "method": "GET"
  },
  "getTransfer": {
    "path": "/v1/transfers/{id}",
    "method": "GET"
  },
  "cancelTransfer": {
    "path": "/v1/transfers/{id}",
    "method": "DELETE"
  },
  "prepareTransferWithdrawal": {
    "path": "/v1/transfers/{id}/withdrawal/prepare",
    "method": "POST"
  },
  "submitTransferWithdrawal": {
    "path": "/v1/transfers/{id}/withdrawal",
    "method": "POST"
  },
  "prepareTransferMove": {
    "path": "/v1/transfers/{id}/move/prepare",
    "method": "POST"
  },
  "submitTransferMove": {
    "path": "/v1/transfers/{id}/move",
    "method": "POST"
  },
  "prepareGroupedRoute": {
    "path": "/v1/transfers/{id}/grouped",
    "method": "POST"
  },
  "abortGroupedRoute": {
    "path": "/v1/transfers/{id}/grouped",
    "method": "DELETE"
  },
  "commitGroupedRoute": {
    "path": "/v1/transfers/{id}/grouped/signatures",
    "method": "POST"
  },
  "postTake": {
    "path": "/v1/takes",
    "method": "POST"
  },
  "getV1TakesId": {
    "path": "/v1/takes/{id}",
    "method": "GET"
  },
  "deleteTake": {
    "path": "/v1/takes/{id}",
    "method": "DELETE"
  },
  "postTakeSignatures": {
    "path": "/v1/takes/{id}/signatures",
    "method": "POST"
  },
  "preparePaymentRefund": {
    "path": "/v1/fills/{id}/refund/prepare",
    "method": "POST"
  },
  "submitPaymentRefund": {
    "path": "/v1/fills/{id}/refund",
    "method": "POST"
  },
  "acceptFill": {
    "path": "/v1/fills/{id}/accept",
    "method": "POST"
  },
  "submitDelivery": {
    "path": "/v1/fills/{id}/delivery",
    "method": "POST"
  },
  "getFills": {
    "path": "/v1/fills",
    "method": "GET"
  },
  "postWithdrawalPrepare": {
    "path": "/v1/withdrawals/prepare",
    "method": "POST"
  },
  "postWithdrawal": {
    "path": "/v1/withdrawals",
    "method": "POST"
  },
  "postV1Credentials": {
    "path": "/v1/credentials",
    "method": "POST"
  },
  "deleteV1CredentialsId": {
    "path": "/v1/credentials/{id}",
    "method": "DELETE"
  },
  "postV1CredentialsIdRotate": {
    "path": "/v1/credentials/{id}/rotate",
    "method": "POST"
  },
  "getV1OrdersHistory": {
    "path": "/v1/orders/history",
    "method": "GET"
  },
  "getTakeHistory": {
    "path": "/v1/takes/history",
    "method": "GET"
  },
  "getV1FillsHistory": {
    "path": "/v1/fills/history",
    "method": "GET"
  },
  "getV1WithdrawalsHistory": {
    "path": "/v1/withdrawals/history",
    "method": "GET"
  },
  "getV1TradesHistory": {
    "path": "/v1/trades/history",
    "method": "GET"
  },
  "getV1Events": {
    "path": "/v1/events",
    "method": "GET"
  },
  "getV1Snapshot": {
    "path": "/v1/snapshot",
    "method": "GET"
  },
  "getV1MeEvents": {
    "path": "/v1/me/events",
    "method": "GET"
  },
  "getV1MeSnapshot": {
    "path": "/v1/me/snapshot",
    "method": "GET"
  },
  "getV1Stream": {
    "path": "/v1/stream",
    "method": "GET"
  }
} as const;

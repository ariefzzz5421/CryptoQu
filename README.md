# CryptoQu

Payment infrastructure that lets anyone settle an Indonesian **QRIS** code with **stablecoins**.
The payer holds USDC, USDT or IDRX; the merchant receives rupiah on the rails they already use and
sees an ordinary QRIS payment. Nothing at the counter changes.

Built from the primitives up — a QRIS codec, a routing engine, a double-entry ledger and a webhook
dispatcher — with a web app on top.

```
payer wallet → chain watcher → payment router → liquidity venue → IDR payout rail → QRIS merchant
                                     └────────── double-entry ledger ──────────┘
```

## What is actually implemented

| Piece | Where | What it does |
| --- | --- | --- |
| QRIS codec | `src/lib/qris/` | EMVCo TLV encode/decode, CRC-16/CCITT-FALSE, parser, validator, static→dynamic conversion, code minting |
| Payment router | `src/lib/router/` | Asset/chain/venue/rail registry, FX oracle with median aggregation, route pricing and ranking, signed quotes |
| Settlement core | `src/server/` | Double-entry ledger, payment-intent state machine, HMAC webhooks with backoff, API keys, idempotency, rate limiting |
| REST API | `src/app/api/v1/` | Decode, quote, intent lifecycle, rates, assets, merchants, ledger, health |
| Web app | `src/app/`, `src/components/` | Landing page, checkout, merchant console, API playground, status board |

### QRIS codec

Handles a real Merchant-Presented QR payload: nested templates (tags 26–51, 62, 64, 80–99), the
national repository template carrying the NMID, merchant classification, convenience-fee tags
55/56/57, and the tag-63 checksum. Converting a static code to a dynamic one flips tag 01, writes
tag 54, rewrites the fee tags as a set, merges tag 62 and recomputes the CRC.

The checksum is CRC-16/CCITT-FALSE (`poly=0x1021, init=0xFFFF, no reflection`), verified in tests
against the canonical `"123456789" → 0x29B1` check vector.

### Payment router

For a given rupiah amount it prices **every** accepted `(asset, chain)` pair end to end:

- gas on the source chain,
- liquidity venue commission,
- price impact from ticket size against venue depth,
- FX spread crossing into IDR (zero for rupiah-pegged tokens),
- the platform take rate,

then ranks routes under a `cost` / `balanced` / `speed` objective. Token amounts always round **up**
to the asset's precision — rounding down would leave the merchant short and the payment would
reconcile as underpaid.

The winning route is returned as a **signed quote** with a 90-second rate lock. The signature covers
the amounts, the deadline and the route's asset/chain/size, so a client cannot edit any of it on the
way back to the intent endpoint.

### Fees, and who pays them

Bank Indonesia sets the Merchant Discount Rate and requires the **merchant** to bear it — it must
never be passed to the customer. CryptoQu keeps that line separate: the MDR is shown on every quote
but is not added to what the payer sends. The platform fee, FX spread, venue fee and price impact
sit on the payer's side and are itemised individually.

### Ledger

Every settled payment writes three balanced transactions: the payer's transfer into a vault, the
sale to the liquidity venue (which simultaneously recognises the merchant payable and the platform
revenue), and the rupiah payout. A transaction must sum to zero **within each currency it touches**;
a cross-currency payment balances the token leg and the rupiah leg independently. `GET /api/v1/ledger`
will show you its own trial balance.

Amounts are `bigint` minor units throughout. No floating point touches a balance.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 83 tests
npm run build
```

No database, no external services, no keys required — the store is in-process and seeds a demo
merchant on boot.

### Environment

| Variable | Effect |
| --- | --- |
| `CRYPTOQU_QUOTE_SECRET` | HMAC key for quote signatures. Without it an ephemeral key is generated, so quotes stop verifying across a restart. Set this in any real deployment. |

## API

Base path `/api/v1`. JSON over HTTPS, `Idempotency-Key` honoured on mutations, per-key rate limits,
machine-readable error codes.

```bash
# 1. Decode the merchant's code
curl -s localhost:3000/api/v1/qris/decode \
  -H 'content-type: application/json' \
  -d '{"payload":"00020101021151440014ID.CO.QRIS.WWW..."}'

# 2. Price it across every asset and chain
curl -s localhost:3000/api/v1/quotes \
  -H 'content-type: application/json' \
  -d '{"payload":"...","amountIdr":45000,"objective":"cost"}'

# 3. Commit the quote into a payment intent
curl -s localhost:3000/api/v1/intents \
  -H 'content-type: application/json' \
  -H 'idempotency-key: 7f3c...' \
  -d '{"quote":{...}}'

# 4. Record the payer's transfer (the chain watcher's job in production)
curl -s localhost:3000/api/v1/intents/pi_.../fund \
  -H 'content-type: application/json' \
  -d '{"txHash":"0x..."}'
```

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/qris/decode` | Parse a payload into merchant identity, amounts and the TLV tree |
| POST | `/qris/dynamic` | Promote a static code to a dynamic one carrying an amount |
| POST | `/quotes` | Price the payment; returns the best route, alternatives and a signature |
| POST | `/intents` | Commit a signed quote |
| GET | `/intents`, `/intents/{id}` | Read intents, advanced to their current state |
| POST | `/intents/{id}/fund` | Record the payer's on-chain transfer |
| GET | `/rates` | IDR rates per peg currency plus stablecoin peg health |
| GET | `/assets` | Assets, chains, venues, rails, limits, MDR schedule |
| GET | `/merchants`, POST `/merchants` | Merchant registry and onboarding |
| GET | `/ledger` | Trial balance, accounts and postings (`?reference=pi_…`) |
| GET | `/webhooks` | Every delivery attempt and its response |
| GET | `/health` | Component health and the FX oracle's current state |

### Webhooks

`payment_intent.created | funded | succeeded | failed | expired`, signed as
`X-CryptoQu-Signature: t=<unix>,v1=<hmac-sha256 of "<t>.<body>">`, retried five times over roughly
ten minutes. `verifyWebhook` in `src/server/webhooks.ts` is the reference implementation and is
exported so integrators can copy it verbatim.

## Deliberate boundaries

This is a working reference implementation, not a licensed payment provider. Specifically:

- **No custody and no chain connection.** `POST /intents/{id}/fund` stands in for the chain watcher.
  Deposit addresses are derived deterministically from the quote rather than from a custody
  provider's derivation path.
- **No acquirer connection.** Settlement is modelled against the published rail characteristics; no
  real IDR moves.
- **In-process storage.** `src/server/store.ts` is a single-process map behind a `Store` interface.
  Swapping it for Postgres means implementing that interface, not touching route handlers.
- **Venue depth and peg prices are configuration**, not live market data. They live in
  `src/lib/router/registry.ts` and are the surface a liquidity keeper would refresh.
- Operating this for real in Indonesia requires PJP licensing from Bank Indonesia and a registered
  crypto-asset trader licence — neither of which a repository can provide.

### FX oracle behaviour

Rates are the median of independent public feeds (`open.er-api`, `frankfurter`, `coinbase`), with
outliers beyond 2% discarded. When every feed is unreachable the oracle falls back to a baseline and
marks the snapshot `degraded`; quotes built that way carry the warning rather than being silently
priced. `/status` shows which sources answered.

Note that Node's `fetch` does not honour `HTTPS_PROXY` automatically — in a sandbox that requires an
egress proxy the feeds will fail and the oracle will run on the baseline by design.

## Tests

```
src/lib/qris/qris.test.ts     32   codec, checksum, parsing, conversion, minting, MDR tiers
src/lib/router/router.test.ts 23   pricing, rounding, objectives, limits, venue and rail selection
src/server/server.test.ts     28   ledger invariants, quote signing, intent lifecycle, webhooks
```

The lifecycle tests assert something worth stating explicitly: an intent's event log reads
identically whether it was polled every second or read once after settlement.

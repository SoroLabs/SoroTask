# Portfolio allocation dashboard

The `/dashboard` page includes a Recharts donut for token allocation, active and
idle capital totals, and an area chart of historical USD portfolio values. It
loads separately from existing dashboard widgets. Hover a donut segment or
focus its token button to see exact USD values. The expandable tables contain
every asset and historical value, so chart information does not depend on color
or a pointer. Animations use 600 ms easing and honor reduced-motion preferences.

The chart uses an Okabe–Ito palette, token labels and percentages. At most eight
donut segments are shown: portfolios with more than eight valued tokens group
the smaller holdings under **Other assets**. All individual assets remain in the
table, including zero balances and issuer/contract identifiers. Equal symbols
from different issuers are distinct assets. Zero-valued portfolios have an empty
state, and fewer than two history points produce an explanatory message.

## Configure a read-only data source

Set the server-only environment variable:

```dotenv
SOROTASK_PORTFOLIO_API_URL=https://portfolio.example.org/snapshot
```

SoroTask does not currently provide a multi-token valuation endpoint. Configure
an HTTPS source that implements the contract below. Without it, the dashboard
shows an unavailable-data message rather than invented balances. The chart does
not use the existing WalletContext's sample XLM portfolio metrics or assume an
exchange rate. Configuration is optional and adds no dependency.

The same-origin `GET /api/portfolio-allocation` adapter forwards `address` and
`networkPassphrase` query parameters to that fixed configured URL. User input
cannot select a host. URLs with embedded credentials/fragments are rejected;
redirects are refused. The source must serve publicly readable valuation data,
and the adapter forwards no cookies, wallet signatures or authentication tokens.
Its scope is the current wallet address and SoroTask's supported Futurenet network
(`Test SDF Future Network ; October 2022`). No contract calls or transfers occur.

## Snapshot interface, version 1

Return JSON with this shape (values and identifiers below are synthetic):

```json
{
  "schemaVersion": 1,
  "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "networkPassphrase": "Test SDF Future Network ; October 2022",
  "asOf": "2026-11-23T10:00:00Z",
  "assets": [
    {
      "assetId": "USDC:synthetic-issuer",
      "symbol": "USDC",
      "name": "USD Coin",
      "activeUsdCents": "60000",
      "idleUsdCents": "20000"
    },
    {
      "assetId": "EURC:synthetic-issuer",
      "symbol": "EURC",
      "name": "Euro Coin",
      "activeUsdCents": "10000",
      "idleUsdCents": "10000"
    }
  ],
  "history": [
    { "at": "2026-11-22T00:00:00Z", "totalUsdCents": "90000" },
    { "at": "2026-11-23T00:00:00Z", "totalUsdCents": "100000" }
  ]
}
```

This renders **$1,000.00 total**, **USDC 80.0%**, **EURC 20.0%**, **$700.00 active**
and **$300.00 idle**. Historical values use their own observation-time prices.

- USD values are canonical nonnegative integer **cent strings**, not token units
  or floating-point dollar values. Exact totals use BigInt; fractions converted
  to Number are used only for SVG geometry and displayed percentages. Tiny shares
  display `<0.1%`. Individual amounts and their combined total must fit positive
  Soroban i128 range (zero is permitted).
- The source performs price conversion and defines **active** as committed escrow
  value and **idle** as uncommitted balance. These buckets must be mutually
  exclusive; it must avoid counting deposited assets and their receipts twice.
  Unpriced assets must be omitted, not silently valued at zero. Values are source
  estimates; the component labels their valuation timestamp.
- `assetId` must uniquely identify the token by issuer/contract, not its symbol.
  Limits: 200 assets, 365 history points, 160 characters per ID, 32 per symbol,
  100 per name. Empty/control-character labels and duplicate IDs are rejected.
- UTC timestamps use `YYYY-MM-DDTHH:mm:ssZ` or exactly three fractional digits.
  Invalid dates, duplicate historical instants, and history after `asOf` fail.
  History is sorted without mutating the source input.
- The response must match the requested address/network. Snapshots older than
  five minutes or more than one minute in the future are rejected. Displayed
  values disappear once their five-minute freshness window expires.
- Upstream fetch timeout: eight seconds. Maximum body: 256 KiB, enforced while
  streaming as well as through Content-Length. API and client fetches use
  `no-store`; responses include `Cache-Control: no-store`.

The client aborts requests on wallet/network changes or unmount, ignores late
responses, and never displays the previous wallet's values while switching.
Loading, disconnected, unconfigured, empty and error states are distinct. Failed
loads offer Retry; a ten-second client timeout also handles stalled responses.

## Stable API failures

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_scope` | Invalid Stellar address or unsupported network. |
| 503 | `not_configured` | Source is absent or its URL is invalid. |
| 503 | `source_unavailable` | Transport, size, JSON, schema or scope validation failed. |
| 503 | `stale_snapshot` | Snapshot falls outside the freshness window. |

Failures never echo endpoint credentials or raw provider errors. The adapter is
read-only and does not certify the feed's prices, index state or accounting.

## Verification

```sh
cd frontend
npm test -- --runInBand --runTestsByPath \
  src/lib/__tests__/portfolio-allocation.test.ts \
  src/lib/__tests__/portfolio-source.test.ts \
  app/api/portfolio-allocation/route.test.ts \
  src/components/__tests__/PortfolioAllocationChart.test.tsx \
  src/components/__tests__/DashboardPortfolioAllocation.test.tsx \
  app/dashboard/page.test.tsx \
  src/lib/rsc/__tests__/pipeline.test.ts
npm run lint
npm run build
```

Tests use synthetic snapshots, fake transports and temporary component state.
No production credentials, live wallet connection or funded-state changes are
needed. Browser verification uses the actual Recharts component with synthetic
data; it does not establish that unrelated repository pages build successfully.

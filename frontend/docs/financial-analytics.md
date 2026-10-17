# Financial analytics feeds

The gas optimization and yield calculator pages use real analytics records.
They do not generate example market data when a feed is unavailable. Configure
the service URLs before deploying these dashboards:

- `NEXT_PUBLIC_ANALYTICS_API_URL` is the API origin/base URL (defaults to the
  same origin). The dashboard requests `/api/analytics/gas-history` and
  `/api/analytics/yield-history`; when the base ends in `/api`, it requests
  `/analytics/gas-history` and `/analytics/yield-history` beneath it.
- `NEXT_PUBLIC_ANALYTICS_WS_URL` is an optional absolute `ws://` or `wss://`
  URL for live updates. The client adds `stream=gas` or `stream=yield` to select
  the feed, then reconnects with capped exponential backoff. Socket messages must be JSON objects containing
  `type: "gas"` or `type: "yield"` and a `data` record. `type: "heartbeat"`
  messages are ignored.

History endpoints may return an array or `{ "records": [...] }`, with at most
10,000 records:

```json
{
  "records": [
    {
      "timestamp": "2026-10-17T00:00:00.000Z",
      "open": 0.08,
      "high": 0.12,
      "low": 0.06,
      "close": 0.1,
      "volumeXlm": 250,
      "batchSavingsXlm": 0.02,
      "depth": [
        { "priceXlm": 0.1, "cumulativeVolumeXlm": 1200 }
      ]
    }
  ]
}
```

Gas records require non-negative XLM OHLC values and may include volume,
batching savings, and liquidity depth. Yield records require
`timestamp` and `apyPercent`; `accruedYieldXlm` is optional. Timestamps may be
ISO strings or Unix timestamps in seconds/milliseconds. The server is
responsible for sourcing and authorizing these financial records. The browser
validates each response and reports feed errors instead of plotting malformed
or fabricated values.

Both chart types support wheel/toolbar zoom and drag-to-pan. CSV exports
contain the complete loaded history and current compound projection points,
not only the chart's visible zoom window. Gas exports include OHLC, volume,
batch savings and each returned liquidity-depth level.

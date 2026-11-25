# Automated Disaster Recovery and Multi-Region Failover

This document describes the keeper's automated disaster recovery path for Soroban RPC outages.

## Goals

- Keep task polling and execution available when a primary region fails.
- Detect endpoint degradation early and route traffic to healthy regions.
- Emit explicit operational signals for failover events and endpoint health.

## Architecture

The keeper now uses `MultiRegionRPCClient` as the RPC access layer.

- Endpoints are configured as an ordered region list.
- One endpoint is marked active for observability and non-wrapped passthrough access.
- Wrapped RPC calls are routed to the highest-scoring healthy endpoint first.
- On failure, calls automatically retry across the remaining healthy endpoints.
- Repeated failures mark an endpoint unavailable for a cooldown window.
- Background health checks periodically recover endpoints, measure latency, compare ledger height,
  and rebalance active routing to the fastest synchronized node.

## Configuration

Required:

- `SOROBAN_RPC_URL`: primary RPC URL (backward-compatible default)

Optional failover controls:

- `SOROBAN_RPC_URLS`: comma-separated list of additional RPC URLs (multi-region)
- `RPC_FAILOVER_ENABLED`: `true|false` (default: enabled when more than one URL exists)
- `RPC_FAILOVER_FAILURE_THRESHOLD`: consecutive failures before endpoint quarantine (default: `3`)
- `RPC_FAILOVER_COOLDOWN_MS`: endpoint cooldown window (default: `30000`)
- `RPC_FAILOVER_HEALTH_CHECK_INTERVAL_MS`: background probe interval (default: `15000`)
- `RPC_FAILOVER_MAX_HEALTHY_LEDGER_LAG`: ledgers behind the best observed node before score is penalized (default: `3`)
- `RPC_FAILOVER_LATENCY_PENALTY_THRESHOLD_MS`: latency used to scale score penalties (default: `1000`)

## Routing Score

Each endpoint starts with a score of `100`. Health checks and live calls adjust the score by:

- Average RPC latency
- Rolling error rate
- Consecutive failures
- Ledger-height lag compared with the freshest observed node

The keeper routes calls to the highest score first. Transaction submissions therefore prefer the
fastest healthy, synchronized node, while still retrying across every available endpoint before
returning a structured exhausted-failover error.

## Observability

The metrics and health endpoints include failover state.

JSON endpoints (`/health`, `/metrics`):

- Active region and endpoint index
- Healthy endpoint count versus total
- Per-endpoint status and failure metadata

Prometheus metrics:

- `keeper_rpc_failover_events_total`
- `keeper_rpc_failover_switches_total`
- `keeper_rpc_failover_active_endpoint_index`
- `keeper_rpc_failover_healthy_endpoints`
- `keeper_rpc_failover_total_endpoints`

## Failure and Recovery Flow

1. Active region fails an RPC call.
2. Failure counters increase and endpoint score decreases.
3. If threshold is exceeded, endpoint becomes unavailable for cooldown.
4. Request is retried against alternate regions by health score.
5. Successful alternate response updates active endpoint selection.
6. Background health checks recover previously unavailable regions and rebalance to faster nodes.

## Security Notes

- Keep all RPC URLs on trusted infrastructure and private networking where possible.
- Use TLS endpoints only for production traffic.
- Rotate keeper secrets independently from region failover operations.

## Testing

Unit tests for failover behavior are in `keeper/__tests__/disasterRecovery.test.js` and cover:

- Healthy primary path
- Automatic cross-region failover
- Exhausted failover error path
- Endpoint recovery via health checks
- Latency-based routing to the fastest healthy endpoint
- Ledger-lag scoring for stale nodes

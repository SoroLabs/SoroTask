# Multi-region routing for keeper API gateways (BE-PROD-38, #1462)

Status: **scaffold and design notes only**. Nothing here is provisioned. The
routing layer depends on DNS or BGP accounts and on regional deployments that
this repository does not contain.

## What is in this directory

- `health-check.example.json`: an example Route 53 HTTPS health check for one
  regional gateway. It probes `/health`, which the keeper metrics server serves
  (`keeper/src/metrics.js`).

## Target design

1. Deploy one keeper API gateway per region (three regions per the issue).
2. Route client traffic to the lowest-latency healthy region: latency-based
   records (Route 53) or Cloudflare load balancing with a latency steering policy.
3. Each region has an HTTPS health check. When a region fails its check, its
   record is removed from answers and traffic moves to the next region.

## Acceptance criteria versus what DNS can do

These are the issue's targets, with what each one needs:

- **Failover in under 5 seconds.** DNS-based failover cannot meet this. Route 53
  health checks run at 10 s (fast) or 30 s (standard) intervals with a failure
  threshold of at least 1, and resolvers cache answers for the record TTL.
  Realistic failover is tens of seconds. Sub-5-second failover needs BGP anycast
  with a traffic-steering provider (for example, Cloudflare Magic Transit), which
  is a separate paid product.
- **Average client latency under 50 ms.** This depends on client geography and
  regional placement. It cannot be checked from this repository.
- **100% uptime.** No design meets this strictly. The realistic target is
  multi-region redundancy plus monitoring (see the synthetic canary prober,
  #1467).

## Needed outside this repo

1. Domain DNS hosted on Route 53 or Cloudflare.
2. Gateway deployments in three regions with a `/health` endpoint.
3. If sub-5-second failover is a hard requirement: a BGP anycast provider
   contract and an agreed change to the acceptance criteria if it is not bought.

## Not covered by this scaffold

- Terraform or provisioning code for health checks and records.
- Any measurement of latency or failover time. Those need a live multi-region
  deployment and a test harness.

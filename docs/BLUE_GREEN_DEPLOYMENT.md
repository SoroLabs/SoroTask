# Keeper Blue/Green Deployment with Automated Canary Routing

Issue #1657. This page covers how keeper releases reach production without
downtime, without dropped transactions, and with automatic rollback.

## Components

| Piece | Where | Role |
| --- | --- | --- |
| ALB, `blue`/`green` target groups, weighted HTTPS listener, 5xx alarms | `terraform/services.tf` | Traffic split between the two colors; connection draining (30s deregistration delay); `/readyz` health checks every 5s |
| `TargetGroupBinding` + `blueGreen.*` values | `charts/sorotask-keeper` | Registers each color's pods (IP mode) into its target group; sets `DEPLOYMENT_COLOR` |
| `keeper_http_responses_total{status,deployment_color}` | `keeper/src/metrics.js` | Per-color request and 5xx counts, scraped every 5s |
| Readiness drain flag | `keeper/src/metrics.js`, `keeper/index.js` | `/readyz` returns `503 draining` from the moment SIGTERM arrives |
| Canary controller | `keeper/src/deploy/canaryController.js` | Shifts the weights, checks telemetry, decides whether to roll back |
| AWS ALB / Prometheus adapters, simulator | `keeper/src/deploy/providers.js` | I/O for the controller, plus an in-memory fleet for tests and dry runs |
| CLI | `keeper/scripts/blue-green-deploy.js` | Entry point used by the pipeline (`--simulate` for dry runs) |
| Pipeline | `.github/workflows/deploy.yml` | `blue-green-validate` on PRs; `keeper-blue-green-deploy` on `main` |

## Rollout

1. The pipeline reads the listener and finds the live color, the one with
   weight 100. The other color becomes the candidate. A listener that is not
   at a clean 100/0 split stops the job.
2. `helm upgrade --install sorotask-keeper-<candidate>` deploys the new image
   with weight 0. The job waits until every candidate target passes the ALB
   `/readyz` health check.
3. The controller moves the candidate's traffic to **10% → 50% → 100%** and
   holds each step for 60s (`CANARY_STEP_HOLD_MS`). It reads the candidate's
   10s 5xx window from Prometheus every 5s.
4. Once the 100% step has held cleanly, the old color's release is
   uninstalled. Its pods drain as described below.

## Rollback

A window counts as a breach when the candidate's 5xx rate is **above 0.5%**
and the window holds at least 5 errors. The 5-error floor stops a single
error among a handful of canary requests from rolling back a healthy release.
On a breach the controller sets the weights back to 100% stable at once. It
also rolls back when telemetry fails twice in a row, or when a weight change
fails.

Rollback time budget, checked when the config is validated (the controller
refuses a config that exceeds it):

| Stage | Worst case |
| --- | --- |
| Telemetry lag (5s Prometheus scrape) | 5s |
| Evaluation interval | 5s |
| ALB `modify-listener` call (timeout) | 4s |
| **Total** | **14s ≤ 15s** |

Failed rollback calls are retried within the deadline. If traffic still
cannot be restored, the controller exits with `ROLLBACK_FAILED`. The pipeline
then leaves both releases in place for an operator. It does not delete a
color that may still be carrying traffic.

The CloudWatch alarm `sorotask-keeper-<color>-5xx-rate-*` (>0.5%, 60s) is a
backstop. ALB metrics only have 60s resolution, so the controller enforces
the 15s rollback on its own.

## Zero dropped transactions

When a color is retired, each keeper pod goes through these steps:

1. `preStop` sleeps 5s, so the ALB controller can deregister the pod IP. New
   requests stop arriving, and the ALB drains open connections for 30s.
2. SIGTERM reaches `GracefulShutdownManager`, which moves to `draining`:
   - `/readyz` returns `503 draining`, so health checks also take the pod out
     of rotation;
   - the polling loop stops picking up new tasks;
   - in-flight executions keep running until they are confirmed, for up to
     `SHUTDOWN_DRAIN_TIMEOUT_MS` (30s).
3. Resources and locks are released, and the process exits.

`terminationGracePeriodSeconds` (45s) is longer than preStop (5s) + drain
(30s) + cleanup (5s), so Kubernetes never kills a pod in the middle of a
transaction. Both colors run side by side during a rollout. This is safe for
the same reason running several replicas is safe: task execution is guarded
by the Redis locks and the idempotency layer.

## Configuration (repository settings)

| Name | Type | Purpose |
| --- | --- | --- |
| `KEEPER_DEPLOY_ROLE_ARN` | secret | Role from terraform output `keeper_deployer_role_arn` (GitHub OIDC) |
| `KEEPER_LISTENER_ARN` | variable | terraform output `keeper_listener_arn` |
| `KEEPER_BLUE_TARGET_GROUP_ARN` / `KEEPER_GREEN_TARGET_GROUP_ARN` | variable | terraform output `keeper_target_group_arns` |
| `KEEPER_PROMETHEUS_URL` | variable | Prometheus reachable from the deploy runner |
| `KEEPER_DEPLOY_RUNNER` | variable | Runner label inside the VPC (the EKS endpoint is private) |
| `AWS_REGION`, `EKS_CLUSTER_NAME`, `KEEPER_NAMESPACE` | variable | Optional overrides |

If these are not set, the live job logs a notice and skips. Validation and
simulated rollouts still run.

**First migration:** the current single release (`sorotask-keeper`) is not
bound to a target group. Install it once as `sorotask-keeper-blue` with
`blueGreen.enabled=true`, `blueGreen.color=blue` and the blue target group
ARN, then point DNS (`origin_hostname`) at `keeper_alb_dns_name`.

## Local checks

```bash
cd keeper
npx jest __tests__/canaryController.test.js __tests__/blueGreenDrain.test.js __tests__/canaryStress.test.js
node scripts/blue-green-deploy.js --simulate                       # promotes
node scripts/blue-green-deploy.js --simulate --fault-rate 0.05     # rolls back, exit 2

terraform -chdir=terraform init -backend=false && terraform -chdir=terraform test
```

# SoroTask Keeper Configuration Guide

Welcome to the SoroTask Keeper network! This guide provides step-by-step instructions on how to set up and run a SoroTask Keeper bot. By running a keeper, you help ensure tasks in the SoroTask network are executed reliably and on time.

See the centralized [Glossary](../GLOSSARY.md) for definitions of domain-specific terms like Keeper, Resolver, and TaskConfig.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Setup Instructions](#setup-instructions)
- [Dead-Letter Queue](#dead-letter-queue)
- [Mock Soroban RPC](#mock-soroban-rpc-for-faster-local-testing)
- [Chaos Testing](#chaos-testing)
- [Docker Deployment](#docker-deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed on your machine:

- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://npmjs.com/)

## Environment Variables

The keeper bot requires certain configuration details to interact with the Stellar/Soroban network.
Create a `.env` file in the `keeper` directory and configure the following variables:

```env
# The URL of the Soroban RPC server you are connecting to
SOROBAN_RPC_URL="https://rpc-futurenet.stellar.org"

# The network passphrase for the network you are targeting
NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"

# The secret key of the keeper account that will submit the transactions
KEEPER_SECRET="S..."

# The contract ID of the deployed SoroTask contract
CONTRACT_ID="C..."

# Polling interval in milliseconds (default: 10000ms = 10 seconds)
POLLING_INTERVAL_MS=10000

# Maximum number of concurrent task reads during polling (default: 10)
MAX_CONCURRENT_READS=10

# Maximum number of concurrent task executions (default: 3)
MAX_CONCURRENT_EXECUTIONS=3

# Maximum task ID to check (default: 100) - or use TASK_IDS for specific tasks
MAX_TASK_ID=100

# Optional: Comma-separated list of specific task IDs to monitor
# TASK_IDS="1,2,3,5,8"

# Wait for transaction confirmation (default: true, set to 'false' to disable)
WAIT_FOR_CONFIRMATION=true

# Structured logging
LOG_LEVEL=info
# Optional: pretty console output for local development only
# LOG_FORMAT=pretty

# Optional: folder/file for keeper execution idempotency state
# Default file: ./data/execution_locks.json
# KEEPER_STATE_DIR=./data
# IDEMPOTENCY_STATE_FILE=./data/execution_locks.json

# Optional: lock expiration controls (milliseconds)
# EXECUTION_LOCK_TTL_MS=120000
# EXECUTION_COMPLETED_MARKER_TTL_MS=30000

# Metrics / admin API
METRICS_PORT=3000
HEALTH_STALE_THRESHOLD_MS=60000
# KEEPER_ADMIN_TOKEN=replace-with-strong-random-token

# Stable work partitioning across keeper instances
KEEPER_SHARD_INDEX=0
KEEPER_SHARD_COUNT=1
# KEEPER_SHARD_LABEL=keeper-a

# Recurring schedule drift thresholds (seconds)
DRIFT_WARNING_SECONDS=60
DRIFT_CRITICAL_SECONDS=300
```

### Explanation of Variables:

- **`SOROBAN_RPC_URL`**: This is the endpoint the bot uses to communicate with the network. You can use public nodes provided by Stellar or set up your own.
- **`NETWORK_PASSPHRASE`**: This ensures your bot is talking to the right network (e.g., Futurenet, Testnet, or Public Network).
- **`KEEPER_SECRET`**: Your keeper wallet's secret key. _Keep this private and never commit it to version control (we've ensured `.env` is ignored by git)._
- **`CONTRACT_ID`**: The deployed SoroTask contract address that the keeper will monitor and execute tasks from.
- **`POLLING_INTERVAL_MS`**: How often (in milliseconds) the keeper checks for due tasks. Lower values mean more frequent checks but higher RPC usage.
- **`MAX_CONCURRENT_READS`**: Maximum number of tasks to query in parallel during each poll. Higher values speed up polling but increase RPC load.
- **`MAX_CONCURRENT_EXECUTIONS`**: Maximum number of tasks that can be executed simultaneously. Controls execution throughput.
- **`MAX_TASK_ID`**: The keeper will check task IDs from 1 to this value. Alternatively, use `TASK_IDS` to specify exact task IDs.
- **`TASK_IDS`**: Optional comma-separated list of specific task IDs to monitor (e.g., "1,2,3,5"). If set, overrides `MAX_TASK_ID`.
- **`WAIT_FOR_CONFIRMATION`**: Whether to wait for transaction confirmation after submitting. Set to 'false' for fire-and-forget mode.
- **`LOG_LEVEL`**: Minimum log severity to emit (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).
- **`LOG_FORMAT`**: Optional log renderer. Leave unset for JSON logs; set to `pretty` for local human-readable output.
- **`KEEPER_STATE_DIR` / `IDEMPOTENCY_STATE_FILE`**: Location of persisted execution idempotency locks used to prevent duplicate submissions.
- **`EXECUTION_LOCK_TTL_MS`**: How long an in-progress execution lock is considered valid before stale recovery allows new work.
- **`EXECUTION_COMPLETED_MARKER_TTL_MS`**: Short-lived post-success marker to reduce accidental immediate duplicate submissions.
- **`KEEPER_ADMIN_TOKEN`**: Bearer token required to call the keeper admin pause/resume API.
- **`KEEPER_SHARD_INDEX` / `KEEPER_SHARD_COUNT`**: Stable shard assignment controls so multiple keeper instances can partition work without ambiguous ownership.
- **`KEEPER_SHARD_LABEL`**: Optional human-readable shard identifier used in metrics and logs.
- **`DRIFT_WARNING_SECONDS` / `DRIFT_CRITICAL_SECONDS`**: Thresholds for recurring execution drift classification.

### Dead-Letter Queue Configuration

The keeper includes a Dead-Letter Queue (DLQ) for handling repeatedly failing tasks:

```env
# Maximum number of failures before a task is quarantined (default: 5)
DLQ_MAX_FAILURES=5

# Time window for counting failures in milliseconds (default: 3600000 = 1 hour)
DLQ_FAILURE_WINDOW_MS=3600000

# Enable automatic quarantine of repeatedly failing tasks (default: true)
DLQ_AUTO_QUARANTINE=true

# Maximum number of dead-letter records to keep (default: 1000)
DLQ_MAX_RECORDS=1000
```

The DLQ automatically isolates tasks that fail repeatedly, preventing resource waste and providing diagnostic information for operators. See [Dead-Letter Queue Documentation](./docs/dead-letter-queue.md) for details.

## Setup Instructions

### Docker Deployment (Recommended)

Docker provides a reproducible, portable deployment that works on any cloud VM, VPS, or container orchestrator. This is the recommended approach for production deployments.

#### Quick Start with Docker Compose

1. **Navigate to the Repository Root**
   ```bash
   cd /path/to/sorotask
   ```

2. **Configure Environment Variables**
   
   Copy the example environment file and configure it:
   ```bash
   cp keeper/.env.example keeper/.env
   ```
   
   Edit `keeper/.env` with your configuration (see Environment Variables section below).

3. **Start the Keeper**
   
   From the repository root:
   ```bash
   docker compose up -d
   ```
   
   This will:
   - Build the Docker image with multi-stage optimization
   - Start the keeper container in detached mode
   - Mount `./keeper/data` for task registry persistence
   - Expose port 3001 for health checks and metrics
   - Automatically restart the container unless explicitly stopped

4. **View Logs**
   ```bash
   docker compose logs -f keeper
   ```

5. **Check Health Status**
   ```bash
   curl http://localhost:3001/health
   ```

6. **Stop the Keeper**
   ```bash
   docker compose down
   ```

#### Docker Commands Reference

**Build the image:**
```bash
cd keeper
npm run docker:build
```

**Run standalone container:**
```bash
cd keeper
npm run docker:run
```

**Manual Docker commands:**
```bash
# Build
docker build -t sorotask-keeper ./keeper

# Run with environment file and volume
docker run -d \
  --name sorotask-keeper \
  --env-file ./keeper/.env \
  -p 3001:3001 \
  -v $(pwd)/keeper/data:/app/data \
  --restart unless-stopped \
  sorotask-keeper

# View logs
docker logs -f sorotask-keeper

# Stop and remove
docker stop sorotask-keeper
docker rm sorotask-keeper
```

#### Docker Deployment Features

- **Multi-stage build**: Optimized image size with separate dependency and runtime stages
- **Security hardening**: Runs as non-root user (`node`)
- **Health checks**: Built-in health monitoring via `/health` endpoint
- **Data persistence**: Task registry persisted in `./keeper/data` volume
- **Automatic restart**: Container restarts automatically on failure
- **Log rotation**: Configured with 10MB max size and 3 file retention
- **Minimal base**: Uses `node:20-alpine` for smallest footprint

#### Cloud Deployment Examples

**AWS EC2 / DigitalOcean / Linode:**
```bash
# SSH into your VM
ssh user@your-server-ip

# Clone repository
git clone https://github.com/your-org/sorotask.git
cd sorotask

# Configure environment
cp keeper/.env.example keeper/.env
nano keeper/.env  # Edit with your settings

# Start with Docker Compose
docker compose up -d

# Verify it's running
docker compose ps
curl http://localhost:3001/health
```

**Kubernetes:**
```bash
# Build and push to registry
docker build -t your-registry/sorotask-keeper:latest ./keeper
docker push your-registry/sorotask-keeper:latest

# Create ConfigMap from .env
kubectl create configmap keeper-config --from-env-file=keeper/.env

# Deploy (create your k8s manifests based on docker-compose.yml)
kubectl apply -f k8s/keeper-deployment.yaml
```

### Local Development Setup

Once you have your prerequisite software and environment variables ready, follow these steps on a clean environment:

1. **Navigate to the Keeper Directory**  
   Open your terminal and navigate to the `keeper` folder if you haven't already:

   ```bash
   cd keeper
   ```

2. **Install Dependencies**  
   Run the following command to install the required Node.js packages (`soroban-client`, `dotenv`, and `node-fetch`):

   ```bash
   npm install
   ```

3. **Run the Keeper Bot**  
   Start the Node.js application to begin listening for and executing SoroTask tasks:
   ```bash
   node index.js
   ```

If successful, you will see output indicating that the Keeper has started, along with logs of its periodic checks for due tasks!

## Dead-Letter Queue

The keeper includes a Dead-Letter Queue (DLQ) system that automatically handles repeatedly failing tasks:

### What is the Dead-Letter Queue?

The DLQ captures and isolates tasks that fail repeatedly due to:
- Invalid configuration
- Broken target contracts
- Persistent permission problems
- Insufficient gas balance

### Key Features

- **Automatic Quarantine**: Tasks exceeding failure thresholds are automatically isolated
- **Diagnostic Context**: Full error history, stack traces, and task configuration preserved
- **Operator Visibility**: HTTP endpoints and Prometheus metrics for monitoring
- **Recovery Mechanism**: Manual recovery after issues are resolved

### Inspecting Quarantined Tasks

```bash
# Get DLQ overview
curl http://localhost:3000/dead-letter

# Get specific task details
curl http://localhost:3000/dead-letter/123
```

### Prometheus Metrics

```
keeper_quarantined_tasks_count          # Current quarantined tasks
keeper_tasks_quarantined_total          # Total tasks quarantined
keeper_tasks_recovered_total            # Total tasks recovered
keeper_tasks_quarantined_skipped_total  # Tasks skipped due to quarantine
```

### Demo

Run the interactive demo to see the DLQ in action:

```bash
node examples/dead-letter-demo.js
```

For complete documentation, see [Dead-Letter Queue Guide](./docs/dead-letter-queue.md).

## Mock Soroban RPC for Faster Local Testing

If you want to test keeper flows without a full Soroban node, the keeper includes a lightweight mock JSON-RPC server.

```bash
cd keeper
npm run mock-rpc
```

Then point the keeper at it:

```bash
export SOROBAN_RPC_URL=http://127.0.0.1:4100
export NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
```

Detailed usage, supported methods, and test examples are in [docs/mock-soroban-rpc.md](./docs/mock-soroban-rpc.md).

## Troubleshooting

### Issue: "Account not found"

- **Cause**: The account associated with your `KEEPER_SECRET` does not exist on the network you are trying to use.
- **Solution**: Fund your keeper account. If you are on Testnet or Futurenet, use the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator) to fund the public key associated with your secret. Ensure you've set the correct `NETWORK_PASSPHRASE` and match the network on Stellar Laboratory.

### Issue: "RPC error" or "Could not connect to server"

- **Cause**: The bot cannot reach the specified RPC endpoint, or the endpoint rejected the request due to rate-limiting or an invalid URL setup.
- **Solution**:
  - Double-check your `SOROBAN_RPC_URL` in the `.env` file for any typos. Ensure it includes the proper protocol (e.g., `https://`).
  - If you're using a public RPC, you might be rate-limited. Wait a few moments and try again, or switch to a dedicated/private RPC provider node.

### Issue: `Error: Cannot find module 'dotenv'` or `Error: Cannot find module 'soroban-client'`

- **Cause**: Application dependencies were not correctly or fully installed.
- **Solution**: Ensure you ran `npm install` inside the `keeper/` directory correctly. Try clearing cache or removing `node_modules` (`rm -rf node_modules`) and running `npm install` again.

## Chaos Testing

The keeper includes a comprehensive chaos testing framework to validate resilience under realistic failure conditions. This helps ensure the keeper can handle network issues, RPC failures, and degraded performance.

### Running Chaos Tests

```bash
# Run all chaos scenarios
npm run chaos-test

# Run specific scenarios
npm run chaos-test -- --scenario=latency,ratelimit

# List available scenarios
npm run chaos-test:list

# Run single scenario
npm run chaos-test:single latency

# Save report to file
npm run chaos-test -- --output=json --file=chaos-report.json
```

### Available Scenarios

1. **Latency Spikes** - Test timeout handling with random delays
2. **Partial RPC Failure** - Test graceful degradation when some methods fail
3. **Rate Limiting** - Test backoff behavior under throttling
4. **Flaky Network** - Test circuit breaker recovery
5. **Gradual Degradation** - Test adaptive behavior to worsening conditions
6. **Complete Outage** - Test worst-case scenario handling

### Integration with Tests

Chaos tests are integrated into the Jest test suite:

```bash
# Run all tests including chaos tests
npm test

# Run only chaos tests
npm test -- chaos.test.js
```

See [Chaos Testing Documentation](./docs/CHAOS_TESTING.md) for detailed information.

## Docker Deployment

The Keeper ships with a multi-stage Dockerfile and a `docker-compose.yml` at the repo root so you can run it on any server with a single command — no local Node.js installation required.

### Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) ≥ 24 (tested on 29.x)
- Docker Compose v2 (`docker compose` — space, not hyphen)

### Quick Start (recommended)

```bash
# 1. From the repo root, copy and fill in the environment file
cp keeper/.env.example keeper/.env
# Edit keeper/.env with your KEEPER_SECRET, CONTRACT_ID, etc.

# 2. Build the image and start the keeper in the background
docker compose up --build -d

# 3. Tail logs
docker compose logs -f keeper
```

The keeper's health and metrics endpoint will be reachable at `http://localhost:3000/health`.

### Prometheus Metrics

Prometheus-formatted metrics are available at `http://localhost:3000/metrics/prometheus`. See [docs/prometheus-metrics.md](./docs/prometheus-metrics.md) for detailed metric descriptions and Grafana dashboard examples.

### Check Health

```bash
# Should return {"status":"ok","uptime":...}
curl http://localhost:3000/health

# Or let Docker tell you (after ~30 s start_period)
docker compose ps
# Look for "healthy" in the STATUS column
```

### Data Persistence

The task registry (`data/tasks.json`) is stored in `./keeper/data/` on the host and mounted into the container. It survives container restarts and upgrades automatically.

### Standalone Docker Commands (npm scripts)

If you prefer to manage the container yourself without Compose, two npm convenience scripts are available. Run them from inside the `keeper/` directory:

```bash
# Build the image
npm run docker:build

# Run the container (reads .env from the current directory)
npm run docker:run
```

### Stop / Restart

```bash
# Stop (data volume is preserved)
docker compose down

# Restart after config changes
docker compose up -d --build
```

---

## Need Help?

If you're still running into issues, feel free to open a GitHub issue or reach out to our community channels.

# SoroTask Keeper Quick Start Guide

Get your keeper up and running in 5 minutes!

## Prerequisites

- Node.js v16 or higher
- npm
- A funded Stellar/Soroban account
- Access to a Soroban RPC endpoint

## Step 1: Install Dependencies

```bash
cd keeper
npm install
```

## Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your configuration:

```env
# Required
SOROBAN_RPC_URL=https://rpc-futurenet.stellar.org
NETWORK_PASSPHRASE=Test SDF Future Network ; October 2022
KEEPER_SECRET=S...your-secret-key...
CONTRACT_ID=C...deployed-contract-id...

# Optional (defaults shown)
POLLING_INTERVAL_MS=10000
MAX_CONCURRENT_READS=10
MAX_CONCURRENT_EXECUTIONS=3
MAX_TASK_ID=100
```

### Getting Your Keeper Secret

1. Generate a new keypair or use an existing one
2. Fund it using [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator)
3. Add the secret key to `.env`

### Getting the Contract ID

Deploy the SoroTask contract and copy its address:

```bash
cd ../contract
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/contract.wasm \
  --source YOUR_ACCOUNT \
  --network futurenet
```

## Step 3: Start the Keeper

```bash
npm start
```

You should see output like:

```
Starting SoroTask Keeper...
Connected to Soroban RPC: https://rpc-futurenet.stellar.org
Keeper account: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Poller initialized with max concurrent reads: 10
Starting polling loop with interval: 10000ms
[Keeper] Running initial poll...
[Keeper] Initial check: 100 tasks in registry
[Poller] Current ledger sequence: 12345
[Poller] Poll complete in 234ms | Checked: 5 | Due: 2 | Skipped: 1 | Errors: 0
```

## Step 4: Monitor Execution

Watch the logs for task execution:

```
[Keeper] ===== Starting new polling cycle =====
[Keeper] Checking 100 tasks...
[Poller] Task 1 is DUE (last_run: 1000, interval: 3600, next_run: 4600, current: 5000)
[Poller] Task 3 is DUE (last_run: 500, interval: 1000, next_run: 1500, current: 5000)
[Keeper] Found 2 due tasks, enqueueing for execution...
[Queue] Started execution for task 1
[Queue] Started execution for task 3
[Executor] Task 1 transaction submitted: abc123...
[Executor] Task 3 transaction submitted: def456...
[Executor] Task 1 executed successfully
[Executor] Task 3 executed successfully
[Queue] Task 1 executed successfully
[Queue] Task 3 executed successfully
[Queue] Cycle complete: {"depth":0,"inFlight":0,"completed":2,"failed":0}
[Keeper] ===== Polling cycle complete =====
```

## Step 5: Graceful Shutdown

Press `Ctrl+C` to stop the keeper:

```
^C
Received SIGINT. Starting graceful shutdown...
[ExecutionQueue] Draining queue. Waiting for 0 pending/in-flight tasks to complete/cancel...
[ExecutionQueue] Drained successfully.
Graceful shutdown complete. Exiting.
```

## Configuration Tips

### For Testing

Use a short polling interval and specific task IDs:

```env
POLLING_INTERVAL_MS=5000
TASK_IDS=1,2,3
WAIT_FOR_CONFIRMATION=true
```

### For Production

Use longer intervals and higher concurrency:

```env
POLLING_INTERVAL_MS=30000
MAX_CONCURRENT_READS=20
MAX_CONCURRENT_EXECUTIONS=5
MAX_TASK_ID=1000
WAIT_FOR_CONFIRMATION=false
```

## Troubleshooting

### "SOROBAN_RPC_URL environment variable is required"

Make sure your `.env` file exists and contains all required variables.

### "Account not found"

Your keeper account needs to be funded. Use the Friendbot for testnet/futurenet.

### "No tasks due for execution"

This is normal if:
- No tasks are registered yet
- All tasks have been executed recently
- Tasks don't have sufficient gas balance

### High error rate

Try reducing concurrency:

```env
MAX_CONCURRENT_READS=5
MAX_CONCURRENT_EXECUTIONS=2
```

## Next Steps

- Read [POLLING_ENGINE.md](./POLLING_ENGINE.md) for architecture details
- Check [README.md](./README.md) for comprehensive setup guide
- Run tests: `npm test`
- Monitor keeper performance and adjust configuration

## Production Checklist

- [ ] Secure storage for `KEEPER_SECRET`
- [ ] Dedicated RPC endpoint (not public)
- [ ] Monitoring and alerting setup
- [ ] Log aggregation configured
- [ ] Multiple keeper instances for HA
- [ ] Regular key rotation schedule
- [ ] Backup keeper accounts funded

## Support

For issues or questions:
- Check the troubleshooting section in [README.md](./README.md)
- Review [POLLING_ENGINE.md](./POLLING_ENGINE.md) for technical details
- Open a GitHub issue with logs and configuration (redact secrets!)

const {
  Keypair,
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  scValToNative,
} = require('@stellar/stellar-sdk');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.test from the root
const envPath = path.resolve(__dirname, '../../.env.test');
if (!fs.existsSync(envPath)) {
  console.error('.env.test not found. Run scripts/setup-contracts.sh first.');
  process.exit(1);
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const RPC_URL = process.env.SOROBAN_RPC_URL;
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE;
const CONTRACT_ID = process.env.CONTRACT_ID;
const TARGET_ID = process.env.TARGET_ID;
const CREATOR_SECRET = process.env.CREATOR_SECRET;

const server = new rpc.Server(RPC_URL);
const creatorKeypair = Keypair.fromSecret(CREATOR_SECRET);

async function registerTask() {
  console.log('Registering a task using stellar-cli...');

  // Construct the command
  // Note: we use --config as the argument name because that's what's in lib.rs: register(env, config)
  const cmd = `stellar contract invoke \
    --id ${CONTRACT_ID} \
    --source creator \
    --network local \
    -- \
    register \
    --config '{
      "creator": "${creatorKeypair.publicKey()}",
      "target": "${TARGET_ID}",
      "function": "get_token",
      "args": [],
      "resolver": null,
      "interval": 5,
      "last_run": 0,
      "gas_balance": "1000",
      "whitelist": [],
      "is_active": true
    }'`;

  console.log('Executing:', cmd);
  const output = execSync(cmd, { encoding: 'utf8' });
  console.log('CLI Output:', output);

  // Extract task ID from output (it's usually the last line or just the value)
  const taskId = parseInt(output.trim(), 10);
  console.log('Task ID registered:', taskId);
  return taskId;
}

async function getTaskLastRun(taskId) {
  const contract = new Contract(CONTRACT_ID);
  const result = await server.simulateTransaction(
    new TransactionBuilder(await server.getAccount(creatorKeypair.publicKey()), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_task', rpc.nativeToScVal(taskId, { type: 'u64' })))
      .setTimeout(30)
      .build(),
  );

  if (result.error) {
    throw new Error('Failed to get task: ' + JSON.stringify(result.error));
  }

  const task = scValToNative(result.result.retval);
  return task ? task.last_run : null;
}

async function runTest() {
  try {
    const taskId = await registerTask();
    const initialLastRun = await getTaskLastRun(taskId);
    console.log('Initial last_run:', initialLastRun);

    console.log('Starting keeper process...');
    // Ensure we are in the keeper directory
    const keeperDir = path.resolve(__dirname, '..');

    const keeper = spawn('node', ['index.js'], {
      cwd: keeperDir,
      env: {
        ...process.env,
        POLLING_INTERVAL_MS: '2000',
        LOG_LEVEL: 'debug',
        // Make sure data dir is clean for E2E
        DATA_DIR: path.join(keeperDir, 'data-e2e'),
      },
      stdio: 'inherit',
    });

    console.log('Waiting for keeper to execute task...');
    let executed = false;
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds

    while (Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, 5000));
      const currentLastRun = await getTaskLastRun(taskId);
      console.log('Current last_run:', currentLastRun);

      if (currentLastRun > initialLastRun) {
        console.log('SUCCESS: Task executed!');
        executed = true;
        break;
      }
    }

    keeper.kill('SIGINT');

    if (!executed) {
      console.error('FAILED: Task was not executed within timeout');
      process.exit(1);
    }

    console.log('E2E Test Passed!');
    process.exit(0);
  } catch (err) {
    console.error('Error during E2E test:', err);
    process.exit(1);
  }
}

runTest();

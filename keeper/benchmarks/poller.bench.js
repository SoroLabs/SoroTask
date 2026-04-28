const benny = require('benny');
const { rpc, nativeToScVal, Address, Networks } = require('@stellar/stellar-sdk');
const TaskPoller = require('../src/poller');
const { MockSorobanRpcServer } = require('../src/mockRpcServer');
const { createLogger } = require('../src/logger');

const { Server } = rpc;

// Disable logging for benchmarks to avoid noise and overhead
const logger = createLogger('bench');
logger.info = () => {};
logger.error = () => {};
logger.warn = () => {};

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

function createMockTaskConfig() {
  const config = {
    last_run: 100n,
    interval: 60n,
    gas_balance: 1000n,
    creator: new Address('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
    target: new Address('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
    function: 'hello',
    args: [],
    resolver: null,
    whitelist: []
  };
  
  // Wrap in Option::Some (scvVec with 1 element)
  return nativeToScVal([config]);
}

async function runBenchmark() {
  const server = new MockSorobanRpcServer({
    port: 0, // Random port
    latestLedger: { sequence: 200 }, // Ensure tasks are due (100 + 60 <= 200)
    defaultSimulationResponse: {
      results: [{
        retval: createMockTaskConfig()
      }]
    }
  });

  const url = await server.start();
  const rpcServer = new Server(url, { allowHttp: true });
  
  const poller = new TaskPoller(rpcServer, CONTRACT_ID, {
    maxConcurrentReads: 100, // High concurrency for stress testing
    logger: logger
  });

  // Mock getAccount to avoid extra RPC call in getTaskConfig if possible
  rpcServer.getAccount = async () => ({
    sequence: '1'
  });

  const generateTaskIds = (count) => Array.from({ length: count }, (_, i) => i + 1);

  const memBefore = process.memoryUsage();
  console.log(`Memory before polling benchmarks: ${Math.round(memBefore.heapUsed / 1024 / 1024)} MB`);

  await benny.suite(
    'Polling Engine Performance',

    benny.add('Poll 10 Tasks (Low Load)', async () => {
      await poller.pollDueTasks(generateTaskIds(10));
    }),

    benny.add('Poll 100 Tasks (Medium Load)', async () => {
      await poller.pollDueTasks(generateTaskIds(100));
    }),

    benny.add('Poll 1000 Tasks (Heavy Load)', async () => {
      await poller.pollDueTasks(generateTaskIds(1000));
    }),

    benny.cycle(),
    benny.complete(),
    benny.save({ folder: 'benchmarks/results', file: 'polling-results', format: 'json', details: true }),
    benny.save({ folder: 'benchmarks/results', file: 'polling-results', format: 'table.html' }),
  );

  const memAfter = process.memoryUsage();
  console.log(`Memory after polling benchmarks: ${Math.round(memAfter.heapUsed / 1024 / 1024)} MB`);
  console.log(`Heap growth: ${Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024)} MB`);

  await server.stop();
}

runBenchmark().catch(console.error);

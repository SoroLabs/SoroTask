const benny = require('benny');
const { rpc, xdr, Keypair, Account, Networks } = require('@stellar/stellar-sdk');
const { executeTask } = require('../src/executor');
const { MockSorobanRpcServer } = require('../src/mockRpcServer');
const { createLogger } = require('../src/logger');
const { createConcurrencyLimit } = require('../src/concurrency');

const { Server } = rpc;

// Disable logging for benchmarks to avoid noise and overhead
const logger = createLogger('bench');
logger.info = () => {};
logger.error = () => {};
logger.warn = () => {};

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const NETWORK_PASSPHRASE = Networks.FUTURENET;

async function runBenchmark() {
  const serverMock = new MockSorobanRpcServer({
    port: 0, // Random port
    defaultSimulationResponse: {
      transactionData: new xdr.SorobanTransactionData({
        ext: new xdr.SorobanTransactionDataExt(0),
        resources: new xdr.SorobanResources({
          footprint: new xdr.LedgerFootprint({
            readOnly: [],
            readWrite: []
          }),
          instructions: 100,
          diskReadBytes: 0,
          writeBytes: 0
        }),
        resourceFee: xdr.Int64.fromString("100")
      }).toXDR('base64'),
      minResourceFee: "100",
      results: [{
        auth: [],
        xdr: xdr.ScVal.scvVoid().toXDR('base64')
      }]
    }
  });

  const url = await serverMock.start();
  const server = new Server(url, { allowHttp: true });
  
  const keypair = Keypair.random();
  // Using a mock account
  const account = new Account(keypair.publicKey(), '1');

  // Intercept getTransaction to provide a mock response that avoids XDR parsing overhead/errors
  server.getTransaction = async () => ({
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    resultMetaXdr: {
      v3: () => ({
        sorobanMeta: () => ({
          ext: () => ({
            v1: () => ({
              totalNonRefundableResourceFeeCharged: () => 100n
            })
          })
        })
      })
    }
  });

  const executeMultipleTasks = async (count) => {
    // Limit concurrency to 100 to simulate a reasonable queue processing rate
    const limit = createConcurrencyLimit(100);
    const tasks = Array.from({ length: count }, (_, i) => i + 1);
    
    await Promise.all(
      tasks.map(taskId => limit(() => executeTask(taskId, {
        server,
        keypair,
        account,
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE
      })))
    );
  };

  const memBefore = process.memoryUsage();
  console.log(`Memory before execution benchmarks: ${Math.round(memBefore.heapUsed / 1024 / 1024)} MB`);

  await benny.suite(
    'Execution Engine Performance (Simulation + Submission)',

    benny.add('Execute 10 Tasks (Low Load)', async () => {
      await executeMultipleTasks(10);
    }),

    benny.add('Execute 100 Tasks (Medium Load)', async () => {
      await executeMultipleTasks(100);
    }),

    benny.add('Execute 1000 Tasks (Heavy Load)', async () => {
      await executeMultipleTasks(1000);
    }),

    benny.cycle(),
    benny.complete(),
    benny.save({ folder: 'benchmarks/results', file: 'executor-results', format: 'json', details: true }),
    benny.save({ folder: 'benchmarks/results', file: 'executor-results', format: 'table.html' }),
  );

  const memAfter = process.memoryUsage();
  console.log(`Memory after execution benchmarks: ${Math.round(memAfter.heapUsed / 1024 / 1024)} MB`);
  console.log(`Heap growth: ${Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024)} MB`);

  await serverMock.stop();
}

runBenchmark().catch(console.error);

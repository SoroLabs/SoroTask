const TaskRegistry = require('../src/registry');
const TaskPoller = require('../src/poller');

async function benchmark() {
  const server = {
    getLatestLedger: async () => ({ sequence: 10000 }),
    getEvents: async () => ({ events: [], cursor: 'next' }),
    getAccount: async () => ({ sequenceNumber: () => '1' }),
    simulateTransaction: async () => ({ results: [{ retval: null }] }),
  };

  const registry = new TaskRegistry(server, 'CONTRACT_ID');
  const poller = new TaskPoller(server, 'CONTRACT_ID');

  // Simulate 10 tasks in registry
  for (let i = 1; i <= 10; i++) {
    registry.updateTask(i, { id: i, interval: 3600, last_run: 0, gas_balance: 1000, status: 'active' });
  }

  const taskIds = registry.getTaskIds();

  console.time('Cold Start with Trusted Registry');
  await poller.pollDueTasks(taskIds, { registry, trustRegistry: true });
  console.timeEnd('Cold Start with Trusted Registry');

  console.time('Cold Start WITHOUT Trusted Registry');
  // This will try to do 1000 RPC calls (mocked but still overhead)
  await poller.pollDueTasks(taskIds, { registry, trustRegistry: false });
  console.timeEnd('Cold Start WITHOUT Trusted Registry');
}

benchmark();

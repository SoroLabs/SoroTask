require('dotenv').config();
const { Server, Keypair } = require('soroban-client');
const ExecutionQueue = require('./src/queue');

async function main() {
  console.log("Starting SoroTask Keeper...");
    
  // TODO: Initialize Soroban server connection
  // const server = new Server(process.env.SOROBAN_RPC_URL);
    
  // TODO: Load keeper account
  // const keeper = Keypair.fromSecret(process.env.KEEPER_SECRET);
    
    const queue = new ExecutionQueue();

    queue.on('task:started', (taskId) => console.log(`Started execution for task ${taskId}`));
    queue.on('task:success', (taskId) => console.log(`Task ${taskId} executed successfully`));
    queue.on('task:failed', (taskId, err) => console.error(`Task ${taskId} failed:`, err.message));
    queue.on('cycle:complete', (stats) => console.log(`Cycle complete: ${JSON.stringify(stats)}`));

    // Dummy executor function for now
    const dummyExecutor = async (taskId) => {
        return new Promise((resolve) => setTimeout(resolve, 500));
    };

    // Graceful shutdown handling
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
        clearInterval(pollingInterval);
        await queue.drain();
        console.log("Graceful shutdown complete. Exiting.");
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Polling loop
    const pollingInterval = setInterval(async () => {
        console.log("Checking for due tasks...");
        // TODO: Query contract for tasks due for execution
        
        // Mocking some due tasks to test enqueue
        // const dueTaskIds = await getDueTasks();
        // await queue.enqueue(dueTaskIds, dummyExecutor);
        
    }, 10000);
}

main().catch(err => {
  console.error("Keeper failed:", err);
});

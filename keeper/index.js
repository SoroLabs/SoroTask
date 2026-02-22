require('dotenv').config();
const { Server, Keypair } = require('soroban-client');
const ExecutionQueue = require('./src/queue');
const MetricsServer = require('./src/server');
const metrics = require('./src/metrics');

async function main() {
    console.log("Starting SoroTask Keeper...");

    // Initialize metrics server
    const metricsServer = new MetricsServer();
    await metricsServer.start();

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
        await metricsServer.stop();
        console.log("Graceful shutdown complete. Exiting.");
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Polling loop
    const pollingInterval = setInterval(async () => {
        const pollStartTime = new Date();
        console.log("Checking for due tasks...");

        // Update health check state
        metricsServer.updateHealth({
            lastPollAt: pollStartTime,
            rpcConnected: true, // TODO: Set based on actual RPC connection status
        });

        // TODO: Query contract for tasks due for execution
        // const dueTaskIds = await getDueTasks();
        // metrics.increment('tasksCheckedTotal', dueTaskIds.length);
        // await queue.enqueue(dueTaskIds, dummyExecutor);

    }, 10000);
}

main().catch(err => {
    console.error("Keeper failed:", err);
});

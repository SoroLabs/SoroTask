require('dotenv').config();
const { Server, Keypair } = require('soroban-client');
const ExecutionQueue = require('./src/queue');
const TaskPoller = require('./src/poller');

async function main() {
    console.log("Starting SoroTask Keeper...");
    
    // Validate required environment variables
    if (!process.env.SOROBAN_RPC_URL) {
        throw new Error('SOROBAN_RPC_URL environment variable is required');
    }
    if (!process.env.CONTRACT_ID) {
        throw new Error('CONTRACT_ID environment variable is required');
    }
    if (!process.env.KEEPER_SECRET) {
        throw new Error('KEEPER_SECRET environment variable is required');
    }
    
    // Initialize Soroban server connection
    const server = new Server(process.env.SOROBAN_RPC_URL);
    console.log(`Connected to Soroban RPC: ${process.env.SOROBAN_RPC_URL}`);
    
    // Load keeper account
    const keeper = Keypair.fromSecret(process.env.KEEPER_SECRET);
    console.log(`Keeper account: ${keeper.publicKey()}`);
    
    // Initialize polling engine
    const poller = new TaskPoller(server, process.env.CONTRACT_ID, {
        maxConcurrentReads: process.env.MAX_CONCURRENT_READS
    });
    console.log(`Poller initialized with max concurrent reads: ${poller.maxConcurrentReads}`);
    
    // Initialize execution queue
    const queue = new ExecutionQueue();

    queue.on('task:started', (taskId) => console.log(`[Queue] Started execution for task ${taskId}`));
    queue.on('task:success', (taskId) => console.log(`[Queue] Task ${taskId} executed successfully`));
    queue.on('task:failed', (taskId, err) => console.error(`[Queue] Task ${taskId} failed:`, err.message));
    queue.on('cycle:complete', (stats) => console.log(`[Queue] Cycle complete: ${JSON.stringify(stats)}`));

    // Task executor function - calls contract.execute(keeper, task_id)
    const executeTask = async (taskId) => {
        try {
            const { Contract, TransactionBuilder, BASE_FEE, Networks } = require('soroban-client');
            
            // Build the execute transaction
            const contract = new Contract(process.env.CONTRACT_ID);
            const account = await server.getAccount(keeper.publicKey());
            
            const operation = contract.call(
                'execute',
                keeper.publicKey(), // keeper address
                taskId // task_id
            );
            
            const transaction = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET
            })
                .addOperation(operation)
                .setTimeout(30)
                .build();
            
            transaction.sign(keeper);
            
            // Submit the transaction
            const response = await server.sendTransaction(transaction);
            console.log(`[Executor] Task ${taskId} transaction submitted: ${response.hash}`);
            
            // Wait for confirmation (optional, can be made configurable)
            if (process.env.WAIT_FOR_CONFIRMATION !== 'false') {
                let status = await server.getTransaction(response.hash);
                let attempts = 0;
                const maxAttempts = 10;
                
                while (status.status === 'PENDING' && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    status = await server.getTransaction(response.hash);
                    attempts++;
                }
                
                if (status.status === 'SUCCESS') {
                    console.log(`[Executor] Task ${taskId} executed successfully`);
                } else {
                    throw new Error(`Transaction failed with status: ${status.status}`);
                }
            }
            
        } catch (error) {
            console.error(`[Executor] Failed to execute task ${taskId}:`, error.message);
            throw error;
        }
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

    // Get task registry - in production, this would query the contract for all registered task IDs
    // For now, we'll use an environment variable or query events
    const getTaskRegistry = async () => {
        // Option 1: Use environment variable for known task IDs
        if (process.env.TASK_IDS) {
            return process.env.TASK_IDS.split(',').map(id => parseInt(id.trim(), 10));
        }
        
        // Option 2: Query contract counter to get all task IDs (1 to counter)
        // This is a simple approach - in production you might want to track task IDs via events
        try {
            const { Contract, xdr } = require('soroban-client');
            const contract = new Contract(process.env.CONTRACT_ID);
            
            // Get the counter value to know how many tasks exist
            const account = await server.getAccount(
                'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
            );
            
            const { TransactionBuilder, BASE_FEE, Networks } = require('soroban-client');
            
            const operation = contract.call('get_task', xdr.ScVal.scvU64(xdr.Uint64.fromString('1')));
            
            const transaction = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET
            })
                .addOperation(operation)
                .setTimeout(30)
                .build();

            const simulated = await server.simulateTransaction(transaction);
            
            // For now, return a range based on MAX_TASK_ID env var or default
            const maxTaskId = parseInt(process.env.MAX_TASK_ID || 100, 10);
            return Array.from({ length: maxTaskId }, (_, i) => i + 1);
            
        } catch (error) {
            console.warn('[Registry] Could not query task counter, using default range');
            const maxTaskId = parseInt(process.env.MAX_TASK_ID || 10, 10);
            return Array.from({ length: maxTaskId }, (_, i) => i + 1);
        }
    };

    // Polling loop
    const pollingIntervalMs = parseInt(process.env.POLLING_INTERVAL_MS || 10000, 10);
    console.log(`Starting polling loop with interval: ${pollingIntervalMs}ms`);
    
    const pollingInterval = setInterval(async () => {
        try {
            console.log('\n[Keeper] ===== Starting new polling cycle =====');
            
            // Get list of all registered task IDs
            const taskIds = await getTaskRegistry();
            console.log(`[Keeper] Checking ${taskIds.length} tasks...`);
            
            // Poll for due tasks
            const dueTaskIds = await poller.pollDueTasks(taskIds);
            
            if (dueTaskIds.length > 0) {
                console.log(`[Keeper] Found ${dueTaskIds.length} due tasks, enqueueing for execution...`);
                await queue.enqueue(dueTaskIds, executeTask);
            } else {
                console.log('[Keeper] No tasks due for execution');
            }
            
            console.log('[Keeper] ===== Polling cycle complete =====\n');
            
        } catch (error) {
            console.error('[Keeper] Error in polling cycle:', error);
        }
    }, pollingIntervalMs);
    
    // Run first poll immediately
    console.log('[Keeper] Running initial poll...');
    setTimeout(async () => {
        try {
            const taskIds = await getTaskRegistry();
            console.log(`[Keeper] Initial check: ${taskIds.length} tasks in registry`);
            const dueTaskIds = await poller.pollDueTasks(taskIds);
            if (dueTaskIds.length > 0) {
                await queue.enqueue(dueTaskIds, executeTask);
            }
        } catch (error) {
            console.error('[Keeper] Error in initial poll:', error);
        }
    }, 1000);
}

main().catch(err => {
    console.error("Keeper failed:", err);
});

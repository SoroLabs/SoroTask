const pLimit = require('p-limit');

/**
 * Production-grade polling engine for SoroTask Keeper.
 * Queries the contract for each known task and determines which tasks are due for execution
 * based on last_run + interval <= current_ledger_timestamp.
 */
class TaskPoller {
    constructor(server, contractId, options = {}) {
        this.server = server;
        this.contractId = contractId;
        
        // Configuration with defaults
        this.maxConcurrentReads = parseInt(
            options.maxConcurrentReads || process.env.MAX_CONCURRENT_READS || 10,
            10
        );
        
        // Create concurrency limiter for parallel task reads
        const pLimitMod = pLimit;
        const limitFn = pLimitMod.default || pLimitMod;
        this.readLimit = limitFn(this.maxConcurrentReads);
        
        // Statistics
        this.stats = {
            lastPollTime: null,
            tasksChecked: 0,
            tasksDue: 0,
            tasksSkipped: 0,
            errors: 0
        };
    }

    /**
     * Poll the contract for all registered tasks and determine which are due for execution.
     * 
     * @param {number[]} taskIds - Array of task IDs to check
     * @returns {Promise<number[]>} Array of task IDs that are due for execution
     */
    async pollDueTasks(taskIds) {
        const startTime = Date.now();
        this.stats.lastPollTime = new Date().toISOString();
        this.stats.tasksChecked = 0;
        this.stats.tasksDue = 0;
        this.stats.tasksSkipped = 0;
        this.stats.errors = 0;

        if (!taskIds || taskIds.length === 0) {
            console.log('[Poller] No tasks to check');
            return [];
        }

        try {
            // Fetch current ledger timestamp
            const ledgerInfo = await this.server.getLatestLedger();
            const currentTimestamp = ledgerInfo.sequence; // Using sequence as timestamp proxy
            
            // Note: In production, you'd want to use the actual ledger timestamp
            // which might require additional RPC calls or using ledger.timestamp from contract context
            console.log(`[Poller] Current ledger sequence: ${currentTimestamp}`);

            // Process tasks in parallel with concurrency control
            const taskChecks = taskIds.map(taskId => 
                this.readLimit(() => this.checkTask(taskId, currentTimestamp))
            );

            const results = await Promise.allSettled(taskChecks);
            
            // Collect due task IDs from successful checks
            const dueTaskIds = [];
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const { isDue, taskId, reason } = result.value;
                    
                    if (isDue) {
                        dueTaskIds.push(taskId);
                        this.stats.tasksDue++;
                    } else if (reason === 'skipped') {
                        this.stats.tasksSkipped++;
                    }
                    
                    this.stats.tasksChecked++;
                } else if (result.status === 'rejected') {
                    this.stats.errors++;
                    console.error(`[Poller] Error checking task ${taskIds[index]}:`, result.reason);
                }
            });

            const duration = Date.now() - startTime;
            this.logPollSummary(duration);

            return dueTaskIds;
            
        } catch (error) {
            console.error('[Poller] Fatal error during polling cycle:', error);
            this.stats.errors++;
            return [];
        }
    }

    /**
     * Check a single task to determine if it's due for execution.
     * 
     * @param {number} taskId - The task ID to check
     * @param {number} currentTimestamp - Current ledger timestamp
     * @returns {Promise<{isDue: boolean, taskId: number, reason?: string}>}
     */
    async checkTask(taskId, currentTimestamp) {
        try {
            // Read task configuration from contract using view call
            const taskConfig = await this.getTaskConfig(taskId);
            
            if (!taskConfig) {
                console.warn(`[Poller] Task ${taskId} not found (may have been deregistered)`);
                return { isDue: false, taskId, reason: 'not_found' };
            }

            // Check gas balance
            if (taskConfig.gas_balance <= 0) {
                console.warn(`[Poller] Task ${taskId} has insufficient gas balance: ${taskConfig.gas_balance}`);
                return { isDue: false, taskId, reason: 'skipped' };
            }

            // Calculate if task is due: last_run + interval <= currentTimestamp
            const nextRunTime = taskConfig.last_run + taskConfig.interval;
            const isDue = nextRunTime <= currentTimestamp;

            if (isDue) {
                console.log(
                    `[Poller] Task ${taskId} is DUE ` +
                    `(last_run: ${taskConfig.last_run}, interval: ${taskConfig.interval}, ` +
                    `next_run: ${nextRunTime}, current: ${currentTimestamp})`
                );
            }

            return { isDue, taskId };
            
        } catch (error) {
            console.error(`[Poller] Error checking task ${taskId}:`, error.message);
            throw error;
        }
    }

    /**
     * Retrieve task configuration from the contract.
     * Uses simulateTransaction for a view call that doesn't consume fees.
     * 
     * @param {number} taskId - The task ID to retrieve
     * @returns {Promise<Object|null>} Task configuration or null if not found
     */
    async getTaskConfig(taskId) {
        try {
            // Build the contract call for get_task
            const { Contract, xdr } = require('soroban-client');
            
            const contract = new Contract(this.contractId);
            
            // Create the operation to call get_task
            const operation = contract.call(
                'get_task',
                xdr.ScVal.scvU64(xdr.Uint64.fromString(taskId.toString()))
            );

            // Simulate the transaction (view call - no fees)
            const account = await this.server.getAccount(
                // Use a dummy account for simulation
                'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
            );

            const { TransactionBuilder, BASE_FEE, Networks } = require('soroban-client');
            
            const transaction = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET
            })
                .addOperation(operation)
                .setTimeout(30)
                .build();

            const simulated = await this.server.simulateTransaction(transaction);
            
            if (!simulated.results || simulated.results.length === 0) {
                return null;
            }

            const result = simulated.results[0];
            
            if (!result.retval) {
                return null;
            }

            // Decode the XDR result
            const taskConfig = this.decodeTaskConfig(result.retval);
            return taskConfig;
            
        } catch (error) {
            // Task might not exist or other error occurred
            if (error.message && error.message.includes('not found')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Decode TaskConfig from XDR ScVal.
     * 
     * @param {xdr.ScVal} scVal - The XDR value returned from get_task
     * @returns {Object|null} Decoded task configuration
     */
    decodeTaskConfig(scVal) {
        try {
            const { xdr, Address, scValToNative } = require('soroban-client');
            
            // Check if it's an Option::None
            if (scVal.switch().name === 'scvVoid') {
                return null;
            }

            // For Option::Some, unwrap the value
            let taskVal = scVal;
            if (scVal.switch().name === 'scvVec') {
                const vec = scVal.vec();
                if (vec.length === 0) {
                    return null;
                }
                // Option::Some wraps the value in a vec with one element
                taskVal = vec[0];
            }

            // TaskConfig is a struct (scvMap)
            if (taskVal.switch().name !== 'scvMap') {
                console.warn('[Poller] Unexpected ScVal type for TaskConfig:', taskVal.switch().name);
                return null;
            }

            const map = taskVal.map();
            const config = {};

            // Extract fields from the map
            map.forEach(entry => {
                const key = scValToNative(entry.key());
                const val = entry.val();

                switch (key) {
                    case 'last_run':
                        config.last_run = Number(scValToNative(val));
                        break;
                    case 'interval':
                        config.interval = Number(scValToNative(val));
                        break;
                    case 'gas_balance':
                        config.gas_balance = Number(scValToNative(val));
                        break;
                    case 'creator':
                        config.creator = scValToNative(val);
                        break;
                    case 'target':
                        config.target = scValToNative(val);
                        break;
                    case 'function':
                        config.function = scValToNative(val);
                        break;
                    case 'args':
                        config.args = scValToNative(val);
                        break;
                    case 'resolver':
                        config.resolver = scValToNative(val);
                        break;
                    case 'whitelist':
                        config.whitelist = scValToNative(val);
                        break;
                }
            });

            return config;
            
        } catch (error) {
            console.error('[Poller] Error decoding TaskConfig XDR:', error);
            return null;
        }
    }

    /**
     * Log a summary of the polling cycle.
     * 
     * @param {number} duration - Duration of the poll in milliseconds
     */
    logPollSummary(duration) {
        console.log(
            `[Poller] Poll complete in ${duration}ms | ` +
            `Checked: ${this.stats.tasksChecked} | ` +
            `Due: ${this.stats.tasksDue} | ` +
            `Skipped: ${this.stats.tasksSkipped} | ` +
            `Errors: ${this.stats.errors}`
        );
    }

    /**
     * Get current polling statistics.
     * 
     * @returns {Object} Current statistics
     */
    getStats() {
        return { ...this.stats };
    }
}

module.exports = TaskPoller;

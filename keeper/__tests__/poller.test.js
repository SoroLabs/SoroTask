const TaskPoller = require('../src/poller');

describe('TaskPoller', () => {
    let mockServer;
    let poller;
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

    beforeEach(() => {
        // Mock Soroban server
        mockServer = {
            getLatestLedger: jest.fn(),
            getAccount: jest.fn(),
            simulateTransaction: jest.fn()
        };

        poller = new TaskPoller(mockServer, contractId, {
            maxConcurrentReads: 5
        });
    });

    describe('constructor', () => {
        it('should initialize with default values', () => {
            const defaultPoller = new TaskPoller(mockServer, contractId);
            expect(defaultPoller.maxConcurrentReads).toBe(10);
            expect(defaultPoller.contractId).toBe(contractId);
        });

        it('should use custom maxConcurrentReads', () => {
            expect(poller.maxConcurrentReads).toBe(5);
        });

        it('should initialize stats', () => {
            expect(poller.stats).toEqual({
                lastPollTime: null,
                tasksChecked: 0,
                tasksDue: 0,
                tasksSkipped: 0,
                errors: 0
            });
        });
    });

    describe('pollDueTasks', () => {
        beforeEach(() => {
            mockServer.getLatestLedger.mockResolvedValue({
                sequence: 1000
            });
        });

        it('should return empty array when no task IDs provided', async () => {
            const result = await poller.pollDueTasks([]);
            expect(result).toEqual([]);
        });

        it('should return empty array when taskIds is null', async () => {
            const result = await poller.pollDueTasks(null);
            expect(result).toEqual([]);
        });

        it('should check all provided task IDs', async () => {
            const taskIds = [1, 2, 3];
            
            // Mock checkTask to return not due
            jest.spyOn(poller, 'checkTask').mockResolvedValue({
                isDue: false,
                taskId: 1
            });

            await poller.pollDueTasks(taskIds);

            expect(poller.checkTask).toHaveBeenCalledTimes(3);
            expect(poller.stats.tasksChecked).toBe(3);
        });

        it('should return due task IDs', async () => {
            const taskIds = [1, 2, 3];
            
            jest.spyOn(poller, 'checkTask')
                .mockResolvedValueOnce({ isDue: true, taskId: 1 })
                .mockResolvedValueOnce({ isDue: false, taskId: 2 })
                .mockResolvedValueOnce({ isDue: true, taskId: 3 });

            const result = await poller.pollDueTasks(taskIds);

            expect(result).toEqual([1, 3]);
            expect(poller.stats.tasksDue).toBe(2);
        });

        it('should count skipped tasks', async () => {
            const taskIds = [1, 2];
            
            jest.spyOn(poller, 'checkTask')
                .mockResolvedValueOnce({ isDue: false, taskId: 1, reason: 'skipped' })
                .mockResolvedValueOnce({ isDue: true, taskId: 2 });

            await poller.pollDueTasks(taskIds);

            expect(poller.stats.tasksSkipped).toBe(1);
            expect(poller.stats.tasksDue).toBe(1);
        });

        it('should handle errors gracefully', async () => {
            const taskIds = [1, 2];
            
            jest.spyOn(poller, 'checkTask')
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({ isDue: true, taskId: 2 });

            const result = await poller.pollDueTasks(taskIds);

            expect(result).toEqual([2]);
            expect(poller.stats.errors).toBe(1);
            expect(poller.stats.tasksDue).toBe(1);
        });

        it('should update lastPollTime', async () => {
            await poller.pollDueTasks([1]);
            expect(poller.stats.lastPollTime).toBeTruthy();
        });
    });

    describe('checkTask', () => {
        it('should return not due when task not found', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue(null);

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: false,
                taskId: 1,
                reason: 'not_found'
            });
        });

        it('should skip task with zero gas balance', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
                last_run: 500,
                interval: 100,
                gas_balance: 0
            });

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: false,
                taskId: 1,
                reason: 'skipped'
            });
        });

        it('should skip task with negative gas balance', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
                last_run: 500,
                interval: 100,
                gas_balance: -10
            });

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: false,
                taskId: 1,
                reason: 'skipped'
            });
        });

        it('should return due when last_run + interval <= currentTimestamp', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
                last_run: 500,
                interval: 400,
                gas_balance: 1000
            });

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: true,
                taskId: 1
            });
        });

        it('should return not due when last_run + interval > currentTimestamp', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
                last_run: 800,
                interval: 300,
                gas_balance: 1000
            });

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: false,
                taskId: 1
            });
        });

        it('should handle edge case when exactly at boundary', async () => {
            jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
                last_run: 500,
                interval: 500,
                gas_balance: 1000
            });

            const result = await poller.checkTask(1, 1000);

            expect(result).toEqual({
                isDue: true,
                taskId: 1
            });
        });
    });

    describe('getStats', () => {
        it('should return a copy of stats', () => {
            poller.stats.tasksChecked = 5;
            const stats = poller.getStats();
            
            expect(stats.tasksChecked).toBe(5);
            
            // Verify it's a copy
            stats.tasksChecked = 10;
            expect(poller.stats.tasksChecked).toBe(5);
        });
    });

    describe('decodeTaskConfig', () => {
        it('should return null for void ScVal', () => {
            const { xdr } = require('soroban-client');
            const voidVal = xdr.ScVal.scvVoid();
            
            const result = poller.decodeTaskConfig(voidVal);
            expect(result).toBeNull();
        });

        it('should return null for empty vec', () => {
            const { xdr } = require('soroban-client');
            const emptyVec = xdr.ScVal.scvVec([]);
            
            const result = poller.decodeTaskConfig(emptyVec);
            expect(result).toBeNull();
        });
    });
});

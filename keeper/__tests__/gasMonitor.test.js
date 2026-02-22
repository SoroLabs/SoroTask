const GasMonitor = require('../src/gasMonitor');

// Mock fetch globally
global.fetch = jest.fn();

describe('GasMonitor', () => {
    let gasMonitor;

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        
        // Mock environment variables
        process.env.GAS_WARN_THRESHOLD = '500';
        process.env.ALERT_WEBHOOK_URL = 'https://webhook.example.com/alert';
        process.env.ALERT_DEBOUNCE_MS = '3600000'; // 1 hour
        
        gasMonitor = new GasMonitor();
    });

    afterEach(() => {
        // Clean up environment variables
        delete process.env.GAS_WARN_THRESHOLD;
        delete process.env.ALERT_WEBHOOK_URL;
        delete process.env.ALERT_DEBOUNCE_MS;
    });

    describe('constructor', () => {
        it('initializes with default values when environment variables are not set', () => {
            delete process.env.GAS_WARN_THRESHOLD;
            delete process.env.ALERT_WEBHOOK_URL;
            delete process.env.ALERT_DEBOUNCE_MS;
            
            const monitor = new GasMonitor();
            
            expect(monitor.GAS_WARN_THRESHOLD).toBe(500);
            expect(monitor.ALERT_WEBHOOK_URL).toBeNull();
            expect(monitor.ALERT_DEBOUNCE_MS).toBe(3600000);
            expect(monitor.tasksLowGasCount).toBe(0);
        });

        it('uses environment variables when set', () => {
            process.env.GAS_WARN_THRESHOLD = '1000';
            process.env.ALERT_WEBHOOK_URL = 'https://test.com/webhook';
            process.env.ALERT_DEBOUNCE_MS = '7200000';
            
            const monitor = new GasMonitor();
            
            expect(monitor.GAS_WARN_THRESHOLD).toBe(1000);
            expect(monitor.ALERT_WEBHOOK_URL).toBe('https://test.com/webhook');
            expect(monitor.ALERT_DEBOUNCE_MS).toBe(7200000);
        });
    });

    describe('checkGasBalance', () => {
        it('logs warning when gas balance is below threshold but greater than 0', async () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            const taskId = '123';
            const gasBalance = 400; // Below default threshold of 500 but > 0
            
            const shouldSkip = await gasMonitor.checkGasBalance(taskId, gasBalance);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                `Task ${taskId} has low gas balance (${gasBalance}). Threshold: ${gasMonitor.GAS_WARN_THRESHOLD}`
            );
            expect(shouldSkip).toBe(false);
            consoleSpy.mockRestore();
        });

        it('logs error and returns true when gas balance is zero or negative', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            
            const taskId = '123';
            const gasBalance = 0; // Zero or negative
            
            const shouldSkip = await gasMonitor.checkGasBalance(taskId, gasBalance);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                `Task ${taskId} has critically low gas balance (${gasBalance}). Skipping execution.`
            );
            expect(shouldSkip).toBe(true);
            consoleSpy.mockRestore();
        });

        it('does not log warning when gas balance is above threshold', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const errorSpy = jest.spyOn(console, 'error').mockImplementation();
            
            const taskId = '123';
            const gasBalance = 600; // Above threshold
            
            const shouldSkip = await gasMonitor.checkGasBalance(taskId, gasBalance);
            
            expect(warnSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(shouldSkip).toBe(false);
            
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('tracks low gas count correctly', async () => {
            // Add a task with low gas
            await gasMonitor.checkGasBalance('1', 400);
            expect(gasMonitor.getLowGasCount()).toBe(1);
            
            // Add another task with low gas
            await gasMonitor.checkGasBalance('2', 300);
            expect(gasMonitor.getLowGasCount()).toBe(2);
            
            // Add a task with sufficient gas (should not increase count)
            await gasMonitor.checkGasBalance('3', 600);
            expect(gasMonitor.getLowGasCount()).toBe(2);
            
            // Reduce gas on the third task to low level
            await gasMonitor.checkGasBalance('3', 200);
            expect(gasMonitor.getLowGasCount()).toBe(3);
            
            // Increase gas on first task above threshold (should decrease count)
            await gasMonitor.checkGasBalance('1', 600);
            expect(gasMonitor.getLowGasCount()).toBe(2);
        });

        it('decreases low gas count when task balance goes from low to sufficient', async () => {
            // Add task with low gas
            await gasMonitor.checkGasBalance('1', 400);
            expect(gasMonitor.getLowGasCount()).toBe(1);
            
            // Increase gas above threshold (should decrease count)
            await gasMonitor.checkGasBalance('1', 600);
            expect(gasMonitor.getLowGasCount()).toBe(0);
        });
    });

    describe('sendWebhookAlert', () => {
        beforeEach(() => {
            // Reset the fetch mock
            global.fetch.mockClear();
        });

        it('sends webhook alert with correct payload when balance is low', async () => {
            const taskId = '123';
            const gasBalance = 300;
            const mockResponse = { ok: true };
            
            global.fetch.mockResolvedValue(mockResponse);
            
            await gasMonitor.sendWebhookAlert(taskId, gasBalance);
            
            expect(global.fetch).toHaveBeenCalledWith(
                gasMonitor.ALERT_WEBHOOK_URL,
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: expect.stringMatching(/{"event":"low_gas","taskId":"123","gasBalance":300,"timestamp":".*"}/)
                })
            );
        });

        it('handles fetch errors gracefully', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            const taskId = '123';
            const gasBalance = 300;
            
            global.fetch.mockRejectedValue(new Error('Network error'));
            
            await gasMonitor.sendWebhookAlert(taskId, gasBalance);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                `Error sending webhook alert for task ${taskId}:`,
                'Network error'
            );
            
            consoleSpy.mockRestore();
        });

        it('updates last alert timestamp after successful webhook call', async () => {
            const taskId = '123';
            const gasBalance = 300;
            const mockResponse = { ok: true };
            
            global.fetch.mockResolvedValue(mockResponse);
            
            const initialTime = Date.now();
            await gasMonitor.sendWebhookAlert(taskId, gasBalance);
            
            const lastAlertTime = gasMonitor.lastAlertTimestamps.get(taskId);
            expect(lastAlertTime).toBeDefined();
            expect(lastAlertTime).toBeGreaterThanOrEqual(initialTime);
        });

        it('does not send duplicate alerts within debounce period', async () => {
            const taskId = '123';
            const gasBalance = 300;
            const mockResponse = { ok: true };
            
            global.fetch.mockResolvedValue(mockResponse);
            
            // First call should trigger fetch
            await gasMonitor.sendWebhookAlert(taskId, gasBalance);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            
            // Second call immediately after should be debounced
            await gasMonitor.sendWebhookAlert(taskId, gasBalance);
            expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1
        });
    });

    describe('metrics methods', () => {
        it('returns correct low gas count', () => {
            expect(gasMonitor.getLowGasCount()).toBe(0);
            
            gasMonitor.tasksLowGasCount = 5;
            expect(gasMonitor.getLowGasCount()).toBe(5);
        });

        it('returns correct configuration', () => {
            const config = gasMonitor.getConfig();
            
            expect(config.gasWarnThreshold).toBe(gasMonitor.GAS_WARN_THRESHOLD);
            expect(config.alertWebhookEnabled).toBe(!!gasMonitor.ALERT_WEBHOOK_URL);
            expect(config.alertDebounceMs).toBe(gasMonitor.ALERT_DEBOUNCE_MS);
        });
    });
});
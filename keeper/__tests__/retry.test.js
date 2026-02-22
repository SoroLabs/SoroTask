const { withRetry, retryEmitter } = require('../src/retry');

describe('withRetry', () => {
    let oldEnv;

    beforeEach(() => {
        oldEnv = { ...process.env };
        process.env.MAX_RETRIES = '3';
        process.env.BASE_DELAY_MS = '10'; // Use tiny delays for testing
        process.env.MAX_RETRY_DELAY_MS = '50';
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env = oldEnv;
        retryEmitter.removeAllListeners();
    });

    it('should succeed on the first attempt without retrying', async () => {
        const fn = jest.fn().mockResolvedValue('success-1');
        const wrapped = withRetry(fn);
        const result = await wrapped('task-1');
        
        expect(result).toBe('success-1');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should succeed on the 2nd attempt after a retryable error', async () => {
        const retryableError = new Error('network timeout occurred');
        retryableError.code = 408;

        const fn = jest.fn()
            .mockRejectedValueOnce(retryableError)
            .mockResolvedValueOnce('success-2');
            
        const wrapped = withRetry(fn);
        const result = await wrapped('task-2');
        
        expect(result).toBe('success-2');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should bail immediately on non-retryable error (e.g., invalid args)', async () => {
        const nonRetryableError = new Error('invalid arguments supplied');
        
        const fn = jest.fn().mockRejectedValue(nonRetryableError);
            
        const wrapped = withRetry(fn);
        
        await expect(wrapped('task-err')).rejects.toThrow('invalid arguments supplied');
        expect(fn).toHaveBeenCalledTimes(1); // Should not retry
    });

    it('should exceed max retries and emit MAX_RETRIES_EXCEEDED event', async () => {
        const retryableError = new Error('connection timeout');
        const fn = jest.fn().mockRejectedValue(retryableError);
            
        const wrapped = withRetry(fn, { maxRetries: 2, baseDelay: 5 });
        const eventSpy = jest.fn();
        retryEmitter.on('MAX_RETRIES_EXCEEDED', eventSpy);

        await expect(wrapped('task-max')).rejects.toThrow('connection timeout');
        
        // 1 initial attempt + 2 retries = 3 calls
        expect(fn).toHaveBeenCalledTimes(3); 
        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
            error: 'connection timeout',
            maxRetries: 2
        }));
    });

    it('should treat DUPLICATE_TRANSACTION as success without retrying', async () => {
        const duplicateError = new Error('Transaction hash already exists');
        duplicateError.code = 'DUPLICATE_TRANSACTION';
        
        const fn = jest.fn().mockRejectedValue(duplicateError);
            
        const wrapped = withRetry(fn);
        const result = await wrapped('task-dup');
        
        expect(result).toEqual({ status: 'success', duplicate: true, attempt: 1 });
        expect(fn).toHaveBeenCalledTimes(1); // No retries for duplicates
    });
    
    it('should treat tx_bad_seq message as success', async () => {
        const duplicateError = new Error('tx_bad_seq error occurred');
        
        const fn = jest.fn().mockRejectedValue(duplicateError);
            
        const wrapped = withRetry(fn);
        const result = await wrapped('task-dup-2');
        
        expect(result).toEqual({ status: 'success', duplicate: true, attempt: 1 });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

const EventEmitter = require('events');

const retryEmitter = new EventEmitter();

function isDuplicateTransaction(error) {
    if (!error) return false;
    
    // Check error code directly
    if (error.code === 'DUPLICATE_TRANSACTION' || error.code === 'tx_bad_seq' || error.code === 'tx_duplicate') {
        return true;
    }
    
    // Check error message strings broadly
    if (error.message) {
        const msg = error.message.toLowerCase();
        if (msg.includes('duplicate') || msg.includes('already submitted') || msg.includes('tx_bad_seq')) {
            return true;
        }
    }
    return false;
}

function isRetryableError(error) {
    if (!error) return false;

    if (isDuplicateTransaction(error)) return false;

    // Retryable classifications
    const retryableCodes = [408, 429, 500, 502, 503, 504, -32000, -32001, -32005, -32603];
    if (error.code && retryableCodes.includes(error.code)) {
        return true;
    }

    if (error.message) {
        const msg = error.message.toLowerCase();
        if (
            msg.includes('timeout') || 
            msg.includes('network') || 
            msg.includes('rate limit') || 
            msg.includes('socket') || 
            msg.includes('connection')
        ) {
            return true;
        }
    }

    // Default down to non-retryable for invalid args, gas, contract panic
    return false;
}

function withRetry(fn, options = {}) {
    return async function (...args) {
        const _maxRetries = options.maxRetries !== undefined ? options.maxRetries : process.env.MAX_RETRIES;
        const _baseDelay = options.baseDelay !== undefined ? options.baseDelay : process.env.BASE_DELAY_MS;
        const _maxDelay = options.maxDelay !== undefined ? options.maxDelay : process.env.MAX_RETRY_DELAY_MS;

        const maxRetries = parseInt(_maxRetries || 3, 10);
        const baseDelay = parseInt(_baseDelay || 1000, 10);
        const maxDelay = parseInt(_maxDelay || 10000, 10);
        const emitter = options.emitter || retryEmitter;

        let attempt = 0;
        
        while (attempt <= maxRetries) {
            try {
                const result = await fn(...args);
                if (attempt > 0) {
                    console.log(`[Retry] Task execution succeeded on attempt ${attempt + 1}.`);
                }
                return result; 
            } catch (error) {
                if (isDuplicateTransaction(error)) {
                    console.log(`[Retry] Treating duplicate transaction as success on attempt ${attempt + 1}.`);
                    return { status: 'success', duplicate: true, attempt: attempt + 1 };
                }

                const retryable = isRetryableError(error);

                if (!retryable || attempt === maxRetries) {
                    if (attempt === maxRetries && retryable) {
                        const errMsg = `MAX_RETRIES_EXCEEDED: Task failed after ${maxRetries} retries.`;
                        console.warn(errMsg);
                        emitter.emit('MAX_RETRIES_EXCEEDED', { args, error: error.message, maxRetries });
                    }
                    throw error;
                }

                // Jitter random between 0 and baseDelay
                const jitter = Math.random() * baseDelay;
                let delay = (baseDelay * Math.pow(2, attempt)) + jitter;
                delay = Math.min(delay, maxDelay);

                console.log(`[Retry] Task execution failed on attempt ${attempt + 1} with error: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
            }
        }
    };
}

module.exports = {
    withRetry,
    isRetryableError,
    isDuplicateTransaction,
    retryEmitter
};

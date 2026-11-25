export type ErrorPayload = {
  id: string;
  message: string;
  componentStack?: string;
  timestamp: number;
};

export type ProcessedError = ErrorPayload & {
  processedAt: number;
  recoveryStatus: 'Recoverable' | 'Critical' | 'Warning';
  suggestedAction: string;
  hash: number;
};

// Only add self logic if we are in a web worker environment
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'PROCESS_ERROR') {
      const errorPayload = payload as ErrorPayload;
      
      const recoveryStatus = errorPayload.message.includes('Critical')
        ? 'Critical'
        : errorPayload.message.includes('Warning')
          ? 'Warning'
          : 'Recoverable';
          
      const suggestedAction = recoveryStatus === 'Critical'
        ? 'Manual intervention required'
        : recoveryStatus === 'Warning'
          ? 'Monitor closely'
          : 'Automatic retry safe';

      const processedError: ProcessedError = {
        ...errorPayload,
        processedAt: Date.now(),
        recoveryStatus,
        suggestedAction,
        hash: 0,
      };

      // Simulate complex off-main-thread processing for resilience testing
      let hash = 0;
      for (let i = 0; i < 1e5; i++) {
        hash = (hash + i) % 1000;
      }
      processedError.hash = hash;

      self.postMessage({
        type: 'ERROR_PROCESSED',
        payload: processedError,
      });
    }
  };
}

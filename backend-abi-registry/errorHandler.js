class ErrorHandler {
  constructor() {
    this.errors = [];
  }

  logError(context, error) {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      context,
      message: error.message || error,
      stack: error.stack || null,
    };
    this.errors.push(errorRecord);
    console.error(`[ErrorHandler] [${context}]`, error.message || error);
    // In a real implementation, this might send to Sentry, Datadog, etc.
  }

  getRecentErrors() {
    return this.errors.slice(-100);
  }

  clearErrors() {
    this.errors = [];
  }
}

module.exports = new ErrorHandler();

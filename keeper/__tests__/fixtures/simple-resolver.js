class SimpleResolver {
  async init(options) {
    this.options = options || {};
  }

  async resolve(taskId, taskConfig) {
    if (this.options.reject) {
      return { isReady: false, reason: 'explicit_reject' };
    }

    if (this.options.timeout) {
      await new Promise((resolve) => setTimeout(resolve, this.options.timeout));
    }

    return { isReady: true };
  }
}

module.exports = SimpleResolver;

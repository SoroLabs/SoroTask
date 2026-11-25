const client = require('prom-client');

class Observability {
  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry });

    this.counters = {};
  }

  counter(name, help) {
    if (!this.counters[name]) {
      this.counters[name] = new client.Counter({ name, help, registers: [this.registry] });
    }
    return this.counters[name];
  }

  increment(name, value = 1) {
    const c = this.counter(name, `${name} counter`);
    c.inc(value);
  }

  metrics() {
    return this.registry.metrics();
  }
}

module.exports = { Observability };

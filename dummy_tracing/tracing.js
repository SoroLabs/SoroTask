const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

class TracingSystem {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.serviceName,
      }),
    });
    
    // Fault-tolerant data pipeline setup
    this.exporter = new OTLPTraceExporter({
      url: process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      headers: {},
      timeoutMillis: 15000,
      concurrencyLimit: 10, 
    });

    this.processor = new SimpleSpanProcessor(this.exporter);
    this.provider.addSpanProcessor(this.processor);
  }

  start() {
    try {
      this.provider.register();
      registerInstrumentations({
        tracerProvider: this.provider,
        instrumentations: [
          new HttpInstrumentation(),
          new ExpressInstrumentation(),
        ],
      });
      console.log(`Tracing started for service: ${this.serviceName}`);
    } catch (error) {
      // Error tracking and fallback systems
      console.error('Failed to initialize tracing system, falling back to no-op tracing', error);
    }
  }

  async stop() {
    try {
      await this.provider.shutdown();
      console.log(`Tracing stopped for service: ${this.serviceName}`);
    } catch (error) {
      console.error('Error shutting down tracing system', error);
    }
  }
}

module.exports = TracingSystem;

const express = require('express');
const { ZKProofService } = require('./index');

const DEFAULT_PORT = 3002;

function createApp(service = new ZKProofService()) {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'zk-proof-service',
      ready: service.isReady,
      workers: service.workers.length
    });
  });

  app.post('/generate-proof', async (req, res) => {
    try {
      const { taskCondition, clientData } = req.body || {};
      const proof = await service.generateProof(taskCondition, clientData);
      res.status(200).json({ proof });
    } catch (error) {
      res.status(error.message === 'Invalid input data' ? 400 : 503).json({
        error: error.message
      });
    }
  });

  return app;
}

function startServer() {
  const service = new ZKProofService(Number(process.env.WORKER_COUNT) || 4);
  service.initialize();

  const app = createApp(service);
  const port = Number(process.env.PORT) || DEFAULT_PORT;

  const server = app.listen(port, () => {
    console.log(`ZK proof service listening on port ${port}`);
  });

  const shutdown = () => {
    service.shutdown();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, service };
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };

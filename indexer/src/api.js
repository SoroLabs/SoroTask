const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createCrossChainRouter } = require('./crossChainApi');
const { createContext, expressJwtAuth, requireRole, ROLES } = require('./graphql/auth');
const dbHelpers = require('./graphql/db');
const { ensureSchema, buildMerkleProofResponse } = require('./merkleStore');
const { metricsHandler } = require('./metrics');
const { createRateLimiter } = require('./rateLimiter');
const { traceContextMiddleware } = require('../../scripts/traceContext');
const { openApiSpec } = require('./openapi');

const DEFAULT_PORT = 4000;

/**
 * Register REST routes that live alongside the GraphQL endpoint.
 * Exposed separately so it can be mounted on a bare Express app in tests.
 */
function registerRestRoutes(app, deps = dbHelpers) {
  // Attach W3C TraceContext middleware
  app.use(traceContextMiddleware('indexer'));

  // Metrics endpoint
  app.get('/metrics', metricsHandler);

  // Health and protected endpoint routes for REST API
  app.get('/api/health', (req, res) => {
    const context = createContext({ req });
    res.json({ status: 'ok', timestamp: new Date().toISOString(), user: context.user });
  });

  app.get('/api/protected', (req, res) => {
    const context = createContext({ req });
    if (!context.user || context.user.role === 'ANONYMOUS') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ message: 'Access granted' });
  });

  // Issue #863: cryptographic Merkle inclusion proofs for a ledger's events.
  app.get('/events/:ledger/merkle-proof', async (req, res) => {
    const ledger = Number(req.params.ledger);
    if (!Number.isInteger(ledger)) {
      return res.status(400).json({ error: 'ledger must be an integer' });
    }
    try {
      const { status, body } = await buildMerkleProofResponse(
        deps,
        ledger,
        req.query.eventId,
      );
      return res.status(status).json(body);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Issue #798: allow a task creator to register (or update) a real-time webhook
  // destination with a shared secret used to HMAC-sign outbound deliveries.
  app.post('/api/webhook/register', async (req, res) => {
    try {
      const { task_id: taskId, url, secret_key: secretKey } = req.body || {};
      const parsedTaskId = Number(taskId);
      if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
        return res.status(400).json({ error: 'task_id must be a positive integer' });
      }
      if (!url || typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
        return res.status(400).json({ error: 'url must be a valid http(s) URL' });
      }
      if (secretKey != null && (typeof secretKey !== 'string' || secretKey.length > 1024)) {
        return res.status(400).json({ error: 'secret_key must be a string (<= 1024 chars)' });
      }

      // Ensure the runtime table carries the webhook metadata columns. This is
      // idempotent and also widens pre-existing databases created before the
      // columns were introduced.
      await deps.queryRun('ALTER TABLE tasks ADD COLUMN webhook_url TEXT').catch(() => {});
      await deps.queryRun('ALTER TABLE tasks ADD COLUMN webhook_secret_key TEXT').catch(() => {});

      const result = await deps.queryRun(
        'UPDATE tasks SET webhook_url = ?, webhook_secret_key = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?',
        [url, secretKey || null, parsedTaskId],
      );

      if (!result || result.changes === 0) {
        return res.status(404).json({ error: `Task ${parsedTaskId} not found` });
      }

      const task = await deps.queryGet(
        'SELECT task_id, creator, webhook_url FROM tasks WHERE task_id = ?',
        [parsedTaskId],
      );
      return res.status(200).json({ registered: true, task });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Issue #825: query cold-storage archives
  app.get('/events/archived', requireRole(ROLES.USER), async (req, res) => {
    if (!req.query.contractId) {
      return res.status(400).json({ error: 'contractId query parameter is required' });
    }
    try {
      const { queryArchivedEvents } = require('./archivalQuery');
      const limit = Number(req.query.limit) || 100;
      const rows = await queryArchivedEvents(req.query.contractId, limit);
      return res.json({ events: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return app;
}

function createExpressApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/cross-chain', createCrossChainRouter());

  // Prometheus scrape target and public docs remain accessible without login.
  app.get('/metrics', metricsHandler);
  app.use(expressJwtAuth);
  app.use(createRateLimiter());

  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));
  if (openApiSpec) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

  registerRestRoutes(app);

  ensureSchema(dbHelpers).catch((err) => {
    console.error('Failed to ensure merkle schema:', err);
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  app.locals.graphqlSchema = schema;

  const server = new ApolloServer({
    schema,
    context: createContext,
    introspection: true,
  });

  app.locals.graphqlReady = server
    .start()
    .then(() =>
      server.applyMiddleware({ app, path: '/graphql', bodyParserConfig: false }),
    )
    .catch((err) => {
      console.error('Failed to start Apollo Server:', err);
    });

  return app;
}

/**
 * Boots the Express app, starts listening, and attaches the GraphQL subscriptions transport.
 */
function startApiServer(port = DEFAULT_PORT) {
  const app = createExpressApp();
  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      const { SubscriptionServer } = require('subscriptions-transport-ws');
      const { execute, subscribe } = require('graphql');
      SubscriptionServer.create(
        {
          schema: app.locals.graphqlSchema,
          execute,
          subscribe,
          onConnect: () => ({ user: { role: ROLES.ANONYMOUS } }),
        },
        { server: httpServer, path: '/graphql' },
      );

      console.log(`GraphQL API ready at http://localhost:${port}/graphql`);
      console.log(`GraphQL subscriptions ready at ws://localhost:${port}/graphql`);
      console.log(`Prometheus Metrics ready at http://localhost:${port}/metrics`);
      resolve(httpServer);
    });
  });
}

module.exports = { startApiServer, createExpressApp, registerRestRoutes };

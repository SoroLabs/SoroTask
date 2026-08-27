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

  // Attach rate limiter middleware
  app.use(createRateLimiter());

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

  // Prometheus scrape target - mounted ahead of auth/rate-limiting
  app.get('/metrics', metricsHandler);

  registerRestRoutes(app);

  app.use(expressJwtAuth);

  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));
  if (openApiSpec) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

  ensureSchema(dbHelpers).catch((err) => {
    console.error('Failed to ensure merkle schema:', err);
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  app.locals.graphqlSchema = schema;

const {
  createDepthRule,
  createComplexityLimitRule,
  createPaginationBoundsRule,
} = require('./graphql/complexity');

  const server = new ApolloServer({
    schema,
    context: createContext,
    introspection: true,
    validationRules: [
      createDepthRule(5),
      createComplexityLimitRule(1000),
      createPaginationBoundsRule(50),
    ],
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

const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createContext, expressJwtAuth, requireRole, ROLES } = require('./graphql/auth');
const dbHelpers = require('./graphql/db');
const { ensureSchema, buildMerkleProofResponse } = require('./merkleStore');
const { metricsHandler } = require('./metrics');
const { createRateLimiter } = require('./rateLimiter');
const { openApiSpec } = require('./openapi');

const DEFAULT_PORT = 4000;

/**
 * Register REST routes that live alongside the GraphQL endpoint.
 * Exposed separately so it can be mounted on a bare Express app in tests.
 */
function registerRestRoutes(app, deps = dbHelpers) {
  // Issue #863: cryptographic Merkle inclusion proofs for a ledger's events.
  //   GET /events/:ledger/merkle-proof            -> full leaf set + root
  //   GET /events/:ledger/merkle-proof?eventId=N  -> inclusion proof for event N
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
  return app;
}

function createExpressApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Prometheus scrape target - mounted ahead of auth/rate-limiting so
  // infra scrapers never get throttled or challenged for a token.
  app.get('/metrics', metricsHandler);

  registerRestRoutes(app);

  app.use(expressJwtAuth);
  app.use(createRateLimiter());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), user: req.user });
  });

  app.get('/api/protected', requireRole(ROLES.USER), (req, res) => {
    res.json({ message: 'Access granted' });
  });

  // Issue #825: query cold-storage archives (S3 Parquet, written by
  // archival.js) directly via DuckDB, for events past the retention window
  // that have already been pruned from the primary database.
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

  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  ensureSchema(dbHelpers).catch((err) => {
    console.error('Failed to ensure merkle schema:', err);
  });

  // Built once and reused for both query/mutation (ApolloServer) and, once
  // an HTTP server exists (see startApiServer), subscriptions - the two
  // must share a schema instance or resolver behavior can drift between them.
  const schema = makeExecutableSchema({ typeDefs, resolvers });
  app.locals.graphqlSchema = schema;

  const server = new ApolloServer({
    schema,
    context: createContext,
    introspection: true,
  });

  // Stashed so tests can `await app.locals.graphqlReady` before hitting
  // /graphql instead of racing Apollo's async startup.
  app.locals.graphqlReady = server
    .start()
    .then(() =>
      // `bodyParserConfig: false` - the app already runs `express.json()`
      // globally; parsing the request body twice throws ("stream is not
      // readable") on the second read.
      server.applyMiddleware({ app, path: '/graphql', bodyParserConfig: false }),
    )
    .catch((err) => {
      console.error('Failed to start Apollo Server:', err);
    });

  return app;
}

/**
 * Boots the Express app, starts listening, and attaches the GraphQL
 * subscriptions transport (Issue #824) to the same HTTP server at
 * ws://<host>:<port>/graphql. Used by the indexer's main entrypoint; tests
 * use `createExpressApp()` directly with supertest instead, which never
 * exercises subscriptions since those require a real socket.
 */
function startApiServer(port = DEFAULT_PORT) {
  const app = createExpressApp();
  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      // subscriptions-transport-ws is deprecated upstream in favor of
      // graphql-ws, but is what apollo-server-express@3 (already used here)
      // is documented against; switching both is a larger, separate upgrade.
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
      console.log(`OpenAPI v3 Docs ready at http://localhost:${port}/api-docs`);
      resolve(httpServer);
    });
  });
}

module.exports = { startApiServer, createExpressApp, registerRestRoutes };

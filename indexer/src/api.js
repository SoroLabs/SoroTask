const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const cors = require('cors');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createContext } = require('./graphql/auth');
const dbHelpers = require('./graphql/db');
const { ensureSchema, buildMerkleProofResponse } = require('./merkleStore');

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

async function startApiServer(port = 4000) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  await ensureSchema(dbHelpers);
  registerRestRoutes(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: createContext,
    // Enable introspection in MVP to test the API easily
    introspection: true,
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`🚀 GraphQL API ready at http://localhost:${port}${server.graphqlPath}`);
      resolve(httpServer);
    });
  });
}

module.exports = { startApiServer, registerRestRoutes };

/**
 * OpenAPI v3 specification for the SoroTask Indexer API.
 * Covers REST endpoints; GraphQL is documented separately via introspection.
 */
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SoroTask Indexer API',
    version: '1.0.0',
    description:
      'REST and GraphQL API for the SoroTask Keeper Task Indexer. ' +
      'Provides task data, health checks, and Prometheus metrics. ' +
      'The GraphQL endpoint at /graphql supports full introspection.',
    contact: { name: 'SoroTask', url: 'https://github.com/SoroLabs/SoroTask' },
    license: { name: 'MIT' },
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local development server' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT obtained via /api/auth/login',
      },
    },
    schemas: {
      Task: {
        type: 'object',
        properties: {
          task_id: { type: 'string', example: 'task-001' },
          creator: { type: 'string', example: 'GA32XXXX' },
          target: { type: 'string', example: 'CC3XXXXXX' },
          function: { type: 'string', example: 'execute' },
          args_json: { type: 'string', nullable: true },
          resolver: { type: 'string', nullable: true },
          interval: { type: 'integer', example: 3600 },
          last_run: { type: 'integer', example: 1700000000 },
          gas_balance: { type: 'string', example: '100.5' },
          is_active: { type: 'boolean', example: true },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
          user: {
            type: 'object',
            properties: {
              role: { type: 'string', example: 'anonymous' },
            },
          },
        },
      },
      AuthRequest: {
        type: 'object',
        required: ['address', 'signature'],
        properties: {
          address: { type: 'string', description: 'Stellar public key', example: 'GA32XXXX' },
          signature: { type: 'string', description: 'Ed25519 signature of the challenge' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Signed JWT' },
          user: { $ref: '#/components/schemas/Task' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        description: 'Returns the API health status and the current authenticated user role.',
        operationId: 'getHealth',
        security: [],
        tags: ['System'],
        responses: {
          200: {
            description: 'API is healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/api/protected': {
      get: {
        summary: 'Protected test endpoint',
        description: 'Requires a valid JWT with at least USER role.',
        operationId: 'getProtected',
        tags: ['System'],
        responses: {
          200: { description: 'Access granted', content: { 'application/json': { schema: { type: 'object' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/events/archived': {
      get: {
        summary: 'Query cold-storage archived events',
        description:
          'Queries events older than the retention window directly from S3 Parquet archives ' +
          '(written by the daily archival job) via DuckDB, without re-hydrating them into the primary database.',
        operationId: 'getArchivedEvents',
        tags: ['System'],
        parameters: [
          { name: 'contractId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 100 } },
        ],
        responses: {
          200: {
            description: 'Archived events for the given contract',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          400: { description: 'Missing contractId', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
        description: 'Exposes Prometheus-compatible metrics for scraping. No authentication required.',
        operationId: 'getMetrics',
        security: [],
        tags: ['System'],
        responses: {
          200: {
            description: 'Prometheus text format metrics',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/graphql': {
      post: {
        summary: 'GraphQL endpoint',
        description:
          'Accepts GraphQL queries and mutations. Supports full introspection. ' +
          'See /api-docs for the REST surface; use a GraphQL client (e.g. Apollo Sandbox) for the full schema.',
        operationId: 'graphql',
        tags: ['GraphQL'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', example: '{ __typename }' },
                  variables: { type: 'object' },
                  operationName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'GraphQL response (errors are returned inside the body, not via HTTP status)',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Health, metrics, and diagnostics' },
    { name: 'GraphQL', description: 'GraphQL gateway — task queries, mutations, subscriptions' },
  ],
};

module.exports = { openApiSpec };

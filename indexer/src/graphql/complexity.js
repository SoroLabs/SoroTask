'use strict';

/**
 * GraphQL Query Complexity Analysis & Depth Limiting (Issue #1066).
 *
 * Enforces:
 * 1. Query Depth Limit: Hard maximum depth of 5 to prevent recursive nest attacks.
 * 2. Query Complexity Analysis: Maximum cost threshold of 1000 points per request.
 * 3. Pagination Bounds: Hard cap on list resolutions (max: 50).
 */

const graphql = require('graphql');
try {
  const values = require('graphql/execution/values');
  for (const key of Object.keys(values)) {
    try {
      Object.defineProperty(graphql, key, {
        value: values[key],
        configurable: true,
        writable: true,
      });
    } catch (e) {}
  }
} catch (e) {}

const { GraphQLError } = graphql;
const depthLimit = require('graphql-depth-limit');
const {
  createComplexityRule,
  simpleEstimator,
  fieldExtensionsEstimator,
} = require('graphql-query-complexity');

const MAX_DEPTH = 5;
const MAX_COMPLEXITY = 1000;
const MAX_PAGINATION_LIMIT = 50;

/**
 * Custom estimator calculating cost based on pagination arguments (first, limit).
 */
function paginationComplexityEstimator() {
  return (args) => {
    const fieldArgs = args.args || {};
    const multiplier = Number(fieldArgs.first || fieldArgs.limit || 1);
    const childComplexity = args.childComplexity || 1;
    const cost = Math.max(1, multiplier) * childComplexity + 1;
    return cost;
  };
}

/**
 * Validation rule enforcing query depth <= 5.
 */
function createDepthRule(maxDepth = MAX_DEPTH) {
  return depthLimit(maxDepth);
}

/**
 * Validation rule enforcing query complexity <= 1000.
 */
function createComplexityLimitRule(maxComplexity = MAX_COMPLEXITY) {
  return createComplexityRule({
    maximumComplexity: maxComplexity,
    estimators: [
      paginationComplexityEstimator(),
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 }),
    ],
    createError: (max, actual) => {
      return new GraphQLError(
        `Query complexity of ${actual} exceeds maximum allowed complexity of ${max}.`
      );
    },
  });
}

/**
 * Custom validation rule enforcing pagination bounds on list queries.
 */
function createPaginationBoundsRule(maxLimit = MAX_PAGINATION_LIMIT) {
  return function PaginationBoundsRule(context) {
    return {
      Field(node) {
        const fieldName = node.name.value;
        const listFields = [
          'tasks',
          'events',
          'keeperStats',
          'reconciliationLogs',
          'executionHistory',
          'tasksConnection',
          'eventsConnection',
        ];

        if (listFields.includes(fieldName)) {
          const firstArg = node.arguments?.find((a) => a.name.value === 'first');
          const limitArg = node.arguments?.find((a) => a.name.value === 'limit');
          const arg = firstArg || limitArg;

          if (arg && arg.value.kind === 'IntValue') {
            const val = parseInt(arg.value.value, 10);
            if (val > maxLimit) {
              context.reportError(
                new GraphQLError(
                  `Pagination limit on field "${fieldName}" cannot exceed ${maxLimit} (requested: ${val}).`,
                  [node]
                )
              );
            }
            if (val < 1) {
              context.reportError(
                new GraphQLError(
                  `Pagination limit on field "${fieldName}" must be at least 1 (requested: ${val}).`,
                  [node]
                )
              );
            }
          }
        }
      },
    };
  };
}

/**
 * Helper to validate pagination inputs within resolvers.
 * @param {object} args
 * @returns {{ limit: number, offset: number, cursor?: string }}
 */
function validatePaginationBounds(args = {}, defaultLimit = 50, maxLimit = 50) {
  let limit = args.first !== undefined ? args.first : args.limit;
  if (limit === undefined || limit === null) {
    limit = defaultLimit;
  }

  limit = Number(limit);
  if (isNaN(limit) || limit < 1 || limit > maxLimit) {
    throw new GraphQLError(
      `Pagination bounds violation: limit/first must be between 1 and ${maxLimit} (got: ${args.first ?? args.limit}).`
    );
  }

  let offset = Number(args.offset || 0);
  if (isNaN(offset) || offset < 0) {
    throw new GraphQLError(`Invalid pagination offset: ${args.offset}.`);
  }

  // Handle cursor-based pagination
  if (args.after) {
    try {
      const decoded = Buffer.from(args.after, 'base64').toString('utf8');
      const parsedOffset = parseInt(decoded, 10);
      if (!isNaN(parsedOffset) && parsedOffset >= 0) {
        offset = parsedOffset;
      }
    } catch (e) {
      throw new GraphQLError(`Invalid pagination cursor: "${args.after}".`);
    }
  }

  return { limit, offset, after: args.after };
}

/**
 * Encode an ID or offset as an opaque cursor.
 */
function encodeCursor(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

/**
 * Decode an opaque cursor.
 */
function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const str = Buffer.from(cursor, 'base64').toString('utf8');
    const num = parseInt(str, 10);
    return isNaN(num) ? 0 : num;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  MAX_DEPTH,
  MAX_COMPLEXITY,
  MAX_PAGINATION_LIMIT,
  createDepthRule,
  createComplexityLimitRule,
  createPaginationBoundsRule,
  validatePaginationBounds,
  encodeCursor,
  decodeCursor,
};

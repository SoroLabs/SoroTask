'use strict';

const jwt = require('jsonwebtoken');
const { withFilter } = require('graphql-subscriptions');
const { ROLES, JWT_SECRET, enforceRole, isOwner } = require('./auth');
const { queryAll, queryGet, queryRun } = require('./db');
const { pubsub, EVENT_ADDED } = require('./pubsub');
const {
  validatePaginationBounds,
  encodeCursor,
  decodeCursor,
  MAX_PAGINATION_LIMIT,
} = require('./complexity');

const resolvers = {
  Query: {
    me: (parent, args, context) => {
      if (context.user.role === ROLES.ANONYMOUS) return null;
      return context.user;
    },

    tasks: async (parent, args, context) => {
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      return queryAll('SELECT * FROM tasks ORDER BY task_id ASC LIMIT ? OFFSET ?', [limit, offset]);
    },

    tasksConnection: async (parent, args, context) => {
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      const rows = await queryAll(
        'SELECT * FROM tasks ORDER BY task_id ASC LIMIT ? OFFSET ?',
        [limit + 1, offset]
      );
      const hasNextPage = rows.length > limit;
      const nodes = hasNextPage ? rows.slice(0, limit) : rows;

      const edges = nodes.map((node, i) => ({
        cursor: encodeCursor(offset + i + 1),
        node,
      }));

      const countResult = await queryGet('SELECT COUNT(*) as count FROM tasks');
      const totalCount = Number(countResult?.count || nodes.length);

      return {
        edges,
        nodes,
        totalCount,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: offset > 0,
          startCursor: edges.length > 0 ? edges[0].cursor : null,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        },
      };
    },

    task: async (parent, { id }, context) => {
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    },

    events: async (parent, args, context) => {
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      if (args.task_id !== undefined) {
        return queryAll(
          'SELECT * FROM events WHERE task_id = ? ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?',
          [args.task_id, limit, offset]
        );
      }
      return queryAll(
        'SELECT * FROM events ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
    },

    eventsConnection: async (parent, args, context) => {
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      const params = args.task_id !== undefined
        ? [args.task_id, limit + 1, offset]
        : [limit + 1, offset];

      const sql = args.task_id !== undefined
        ? 'SELECT * FROM events WHERE task_id = ? ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?'
        : 'SELECT * FROM events ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?';

      const rows = await queryAll(sql, params);
      const hasNextPage = rows.length > limit;
      const nodes = hasNextPage ? rows.slice(0, limit) : rows;

      const edges = nodes.map((node, i) => ({
        cursor: encodeCursor(offset + i + 1),
        node,
      }));

      const countSql = args.task_id !== undefined
        ? 'SELECT COUNT(*) as count FROM events WHERE task_id = ?'
        : 'SELECT COUNT(*) as count FROM events';
      const countParams = args.task_id !== undefined ? [args.task_id] : [];
      const countResult = await queryGet(countSql, countParams);
      const totalCount = Number(countResult?.count || nodes.length);

      return {
        edges,
        nodes,
        totalCount,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: offset > 0,
          startCursor: edges.length > 0 ? edges[0].cursor : null,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        },
      };
    },

    keeperStats: async (parent, args) => {
      const { limit } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      const rows = await queryAll(
        `SELECT
           (data_json->>'keeper') AS address,
           COUNT(*) AS tasks_executed,
           SUM(CAST((data_json->>'fee') AS REAL)) AS fee_total_stroops
         FROM events
         WHERE event_name = 'KeeperPaid' AND (data_json->>'keeper') IS NOT NULL
         GROUP BY address
         ORDER BY tasks_executed DESC
         LIMIT ?`,
        [limit]
      );
      return rows.map((row) => ({
        address: row.address,
        tasksExecuted: Number(row.tasks_executed || 0),
        bountiesEarnedXlm: (Number(row.fee_total_stroops) || 0) / 1e7,
      }));
    },

    reconciliationLogs: async (parent, args, context) => {
      enforceRole(context, ROLES.OPERATOR);
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);

      if (args.task_id !== undefined) {
        return queryAll(
          'SELECT * FROM reconciliation_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [args.task_id, limit, offset]
        );
      }
      return queryAll(
        'SELECT * FROM reconciliation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
    },

    executionHistory: async (parent, args) => {
      const { limit, offset } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      const params = args.task_id !== undefined ? [args.task_id, limit, offset] : [limit, offset];
      const rows = await queryAll(
        `SELECT task_id, ledger_sequence, processed_at,
                (data_json->>'keeper') AS keeper,
                (data_json->>'fee') AS fee
         FROM events
         WHERE event_name = 'KeeperPaid' ${args.task_id !== undefined ? 'AND task_id = ?' : ''}
         ORDER BY ledger_sequence DESC
         LIMIT ? OFFSET ?`,
        params
      );
      return rows;
    },
  },

  Subscription: {
    eventAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator([EVENT_ADDED]),
        (payload, variables) => {
          if (variables.task_id !== undefined && payload.eventAdded.task_id !== variables.task_id) {
            return false;
          }
          if (
            variables.contract_id !== undefined &&
            payload.eventAdded.contract_id !== variables.contract_id
          ) {
            return false;
          }
          return true;
        }
      ),
    },
  },

  Mutation: {
    loginDemo: (parent, { address, role }) => {
      const userRole = role || ROLES.USER;
      const user = {
        id: `usr_${Math.random().toString(36).substr(2, 9)}`,
        address,
        role: userRole,
      };

      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '1d' });
      return { token, user };
    },

    pauseTask: async (parent, { id }, context) => {
      const task = await queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
      if (!task) throw new Error('Task not found');

      if (context.user.role !== ROLES.ADMIN && !isOwner(context, task.creator)) {
        throw new Error('Unauthorized: Only Admin or the task Creator can pause this task.');
      }

      await queryRun('UPDATE tasks SET is_active = 0 WHERE task_id = ?', [id]);
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    },
  },

  // Field-level resolvers and relations
  Task: {
    whitelist_json: (task, args, context) => {
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.whitelist_json;
      }
      return null;
    },
    blocked_by_json: (task, args, context) => {
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.blocked_by_json;
      }
      return null;
    },
    events: async (task, args) => {
      const { limit } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      return queryAll(
        'SELECT * FROM events WHERE task_id = ? ORDER BY ledger_sequence DESC LIMIT ?',
        [task.task_id, limit]
      );
    },
    executions: async (task, args) => {
      const { limit } = validatePaginationBounds(args, 50, MAX_PAGINATION_LIMIT);
      return queryAll(
        `SELECT task_id, ledger_sequence, processed_at,
                (data_json->>'keeper') AS keeper,
                (data_json->>'fee') AS fee
         FROM events
         WHERE event_name = 'KeeperPaid' AND task_id = ?
         ORDER BY ledger_sequence DESC
         LIMIT ?`,
        [task.task_id, limit]
      );
    },
  },

  Event: {
    task: async (event) => {
      if (!event.task_id) return null;
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [event.task_id]);
    },
  },

  ExecutionHistory: {
    task: async (execution) => {
      if (!execution.task_id) return null;
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [execution.task_id]);
    },
  },
};

module.exports = { resolvers };

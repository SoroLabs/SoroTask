const jwt = require('jsonwebtoken');
const { withFilter } = require('graphql-subscriptions');
const { ROLES, JWT_SECRET, enforceRole, isOwner } = require('./auth');
const { queryAll, queryGet, queryRun } = require('./db');
const { pubsub, EVENT_ADDED } = require('./pubsub');

const resolvers = {
  Query: {
    me: (parent, args, context) => {
      if (context.user.role === ROLES.ANONYMOUS) return null;
      return context.user;
    },
    tasks: async (parent, { limit = 50, offset = 0 }, context) => {
      return queryAll('SELECT * FROM tasks LIMIT ? OFFSET ?', [limit, offset]);
    },
    task: async (parent, { id }, context) => {
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    },
    events: async (parent, { task_id, limit = 50, offset = 0 }, context) => {
      if (task_id !== undefined) {
        return queryAll('SELECT * FROM events WHERE task_id = ? ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?', [task_id, limit, offset]);
      }
      return queryAll('SELECT * FROM events ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?', [limit, offset]);
    },
    keeperStats: async (parent, { limit = 50 }) => {
      // Aggregated at the SQL layer (not pulled into JS and summed there) so
      // this stays cheap as the events table grows. fee is stored in the
      // gas token's smallest unit (stroops for XLM); bountiesEarnedXlm
      // assumes the standard 7-decimal Stellar asset scale, matching the
      // convention the keeper's own /metrics endpoint already uses.
      const rows = await queryAll(
        `SELECT
           json_extract(data_json, '$.keeper') AS address,
           COUNT(*) AS tasks_executed,
           SUM(CAST(json_extract(data_json, '$.fee') AS REAL)) AS fee_total_stroops
         FROM events
         WHERE event_name = 'KeeperPaid' AND json_extract(data_json, '$.keeper') IS NOT NULL
         GROUP BY address
         ORDER BY tasks_executed DESC
         LIMIT ?`,
        [limit],
      );
      return rows.map((row) => ({
        address: row.address,
        tasksExecuted: row.tasks_executed,
        bountiesEarnedXlm: (row.fee_total_stroops || 0) / 1e7,
      }));
    },
    reconciliationLogs: async (parent, { task_id, limit = 50, offset = 0 }, context) => {
      // Role-based access control: Only Operator and Admin can view reconciliation logs
      enforceRole(context, ROLES.OPERATOR);
      
      if (task_id !== undefined) {
        return queryAll('SELECT * FROM reconciliation_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [task_id, limit, offset]);
      }
      return queryAll('SELECT * FROM reconciliation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    },
    executionHistory: async (parent, { task_id, limit = 50, offset = 0 }) => {
      const params = task_id !== undefined ? [task_id, limit, offset] : [limit, offset];
      const rows = await queryAll(
        `SELECT task_id, ledger_sequence, processed_at,
                json_extract(data_json, '$.keeper') AS keeper,
                json_extract(data_json, '$.fee') AS fee
         FROM events
         WHERE event_name = 'KeeperPaid' ${task_id !== undefined ? 'AND task_id = ?' : ''}
         ORDER BY ledger_sequence DESC
         LIMIT ? OFFSET ?`,
        params,
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
        },
      ),
    },
  },

  Mutation: {
    loginDemo: (parent, { address, role }) => {
      // For demo purposes, allow token generation.
      const userRole = role || ROLES.USER;
      const user = {
        id: `usr_${Math.random().toString(36).substr(2, 9)}`,
        address,
        role: userRole
      };
      
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '1d' });
      return { token, user };
    },
    pauseTask: async (parent, { id }, context) => {
      const task = await queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
      if (!task) throw new Error("Task not found");
      
      // Complex Authorization: Admin can pause any task. User can only pause their own task.
      if (context.user.role !== ROLES.ADMIN && !isOwner(context, task.creator)) {
        throw new Error("Unauthorized: Only Admin or the task Creator can pause this task.");
      }
      
      await queryRun('UPDATE tasks SET is_active = 0 WHERE task_id = ?', [id]);
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    }
  },
  
  // Field-level Authorization for Task type
  Task: {
    whitelist_json: (task, args, context) => {
      // Only Admin or the Creator can view the whitelist
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.whitelist_json;
      }
      return null;
    },
    blocked_by_json: (task, args, context) => {
      // Only Admin or the Creator can view block reasons
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.blocked_by_json;
      }
      return null;
    }
  }
};

module.exports = { resolvers };

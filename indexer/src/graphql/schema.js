const { gql } = require('apollo-server-express');

const typeDefs = gql`
  """
  Standard response for authentication.
  """
  type AuthPayload {
    token: String!
    user: User!
  }

  """
  User representation within the system.
  """
  type User {
    id: ID!
    address: String!
    role: String!
  }

  """
  Represents a scheduled Keeper Task.
  """
  type Task {
    task_id: ID!
    creator: String!
    target: String!
    function: String!
    args_json: String
    resolver: String
    interval: Int!
    last_run: Int!
    gas_balance: String!
    is_active: Boolean!
    
    # Restricted fields (Admin or Owner only)
    whitelist_json: String
    blocked_by_json: String
    updated_at: String
    last_reconciled_at: String
  }

  """
  Represents a contract event indexed by the system.
  """
  type Event {
    id: ID!
    ledger_sequence: Int!
    contract_id: String!
    event_name: String!
    task_id: Int
    data_json: String!
    processed_at: String!
  }

  """
  Aggregate performance stats for a single Keeper, derived from KeeperPaid events.
  """
  type KeeperStat {
    address: String!
    tasksExecuted: Int!
    bountiesEarnedXlm: Float!
  }

  """
  Represents a reconciliation log.
  Restricted to Operators and Admins.
  """
  type ReconciliationLog {
    id: ID!
    task_id: Int
    status: String!
    details_json: String
    created_at: String!
  }

  """
  A single keeper execution outcome, derived from KeeperPaid events.
  """
  type ExecutionHistory {
    task_id: Int
    keeper: String!
    fee: String!
    ledger_sequence: Int!
    processed_at: String!
  }

  type Query {
    """
    Get the currently authenticated user.
    """
    me: User

    """
    Retrieve all tasks. Accessible by anyone.
    """
    tasks(limit: Int, offset: Int): [Task!]!

    """
    Retrieve a specific task by ID. Accessible by anyone.
    """
    task(id: ID!): Task

    """
    Retrieve events. Optionally filter by task_id.
    """
    events(task_id: Int, limit: Int, offset: Int): [Event!]!

    """
    Keeper leaderboard, ranked by tasks executed. Accessible by anyone.
    """
    keeperStats(limit: Int): [KeeperStat!]!

    """
    Retrieve reconciliation logs. Restricted to OPERATOR.
    """
    reconciliationLogs(task_id: Int, limit: Int, offset: Int): [ReconciliationLog!]!

    """
    Retrieve keeper execution history. Optionally filter by task_id.
    """
    executionHistory(task_id: Int, limit: Int, offset: Int): [ExecutionHistory!]!
  }

  type Subscription {
    """
    Streams newly indexed contract events in real time (task registrations,
    executions, gas deposits, ...). Optionally filter by task_id or
    contract_id. Only active on a live WebSocket connection to /graphql;
    has no effect on plain query/mutation requests.
    """
    eventAdded(task_id: Int, contract_id: String): Event!
  }

  type Mutation {
    """
    Generate a demo JWT token for testing. (In production, replace with real auth).
    """
    loginDemo(address: String!, role: String): AuthPayload!

    """
    Force a task to pause. Restricted to ADMIN or Task Creator.
    """
    pauseTask(id: ID!): Task
  }
`;

module.exports = { typeDefs };

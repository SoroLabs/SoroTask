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
  Page navigation metadata for cursor-based pagination.
  """
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
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

    # Nested relations (depth-limited and bounded)
    events(first: Int, limit: Int): [Event!]!
    executions(first: Int, limit: Int): [ExecutionHistory!]!
    
    # Restricted fields (Admin or Owner only)
    whitelist_json: String
    blocked_by_json: String
    updated_at: String
    last_reconciled_at: String
  }

  type TaskEdge {
    cursor: String!
    node: Task!
  }

  type TaskConnection {
    edges: [TaskEdge!]!
    nodes: [Task!]!
    pageInfo: PageInfo!
    totalCount: Int!
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
    task: Task
  }

  type EventEdge {
    cursor: String!
    node: Event!
  }

  type EventConnection {
    edges: [EventEdge!]!
    nodes: [Event!]!
    pageInfo: PageInfo!
    totalCount: Int!
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
    task: Task
  }

  type Query {
    """
    Get the currently authenticated user.
    """
    me: User

    """
    Retrieve all tasks (bounded list, max 50 items). Accessible by anyone.
    """
    tasks(first: Int, after: String, limit: Int, offset: Int): [Task!]!

    """
    Retrieve tasks using cursor-based relay connection (max 50 items).
    """
    tasksConnection(first: Int, after: String): TaskConnection!

    """
    Retrieve a specific task by ID. Accessible by anyone.
    """
    task(id: ID!): Task

    """
    Retrieve events (bounded list, max 50 items). Optionally filter by task_id.
    """
    events(task_id: Int, first: Int, after: String, limit: Int, offset: Int): [Event!]!

    """
    Retrieve events using cursor-based relay connection (max 50 items).
    """
    eventsConnection(task_id: Int, first: Int, after: String): EventConnection!

    """
    Keeper leaderboard, ranked by tasks executed (bounded list, max 50 items). Accessible by anyone.
    """
    keeperStats(first: Int, limit: Int): [KeeperStat!]!

    """
    Retrieve reconciliation logs (bounded list, max 50 items). Restricted to OPERATOR.
    """
    reconciliationLogs(task_id: Int, first: Int, after: String, limit: Int, offset: Int): [ReconciliationLog!]!

    """
    Retrieve keeper execution history (bounded list, max 50 items). Optionally filter by task_id.
    """
    executionHistory(task_id: Int, first: Int, after: String, limit: Int, offset: Int): [ExecutionHistory!]!
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

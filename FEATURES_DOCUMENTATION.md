# SoroTask Platform - New Features Documentation

## Table of Contents
1. [Notification System](#1-notification-system)
2. [WASM-based Soroban Environment](#2-wasm-based-soroban-environment)
3. [Chain State Synchronization](#3-chain-state-synchronization)
4. [Role-Based Access Control](#4-role-based-access-control)
5. [Installation & Setup](#installation--setup)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)

---

## 1. Notification System

### Overview
The notification system provides a unified platform for delivering notifications across multiple channels: in-app, email, and webhook. It integrates with the existing keeper service to notify users about task events, failures, and important status changes.

### Features
- **Multi-channel delivery**: In-app, email, and webhook notifications
- **User preferences**: Configurable notification preferences per user
- **Rate limiting**: Built-in rate limiting to prevent spam
- **Retry logic**: Automatic retry with exponential backoff
- **Event types**: Task failures, recoveries, low gas, pauses, successes, skips, and weekly digests

### Architecture

#### Components
```
keeper/src/
├── notificationService.js      # Core notification delivery engine
├── notificationIntegration.js  # Integration layer for keeper events
└── __tests__/
    ├── notificationService.test.js
    └── notificationIntegration.test.js

frontend/src/
├── lib/notification-preferences.ts  # User preference management
└── components/notification-preference-center.tsx  # UI for preferences
```

#### Data Flow
```
Keeper Event → NotificationIntegration → NotificationService → Channels
                                                        ↓
                                                        ├─ In-App (Memory/DB)
                                                        ├─ Email (SMTP)
                                                        └─ Webhook (HTTP POST)
```

### Configuration

#### Environment Variables
```bash
# Email Configuration
EMAIL_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
EMAIL_FROM=noreply@sorotask.io

# Webhook Configuration
NOTIFICATION_WEBHOOKS_ENABLED=true
NOTIFICATION_WEBHOOK_ENDPOINTS=["https://example.com/webhook"]
WEBHOOK_TIMEOUT=10000
WEBHOOK_RETRY_ATTEMPTS=3

# Rate Limiting
NOTIFICATION_RATE_LIMIT=60

# Retry Configuration
NOTIFICATION_RETRY_DELAY=1000
NOTIFICATION_RETRY_MAX_DELAY=30000
```

### Usage

#### Keeper Integration
```javascript
const { NotificationService, NotificationIntegration } = require('./notificationService');
const { NotificationType } = require('./notificationService');

// Initialize service
const notificationService = new NotificationService({
  emailEnabled: true,
  webhookEnabled: true,
  inAppEnabled: true,
});

const integration = new NotificationIntegration(notificationService);

// Handle task failure
await integration.handleTaskFailure({
  taskId: 123,
  error: 'Execution failed',
  taskConfig: { creator: 'user@example.com' },
  keeperAddress: 'GKEEPER',
  correlationId: 'corr-123',
});
```

#### Frontend Integration
```typescript
import { loadNotificationPreferences, saveNotificationPreferences } from './lib/notification-preferences';

// Load user preferences
const preferences = loadNotificationPreferences();

// Update preferences
preferences.channels.email = true;
preferences.categories.taskFailed = true;
saveNotificationPreferences(preferences);
```

### Notification Types

| Type | Description | Default Channels | Priority |
|------|-------------|------------------|----------|
| `task_failed` | Task execution failed | in-app, email, webhook | Critical |
| `task_recovered` | Task recovered after failure | in-app, webhook | Important |
| `gas_low` | Low gas balance warning | in-app, email, webhook | Critical |
| `task_paused` | Task paused | in-app, email, webhook | Critical |
| `execution_success` | Successful execution | in-app | FYI |
| `execution_skipped` | Execution skipped | in-app, webhook | Important |
| `weekly_digest` | Weekly summary | email | FYI |

### API Reference

#### NotificationService
```javascript
class NotificationService {
  constructor(options)
  async sendNotification(notification)
  async sendInApp(notification, notificationId)
  async sendEmail(notification, notificationId)
  async sendWebhook(notification, notificationId)
  getInAppNotifications(recipient, options)
  markAsRead(notificationId)
  getMetrics()
  cleanupExpiredNotifications()
}
```

#### NotificationIntegration
```javascript
class NotificationIntegration {
  constructor(notificationService, options)
  async handleTaskFailure(event)
  async handleTaskRecovery(event)
  async handleLowGasBalance(event)
  async handleTaskPaused(event)
  async handleExecutionSuccess(event)
  async handleExecutionSkipped(event)
  async sendWeeklyDigest(event)
  updateUserPreferences(userId, preferences)
  getUserPreferences(userId)
}
```

---

## 2. WASM-based Soroban Environment

### Overview
The WASM-based Soroban environment provides browser-based transaction simulation using the Stellar SDK. This allows users to simulate transactions locally before submitting to the network, reducing failed transactions and improving user experience.

### Features
- **Local simulation**: Simulate contract calls in the browser
- **Gas estimation**: Estimate gas costs before submission
- **Transaction validation**: Validate transactions before sending
- **Caching**: Built-in caching for improved performance
- **Error handling**: Comprehensive error reporting

### Architecture

#### Components
```
frontend/lib/
├── soroban-wasm-simulator.ts  # Core simulation engine
└── __tests__/
    └── soroban-wasm-simulator.test.ts
```

#### Data Flow
```
User Input → SorobanWasmSimulator → Stellar SDK RPC → Simulation Result
                                              ↓
                                         Cache (optional)
```

### Configuration

#### TypeScript Configuration
```typescript
const config: SorobanWasmSimulatorConfig = {
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://test-rpc.stellar.org',
  enableCache: true,
  cacheSize: 100,
};
```

### Usage

#### Basic Simulation
```typescript
import { SorobanWasmSimulator } from './lib/soroban-wasm-simulator';
import { Account, xdr } from '@stellar/stellar-sdk';

const simulator = new SorobanWasmSimulator({
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://test-rpc.stellar.org',
});

const account = await simulator.getAccount('GTEST...');
const args = [xdr.ScVal.scvU32(xdr.Uint32.fromString('42'))];

const result = await simulator.simulateContractCall(
  'C-CONTRACT_ID',
  'method_name',
  args,
  account
);

if (result.success) {
  console.log('Simulation successful:', result.result);
} else {
  console.error('Simulation failed:', result.error);
}
```

#### Gas Estimation
```typescript
const gas = await simulator.estimateGas(
  'C-CONTRACT_ID',
  'method_name',
  args,
  account
);

console.log('Estimated gas:', gas);
```

#### Transaction Validation
```typescript
const validation = await simulator.validateTransaction(transaction);

if (validation.valid) {
  console.log('Transaction is valid');
} else {
  console.error('Validation errors:', validation.errors);
  console.warn('Warnings:', validation.warnings);
}
```

### React Hook

```typescript
import { useSorobanWasmSimulator } from './lib/soroban-wasm-simulator';

function MyComponent() {
  const { simulator, simulateContractCall, estimateGas } = useSorobanWasmSimulator({
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://test-rpc.stellar.org',
  });

  const handleSimulate = async () => {
    const result = await simulateContractCall(
      contractId,
      method,
      args,
      account
    );
    // Handle result
  };

  return <button onClick={handleSimulate}>Simulate</button>;
}
```

### API Reference

#### SorobanWasmSimulator
```typescript
class SorobanWasmSimulator {
  constructor(config: SorobanWasmSimulatorConfig)
  async simulateContractCall(contractId, method, args, account, options)
  async simulateTransaction(transaction, options)
  async estimateGas(contractId, method, args, account)
  async validateTransaction(transaction)
  async getAccount(publicKey)
  async getLedgerInfo()
  clearCache()
  getCacheStats()
}
```

#### Types
```typescript
interface SimulationResult {
  success: boolean;
  result?: xdr.ScVal;
  error?: string;
  events?: xdr.DiagnosticEvent[];
  gasUsed?: number;
  cpuInstructions?: number;
  memoryBytes?: number;
}

interface SimulationOptions {
  resourceFee?: number;
  cpuInstructions?: number;
  memoryBytes?: number;
  additionalWasm?: Uint8Array;
}
```

---

## 3. Chain State Synchronization

### Overview
The chain state synchronization engine keeps frontend state in sync with the Soroban blockchain, handling chain reorganizations, dropped transactions, and network disruptions gracefully.

### Features
- **Automatic sync**: Periodic synchronization with the blockchain
- **Reorg detection**: Automatic detection of chain reorganizations
- **Transaction tracking**: Track transaction states (pending, success, failed, dropped)
- **Error recovery**: Automatic recovery from network disruptions
- **Health monitoring**: Built-in health checks and error reporting

### Architecture

#### Components
```
frontend/hooks/
├── useChainStateSync.ts  # Main sync hook
└── __tests__/
    └── useChainStateSync.test.ts
```

#### Data Flow
```
RPC Poll → Ledger Check → Reorg Detection → Transaction Update → State Update
                                                              ↓
                                                         React State
```

### Configuration

```typescript
const config: ChainSyncConfig = {
  rpcUrl: 'https://test-rpc.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  syncInterval: 5000,           // 5 seconds
  reorgThreshold: 10,           // 10 blocks
  maxReorgDepth: 100,          // 100 blocks
  enableAutoRecovery: true,
};
```

### Usage

#### Basic Sync
```typescript
import { useChainStateSync } from './hooks/useChainStateSync';

function MyComponent() {
  const {
    state,
    transactions,
    sync,
    forceSync,
    addTransaction,
    removeTransaction,
    getTransaction,
    isHealthy,
    error,
  } = useChainStateSync({
    rpcUrl: 'https://test-rpc.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  });

  // Track a transaction
  const handleSubmit = async (txHash: string) => {
    addTransaction(txHash);
    // Submit transaction...
  };

  return (
    <div>
      <div>Health: {isHealthy ? 'OK' : 'Error'}</div>
      <div>Ledger: {state.ledgerSequence}</div>
      {error && <div>Error: {error}</div>}
    </div>
  );
}
```

#### Transaction Monitoring
```typescript
import { useTransactionMonitor } from './hooks/useChainStateSync';

function TransactionStatus({ txHash, chainSync }) {
  const txState = useTransactionMonitor(txHash, chainSync);

  if (!txState) return <div>Loading...</div>;

  return (
    <div>
      Status: {txState.status}
      {txState.reorgDetected && <span> (Reorg detected)</span>}
    </div>
  );
}
```

#### Reorg Detection
```typescript
import { useReorgDetector } from './hooks/useChainStateSync';

function ReorgStatus({ chainSync }) {
  const { hasReorg, reorgDepth, isRecovering } = useReorgDetector(chainSync);

  if (hasReorg) {
    return (
      <div>
        Reorg detected! Depth: {reorgDepth}
        {isRecovering && <span> - Recovering...</span>}
      </div>
    );
  }

  return <div>Chain is healthy</div>;
}
```

### API Reference

#### useChainStateSync
```typescript
function useChainStateSync(config: ChainSyncConfig): ChainSyncResult

interface ChainSyncResult {
  state: ChainState;
  transactions: Map<string, TransactionState>;
  sync: () => Promise<void>;
  forceSync: () => Promise<void>;
  addTransaction: (hash: string) => void;
  removeTransaction: (hash: string) => void;
  getTransaction: (hash: string) => TransactionState | undefined;
  isHealthy: boolean;
  error: string | null;
}
```

#### Types
```typescript
interface ChainState {
  ledgerSequence: number;
  ledgerTimestamp: number;
  networkPassphrase: string;
  isSyncing: boolean;
  lastSyncTime: number;
  reorgDepth: number;
}

interface TransactionState {
  hash: string;
  status: 'pending' | 'success' | 'failed' | 'dropped';
  ledgerSequence?: number;
  timestamp?: number;
  error?: string;
  reorgDetected?: boolean;
}
```

---

## 4. Role-Based Access Control

### Overview
The Role-Based Access Control (RBAC) system provides a comprehensive interface for managing workspace members, assigning custom permission sets, and configuring role-based access for task management.

### Features
- **Member management**: Add, remove, and update workspace members
- **Role management**: Create custom roles with specific permissions
- **Permission sets**: Granular permissions for tasks, workspaces, and portfolios
- **Default roles**: Pre-configured roles (Viewer, Editor, Executor, Admin)
- **Audit trail**: Track all access changes

### Architecture

#### Components
```
frontend/components/
└── RoleBasedAccessControl.tsx  # Main RBAC UI component
```

#### Data Model
```
Workspace
├── Members
│   ├── User
│   ├── Role
│   └── Permissions
└── Roles
    ├── Default Roles
    └── Custom Roles
        └── Permissions
```

### Configuration

#### Default Permissions
```typescript
const DEFAULT_PERMISSIONS: Permission[] = [
  {
    id: 'read_task',
    name: 'Read Tasks',
    description: 'View tasks and their details',
    scope: 'read',
    resourceType: 'task',
  },
  {
    id: 'write_task',
    name: 'Edit Tasks',
    description: 'Create and modify tasks',
    scope: 'write',
    resourceType: 'task',
  },
  {
    id: 'execute_task',
    name: 'Execute Tasks',
    description: 'Trigger task execution',
    scope: 'execute',
    resourceType: 'task',
  },
  {
    id: 'admin_workspace',
    name: 'Admin Workspace',
    description: 'Full workspace control',
    scope: 'admin',
    resourceType: 'workspace',
  },
];
```

#### Default Roles
```typescript
const DEFAULT_ROLES: Role[] = [
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to workspace',
    permissions: [read_task],
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can create and modify tasks',
    permissions: [read_task, write_task],
  },
  {
    id: 'executor',
    name: 'Executor',
    description: 'Can execute tasks',
    permissions: [read_task, write_task, execute_task],
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full workspace control',
    permissions: [read_task, write_task, execute_task, admin_workspace],
  },
];
```

### Usage

#### Basic Implementation
```typescript
import { RoleBasedAccessControl } from './components/RoleBasedAccessControl';

function WorkspaceSettings() {
  const [workspace, setWorkspace] = useState<Workspace>({
    id: 'ws-123',
    name: 'My Workspace',
    description: 'Task workspace',
    members: [],
    roles: [],
    owner: 'user@example.com',
    createdAt: new Date().toISOString(),
  });

  const handleAddMember = async (email: string, roleId: string) => {
    // Add member via API
  };

  const handleRemoveMember = async (memberId: string) => {
    // Remove member via API
  };

  const handleUpdateMemberRole = async (memberId: string, roleId: string) => {
    // Update role via API
  };

  const handleCreateRole = async (role: Omit<Role, 'id' | 'createdAt'>) => {
    // Create role via API
  };

  const handleDeleteRole = async (roleId: string) => {
    // Delete role via API
  };

  return (
    <RoleBasedAccessControl
      workspace={workspace}
      onUpdateWorkspace={setWorkspace}
      onAddMember={handleAddMember}
      onRemoveMember={handleRemoveMember}
      onUpdateMemberRole={handleUpdateMemberRole}
      onCreateRole={handleCreateRole}
      onUpdateRole={handleUpdateRole}
      onDeleteRole={handleDeleteRole}
    />
  );
}
```

### API Reference

#### RoleBasedAccessControl Props
```typescript
interface RoleBasedAccessControlProps {
  workspace: Workspace;
  onUpdateWorkspace: (workspace: Workspace) => Promise<void>;
  onAddMember: (email: string, roleId: string) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onUpdateMemberRole: (memberId: string, roleId: string) => Promise<void>;
  onCreateRole: (role: Omit<Role, 'id' | 'createdAt'>) => Promise<Role>;
  onUpdateRole: (roleId: string, role: Partial<Role>) => Promise<void>;
  onDeleteRole: (roleId: string) => Promise<void>;
}
```

#### Types
```typescript
type PermissionScope = 'read' | 'write' | 'admin' | 'execute';
type ResourceType = 'task' | 'workspace' | 'portfolio';

interface Permission {
  id: string;
  name: string;
  description: string;
  scope: PermissionScope;
  resourceType: ResourceType;
}

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isCustom: boolean;
  createdAt: string;
}

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
  lastActive: string;
}

interface Workspace {
  id: string;
  name: string;
  description: string;
  members: Member[];
  roles: Role[];
  owner: string;
  createdAt: string;
}
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+
- npm or pnpm
- Stellar SDK

### Keeper Service Setup

1. **Install Dependencies**
```bash
cd keeper
npm install
```

2. **Configure Environment Variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Run Tests**
```bash
npm test
```

4. **Start Service**
```bash
npm start
```

### Frontend Setup

1. **Install Dependencies**
```bash
cd frontend
npm install
```

2. **Install Stellar SDK**
```bash
npm install @stellar/stellar-sdk
```

3. **Configure Environment Variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Run Tests**
```bash
npm test
```

5. **Start Development Server**
```bash
npm run dev
```

---

## API Reference

### Notification Service API

#### Send Notification
```javascript
POST /api/notifications
{
  "type": "task_failed",
  "title": "Task Failed",
  "message": "Task #123 failed",
  "channels": ["in_app", "email"],
  "recipient": "user@example.com",
  "priority": "critical",
  "data": {}
}
```

#### Get Notifications
```javascript
GET /api/notifications?recipient=user@example.com&limit=50&unreadOnly=true
```

#### Mark as Read
```javascript
PUT /api/notifications/:id/read
```

### Chain State API

#### Get Chain State
```javascript
GET /api/chain/state
{
  "ledgerSequence": 12345,
  "ledgerTimestamp": 1234567890,
  "networkPassphrase": "Test SDF Network ; September 2015",
  "isSyncing": false,
  "lastSyncTime": 1234567890000,
  "reorgDepth": 0
}
```

#### Track Transaction
```javascript
POST /api/chain/transactions
{
  "hash": "abc123..."
}
```

#### Get Transaction State
```javascript
GET /api/chain/transactions/:hash
{
  "hash": "abc123...",
  "status": "success",
  "ledgerSequence": 12345,
  "timestamp": 1234567890000
}
```

### RBAC API

#### Get Workspace
```javascript
GET /api/workspaces/:id
```

#### Add Member
```javascript
POST /api/workspaces/:id/members
{
  "email": "user@example.com",
  "roleId": "editor"
}
```

#### Update Member Role
```javascript
PUT /api/workspaces/:id/members/:memberId
{
  "roleId": "admin"
}
```

#### Remove Member
```javascript
DELETE /api/workspaces/:id/members/:memberId
```

#### Create Role
```javascript
POST /api/workspaces/:id/roles
{
  "name": "Custom Role",
  "description": "Custom permissions",
  "permissions": ["read_task", "write_task"],
  "isCustom": true
}
```

#### Delete Role
```javascript
DELETE /api/workspaces/:id/roles/:roleId
```

---

## Troubleshooting

### Notification System

**Issue: Notifications not being delivered**
- Check if notification service is running
- Verify environment variables are set correctly
- Check rate limiting logs
- Verify email/webhook endpoints are accessible

**Issue: Webhook delivery failing**
- Verify webhook endpoint is HTTPS
- Check webhook endpoint is responding
- Verify webhook signature (if implemented)
- Check webhook timeout settings

### WASM Simulator

**Issue: Simulation failing**
- Verify RPC URL is correct and accessible
- Check network passphrase matches
- Verify contract ID is valid
- Check account has sufficient balance

**Issue: Gas estimation inaccurate**
- Update to latest Stellar SDK version
- Check network conditions
- Verify simulation parameters

### Chain State Sync

**Issue: Sync not updating**
- Check RPC connection
- Verify sync interval configuration
- Check for reorg events
- Review error logs

**Issue: Transactions not updating**
- Verify transaction hash is correct
- Check transaction is on-chain
- Review reorg detection logs

### RBAC

**Issue: Permission changes not applying**
- Check server-side permission checks
- Verify role assignments
- Review audit logs
- Clear browser cache

**Issue: Cannot remove member**
- Verify member is not the workspace owner
- Check for active sessions
- Review member dependencies

---

## Security Considerations

See [SECURITY_REVIEW_NEW_FEATURES.md](./SECURITY_REVIEW_NEW_FEATURES.md) for comprehensive security review and recommendations.

### Key Security Points
- All RPC communication must use HTTPS
- Implement proper authentication and authorization
- Use secrets management for sensitive configuration
- Implement audit logging for all access changes
- Validate all user inputs
- Implement rate limiting to prevent abuse

---

## Contributing

### Development Workflow
1. Create feature branch
2. Implement changes with tests
3. Ensure >90% test coverage
4. Run security checks
5. Submit pull request

### Code Style
- Follow existing code style
- Use TypeScript for frontend
- Use JavaScript for keeper service
- Add JSDoc comments for public APIs
- Write comprehensive tests

---

## License

See project LICENSE file for details.

---

## Support

For issues and questions:
- GitHub Issues: [project-url]/issues
- Documentation: [project-url]/wiki
- Security: security@sorotask.io

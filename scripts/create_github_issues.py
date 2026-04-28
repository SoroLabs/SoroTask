#!/usr/bin/env python3
"""Create 50 hard frontend GitHub issues for SoroTask."""
import subprocess, tempfile, os, sys, json

REPO = "SoroLabs/SoroTask"
MILESTONE = "Frontend Sprint — ETA 2 Days"

LABELS = [
    {"name": "frontend",                   "color": "0075ca", "description": "Frontend-related issues"},
    {"name": "complexity: hard",            "color": "d73a4a", "description": "Requires deep expertise and significant effort"},
    {"name": "area: wallet-integration",   "color": "7057ff", "description": "Wallet connection and transaction signing"},
    {"name": "area: task-management",      "color": "0e8a16", "description": "Task creation, scheduling and management UI"},
    {"name": "area: data-visualization",   "color": "e4e669", "description": "Charts, graphs and analytics UI"},
    {"name": "area: performance",          "color": "fbca04", "description": "Performance optimization"},
    {"name": "area: ux",                   "color": "f9d0c4", "description": "User experience and interface design"},
    {"name": "area: accessibility",        "color": "006b75", "description": "Accessibility and screen reader support"},
    {"name": "area: testing",              "color": "bfd4f2", "description": "Frontend test coverage"},
    {"name": "area: security",             "color": "b60205", "description": "Frontend security hardening"},
    {"name": "area: contract-integration", "color": "5319e7", "description": "Soroban smart contract SDK integration"},
    {"name": "eta: 2 days",                "color": "c2e0c6", "description": "Estimated completion time: 2 days"},
]

ISSUES = [
    # ── WALLET INTEGRATION (8) ────────────────────────────────────────────────
    {
        "title": "[Frontend] Implement Multi-Wallet Adapter with Freighter, xBull & Lobstr Support",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
SoroTask currently has no wallet connection layer. This issue requires building a unified \
**multi-wallet adapter** supporting Freighter, xBull, and Lobstr — the three dominant Stellar/Soroban \
wallets — behind a single abstraction so the rest of the codebase never needs to know which wallet \
is active.

## Why It Matters
Each wallet exposes a slightly different browser-extension API. Without an adapter layer, every \
component that needs to sign a transaction must branch on wallet type, creating a maintenance \
nightmare as new wallets emerge.

## Task Breakdown
- [ ] Research and document the browser APIs for Freighter, xBull, and Lobstr
- [ ] Design a `WalletAdapter` TypeScript interface: `connect()`, `disconnect()`, `getPublicKey()`, `signTransaction()`
- [ ] Implement individual adapters for each wallet extending the base interface
- [ ] Build a `WalletProvider` React context storing the active adapter instance
- [ ] Create a wallet-selector modal listing all wallets with live availability detection
- [ ] Show install links for wallets whose extension is not detected
- [ ] Add wallet brand icons to the selector UI
- [ ] Write unit tests for each adapter using mocked extension APIs

## Acceptance Criteria
- [ ] User can connect/disconnect any of the three wallets from the dashboard header
- [ ] Switching wallets clears all previous session state
- [ ] Unavailable wallet shows a correctly linked install prompt
- [ ] All adapter methods are fully TypeScript-typed
- [ ] Unit test coverage ≥ 80 % for adapter logic

## References
- [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
- [Freighter API Docs](https://docs.freighter.app)

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Encrypted Wallet Session Persistence Across Browser Tabs",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Every page refresh forces the user to reconnect their wallet. This issue implements \
**secure session persistence** that survives page reloads and syncs wallet state across \
all open tabs in real time.

## Why It Matters
Requiring repeated wallet approval on every refresh seriously degrades UX, especially for operators \
who monitor the dashboard continuously. Only the wallet *type* (not keys) must be stored, \
keeping the approach secure.

## Task Breakdown
- [ ] Audit what wallet data is safe to persist (wallet type identifier only — never private keys)
- [ ] Implement a `useWalletSession` hook that reads the persisted wallet preference on mount
- [ ] Attempt silent re-connection on app load using the stored wallet type
- [ ] Use the `BroadcastChannel` API to sync connect/disconnect events across tabs in real time
- [ ] Implement session expiry: clear persisted wallet after 24 h of inactivity
- [ ] Show a loading skeleton while the session is being restored to prevent UI flicker
- [ ] Handle gracefully the case where the wallet extension is removed between sessions
- [ ] Write tests for connect, disconnect, expiry, and cross-tab sync scenarios

## Acceptance Criteria
- [ ] Wallet connection survives page refresh without additional user action
- [ ] Connecting in one tab reflects in all open tabs within 500 ms
- [ ] Stored session data never contains private keys or seed phrases
- [ ] Expired sessions are silently cleared on next load
- [ ] Missing extension between sessions is handled without a crash

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Wallet Transaction Signature Authorization Flow with Confirmation Dialog",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Before any task is registered or modified on the Soroban contract the user must **sign a transaction** \
via their wallet. This issue covers the full signature flow: pre-sign confirmation modal, fee display, \
in-progress state, and success/failure feedback.

## Why It Matters
Signing a blockchain transaction is a high-stakes, irreversible action. The UI must clearly \
communicate *what* is being signed, the estimated fee, the target contract, and the consequences \
before invoking the wallet's `signTransaction` method.

## Task Breakdown
- [ ] Design a `TransactionConfirmationModal` showing: action description, estimated XLM fee, target contract address, expiry time
- [ ] Implement a `useTransactionSigner` hook wrapping the active wallet adapter's `signTransaction`
- [ ] Show a loading state while the wallet popup is open, with a Cancel button
- [ ] On success: display the transaction hash with a link to Stellar Explorer
- [ ] On failure: map error codes to human-readable messages (user rejected, insufficient balance, network timeout)
- [ ] Add a "Simulate before sign" step calling the Soroban `simulateTransaction` endpoint first
- [ ] Ensure the modal is fully keyboard-navigable and screen-reader-accessible
- [ ] Write integration tests covering all modal states (idle → confirming → signing → success/error)

## Acceptance Criteria
- [ ] Users see a detailed confirmation modal before any signing action
- [ ] Estimated fees are always shown before the user commits
- [ ] All error cases display actionable messages — not raw error strings
- [ ] The complete flow is operable via keyboard alone
- [ ] No transaction is submitted if the user cancels

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Handle Wallet Disconnect and Reconnect Edge Cases with Full State Recovery",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Wallet extensions can disconnect unexpectedly due to browser restarts, extension updates, or \
account switches. This issue implements **graceful detection and recovery** from these events \
without leaving the UI in a broken or inconsistent state.

## Why It Matters
Currently there is no mechanism to detect when a wallet extension fires a disconnect event \
mid-session. This causes silent failures where the UI shows a wallet as connected but \
transaction signing fails with a cryptic error.

## Task Breakdown
- [ ] Subscribe to wallet extension `disconnect` / `accountChanged` events for each supported wallet
- [ ] Implement a `useWalletHealth` hook that polls wallet availability every 30 s as a fallback
- [ ] On unexpected disconnect: clear wallet state → show a non-blocking toast → prompt reconnect
- [ ] On account switch: detect the new public key, update state, re-fetch account-specific data
- [ ] Block any transaction from initiating if the wallet health check fails
- [ ] Build a `WalletStatusBanner` that appears when the wallet is in a degraded state
- [ ] Implement exponential backoff reconnection (max 3 attempts) before showing a hard error state
- [ ] Write tests simulating disconnect events via mocked extension APIs

## Acceptance Criteria
- [ ] App detects wallet disconnect within 5 s via event or polling fallback
- [ ] UI recovers to a clean disconnected state without requiring a page refresh
- [ ] Account switches are detected and handled without data inconsistency
- [ ] No transaction can be initiated after a detected disconnect
- [ ] All reconnection attempts are visible to the user via the status banner

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Transaction Status Polling UI with Exponential Backoff and Progress Indicator",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
After a Soroban transaction is submitted it enters a pending state that can last several seconds. \
This issue builds a robust **transaction status polling system** giving users real-time feedback \
through every status transition.

## Why It Matters
Without a status tracker, users have no idea whether their submitted transaction succeeded or failed \
and resort to manual Stellar Explorer lookups — a terrible experience.

## Task Breakdown
- [ ] Implement a `useTransactionPoller` hook calling `getTransaction` RPC on a schedule
- [ ] Use exponential backoff: start at 1 s, double each attempt, cap at 10 s, hard timeout at 60 s
- [ ] Build a `TransactionStatusCard` with an animated progress bar across states: Pending → Processing → Success / Error
- [ ] Map all Soroban transaction status codes to human-readable strings
- [ ] On SUCCESS: show confirmation with transaction details and a Stellar Explorer link
- [ ] On ERROR: parse the error code, display a specific message, offer a Retry button
- [ ] On 60 s timeout: show a "Check on Explorer" fallback with the transaction hash — never a blank screen
- [ ] Persist pending hashes in `sessionStorage` to survive accidental page refreshes
- [ ] Write tests covering all status transitions and the timeout scenario

## Acceptance Criteria
- [ ] Real-time status updates are visible for every submitted transaction
- [ ] Progress indicator transitions correctly through all Soroban status states
- [ ] Timeout occurs after 60 s with a helpful fallback
- [ ] Retry after a retryable error works correctly
- [ ] Polling auto-cancels on component unmount

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Add Ledger Hardware Wallet Support via Freighter Bridge Integration",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Power users and institutions prefer hardware wallets for security. This issue integrates \
**Ledger hardware wallet** support through the Freighter browser extension bridge, which proxies \
Ledger signing requests for Stellar/Soroban transactions.

## Why It Matters
Without hardware wallet support, SoroTask is inaccessible to institutional operators who have \
security policies mandating cold-storage key management.

## Task Breakdown
- [ ] Research Freighter's Ledger bridge API and document the differences from the software wallet flow
- [ ] Extend the `FreighterAdapter` to detect hardware wallet mode via derivation path
- [ ] Increase the signing timeout to 120 s for hardware wallets (user must physically confirm on device)
- [ ] Add a `HardwareWalletPrompt` component instructing users to confirm on their Ledger device
- [ ] Handle Ledger-specific errors: device locked, wrong app open, transaction rejected on device
- [ ] Show a Ledger device badge in the wallet status indicator when hardware mode is active
- [ ] Test the full flow using the Ledger simulator in Freighter's developer mode
- [ ] Document hardware wallet setup instructions in the app's help section

## Acceptance Criteria
- [ ] Ledger users can connect via Freighter and sign tasks without errors
- [ ] Signing UI shows a device confirmation prompt with the correct 120 s timeout
- [ ] All Ledger-specific error codes map to actionable messages
- [ ] Hardware wallet detection is automatic — no extra user configuration
- [ ] Flow gracefully recovers if the device disconnects mid-signing

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Mobile Deep-Link Wallet Connection via WalletConnect Protocol",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Mobile users cannot use browser extensions. This issue implements **WalletConnect v2 protocol** \
support so mobile wallet apps (e.g., Lobstr mobile) can scan a QR code and connect to SoroTask \
for remote transaction signing.

## Why It Matters
A large portion of the Stellar user base is on mobile. Without WalletConnect, the entire mobile \
audience is excluded from using SoroTask from a desktop browser.

## Task Breakdown
- [ ] Install and configure `@walletconnect/sign-client` and `@walletconnect/modal`
- [ ] Implement a `WalletConnectAdapter` conforming to the existing `WalletAdapter` interface
- [ ] Build a `QRCodeModal` displaying the WalletConnect pairing URI as a scannable QR code
- [ ] Handle WalletConnect session lifecycle: propose, approve, disconnect, expiry
- [ ] Restore sessions on page load using the stored WalletConnect session topic
- [ ] Add mobile deep-link buttons for Lobstr and other supported wallets
- [ ] Handle relay server connectivity issues with retry and fallback messaging
- [ ] Test across iOS (Lobstr) and Android (LOBSTR) wallet apps

## Acceptance Criteria
- [ ] Desktop users can connect a mobile wallet by scanning a QR code
- [ ] Connected mobile wallet can sign transactions triggered from the desktop browser
- [ ] Session persists across page refreshes via stored session topic
- [ ] Session expiry (48 h default) shows a notification and prompts reconnect
- [ ] Deep-link buttons open the correct mobile wallet app on each platform

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Multi-Account Wallet Switcher with Per-Account Task Isolation",
        "labels": ["frontend","complexity: hard","area: wallet-integration","eta: 2 days"],
        "body": """\
## Overview
Power users manage multiple Stellar accounts. This issue builds an **account switcher** in the \
wallet menu and ensures complete task data isolation between accounts.

## Why It Matters
Without account switching, power users must disconnect and reconnect their wallet with a different \
account — a tedious flow that risks data bleed-through.

## Task Breakdown
- [ ] Extend the `WalletAdapter` interface with `listAccounts()` and `switchAccount(index)` methods
- [ ] Build an `AccountSwitcherDropdown` showing account aliases, abbreviated public keys, and XLM balances
- [ ] Implement a `useAccountContext` hook that re-fetches all account-specific data on account switch
- [ ] Apply optimistic state clearing during account switch to prevent data bleed-through
- [ ] Persist user-defined account aliases in `localStorage` keyed by public key
- [ ] Show loading skeletons during the re-fetch after switching
- [ ] Implement a balance refresh button with rate limiting (max once per 30 s)
- [ ] Write tests verifying complete state isolation between accounts

## Acceptance Criteria
- [ ] Users can switch between available accounts from the wallet dropdown
- [ ] Task list, logs, and balances all update correctly after each switch
- [ ] No data from the previous account is visible after switching
- [ ] Account aliases are remembered across sessions
- [ ] Balance refreshes automatically after an account switch

**ETA: 2 days**
"""},
    # ── TASK MANAGEMENT (10) ──────────────────────────────────────────────────
    {
        "title": "[Frontend] Build Multi-Step Task Creation Wizard with Validation and Draft Auto-Saving",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
The current flat task creation form overwhelms users. This issue rebuilds it as a \
**multi-step wizard** with progressive validation, contextual help, and auto-saving of drafts \
so no work is lost on accidental navigation.

## Why It Matters
Task creation in SoroTask involves several distinct conceptual phases. Grouping them into logical \
steps reduces cognitive load and the error rate for new users.

## Task Breakdown
- [ ] Design wizard steps: ① Target Contract → ② Function & Parameters → ③ Schedule → ④ Incentives → ⑤ Review & Submit
- [ ] Implement a `WizardProvider` context managing step index, navigation, and accumulated form data
- [ ] Add per-step validation with `react-hook-form` + `zod` with inline error messages
- [ ] Build a step indicator component showing completed / active / upcoming states
- [ ] Auto-save form state to `localStorage` with a 2 s debounce after each change
- [ ] Detect saved drafts on page load and offer a restore prompt
- [ ] Add explicit "Save Draft" and "Discard Draft" (with confirmation) buttons
- [ ] Back navigation must preserve all previously entered data
- [ ] Build a Review step with a complete human-readable summary before signing
- [ ] Write tests for validation, draft save/restore, and navigation flows

## Acceptance Criteria
- [ ] Forward navigation is blocked on invalid steps with clear error messages
- [ ] Drafts are auto-saved and correctly restored across sessions
- [ ] The Review step shows a complete, accurate summary
- [ ] Wizard is fully keyboard navigable
- [ ] No data is lost when navigating backward and forward

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Visual Cron Expression Builder for Recurring Task Scheduling",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
SoroTask tasks use interval-based scheduling. This issue builds a **visual schedule builder** so \
users can configure schedules through an intuitive UI with a plain-English preview rather than \
raw numeric interval values.

## Why It Matters
Non-technical users cannot work with raw interval values. A builder with a human-readable preview \
("Every Monday at 09:00 UTC") makes scheduling accessible to a much wider audience.

## Task Breakdown
- [ ] Map the SoroTask contract's scheduling format (ledger intervals) to user-facing time concepts
- [ ] Build a `ScheduleBuilder` component with tabs: Simple (every N minutes/hours/days) and Advanced (specific days/times)
- [ ] Implement a plain-English preview updating in real time as settings change
- [ ] Add a calendar preview showing the next 5 scheduled execution times
- [ ] Implement a timezone selector with UTC offset display (contract always stores UTC)
- [ ] Convert the UI selection to the contract's required interval format on save
- [ ] Validate that the resulting interval is within contract-allowed bounds
- [ ] Write unit tests for conversion functions, covering DST and month-boundary edge cases

## Acceptance Criteria
- [ ] Users can configure any valid schedule without typing a raw number
- [ ] Plain-English preview is always accurate and updates within 100 ms of interaction
- [ ] Next execution times display correctly in the user's local timezone
- [ ] Intervals below the contract minimum are rejected with a clear validation error
- [ ] Output format matches exactly what the Soroban contract expects

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Optimistic UI Updates for Task State Transitions with Automatic Rollback",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
The UI currently waits for transaction confirmation before reflecting state changes, making it feel \
sluggish. This issue implements **optimistic UI updates** that immediately show the expected new state \
while the transaction is in-flight, with silent rollback if it fails.

## Why It Matters
Soroban confirmation takes 5–30 seconds. Waiting for confirmation on every pause/resume/cancel \
action destroys the responsiveness users expect from modern web apps.

## Task Breakdown
- [ ] Identify all state transitions that benefit from optimistic updates: pause, resume, cancel, update
- [ ] Implement a `useOptimisticTask` hook that applies the expected state change immediately
- [ ] Buffer the previous state before applying an optimistic update for rollback
- [ ] Integrate with `useTransactionPoller` to detect the final success or failure
- [ ] On failure: rollback state → show a toast with the error reason and a Retry button
- [ ] On success: remove the optimistic flag and mark the state as confirmed
- [ ] Add a subtle visual indicator (e.g., pulsing border) distinguishing optimistic state from confirmed state
- [ ] Prevent race conditions: block two simultaneous optimistic updates on the same task
- [ ] Write tests for apply, success confirmation, and rollback flows

## Acceptance Criteria
- [ ] Task state changes appear in < 50 ms without waiting for transaction confirmation
- [ ] Optimistic state is visually distinct from confirmed state
- [ ] Failed transactions always rollback with no state inconsistency
- [ ] Concurrent operations on the same task are serialised or rejected
- [ ] Retry after failure produces the correct final state

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Task Dependency Graph Visualizer with Interactive React Flow Canvas",
        "labels": ["frontend","complexity: hard","area: task-management","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Some SoroTask workflows involve tasks that depend on each other's outputs. This issue builds an \
**interactive dependency graph** where users can view, add, and remove task dependencies visually \
on a canvas.

## Why It Matters
Without a visual graph, users cannot understand how their tasks are interconnected. A node-link \
diagram makes the execution topology obvious and directly editable.

## Task Breakdown
- [ ] Evaluate React Flow vs D3-force and justify choice in the PR description
- [ ] Define the dependency data model (adjacency list derived from contract state)
- [ ] Build a `DependencyGraph` component rendering tasks as nodes and dependencies as directed edges
- [ ] Implement interactive features: pan, zoom, node drag-to-reposition
- [ ] Add a details panel on node click: task name, status, last execution, next scheduled run
- [ ] Colour-code nodes by status: active (green), paused (yellow), failed (red), pending (gray)
- [ ] Implement cycle detection — highlight circular dependencies in orange with a warning banner
- [ ] Add "Add Dependency" mode: click source → click target to draw an edge
- [ ] Implement dependency deletion via right-click context menu
- [ ] Support PNG / SVG export of the graph
- [ ] Write tests for cycle detection and graph data transformation logic

## Acceptance Criteria
- [ ] Graph renders correctly for up to 100 tasks without degradation
- [ ] Users can add and remove dependencies via the interactive canvas
- [ ] Circular dependencies are highlighted and blocked from saving
- [ ] Node status colours are accurate and update in real time
- [ ] Default layout has no overlapping nodes

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Real-Time Task Execution Log Streaming via WebSocket",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
Task execution logs are currently loaded as static snapshots. This issue replaces the static log \
view with a **real-time streaming log viewer** that updates as the keeper executes tasks.

## Why It Matters
Operators debugging a failing task need live visibility into what the keeper is doing. Manual \
refresh intervals miss critical log lines and make root-cause analysis unnecessarily hard.

## Task Breakdown
- [ ] Audit the keeper service's logging API — confirm or add a WebSocket / SSE endpoint
- [ ] Implement a `useLogStream` hook managing a WebSocket connection with auto-reconnect (max 5 retries)
- [ ] Build a `LogViewer` component with virtualised scrolling (`@tanstack/react-virtual`)
- [ ] Implement "Follow" mode that auto-scrolls to the latest log entry
- [ ] Add log level colour coding: DEBUG (gray), INFO (white), WARN (yellow), ERROR (red)
- [ ] Implement filtering by log level and keyword search with highlighted matches
- [ ] Add "Pause / Resume stream" toggle
- [ ] Implement log download as `.txt` or `.json`
- [ ] Show a connection status indicator: connected / reconnecting / disconnected
- [ ] Write tests for reconnection logic and log entry parsing

## Acceptance Criteria
- [ ] Logs appear within 500 ms of the keeper emitting them
- [ ] Virtualised list handles 10,000+ lines without frame drops
- [ ] Follow mode correctly tracks the latest entry during fast bursts
- [ ] Filters and search work correctly on the live stream
- [ ] Download exports the complete session log — not just visible lines

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Design Advanced Compound Query Builder for Task Filtering and Search",
        "labels": ["frontend","complexity: hard","area: task-management","area: ux","eta: 2 days"],
        "body": """\
## Overview
As users accumulate tasks, simple keyword search becomes insufficient. This issue builds a \
**compound query builder** supporting multiple criteria combined with AND/OR logic — \
similar to Notion's or Linear's filter system.

## Why It Matters
Power users need to answer questions like "show me all active daily tasks whose last execution \
failed in the past 24 hours." A single search box cannot express this.

## Task Breakdown
- [ ] Design the query model: `{ conditions: Condition[], operator: 'AND'|'OR' }` where `Condition = { field, operator, value }`
- [ ] Build a `FilterBuilder` component with an "Add filter" button opening a condition editor
- [ ] Implement all filterable fields: status, schedule type, target contract, creation date, last run date, success rate
- [ ] Per-field operators: equals, not equals, contains, before/after (dates), greater/less than (numbers)
- [ ] Add saved filters: name, save, and reload compound filters from `localStorage`
- [ ] Serialise active filters to URL query params so filtered views are shareable via link
- [ ] Show an active filter count badge on the filter toggle button
- [ ] Add "Clear all filters" button
- [ ] Debounce filter application by 200 ms to avoid excessive re-renders
- [ ] Write tests for query building, URL serialisation/deserialisation, and filter application logic

## Acceptance Criteria
- [ ] Users can combine up to 10 conditions with AND / OR logic
- [ ] All filter types work correctly and independently
- [ ] Active filters are preserved in the URL and restored on page load
- [ ] Saved filters are retrievable across sessions
- [ ] Filtering 1,000 tasks completes within 100 ms (client-side)

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Drag-and-Drop Task Reordering with Priority Queue Visualization",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
When multiple tasks are due at the same ledger slot, execution order matters. This issue \
implements **drag-and-drop task reordering** using `@dnd-kit/core` with a live priority queue \
visualisation.

## Why It Matters
Without a visual ordering mechanism, users have no control over execution priority for concurrent \
tasks — leaving it entirely to contract internals.

## Task Breakdown
- [ ] Install and configure `@dnd-kit/core` and `@dnd-kit/sortable`
- [ ] Implement drag-and-drop reordering in the `TaskList` component
- [ ] Add visible drag handles to each task card
- [ ] Display a priority number badge on each task that updates live while dragging
- [ ] Implement a drop placeholder showing the exact landing position
- [ ] Build a `PriorityQueueView` sidebar showing the ordered execution queue for the next due ledger slot
- [ ] Sync priority order to the contract on drag-end (with optimistic update + rollback on failure)
- [ ] Handle touch drag on mobile via `@dnd-kit/core` touch sensor
- [ ] Implement full keyboard drag support (Space to grab, arrow keys to move, Space to drop)
- [ ] Write tests for sorting logic and priority number updates

## Acceptance Criteria
- [ ] Tasks reorder via drag-and-drop on desktop and touch on mobile
- [ ] Priority numbers update in real time during the drag
- [ ] Keyboard-only users can reorder tasks without a mouse
- [ ] Priority queue view reflects the new order immediately after the drop
- [ ] Reorder syncs to the contract without breaking other task operations

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Batch Task Operations Panel with Progress Tracking and Undo Support",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
Users managing many tasks need **bulk operations** — pause all, resume selected, cancel batch — \
without doing them one by one. This issue builds a batch operations panel with selection \
management, sequential transaction execution, and undo support.

## Why It Matters
Without bulk operations, pausing 20 tasks requires 20 separate wallet confirmations. A batch panel \
collapses this into a single supervised workflow.

## Task Breakdown
- [ ] Add a checkbox to each task card for individual selection
- [ ] Implement "Select all" / "Select none" / "Select N of M" toggle in the list header
- [ ] Build a `BatchOperationsBar` that appears at the screen bottom when tasks are selected, showing: count + actions (pause, resume, cancel, export)
- [ ] Build confirmation dialogs for destructive batch operations that list all affected task names
- [ ] Implement sequential transaction submission with a live progress indicator ("Submitting 3 of 10…")
- [ ] Implement undo for reversible operations via a 5-second undo toast
- [ ] On partial failure: show a summary dialog identifying which tasks succeeded and which failed
- [ ] Add "Export selected" to download task configs as a JSON file
- [ ] Write tests for selection state management and batch execution logic

## Acceptance Criteria
- [ ] Any combination of tasks can be selected via checkboxes or select-all
- [ ] Batch actions are only shown when valid for all selected tasks
- [ ] Progress is visible during multi-transaction submission
- [ ] Partial failures clearly identify affected tasks
- [ ] Undo works within the 5-second window for reversible operations

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Task Template System with Custom Parameter Schema Editor",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
Experienced users want to save task configurations as **reusable templates** and share them with \
the community. This issue builds a template management system including a schema editor for \
custom parameterised inputs.

## Why It Matters
Templates reduce setup time for common automation patterns dramatically. A "Daily Yield Harvest" \
template lets a user deploy a complex task in under a minute rather than 10.

## Task Breakdown
- [ ] Design the template model: `{ name, description, category, config: TaskConfig, parameterSchema: JSONSchema }`
- [ ] Build a `TemplateGallery` page with categorised browsing and keyword search
- [ ] Implement a `useTemplate` hook for save/load from `localStorage` (contract storage as a future extension)
- [ ] Build a **JSON Schema editor** for defining template parameters: name, type, description, default, validation rules
- [ ] Implement template instantiation: render a dynamic form from the parameter schema
- [ ] Add template import/export as JSON files
- [ ] Implement template forking: clone and edit an existing template
- [ ] Build a preview mode showing the final task config after parameter substitution
- [ ] Write tests for schema validation and parameter substitution logic

## Acceptance Criteria
- [ ] Users can save any completed task form as a template
- [ ] Templates can have custom parameterised schemas
- [ ] The instantiation form validates all schema-defined constraints correctly
- [ ] Templates are importable and exportable as JSON
- [ ] Template gallery displays community templates (mock data for the first implementation)

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Task Version History UI with Side-by-Side Diff Viewer and Rollback",
        "labels": ["frontend","complexity: hard","area: task-management","eta: 2 days"],
        "body": """\
## Overview
When a task's configuration is updated, users need a **version history** of all changes and the \
ability to roll back to any previous configuration. This issue covers the history panel and a \
side-by-side diff viewer.

## Why It Matters
Without version history, a misconfigured update that causes task failures has no recovery path \
visible in the UI — the user must reconstruct the previous config from memory.

## Task Breakdown
- [ ] Fetch all `task_updated` contract events for a given task ID from the Soroban event stream
- [ ] Transform raw event data into a chronological version array: timestamp, author wallet, config snapshot
- [ ] Build a `VersionHistoryPanel` sidebar showing the version timeline
- [ ] Implement a `DiffViewer` component with side-by-side colour-coded diffs (red = removed, green = added)
- [ ] Add a "Restore this version" button that pre-populates the task edit form with the historical config
- [ ] Implement a version comparison mode: select any two versions to compare side by side
- [ ] Show the submitting wallet address for each version (abbreviated + copy-to-clipboard)
- [ ] Write tests for event parsing, version reconstruction, and diff generation

## Acceptance Criteria
- [ ] Version history shows all configuration changes in chronological order
- [ ] Diff viewer highlights every changed field clearly
- [ ] Restoring a version correctly pre-populates the edit form with no missing fields
- [ ] Version comparison works for any two selected versions
- [ ] Wallet addresses are correctly attributed and verified

**ETA: 2 days**
"""},
    # ── DATA VISUALIZATION (6) ────────────────────────────────────────────────
    {
        "title": "[Frontend] Build Real-Time Keeper Performance Dashboard with Live Recharts",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Keeper operators need visibility into their node's performance. This issue builds a \
**real-time performance dashboard** with live-updating Recharts charts showing throughput, \
execution latency, error rates, and queue depth.

## Why It Matters
Without performance metrics, keeper operators are blind — unable to detect degraded performance \
until tasks start failing.

## Task Breakdown
- [ ] Implement a `useKeeperMetrics` hook polling the keeper `/metrics` endpoint every 5 s
- [ ] Parse the Prometheus text format into structured metric objects
- [ ] Build a responsive dashboard grid of metric cards
- [ ] Implement the following Recharts charts:
  - **Throughput** (tasks / min): `LineChart` with 5-minute rolling window
  - **Execution Latency** (p50 / p95 / p99): multi-line `LineChart`
  - **Error Rate**: `AreaChart` with a 5 % threshold reference line
  - **Queue Depth**: `BarChart` showing pending tasks by priority bucket
- [ ] Add summary cards: total tasks executed, 24 h success rate, active task count, keeper uptime
- [ ] Implement chart zoom via click-drag to select a time window
- [ ] Add a "Pause live updates" toggle for detailed inspection
- [ ] Write tests for Prometheus metric parsing and data transformation

## Acceptance Criteria
- [ ] Dashboard loads and renders within 2 s
- [ ] All four charts update every 5 s without a full component re-render
- [ ] Zoom works across all charts simultaneously
- [ ] Pausing live updates freezes charts while data continues to buffer internally
- [ ] All charts are responsive and readable on tablet-sized screens

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Zoomable and Pannable Task Execution Timeline Chart",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Users need to analyse task execution history on a **visual timeline** that supports zooming \
(months down to individual ledger slots) and panning, enabling forensic analysis of execution \
patterns and gaps.

## Why It Matters
A timeline reveals patterns invisible in tabular data: execution clustering, scheduling gaps, and \
correlations between failures and specific time periods.

## Task Breakdown
- [ ] Evaluate D3-timeline, Visx, or a custom Canvas approach for rendering 1,000+ events smoothly
- [ ] Build an `ExecutionTimeline` component with a swimlane layout (one row per task)
- [ ] Implement zoom via scroll wheel and pinch-to-zoom on touch devices
- [ ] Implement horizontal pan via click-drag
- [ ] Add a time axis with dynamic tick density based on zoom level (months → days → hours → minutes)
- [ ] Mark events as coloured dots: green (success), red (failure), orange (retried)
- [ ] Clicking an event opens a popover: transaction hash, ledger number, gas used, result
- [ ] Add a minimap overview at the bottom showing the full timeline with the current viewport highlighted
- [ ] Lazy-load execution events as the user pans (cursor-based pagination)
- [ ] Write tests for time-to-pixel mapping and zoom calculation logic

## Acceptance Criteria
- [ ] Timeline renders correctly for 1,000+ execution events without lag
- [ ] Zoom transitions smoothly through all time granularities
- [ ] Clicking any event shows complete details in a popover
- [ ] Minimap accurately reflects the current viewport position
- [ ] Pinch-zoom and pan work correctly on mobile touch

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Gas Fee Estimation Visualizer with Historical Trend Analysis",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Before creating a task, users want to understand expected fee costs. This issue builds a \
**gas fee visualiser** showing historical fee trends and projecting estimated costs for the \
user's specific task configuration.

## Why It Matters
Fee surprises are a top user complaint in blockchain UIs. Transparent fee estimation builds \
trust and helps users optimise their task configurations to reduce costs.

## Task Breakdown
- [ ] Implement a `useFeeHistory` hook fetching historical fee data from Horizon API for SoroTask contract transactions
- [ ] Build a `FeeHistoryChart` showing fee distribution over the last 30 days (box plot or violin chart)
- [ ] Call Soroban `simulateTransaction` with the user's task config and display the resource footprint
- [ ] Show fee breakdown: base fee, resource fee, and inclusion fee as a stacked bar
- [ ] Build a "Fee Optimiser" panel suggesting config changes to reduce fees (e.g., reducing ledger data footprint)
- [ ] Add a fee alert: warn if the current estimate is > 2× the 7-day median
- [ ] Show fees in both XLM and USD using a Stellar DEX live price feed
- [ ] Write tests for fee parsing, estimate display, and alert threshold logic

## Acceptance Criteria
- [ ] Historical fee chart loads data for the last 30 days
- [ ] Fee estimate reflects the actual `simulateTransaction` result — not a hardcoded guess
- [ ] Fee breakdown is accurate and clearly labelled by component
- [ ] USD conversion updates with live price data
- [ ] Fee alert triggers correctly when the estimate is anomalously high

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Keeper Incentive Payout Analytics Dashboard",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Keeper operators earn incentives for executing tasks. This issue builds an **analytics dashboard** \
showing total earnings, per-task payouts, projected future earnings, and full payout history.

## Why It Matters
Keepers are economically motivated participants. Without a clear earnings dashboard, operators \
cannot evaluate profitability or make informed decisions about which tasks to run.

## Task Breakdown
- [ ] Define the data model for incentive events sourced from Soroban contract event logs
- [ ] Build an `EarningsSummaryCard` showing: total earned (all time), earned this week, pending unclaimed, tasks executed
- [ ] Implement a `PayoutHistoryTable` with sortable columns: task ID, amount, timestamp, transaction hash
- [ ] Build a `ProjectedEarningsChart` showing weekly projected earnings based on current active tasks
- [ ] Implement an earnings breakdown by task as a donut chart showing per-task contribution
- [ ] Add CSV export for the full payout history table
- [ ] Implement a "Claim Incentive" button with a transaction confirmation flow
- [ ] Write tests for earnings calculation and projection logic

## Acceptance Criteria
- [ ] All earnings figures are accurate against on-chain event data
- [ ] Projection model is clearly labelled as an estimate
- [ ] CSV export downloads correctly formatted data
- [ ] Claim flow submits a transaction and updates the dashboard after confirmation
- [ ] Dashboard loads within 3 s including historical event fetches

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Soroban Network Health Monitor with RPC Latency Heatmap",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Users and operators need to see the current health of the Soroban network and RPC endpoints. \
This issue builds a **network health monitor** with an RPC latency heatmap, block production \
rate chart, and aggregate status banner.

## Why It Matters
When the network is degraded, tasks may execute late or fail. A health dashboard helps users \
distinguish network issues from task configuration issues.

## Task Breakdown
- [ ] Implement a `useNetworkHealth` hook pinging multiple Soroban RPC endpoints every 30 s
- [ ] Build a `LatencyHeatmap` component (hour × day grid coloured by average latency per cell)
- [ ] Implement a `BlockProductionChart` showing ledger close times over the last 6 hours
- [ ] Add an RPC endpoint status list: URL, current latency, status (healthy / degraded / down), uptime %
- [ ] Implement failover detection: if the primary RPC is > 500 ms, suggest switching to a backup endpoint
- [ ] Add a network status banner at the top of the dashboard (green / yellow / red) based on aggregate health
- [ ] Store historical health data in `IndexedDB` for up to 7 days
- [ ] Write tests for latency calculation and health status determination logic

## Acceptance Criteria
- [ ] Heatmap shows correct latency data for each hour-day cell
- [ ] Network status banner updates within 30 s of a health change
- [ ] Failover suggestion appears correctly when the primary endpoint exceeds the latency threshold
- [ ] Historical data is persisted and loaded correctly from IndexedDB
- [ ] All charts are responsive and readable on mobile

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Task Success/Failure Rate Sunburst Chart with Category Drilldown",
        "labels": ["frontend","complexity: hard","area: data-visualization","eta: 2 days"],
        "body": """\
## Overview
Users need a bird's-eye view of their task portfolio's health, grouped by category. This issue \
builds an **interactive sunburst chart** where the inner ring represents categories and the outer \
ring represents individual tasks, coloured by success rate.

## Why It Matters
A sunburst chart allows users to quickly identify which categories or individual tasks are \
underperforming — a pattern that is invisible in a flat table view.

## Task Breakdown
- [ ] Implement the sunburst using D3 or Visx (justify the choice in the PR description)
- [ ] Build a two-level hierarchy: inner ring = task category, outer ring = individual tasks
- [ ] Colour coding by success rate: green (> 95 %), yellow (80–95 %), orange (50–80 %), red (< 50 %)
- [ ] Implement click-to-drilldown: clicking a category zooms in to show only that category's tasks
- [ ] Show a tooltip on hover: task name, success rate, total executions, last 24 h status
- [ ] Implement breadcrumb navigation for the drilled-down state
- [ ] Add a legend and colour scale reference
- [ ] Animate transitions between zoom levels using D3 transitions
- [ ] Write tests for hierarchy data transformation and colour calculation logic

## Acceptance Criteria
- [ ] Sunburst renders correctly for up to 200 tasks across 10 categories
- [ ] Click-to-drilldown correctly filters to the selected category
- [ ] Hover tooltips show accurate, up-to-date data
- [ ] Colour mapping is consistent with the legend
- [ ] Zoom transitions are smooth (60 fps)

**ETA: 2 days**
"""},
    # ── PERFORMANCE (6) ───────────────────────────────────────────────────────
    {
        "title": "[Frontend] Implement Virtualised Infinite Scroll for Task and Execution Log Lists",
        "labels": ["frontend","complexity: hard","area: performance","eta: 2 days"],
        "body": """\
## Overview
As users accumulate thousands of tasks and execution logs, rendering them all at once causes \
severe performance degradation. This issue replaces flat list rendering with **virtualised \
infinite scroll** using `@tanstack/react-virtual`.

## Why It Matters
DOM virtualisation renders only the visible rows plus a small buffer, keeping the DOM element count \
constant regardless of dataset size. The result is smooth scrolling through arbitrarily large lists.

## Task Breakdown
- [ ] Install `@tanstack/react-virtual` and integrate it with the `TaskList` component
- [ ] Implement cursor-based pagination API calls (e.g., with `useInfiniteQuery`)
- [ ] Configure the virtualiser with correct item height estimation (handle variable-height task cards)
- [ ] Trigger "fetch next page" when the user scrolls within 200 px of the list bottom
- [ ] Show a loading spinner at the list bottom during page fetches
- [ ] Show "All tasks loaded (N total)" when the last page is reached
- [ ] Apply the same virtualisation to the `LogViewer` component
- [ ] Preserve scroll position when the user navigates away and returns
- [ ] Measure and document FPS for a 10,000 item list before and after
- [ ] Write tests for pagination trigger and virtualiser configuration

## Acceptance Criteria
- [ ] Task list maintains 60 fps scrolling for 10,000+ items
- [ ] New pages are fetched automatically before the user reaches the end
- [ ] Scroll position is preserved on back navigation
- [ ] Log viewer handles 50,000+ lines without frame drops
- [ ] All existing task card interactions work correctly within the virtualised list

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Granular Code-Splitting Strategy with Route and Component-Level Lazy Loading",
        "labels": ["frontend","complexity: hard","area: performance","eta: 2 days"],
        "body": """\
## Overview
The frontend bundle is currently monolithic. This issue designs and implements a **granular \
code-splitting strategy** using Next.js dynamic imports and React `lazy/Suspense` to reduce the \
initial load bundle size significantly.

## Why It Matters
Code splitting defers loading of code that is not needed immediately. Heavy dependencies (D3 charts, \
diff viewer, cron builder) should load only when the user navigates to views that need them.

## Task Breakdown
- [ ] Run `ANALYZE=true next build` and document the current bundle composition by chunk
- [ ] Identify the top 10 largest modules and design a splitting strategy for each
- [ ] Implement route-level splitting: each page in `app/` gets its own chunk
- [ ] Apply `dynamic(() => import(...), { ssr: false })` to: D3/Recharts components, cron builder, diff viewer, wallet connect modal
- [ ] Add `<Suspense>` boundaries with appropriate skeleton fallbacks for each lazily loaded section
- [ ] Add `loading.tsx` files for route-level loading states
- [ ] Preload critical routes on hover using `router.prefetch`
- [ ] Document bundle size before and after in the PR (target: initial JS < 150 KB gzipped)
- [ ] Write tests verifying lazy components load correctly with Suspense

## Acceptance Criteria
- [ ] Initial JavaScript bundle size is reduced by ≥ 40 % from the baseline
- [ ] No visible regression in any page's functionality
- [ ] All lazy components show correct skeleton loading states
- [ ] Route transitions feel instant due to prefetching on hover
- [ ] Bundle analysis report is included in the PR

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Service Worker for Offline Caching of Task Data and Contract ABIs",
        "labels": ["frontend","complexity: hard","area: performance","eta: 2 days"],
        "body": """\
## Overview
SoroTask users in regions with unreliable internet need the app to work **offline in read-only mode**. \
This issue implements a service worker that caches task data, contract ABIs, and static assets.

## Why It Matters
A service worker ensures operators can always see their last-known task state even when connectivity \
is temporarily lost, and write operations are queued for sync when back online.

## Task Breakdown
- [ ] Configure `next-pwa` (or a custom service worker) for the Next.js app
- [ ] Implement cache-first strategy for static assets (JS, CSS, fonts, images)
- [ ] Implement stale-while-revalidate for task list and execution log API responses
- [ ] Cache contract ABIs permanently with version-based cache invalidation
- [ ] Implement a `BackgroundSync` queue for write operations (create, pause, cancel) that executes when online
- [ ] Build an `OfflineBanner` component appearing when offline, listing pending queued operations
- [ ] Implement periodic cache cleanup for entries older than 7 days
- [ ] Test offline functionality using Chrome DevTools Network throttling
- [ ] Write tests for cache strategies and background sync queue logic

## Acceptance Criteria
- [ ] App loads and shows last-known data with no internet connection
- [ ] Write operations made offline are queued and synced automatically when connectivity is restored
- [ ] `OfflineBanner` clearly communicates offline status and pending operations
- [ ] Cache does not grow unboundedly (7-day cleanup is effective)
- [ ] App behaves normally when connection is restored — no stale data issues

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Migrate Dashboard Static Sections to React Server Components (RSC)",
        "labels": ["frontend","complexity: hard","area: performance","eta: 2 days"],
        "body": """\
## Overview
The SoroTask dashboard renders entirely on the client. This issue migrates **static and data-fetching \
sections** to React Server Components (RSC) to reduce client JavaScript and improve Time to First Byte.

## Why It Matters
RSC allows data fetching and rendering to happen on the server, sending pre-rendered HTML to the \
client. This eliminates the loading flash and reduces the JavaScript payload for non-interactive \
sections.

## Task Breakdown
- [ ] Audit all dashboard components and classify each as Server (no interactivity) or Client (uses `useState`, event handlers, wallet)
- [ ] Migrate identified server components: remove `'use client'` directive, convert to `async/await` data fetching
- [ ] Implement `<Suspense>` boundaries with skeleton fallbacks for each server component
- [ ] Verify all wallet-dependent components remain correctly marked `'use client'`
- [ ] Implement streaming SSR with `loading.tsx` so the page shell renders before data arrives
- [ ] Measure and document TTFB and LCP improvements (using Lighthouse or WebPageTest)
- [ ] Ensure no `window` / `document` / browser APIs are accessed in server components
- [ ] Write tests validating correct server/client component boundaries

## Acceptance Criteria
- [ ] All static dashboard sections are server components with no client JavaScript
- [ ] TTFB improves by ≥ 200 ms compared to the baseline
- [ ] No hydration mismatch errors in the browser console
- [ ] Wallet-dependent sections remain fully functional
- [ ] Streaming SSR shows the page shell immediately with content streaming in progressively

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Fine-Grained Zustand Store Slices to Prevent Unnecessary Re-Renders",
        "labels": ["frontend","complexity: hard","area: performance","eta: 2 days"],
        "body": """\
## Overview
Global state is ad-hoc, causing unnecessary component re-renders when unrelated state changes. \
This issue designs and implements a **fine-grained Zustand store** with slice-based architecture \
to minimise re-renders across the dashboard.

## Why It Matters
When a component subscribes to a large state object, it re-renders on every change to that object. \
Zustand's selector pattern and slice architecture lets components subscribe only to the precise \
state they need.

## Task Breakdown
- [ ] Install Zustand and design the slice architecture: `walletSlice`, `taskSlice`, `logSlice`, `uiSlice`, `metricsSlice`
- [ ] Implement each slice with correct TypeScript types using Zustand's `StateCreator`
- [ ] Refactor all existing `useState` / prop-drilling patterns to use the appropriate slice
- [ ] Implement selector memoisation using `useShallow` for object selections
- [ ] Enable Redux DevTools middleware for Zustand to aid debugging
- [ ] Profile the app before and after using React DevTools Profiler — document re-render counts
- [ ] Implement derived state using computed selectors or `useMemo` at component level
- [ ] Write tests for each slice's actions and selectors

## Acceptance Criteria
- [ ] No component re-renders more than once per user action (verified via React Profiler)
- [ ] All store slices are fully TypeScript-typed
- [ ] Redux DevTools shows all state changes with clear labels
- [ ] Re-render count for the task list is reduced by ≥ 50 % from the baseline
- [ ] All existing app functionality works identically after the refactor

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Integrate Bundle Analyser with Automated Performance Regression CI Checks",
        "labels": ["frontend","complexity: hard","area: performance","area: testing","eta: 2 days"],
        "body": """\
## Overview
Without automated checks, bundle size regressions go unnoticed until they impact users. This issue \
integrates `@next/bundle-analyzer` and sets up a **CI performance budget check** that fails the \
build when bundle size exceeds defined thresholds.

## Why It Matters
Performance budgets enforce a contract on what is acceptable. When a PR inadvertently adds a heavy \
dependency, the CI fails and reports exactly what caused the increase — before it reaches production.

## Task Breakdown
- [ ] Install and configure `@next/bundle-analyzer` in `next.config.ts`
- [ ] Generate a baseline bundle report and commit it as `bundle-baseline.json`
- [ ] Create `scripts/check-bundle-size.js` comparing the current build against the baseline
- [ ] Define performance budgets: initial JS < 150 KB gzipped, per-route chunks < 50 KB, CSS < 20 KB
- [ ] Add the size check to the GitHub Actions workflow, failing on regression > 10 %
- [ ] Add a PR comment bot that posts a bundle size diff table (base vs HEAD)
- [ ] Configure `lighthouse-ci` for automated Core Web Vitals checks on every PR
- [ ] Document the performance budget values and rationale in `CONTRIBUTING.md`

## Acceptance Criteria
- [ ] CI fails correctly when a PR introduces a bundle size regression > 10 %
- [ ] PR comment accurately reports the size diff breakdown by chunk
- [ ] Lighthouse CI reports are accessible from PR checks
- [ ] Baseline is easy to update when intentional size increases are merged
- [ ] All CI jobs complete within 5 minutes

**ETA: 2 days**
"""},
    # ── ACCESSIBILITY & UX (7) ────────────────────────────────────────────────
    {
        "title": "[Frontend] Implement Full Keyboard Navigation and ARIA Support Across All Dashboard Views",
        "labels": ["frontend","complexity: hard","area: accessibility","eta: 2 days"],
        "body": """\
## Overview
The SoroTask dashboard is not navigable by keyboard alone and lacks proper ARIA attributes. \
This issue performs a **comprehensive accessibility audit and remediation** to reach WCAG 2.1 AA \
compliance across all dashboard views.

## Why It Matters
Keyboard navigation and screen reader support are legally required in many jurisdictions and \
ethically essential. Blockchain interfaces often neglect accessibility — SoroTask should set a \
high bar.

## Task Breakdown
- [ ] Run an automated accessibility audit using `@axe-core/react` and document all violations
- [ ] Add `role`, `aria-label`, `aria-describedby`, and `aria-live` attributes to all interactive elements
- [ ] Implement focus trapping in all modals and dialogs using `focus-trap-react`
- [ ] Ensure all custom components have visible focus rings (`:focus-visible` styles, not `outline: none`)
- [ ] Implement `aria-live` regions for toast notifications and real-time log updates
- [ ] Fix tab order to be logical and sequential across all views
- [ ] Add keyboard shortcuts for common actions (e.g., `N` = new task, `Escape` = close modal)
- [ ] Implement a keyboard shortcut reference modal triggered by pressing `?`
- [ ] Test with VoiceOver (macOS) and NVDA (Windows) screen readers
- [ ] Write automated accessibility tests using `jest-axe`

## Acceptance Criteria
- [ ] Zero WCAG 2.1 AA violations reported by `axe-core` on all pages
- [ ] All modals correctly trap focus and return focus to the trigger on close
- [ ] Screen reader announcements are correct for all dynamic content changes
- [ ] All interactive elements are reachable and operable via keyboard alone
- [ ] Keyboard shortcut reference modal is accurate and functional

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Onboarding Wizard with Progressive Disclosure for New Keeper Operators",
        "labels": ["frontend","complexity: hard","area: ux","eta: 2 days"],
        "body": """\
## Overview
New users landing on SoroTask face a steep learning curve. This issue builds an **onboarding wizard** \
that guides new Keeper operators step by step through wallet connection, keeper node setup, and first \
task creation — using progressive disclosure to reveal complexity only as needed.

## Why It Matters
Without onboarding, the majority of first-time visitors bounce without creating a single task. A \
guided wizard dramatically improves activation rates.

## Task Breakdown
- [ ] Design the onboarding flow: Welcome → Connect Wallet → Understanding Keepers → Set Up Keeper Node → Create First Task → Done
- [ ] Build an `OnboardingOverlay` component shown on first visit (detected via `localStorage` flag)
- [ ] Implement spotlight highlighting: dim the background and highlight the relevant UI element at each step
- [ ] Add contextual help per step: text explanation + link to docs + video embed where available
- [ ] Implement progress persistence: resume from the correct step if the user closes and reopens the app
- [ ] Add "Skip onboarding" with a confirmation dialog explaining what will be missed
- [ ] Build a "Restart onboarding" option in the Settings page
- [ ] Implement animated step transitions
- [ ] Document the onboarding flow in a flowchart in `docs/`

## Acceptance Criteria
- [ ] New users see the onboarding overlay on their first visit only
- [ ] Each step clearly highlights the relevant UI element with a spotlight
- [ ] Progress is saved and correctly resumed across sessions
- [ ] "Skip" requires confirmation and explains the trade-off
- [ ] Onboarding can be restarted from Settings at any time

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Skeleton Loading States for All Async Data Surfaces",
        "labels": ["frontend","complexity: hard","area: ux","eta: 2 days"],
        "body": """\
## Overview
Async data loading currently shows blank areas or raw spinners. This issue replaces all loading \
states with **accurate skeleton screens** that match the shape and size of the eventual content, \
eliminating layout shift and improving perceived performance.

## Why It Matters
Skeleton screens reduce perceived loading time and prevent jarring layout shifts. Users feel the \
app is more responsive when they see content taking shape rather than staring at blank space.

## Task Breakdown
- [ ] Audit every component that fetches async data and catalogue all loading states
- [ ] Build a reusable `Skeleton` primitive with rectangular, circular, and text variants, all with a shimmer animation
- [ ] Build skeleton variants for: `TaskCard`, `LogEntry`, `MetricChart`, `WalletBalance`, `ExecutionTimeline`
- [ ] Implement Suspense-based rendering: wrap each async component in `<Suspense fallback={<SkeletonVariant />}>`
- [ ] Ensure skeleton dimensions match loaded content within 10 px to prevent layout shift
- [ ] Implement a minimum display time of 300 ms to prevent flash-of-skeleton for fast loads
- [ ] Implement error state variants for each component (skeleton replaced by error message + retry)
- [ ] Test all skeletons using Chrome DevTools Network throttling (Slow 3G)
- [ ] Write snapshot tests for all skeleton variants

## Acceptance Criteria
- [ ] No component renders a blank area or raw spinner for async data
- [ ] Skeleton dimensions are within 10 px of actual content dimensions
- [ ] Cumulative Layout Shift (CLS) is zero during the loading → loaded transition
- [ ] All error states display actionable messages with retry options
- [ ] Shimmer animation renders at 60 fps

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Comprehensive Error Boundary System with Contextual Recovery Actions",
        "labels": ["frontend","complexity: hard","area: ux","eta: 2 days"],
        "body": """\
## Overview
A JavaScript error in any component currently crashes the entire app. This issue implements a \
**granular error boundary system** that contains failures to the affected component, provides \
context-specific recovery options, and reports errors to a monitoring service.

## Why It Matters
A chart failing to load should never take down the task list or wallet connector. Granular boundaries \
ensure a partial failure is a non-event for unrelated sections of the dashboard.

## Task Breakdown
- [ ] Create a reusable `ErrorBoundary` component with a customisable fallback UI slot
- [ ] Place granular boundaries around each major dashboard section independently
- [ ] Design contextual fallback UIs: "Chart failed to load — Retry / Report" style
- [ ] Implement error reporting integration (Sentry or a `console.error` → server log stub)
- [ ] Include error metadata in reports: component name, error message, stack trace, anonymised wallet address
- [ ] Implement auto-retry: attempt to re-render the failed boundary after 3 s (once only)
- [ ] Build a full-page error boundary for unrecoverable errors with a "Reload app" button
- [ ] Handle async errors in `useEffect` (these bypass React error boundaries) via a global `unhandledrejection` listener
- [ ] Write tests that deliberately throw errors and verify the boundary catches them correctly

## Acceptance Criteria
- [ ] A crashed chart or panel does not affect any other dashboard section
- [ ] Each error boundary shows a contextually relevant fallback UI with recovery options
- [ ] All caught errors are reported to the monitoring integration
- [ ] Auto-retry works for transient errors (network timeouts)
- [ ] The full-page boundary appears only for truly unrecoverable situations

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Dark/Light Theme Switcher with System Preference Sync and FOUC Prevention",
        "labels": ["frontend","complexity: hard","area: ux","eta: 2 days"],
        "body": """\
## Overview
The dashboard is currently dark-only. This issue implements a **theme switcher** supporting Dark, \
Light, and System (OS preference) modes, built on CSS custom properties and persisted across sessions \
without a Flash of Unstyled Content (FOUC).

## Why It Matters
Many users work in bright environments where a light theme is essential. Forcing dark mode excludes \
these users and causes eye strain.

## Task Breakdown
- [ ] Design the full light mode colour palette complementing the existing dark mode colours
- [ ] Extend `globals.css` with a `:root[data-theme="light"]` block defining all light mode CSS variables
- [ ] Build a `ThemeProvider` React context managing the active theme state
- [ ] Implement a `ThemeToggle` component with a three-way toggle: Light / System / Dark
- [ ] Persist theme preference in `localStorage` under the key `sorotask-theme`
- [ ] On initial load: read `localStorage`, fall back to `window.matchMedia('prefers-color-scheme')`
- [ ] Subscribe to `prefers-color-scheme` change events to update System mode in real time
- [ ] Prevent FOUC by inlining the theme initialisation script in `<head>` (before React hydration)
- [ ] Write visual regression tests comparing dark and light screenshots for all pages

## Acceptance Criteria
- [ ] All three theme modes apply immediately without a page reload
- [ ] System mode tracks the OS preference in real time
- [ ] Theme preference survives page refresh and new tabs
- [ ] No FOUC on initial page load
- [ ] Light mode passes WCAG AA contrast ratios for all text/background combinations

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Fully Responsive Mobile Layout for Task Management Dashboard",
        "labels": ["frontend","complexity: hard","area: ux","eta: 2 days"],
        "body": """\
## Overview
The SoroTask dashboard is designed for desktop only. This issue performs a **complete responsive \
redesign** making every dashboard view fully usable on mobile devices (320–768 px viewport widths).

## Why It Matters
Many keeper operators check their dashboards on mobile. A responsive layout is not just about \
fitting content — it requires redesigning navigation patterns and interaction models for touch.

## Task Breakdown
- [ ] Audit the current layout and identify every breakpoint where it breaks on mobile
- [ ] Design a mobile-first layout using Tailwind v4 responsive prefixes (`sm:`, `md:`, `lg:`)
- [ ] Replace the desktop sidebar with a bottom navigation bar on mobile (4–5 key actions)
- [ ] Implement a slide-out drawer for secondary navigation and settings on mobile
- [ ] Stack all multi-column grids to single-column on mobile
- [ ] Convert charts to simplified mobile variants (single metric card instead of full chart on small screens)
- [ ] Enforce minimum touch target sizes (44 × 44 px) for all interactive elements
- [ ] Add swipe gestures on task cards: swipe left for quick actions (pause, view details)
- [ ] Test on real devices: iPhone SE (smallest), iPhone 14 Pro, Samsung Galaxy S23
- [ ] Write visual regression tests at 375 px, 768 px, and 1280 px viewports

## Acceptance Criteria
- [ ] All dashboard views are fully functional on a 375 px viewport
- [ ] Bottom navigation correctly replaces the sidebar on mobile
- [ ] Charts are readable and interactive on mobile
- [ ] All touch targets meet the 44 × 44 px minimum
- [ ] Swipe actions work correctly on iOS and Android

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Multi-Language i18n with Dynamic Locale Loading and RTL Support",
        "labels": ["frontend","complexity: hard","area: ux","area: accessibility","eta: 2 days"],
        "body": """\
## Overview
SoroTask has a global user base. This issue implements **multi-language i18n** with dynamic locale \
file loading, Next.js locale routing, and full RTL (right-to-left) layout support for Arabic \
and Hebrew.

## Why It Matters
English-only UIs exclude non-English speakers. RTL support is non-trivial and must be built into \
the layout from the start — retrofitting it later is significantly more expensive.

## Task Breakdown
- [ ] Set up `next-intl` with locale detection middleware
- [ ] Define supported locales: `en`, `es`, `fr`, `ar`, `zh`
- [ ] Extract all hardcoded UI strings to translation files (`messages/en.json`, etc.)
- [ ] Implement dynamic locale loading — only load the active locale's translation file on demand
- [ ] Add a locale switcher in the dashboard header / settings
- [ ] Implement RTL support: use CSS logical properties (`margin-inline-start` instead of `margin-left`) throughout
- [ ] Set `dir="rtl"` on `<html>` when Arabic is the active locale
- [ ] Mirror all directional icon orientations for RTL (arrows, chevrons)
- [ ] Document the contribution workflow for adding a new locale
- [ ] Write tests verifying correct string resolution for all supported locales

## Acceptance Criteria
- [ ] All UI strings are translatable with no hardcoded text remaining
- [ ] Locale switches instantly without a page reload
- [ ] RTL layout is correct with no mirroring issues for the Arabic locale
- [ ] Dynamic loading is verified in the Network tab (only the active locale file is loaded)
- [ ] Missing translation keys fall back to English gracefully

**ETA: 2 days**
"""},
    # ── TESTING (5) ───────────────────────────────────────────────────────────
    {
        "title": "[Frontend] Build Comprehensive Unit Test Suite with Jest and React Testing Library",
        "labels": ["frontend","complexity: hard","area: testing","eta: 2 days"],
        "body": """\
## Overview
The frontend currently has minimal test coverage. This issue builds a **comprehensive unit test \
suite** using Jest and React Testing Library covering all components, hooks, and utility functions.

## Why It Matters
High test coverage prevents regressions in a rapidly evolving codebase. RTL's "test behaviour, not \
implementation" philosophy ensures tests remain valuable as components are refactored.

## Task Breakdown
- [ ] Run `jest --coverage` and document the baseline coverage percentages
- [ ] Write tests for all custom hooks: `useWalletSession`, `useTransactionPoller`, `useLogStream`, etc. using `renderHook`
- [ ] Write component tests for all major UI components using RTL `render` + `userEvent`
- [ ] Mock all external dependencies: wallet adapters, RPC calls, WebSocket connections
- [ ] Implement shared test utilities: `renderWithProviders()` wrapping all context providers
- [ ] Write tests for all utility functions: fee parsing, event parsing, diff generation, etc.
- [ ] Configure coverage thresholds in `jest.config.js`: statements 80 %, branches 75 %, functions 85 %
- [ ] Configure CI to fail if coverage drops below the thresholds
- [ ] Write negative test cases: error states, edge cases, empty data, loading states

## Acceptance Criteria
- [ ] Statement coverage ≥ 80 %, branch coverage ≥ 75 %
- [ ] All hooks are tested with `renderHook` from RTL
- [ ] No component tests use implementation-detail testing patterns
- [ ] All tests pass in CI (GitHub Actions)
- [ ] Test suite completes in under 60 s

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Playwright E2E Test Suite Covering Critical User Journeys",
        "labels": ["frontend","complexity: hard","area: testing","eta: 2 days"],
        "body": """\
## Overview
End-to-end tests validate that the entire system works correctly from the user's perspective. \
This issue builds a **Playwright E2E test suite** covering the critical user journeys in SoroTask.

## Why It Matters
Unit tests cannot catch integration issues between the wallet, contract, and UI layers. E2E tests \
give confidence that the full stack works together as expected.

## Task Breakdown
- [ ] Set up Playwright with `npx playwright install` and configure `playwright.config.ts`
- [ ] Implement a `mockWallet` fixture simulating a Freighter wallet extension
- [ ] Implement a `mockRPC` fixture intercepting Soroban RPC calls and returning deterministic responses
- [ ] Write E2E tests for these critical journeys:
  - Connect wallet → dashboard loads with account data
  - Create task → confirm in wallet → task appears in list
  - Pause task → optimistic update → confirmed pause
  - View execution logs → filter by level → download log
  - Switch account → all data updates correctly
- [ ] Implement page object models (POMs) for all major pages
- [ ] Configure Playwright to run headless Chromium in GitHub Actions CI
- [ ] Add visual diff assertions using Playwright's built-in screenshot comparison

## Acceptance Criteria
- [ ] All 5 critical journeys are covered by E2E tests
- [ ] Tests complete in under 3 minutes in CI
- [ ] Mock wallet and RPC fixtures work reliably with no flakiness
- [ ] Visual diffs catch layout regressions at 1280 px and 375 px viewports
- [ ] Tests are fully independent (no shared state between test files)

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Storybook Component Library with Interactive Stories and A11y Addon",
        "labels": ["frontend","complexity: hard","area: testing","area: ux","eta: 2 days"],
        "body": """\
## Overview
Without a component library, contributors struggle to understand the available UI building blocks. \
This issue sets up **Storybook 8** and writes interactive stories for all components, including the \
a11y addon for accessibility testing.

## Why It Matters
Storybook provides an isolated environment to develop, test, and document components. Each story \
renders a component in a specific state, making it easy to develop and review without running the \
full app.

## Task Breakdown
- [ ] Install and configure Storybook 8 for Next.js with the `@storybook/nextjs` framework
- [ ] Install `@storybook/addon-a11y` and configure it to run on all stories
- [ ] Install `@storybook/addon-interactions` for automated interaction testing
- [ ] Write stories for all components covering: default, loading, error, empty, and interactive states
- [ ] Implement a global decorator providing mock `WalletProvider`, `ThemeProvider`, and `QueryProvider`
- [ ] Add `argTypes` to all components for interactive controls in the Storybook UI
- [ ] Configure Storybook to deploy to GitHub Pages on every merge to `main`
- [ ] Write interaction tests in stories using `@storybook/test` for complex components
- [ ] Add JSDoc/TSDoc to all component props for auto-generated Storybook docs

## Acceptance Criteria
- [ ] All major components have Storybook stories covering all documented states
- [ ] Zero accessibility violations in any story
- [ ] Storybook deploys correctly to GitHub Pages
- [ ] All stories render without errors in the Storybook environment
- [ ] Interactive controls work correctly in all stories

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Visual Regression Testing with Chromatic CI Integration",
        "labels": ["frontend","complexity: hard","area: testing","eta: 2 days"],
        "body": """\
## Overview
CSS changes can silently break component appearance without anyone noticing. This issue integrates \
**Chromatic** (visual regression testing) with the Storybook setup to automatically detect visual \
regressions in pull requests.

## Why It Matters
Visual regressions are invisible to unit tests. Chromatic captures screenshots of every story and \
requires explicit human approval for any visual change — preventing accidental regressions from \
reaching production.

## Task Breakdown
- [ ] Create a Chromatic account and obtain the project token
- [ ] Store the Chromatic token as a GitHub Actions secret (`CHROMATIC_PROJECT_TOKEN`)
- [ ] Add a `chromatic.yml` GitHub Actions workflow that runs on every PR
- [ ] Configure Chromatic to test only stories affected by changed files (TurboSnap)
- [ ] Set up the Chromatic GitHub app to post PR status checks
- [ ] Configure Chromatic to require at least one reviewer approval for visual changes
- [ ] Add a branch protection rule requiring the Chromatic check to pass before merge
- [ ] Document the visual review process in `CONTRIBUTING.md`

## Acceptance Criteria
- [ ] Chromatic CI runs on every PR and posts a status check
- [ ] Visual changes in any story block merge until approved by a reviewer
- [ ] TurboSnap correctly identifies affected stories (CI runtime < 5 minutes)
- [ ] Chromatic baseline updates correctly on merge to `main`
- [ ] The project token is not exposed in any public file

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Mock Soroban RPC Server for Deterministic Frontend Integration Tests",
        "labels": ["frontend","complexity: hard","area: testing","area: contract-integration","eta: 2 days"],
        "body": """\
## Overview
Frontend tests that hit real Soroban RPC endpoints are slow, flaky, and network-dependent. \
This issue builds a **mock Soroban RPC server** returning deterministic responses, enabling \
fast and reliable integration tests for every code path.

## Why It Matters
Deterministic tests are the foundation of a trustworthy CI pipeline. A mock server also \
enables testing error conditions and unusual network states that are impossible to reproduce \
reliably against a live node.

## Task Breakdown
- [ ] Audit all Soroban RPC methods used by the frontend: `simulateTransaction`, `sendTransaction`, `getTransaction`, `getLedgerEntries`, `getEvents`
- [ ] Build a mock server using `msw` (Mock Service Worker) or a lightweight Express server
- [ ] Implement mock handlers for all audited RPC methods with configurable response payloads
- [ ] Create fixture files for common scenarios: task registration success, task execution event, insufficient fee error
- [ ] Implement a control API: `POST /mock-rpc/configure` to set the next response dynamically per test
- [ ] Implement error simulation: configurable delay, random failure rate, and specific error codes
- [ ] Integrate the mock server into Jest integration tests via `jest.globalSetup`
- [ ] Integrate into Playwright E2E tests via the `mockRPC` fixture
- [ ] Document all available fixtures and how to add new ones in `CONTRIBUTING.md`

## Acceptance Criteria
- [ ] All frontend integration tests run entirely against the mock server with zero real network calls
- [ ] Mock server starts and stops in under 1 s for Jest
- [ ] All 5 audited RPC methods are mocked with ≥ 3 fixture variants each
- [ ] Error simulation correctly triggers all frontend error handling paths
- [ ] Integration tests are ≥ 10× faster than equivalent tests against a real RPC endpoint

**ETA: 2 days**
"""},
    # ── SECURITY (4) ──────────────────────────────────────────────────────────
    {
        "title": "[Frontend] Implement Content Security Policy Headers with Nonce-Based Inline Script Control",
        "labels": ["frontend","complexity: hard","area: security","eta: 2 days"],
        "body": """\
## Overview
SoroTask has no Content Security Policy (CSP) headers, leaving it open to cross-site scripting \
(XSS) attacks. This issue configures **strict CSP headers** in Next.js with nonce-based inline \
script control.

## Why It Matters
CSP headers tell the browser which resource origins are trusted. A strict CSP blocks malicious \
scripts injected via XSS from executing — significantly reducing the attack surface in a \
high-stakes financial application.

## Task Breakdown
- [ ] Audit all external resource origins loaded by the app (fonts, analytics, RPC endpoints, CDNs)
- [ ] Implement a nonce generator in `middleware.ts` that generates a unique cryptographic nonce per request
- [ ] Pass the nonce to the Next.js rendering context and apply it to all inline `<script>` and `<style>` tags
- [ ] Configure CSP directives in `next.config.ts` via `headers()`:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-{nonce}'`
  - `style-src 'self' 'nonce-{nonce}' fonts.googleapis.com`
  - `connect-src 'self' *.stellar.org *.soroban.io`
  - `img-src 'self' data:`
- [ ] Add `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin`
- [ ] Set up `Content-Security-Policy-Report-Only` mode first for monitoring before enforcing
- [ ] Write tests verifying all security headers are present in every response

## Acceptance Criteria
- [ ] CSP headers are present on all pages with correct directives
- [ ] No CSP violations appear in the browser console during normal app usage
- [ ] Nonce is unique per request and correctly applied to all inline scripts
- [ ] All additional security headers (`X-Frame-Options`, etc.) are present
- [ ] CSP blocks injected `<script>` tags from unauthorised origins

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build XSS-Safe Contract Address and Parameter Input Sanitization Layer",
        "labels": ["frontend","complexity: hard","area: security","eta: 2 days"],
        "body": """\
## Overview
User-supplied inputs — contract addresses, function parameters, task names — are rendered in the UI \
without sanitisation, creating potential XSS vectors. This issue builds a **robust input sanitisation \
layer** for all contract-related inputs.

## Why It Matters
In a blockchain application, an XSS attack could silently redirect a transaction signing request to \
a malicious contract — causing irreversible financial loss. Sanitisation is non-negotiable.

## Task Breakdown
- [ ] Audit all input fields and dynamic display points where user-supplied data is rendered
- [ ] Install `DOMPurify` for sanitising any HTML-rendered content
- [ ] Implement a `sanitize(value: string): string` utility wrapping DOMPurify with a strict allowlist (no `<script>`, no event handlers)
- [ ] Apply the sanitiser to all displays of user-supplied strings: task names, descriptions, parameter values
- [ ] Implement contract address validation: Stellar StrKey format check before display or submission
- [ ] Implement Soroban function parameter type validation against the contract ABI schema
- [ ] Build a `useFormSanitizer` hook applying sanitisation to all `react-hook-form` field values on change
- [ ] Write security-focused tests: attempt to inject `<script>`, `onerror`, and `javascript:` payloads and verify they are blocked
- [ ] Document the sanitisation strategy in `SECURITY.md`

## Acceptance Criteria
- [ ] All XSS attack vectors identified in the audit are mitigated
- [ ] Contract address inputs immediately reject invalid StrKey format
- [ ] `<script>` injection attempts are sanitised in all input and display contexts
- [ ] DOMPurify allowlist is restrictive (no `<script>`, `<iframe>`, or event handler attributes)
- [ ] Security tests cover all documented attack vectors

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Frontend Rate Limiting and Circuit Breaker for RPC and API Calls",
        "labels": ["frontend","complexity: hard","area: security","eta: 2 days"],
        "body": """\
## Overview
Uncontrolled frontend API calls can exhaust Soroban RPC rate limits, cause accidental denial-of-service, \
and incur unexpected costs. This issue implements **client-side rate limiting** with request queuing, \
deduplication, and a circuit breaker pattern.

## Why It Matters
Without rate limiting, a single buggy component polling too aggressively can get the user's IP \
banned from public RPC endpoints — breaking the entire app for the session.

## Task Breakdown
- [ ] Implement a `RateLimiter` class with configurable: max requests per window, window duration, and queue size
- [ ] Wrap all RPC calls (`simulateTransaction`, `getEvents`, etc.) through the rate limiter
- [ ] Implement request deduplication: concurrent identical requests share a single in-flight promise
- [ ] Implement a circuit breaker: after 5 consecutive errors, stop sending requests for 30 s
- [ ] Build a `RequestQueueDebugPanel` (dev-only) showing pending, in-flight, and blocked requests
- [ ] Show user-facing feedback: "RPC rate limit reached, retrying in Xs" toast when queue is full
- [ ] Implement per-endpoint rate limit configurations (simulation calls are more expensive than read calls)
- [ ] Write tests for rate limiting, deduplication, and circuit breaker state machine logic

## Acceptance Criteria
- [ ] Frontend never exceeds the configured rate limit for any RPC method
- [ ] Duplicate in-flight requests result in only one network call
- [ ] Circuit breaker correctly halts requests after 5 consecutive errors
- [ ] Users see clear feedback when rate limits are hit
- [ ] Debug panel accurately reflects the request queue state in development mode

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Tamper-Evident Audit Log UI for Sensitive Task Operations",
        "labels": ["frontend","complexity: hard","area: security","eta: 2 days"],
        "body": """\
## Overview
For compliance and accountability, sensitive task operations (create, update, cancel, claim incentive) \
need to be recorded in an **immutable audit log** displayed in the frontend with tamper-evidence \
indicators derived from the blockchain.

## Why It Matters
Since all SoroTask operations are on-chain, the audit trail is inherently tamper-evident. The \
frontend must present this audit trail in a human-readable way while proving each event originates \
from the actual contract — not a spoofed API response.

## Task Breakdown
- [ ] Define auditable events: task created, task updated, task paused, task cancelled, incentive claimed
- [ ] Fetch events from the Soroban event stream with transaction hash verification
- [ ] Build an `AuditLog` component rendering events in reverse chronological order
- [ ] Display per event: ledger-close timestamp, action type, wallet address, transaction hash, ledger number
- [ ] Implement a "Verify on Explorer" link for each event (Stellar Expert / Stellar.expert)
- [ ] Implement contract address verification: reject events not emitted by the known SoroTask contract address
- [ ] Add audit log export as a signed JSON file with all event hashes for external verification
- [ ] Implement pagination for large audit logs (cursor-based)
- [ ] Write tests for event verification logic and audit log rendering

## Acceptance Criteria
- [ ] All 5 auditable event types appear correctly in the audit log
- [ ] Each event has a working "Verify on Explorer" link
- [ ] Exported JSON contains all fields needed for independent verification
- [ ] Events from unknown contract addresses are correctly rejected and flagged
- [ ] Audit log is paginated and performant for 1,000+ events

**ETA: 2 days**
"""},
    # ── CONTRACT INTEGRATION (4) ──────────────────────────────────────────────
    {
        "title": "[Frontend] Integrate Soroban Contract SDK with Typed Client Auto-Generation",
        "labels": ["frontend","complexity: hard","area: contract-integration","eta: 2 days"],
        "body": """\
## Overview
The frontend currently has no typed integration with the SoroTask Soroban contract. This issue \
integrates the **Stellar SDK** and generates a fully-typed contract client using \
`stellar contract bindings typescript` to eliminate manual ABI parsing.

## Why It Matters
Manual ABI parsing is error-prone and breaks every time the contract changes. Auto-generated \
TypeScript bindings provide compile-time type safety and eliminate an entire class of runtime errors.

## Task Breakdown
- [ ] Add a `stellar contract bindings typescript` generation step to the project's `Makefile` and `package.json` scripts
- [ ] Run the generation and commit the output to `frontend/src/lib/contract/`
- [ ] Implement a `ContractClientProvider` React context wrapping the generated client with the active wallet's signing key
- [ ] Replace all manual RPC calls in the frontend with typed client method calls
- [ ] Implement proper error handling for each contract method using the generated XDR error types
- [ ] Add client regeneration to the CI pipeline — triggered on contract source changes
- [ ] Write TypeScript type tests verifying the generated types match the contract interface
- [ ] Document the client usage pattern in `CONTRIBUTING.md`

## Acceptance Criteria
- [ ] Generated client covers all public contract functions with full TypeScript types
- [ ] All frontend contract interactions use the generated client — zero manual XDR construction
- [ ] Contract error types are fully typed and handled in the UI with meaningful messages
- [ ] Client regeneration runs automatically in CI when the contract source changes
- [ ] TypeScript compiler catches argument type mismatches at build time

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Transaction Builder UI with Custom Fee, Memo, and Time-Bound Controls",
        "labels": ["frontend","complexity: hard","area: contract-integration","eta: 2 days"],
        "body": """\
## Overview
Advanced users need fine-grained control over transaction parameters. This issue builds a \
**transaction builder panel** allowing users to customise fees, memos, and time bounds before \
any signing action.

## Why It Matters
Power users and operators use custom fees to control transaction priority, memos for accounting \
purposes, and time bounds to prevent stale transactions from executing unexpectedly late.

## Task Breakdown
- [ ] Design the transaction builder as a collapsible "Advanced Options" section in the wizard's Review step
- [ ] Implement a fee input with a slider and three presets: Slow (min fee), Normal (recommended), Fast (2× recommended)
- [ ] Show an estimated confirmation time for each fee level based on historical network data
- [ ] Implement a memo field with a 28-byte character limit and a type selector: text, ID, hash
- [ ] Implement time bounds: "Expires in" selector (1 h, 6 h, 24 h, custom) with a ledger number preview
- [ ] Show real-time transaction size in bytes and total estimated cost (fee × size)
- [ ] Validate that custom fees are above the network minimum
- [ ] Implement a "Reset to defaults" button
- [ ] Write tests for fee calculation, time bound → ledger number conversion, and validation logic

## Acceptance Criteria
- [ ] All transaction parameters are adjustable via the UI before signing
- [ ] Fee presets show accurate confirmation time estimates
- [ ] Time bounds are correctly converted to ledger numbers before submission
- [ ] Transaction size and cost estimates are accurate
- [ ] Custom fees below the network minimum are rejected with a clear error

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Implement Soroban Event Subscription for Real-Time Contract Event Display",
        "labels": ["frontend","complexity: hard","area: contract-integration","eta: 2 days"],
        "body": """\
## Overview
Task status updates currently require a manual page refresh. This issue implements **real-time \
Soroban contract event subscription** so task execution, status changes, and incentive events \
automatically update the frontend without polling.

## Why It Matters
Real-time feedback is essential for operators monitoring active tasks. A 30-second polling delay \
is unacceptable when a task fails and requires immediate attention.

## Task Breakdown
- [ ] Implement a `useContractEvents` hook that long-polls `getEvents` RPC with cursor-based continuation
- [ ] Filter events to only those emitted by the known SoroTask contract address
- [ ] Parse all event types: `task_executed`, `task_registered`, `task_paused`, `task_cancelled`, `incentive_claimed`
- [ ] Dispatch parsed events to the Zustand store to update task state reactively
- [ ] Implement event deduplication by ledger number + transaction hash to prevent double-processing
- [ ] Add a "Live updates" indicator in the dashboard header showing subscription health
- [ ] Implement graceful degradation: fall back to 30 s polling if the event subscription fails
- [ ] Backfill missed events on reconnection by fetching from the last processed cursor
- [ ] Write tests for event parsing, deduplication, and store update logic

## Acceptance Criteria
- [ ] Task state updates appear in the UI within 10 s of the on-chain event
- [ ] All 5 event types are correctly parsed and reflected in the UI
- [ ] Duplicate events are never processed more than once
- [ ] Missed events are backfilled correctly after a reconnection
- [ ] "Live updates" indicator correctly reflects subscription health status

**ETA: 2 days**
"""},
    {
        "title": "[Frontend] Build Contract Call Simulation Preview with Resource Estimation Before Task Submission",
        "labels": ["frontend","complexity: hard","area: contract-integration","eta: 2 days"],
        "body": """\
## Overview
Users submitting tasks with invalid configurations waste fees on failed transactions. This issue \
builds a **contract call simulation preview** that calls `simulateTransaction` before signing, \
showing the expected outcome, resource usage, and any errors upfront.

## Why It Matters
Soroban's `simulateTransaction` executes the transaction against the current ledger state without \
broadcasting it. Showing this result before signing prevents costly mistakes and builds user \
confidence in the task configuration.

## Task Breakdown
- [ ] Implement a `useTransactionSimulator` hook wrapping the `simulateTransaction` RPC call
- [ ] Trigger simulation automatically 500 ms after the user completes the task creation form (debounced)
- [ ] Build a `SimulationResultPanel` showing:
  - Status: ✅ Success / ❌ Error (with the specific error message)
  - Resource usage: CPU instructions, memory bytes, ledger reads / writes
  - Estimated fee with a per-component breakdown
  - Return value parsed from XDR to a human-readable format
- [ ] Show a "Simulation outdated" warning if the form changes after the last simulation
- [ ] Block the "Sign & Submit" button if the latest simulation returned an error
- [ ] Cache the last simulation result and reuse it if the form has not changed
- [ ] Write tests for debounce logic, simulation result parsing, and button state management

## Acceptance Criteria
- [ ] Simulation runs automatically after form completion with no extra user action required
- [ ] Simulation result panel clearly distinguishes success from failure
- [ ] Resource usage and fee estimates are parsed from the actual `simulateTransaction` response
- [ ] "Sign & Submit" is blocked when the simulation fails
- [ ] Cache correctly prevents redundant API calls for unchanged form data

**ETA: 2 days**
"""},
]

def run(cmd, **kwargs):
    r = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    return r

def create_labels():
    print("Creating labels...")
    for l in LABELS:
        r = run(["gh", "label", "create", l["name"],
                 "--color", l["color"],
                 "--description", l["description"],
                 "--repo", REPO, "--force"])
        status = "OK" if r.returncode == 0 else f"WARN: {r.stderr.strip()}"
        print(f"  Label '{l['name']}': {status}")

def create_milestone():
    print("Creating milestone...")
    # Due date 2 days from now
    due = "2026-04-28T23:59:59Z"
    r = run(["gh", "api", f"repos/{REPO}/milestones",
             "-X", "POST",
             "-f", f"title={MILESTONE}",
             "-f", f"due_on={due}",
             "-f", "description=All frontend issues in this sprint have an estimated completion time of 2 days."])
    if r.returncode == 0:
        data = json.loads(r.stdout)
        print(f"  Milestone created: #{data['number']}")
        return data["number"]
    elif "already_exists" in r.stderr or "Validation Failed" in r.stderr:
        # fetch existing
        r2 = run(["gh", "api", f"repos/{REPO}/milestones", "--jq", f'.[] | select(.title=="{MILESTONE}") | .number'])
        num = int(r2.stdout.strip())
        print(f"  Milestone already exists: #{num}")
        return num
    else:
        print(f"  Milestone error: {r.stderr.strip()}")
        return None

def create_issue(issue, milestone_number):
    label_str = ",".join(issue["labels"])
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, dir='/home/knights') as f:
        f.write(issue["body"])
        tmp_path = f.name

    cmd = ["gh", "issue", "create",
           "--repo", REPO,
           "--title", issue["title"],
           "--body-file", tmp_path,
           "--label", label_str]
    if milestone_number:
        cmd += ["--milestone", str(milestone_number)]

    r = run(cmd)
    os.unlink(tmp_path)
    if r.returncode == 0:
        url = r.stdout.strip()
        return True, url
    else:
        return False, r.stderr.strip()

def main():
    create_labels()
    milestone_number = create_milestone()

    print(f"\nCreating {len(ISSUES)} issues...")
    success_count = 0
    for i, issue in enumerate(ISSUES, 1):
        ok, result = create_issue(issue, milestone_number)
        if ok:
            success_count += 1
            print(f"  [{i:02d}/50] OK — {result}")
        else:
            print(f"  [{i:02d}/50] FAIL — {issue['title'][:60]}... Error: {result}")

    print(f"\nDone: {success_count}/{len(ISSUES)} issues created successfully.")

if __name__ == "__main__":
    main()

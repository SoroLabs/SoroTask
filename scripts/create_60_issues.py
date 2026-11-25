import subprocess
import json
import time

issues = [
    # --- Category 1: Smart Contracts (15) ---
    {
        "title": "🦀 [CONTRACT] Implement Decentralized Slashing Mechanism for Fraudulent Keeper Submissions",
        "labels": "contract,security,architecture",
        "summary": "Implement on-chain slashing logic to penalize malicious keepers who submit invalid task execution transactions.",
        "problem": "Currently, if a keeper submits a faulty execution attempt or attempts front-running without fulfilling resolver conditions, there is no financial penalty, allowing spam attacks on task state.",
        "solution": [
            "Require keepers to deposit a minimum XLM/token stake into contract storage before participating.",
            "Implement slash_keeper(keeper_address, evidence) function restricted to slasher guardians or DAO governance.",
            "Distribute slashed collateral between the affected task creator and the slasher reward pool."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Soroban Multi-Asset Escrow & Automated Yield Staking Strategy",
        "labels": "contract,feature,enhancement",
        "summary": "Integrate automated yield generation for idle gas balances deposited in task escrows.",
        "problem": "Idle gas balances and task bounties stored in the contract generate no yield during long interval waiting periods, decreasing capital efficiency for task creators.",
        "solution": [
            "Integrate yield-bearing Soroban liquidity protocols (e.g. blend / pool reserves) for deposited gas funds.",
            "Implement harvest_yield(task_id) function to calculate and auto-compound accumulated interest.",
            "Ensure instant unbonding and liquidity withdrawal when tasks are executed or cancelled."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Zero-Knowledge Proof Verification Gate for Conditional Task Execution",
        "labels": "contract,zk-proof,security",
        "summary": "Add on-chain Groth16 ZK proof verification gate to execute tasks based on private condition evaluations.",
        "problem": "Certain conditional tasks require private computation (e.g. secret thresholds, private credit scores) that cannot be exposed publicly in resolver code.",
        "solution": [
            "Import Soroban cryptographic primitives for pairing-friendly curve operations.",
            "Implement verify_zk_condition(task_id, proof_bytes, public_inputs) function in contract logic.",
            "Reject execution if ZK proof verification fails or public inputs mismatch expected task hash."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Time-Weighted Average Price (TWAP) Oracle Integration for Dynamic Execution Fees",
        "labels": "contract,oracle,optimization",
        "summary": "Integrate a TWAP price oracle to dynamically calculate execution bounties based on real-time network gas costs.",
        "problem": "Fixed execution fees cause task execution to become unprofitable during network congestion or overpaid during quiet periods.",
        "solution": [
            "Integrate price feed oracle interface (e.g. Band / Chainlink) for XLM/USD and gas pricing.",
            "Compute 30-minute TWAP window to calculate dynamic keeper compensation.",
            "Automatically adjust required gas balance checks during task registration."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Upgradable Proxy Pattern using WASM Hash Migration and Timelock Governance",
        "labels": "contract,architecture,security",
        "summary": "Implement an admin-governed upgradable contract proxy pattern using Soroban WASM hash updating.",
        "problem": "Deploying updates to core contract logic requires redeploying contracts and migrating all task state manually.",
        "solution": [
            "Use env.deployer().update_current_contract_wasm(new_wasm_hash) for in-place logic upgrades.",
            "Implement 48-hour timelock delay for upgrade proposals to allow user withdrawal.",
            "Emit ContractUpgraded(old_hash, new_hash, timestamp) governance events."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Off-Chain State Channel Settlement for Micro-Interval Task Triggering",
        "labels": "contract,architecture,performance",
        "summary": "Implement state channel settlement logic for ultra-high-frequency recurring tasks.",
        "problem": "Tasks requiring sub-second execution intervals incur high ledger bloat and transaction fees if executed individually on-chain.",
        "solution": [
            "Implement state channel deposit and multi-signature channel state update verification.",
            "Allow off-chain signed execution state attestations between keepers and task creators.",
            "Settle batch state channel transitions on-chain upon channel closure."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Batch Task Execution and Atomic Multi-Call Invocation Engine",
        "labels": "contract,optimization,feature",
        "summary": "Enable keepers to execute multiple due tasks within a single atomic Soroban contract invocation.",
        "problem": "Executing tasks one-by-one requires separate transactions, increasing keeper overhead and transaction submission delay.",
        "solution": [
            "Implement execute_batch(env: Env, keeper: Address, task_ids: Vec<u64>) function.",
            "Process each task atomically, skipping failed tasks without reverting the entire batch.",
            "Pay combined keeper bounty in a single token transfer."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Automated Insurance Fund and Slash Coverage for Failed Keeper Jobs",
        "labels": "contract,feature,security",
        "summary": "Create an on-chain insurance pool to compensate task creators if keepers fail to execute time-critical tasks.",
        "problem": "Time-sensitive liquidations or automated actions suffer financial loss if keepers miss an execution window.",
        "solution": [
            "Divert a percentage of execution protocol fees into a contract Insurance Reserve.",
            "Implement claim_insurance(task_id, proof_of_delay) for validated missed executions.",
            "Automatically reimburse missed yield or arbitrage loss up to pool cap."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Multi-Signature Emergency Pause and Governance DAO Access Control",
        "labels": "contract,security,governance",
        "summary": "Replace single-admin control with a multi-signature threshold for emergency contract pausing.",
        "problem": "Single admin keys represent a central point of failure if compromised or unavailable during emergencies.",
        "solution": [
            "Implement K-of-N multi-signature authorization structure in contract storage.",
            "Allow designated emergency operators to trigger pause_contract() under consensus.",
            "Implement unpause_contract() requiring timelock and governance approval."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Gas-Optimized Custom Data Serializer for High-Frequency Task Payloads",
        "labels": "contract,performance,optimization",
        "summary": "Replace default XDR serialization with custom bit-packed binary encoding for task invocation arguments.",
        "problem": "Large task payload arguments consume significant CPU instructions and storage bytes during contract deserialization.",
        "solution": [
            "Design compact bit-packed byte array schema for task target arguments.",
            "Implement zero-copy argument decoding helpers in Rust contract.",
            "Reduce WASM footprint and instruction consumption by up to 30%."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Cross-Chain Interoperability Protocol (CCIP) Trigger Gateway",
        "labels": "contract,cross-chain,feature",
        "summary": "Build cross-chain bridge gateway interface for triggering Soroban task execution from external blockchains.",
        "problem": "Users on Ethereum or Solana cannot directly schedule or trigger Soroban tasks without cross-chain messaging.",
        "solution": [
            "Integrate cross-chain messaging verification (e.g. Wormhole / Axelar) in contract logic.",
            "Implement receive_cross_chain_task(source_chain, payload, signature).",
            "Emit CrossChainTaskScheduled event upon validated payload receipt."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Verifiable Random Function (VRF) Integration for Randomized Task Dispatch",
        "labels": "contract,vrf,feature",
        "summary": "Integrate VRF randomness oracle for fair, unpredictable keeper assignment on high-value tasks.",
        "problem": "Deterministic keeper task ordering allows wealthy keepers to front-run execution of lucrative tasks.",
        "solution": [
            "Integrate Pyth / Band VRF randomness callback interface.",
            "Select winning keeper pseudo-randomly using on-chain VRF seed upon task due time.",
            "Prevent miner and keeper front-running manipulation."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Task Dependency Graph & Directed Acyclic Graph (DAG) Execution Ordering",
        "labels": "contract,architecture,feature",
        "summary": "Support task execution dependencies where Task B only runs after Task A succeeds.",
        "problem": "Complex workflows (e.g. swap -> stake -> notify) currently require manual sequential scheduling across multiple intervals.",
        "solution": [
            "Add depends_on: Vec<u64> field to TaskConfig struct.",
            "Verify parent task execution status and timestamp during execute().",
            "Block child task execution if parent task execution reverted or is pending."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Dynamic Gas Price Thresholds & Auto-Refunding Escrow Logic",
        "labels": "contract,feature,ux",
        "summary": "Implement auto-refunding escrow mechanisms for task creators when tasks expire or are deleted.",
        "problem": "Unused gas deposits remain locked in contract storage indefinitely if a task is abandoned by its creator.",
        "solution": [
            "Implement expire_abandoned_task(task_id) callable after configurable inactivity window.",
            "Automatically return remaining gas balance to creator's address upon task cancellation.",
            "Emit TaskGasRefunded(task_id, amount, creator) event."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Granular Access Control Lists (ACL) for Delegation and Sub-Account Management",
        "labels": "contract,security,feature",
        "summary": "Implement role-based access control (RBAC) for managing tasks across team members.",
        "problem": "Only the single creator Address can modify or pause a task, preventing team management or automated operator scripts.",
        "solution": [
            "Add Role enum (Admin, Operator, Viewer) mapping to sub-accounts per task.",
            "Implement grant_task_role(task_id, account, role) and revoke_task_role().",
            "Enforce role checks on update_task, pause_task, and deposit_gas."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },

    # --- Category 2: Keeper Bot (15) ---
    {
        "title": "🤖 [KEEPER] P2P Peer Discovery and Decentralized Mesh Network for Task Allocation",
        "labels": "keeper,networking,architecture",
        "summary": "Build a libp2p peer discovery network for keepers to coordinate task distribution without central servers.",
        "problem": "Centralized keeper coordination creates single points of failure and bottlenecking during network partitions.",
        "solution": [
            "Integrate @libp2p node initialization into keeper startup lifecycle.",
            "Implement gossipsub protocol channel for keeper peer discovery and task lock announcements.",
            "Detect offline peers and dynamically re-assign unclaimed task queues."
        ],
        "area": "Keeper Service (`keeper/src/p2pNetwork.js`)"
    },
    {
        "title": "🤖 [KEEPER] Multi-RPC Fallback Routing with Latency-Based Node Health Scoring",
        "labels": "keeper,reliability,networking",
        "summary": "Implement an adaptive multi-RPC client router that routes calls to the fastest healthy Stellar node.",
        "problem": "Single RPC endpoint outages or rate limiting completely stall keeper polling engines.",
        "solution": [
            "Support array of RPC endpoints in config (e.g. Futurenet, Testnet, custom nodes).",
            "Periodically ping nodes to measure latency, error rate, and block height sync.",
            "Dynamically route transaction submissions to highest-scoring RPC node."
        ],
        "area": "Keeper Service (`keeper/src/disasterRecovery.js`)"
    },
    {
        "title": "🤖 [KEEPER] Predictive Machine Learning Model for Task Failure Risk & Gas Forecasting",
        "labels": "keeper,ai,optimization",
        "summary": "Implement lightweight machine learning model to predict task execution failure probability and optimal gas fee.",
        "problem": "Executing tasks destined to fail due to dynamic state changes wastes keeper gas funds.",
        "solution": [
            "Collect historical task execution data (resolver conditions, gas prices, time of day).",
            "Train lightweight regression model to predict execution success confidence score.",
            "Skip task execution if success probability falls below configured threshold."
        ],
        "area": "Keeper Service (`keeper/src/insights.js`)"
    },
    {
        "title": "🤖 [KEEPER] Graceful Process Shutdown with Execution Recovery & Lock Transfer",
        "labels": "keeper,reliability,devops",
        "summary": "Implement SIGTERM/SIGINT signal handling to safely finish active transactions before process exit.",
        "problem": "Abruptly terminating keeper instances during deployments leads to stuck locks and unhandled transaction states.",
        "solution": [
            "Intercept process SIGTERM/SIGINT signals.",
            "Stop receiving new tasks from queue and complete pending in-flight RPC submissions.",
            "Release all held Redis locks cleanly before exiting process with code 0."
        ],
        "area": "Keeper Service (`keeper/src/gracefulShutdown.js`)"
    },
    {
        "title": "🤖 [KEEPER] Encrypted Private Key Management using AWS KMS and HashiCorp Vault",
        "labels": "keeper,security,infrastructure",
        "summary": "Support external Key Management Service (KMS) integration for signing keeper transactions securely.",
        "problem": "Storing plaintext keeper secret keys in .env files or environment variables presents high security risk.",
        "solution": [
            "Integrate AWS KMS / HashiCorp Vault SDK into keeper account loader.",
            "Perform transaction payload signing remotely via KMS API without exposing private keys.",
            "Add hardware security module (HSM) signing provider interface."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] High-Performance Webhook Trigger Protocol with Signature Verification",
        "labels": "keeper,feature,security",
        "summary": "Allow external webhooks (e.g. GitHub events, price spikes) to trigger instant keeper task evaluations.",
        "problem": "Polling-only execution introduces latency for event-driven tasks that depend on external web services.",
        "solution": [
            "Expose HTTPS POST /webhook/trigger endpoint secured with HMAC SHA-256 signatures.",
            "Validate incoming webhook payload and map to corresponding registered task ID.",
            "Immediately dispatch execution queue item bypassing standard polling interval."
        ],
        "area": "Keeper Service (`keeper/src/webhookTrigger.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automated Fee Arbitrage & Profitability Maximization Engine",
        "labels": "keeper,optimization,feature",
        "summary": "Build an execution profitability calculator that only executes tasks when bounty > total transaction cost.",
        "problem": "Keepers can operate at a loss when network gas prices surge above fixed task bounties.",
        "solution": [
            "Calculate expected transaction cost = (gas_units * gas_price) + network_fee.",
            "Compare expected bounty against estimated cost + minimum profit margin.",
            "Defer task execution until gas prices drop or creator tops up bounty."
        ],
        "area": "Keeper Service (`keeper/src/gasMonitor.js`)"
    },
    {
        "title": "🤖 [KEEPER] Adaptive Polling Engine with Dynamic Sleep Interval Tuning",
        "labels": "keeper,performance,optimization",
        "summary": "Dynamically adjust polling interval based on active task schedules and upcoming due timestamps.",
        "problem": "Fixed 5-second polling loops generate excessive empty RPC requests when no tasks are due for hours.",
        "solution": [
            "Query nearest upcoming task last_run + interval timestamp.",
            "Calculate sleep duration = min(default_poll_interval, time_until_next_due_task).",
            "Reduce RPC bandwidth consumption by up to 70% during low activity windows."
        ],
        "area": "Keeper Service (`keeper/src/poller.js`)"
    },
    {
        "title": "🤖 [KEEPER] Transaction Dead-Letter Queue (DLQ) and Automated Retry Manager",
        "labels": "keeper,reliability,architecture",
        "summary": "Implement a Dead-Letter Queue (DLQ) to capture repeatedly failing tasks for manual inspection.",
        "problem": "Tasks with broken contract target functions can cause perpetual retry loops, starving valid tasks.",
        "solution": [
            "Move task to DLQ storage after N consecutive execution failures.",
            "Pause automatic retries for DLQ items and notify keeper operator via alert.",
            "Expose admin CLI commands gh/api to inspect, retry, or purge DLQ tasks."
        ],
        "area": "Keeper Service (`keeper/src/retryScheduler.js`)"
    },
    {
        "title": "🤖 [KEEPER] Historical Performance Telemetry and Keeper Reputation Scoring System",
        "labels": "keeper,analytics,feature",
        "summary": "Track and calculate local keeper metrics for execution speed, success rate, and gas efficiency.",
        "problem": "Keeper operators lack visibility into long-term node performance and execution success ratios.",
        "solution": [
            "Persist execution attempts, latencies, and transaction hashes in SQLite data store.",
            "Calculate rolling reputation score based on response speed and execution reliability.",
            "Expose score via GET /metrics/reputation for monitoring dashboards."
        ],
        "area": "Keeper Service (`keeper/src/history.js`)"
    },
    {
        "title": "🤖 [KEEPER] Sharded Workload Distribution across Multi-Region Cloud Clusters",
        "labels": "keeper,scaling,architecture",
        "summary": "Implement task ID hash ring sharding to divide task workload deterministically among keeper nodes.",
        "problem": "A single keeper node cannot scale to monitor tens of thousands of active task configurations.",
        "solution": [
            "Implement Consistent Hashing algorithm mapping task_id to keeper shard index.",
            "Configure node shard ID and total shard count via environment variables.",
            "Ensure each keeper instance only polls and executes its designated task partition."
        ],
        "area": "Keeper Service (`keeper/src/sharding.js`)"
    },
    {
        "title": "🤖 [KEEPER] Real-Time Slack and Discord Webhook Alerting for Node Outages",
        "labels": "keeper,monitoring,devops",
        "summary": "Integrate Slack, Discord, and PagerDuty notifications for critical keeper alerts.",
        "problem": "Keeper account low balance or RPC disconnection failures go unnoticed without real-time notifications.",
        "solution": [
            "Build KeeperAlertManager supporting Slack and Discord webhook integrations.",
            "Trigger high-priority alerts on account balance < threshold, 5xx RPC errors, or process crash.",
            "Add notification rate limiting to prevent webhook spam."
        ],
        "area": "Keeper Service (`keeper/src/keeperAlerts.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automated Gas Vault Auto-Refill Trigger via Soroban Swap Routers",
        "labels": "keeper,automation,feature",
        "summary": "Automatically swap earned bounties (USDC/USDT) to XLM to replenish keeper signing account balance.",
        "problem": "Keepers run out of native XLM gas over time if earned bounties are paid in stablecoins or custom tokens.",
        "solution": [
            "Monitor native XLM balance on keeper signing account.",
            "Auto-invoke Soroban DEX swap router when XLM balance drops below reserve threshold.",
            "Swap accumulated bounty tokens back to XLM seamlessly."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] Memory-Efficient In-Memory LRU Cache for Task Dependency Resolution",
        "labels": "keeper,performance,optimization",
        "summary": "Implement LRU cache for contract state queries to avoid duplicate RPC calls during task validation.",
        "problem": "Frequent polling queries fetch unchanged contract metadata repeatedly, causing unnecessary network I/O.",
        "solution": [
            "Implement TTL-based LRU cache for task configurations and resolver check results.",
            "Invalidate cached items automatically upon detecting on-chain TaskUpdated events.",
            "Improve task status check throughput by 4x."
        ],
        "area": "Keeper Service (`keeper/src/registry.js`)"
    },
    {
        "title": "🤖 [KEEPER] End-to-End OpenTelemetry Trace Correlation for Cross-Node Workflows",
        "labels": "keeper,observability,devops",
        "summary": "Integrate OpenTelemetry instrumentation to track execution trace IDs from polling to on-chain inclusion.",
        "problem": "Debugging multi-step task delays across poller, queue, RPC submission, and indexer is difficult without trace IDs.",
        "solution": [
            "Inject W3C traceparent headers into execution context.",
            "Export OpenTelemetry traces to Jaeger / Datadog / Grafana Tempo.",
            "Correlate trace ID with Soroban transaction hash for complete lifecycle visibility."
        ],
        "area": "Keeper Service (`keeper/src/logger.js`)"
    },

    # --- Category 3: ZK-Proof Service (10) ---
    {
        "title": "🛡️ [ZK-SERVICE] Circom Circuit Compiler & Automated WASM Artifact Generator",
        "labels": "zk-proof-service,build,automation",
        "summary": "Build automated Circom compilation pipeline to generate WASM and zkey files on circuit updates.",
        "problem": "Manually compiling Circom circuits and copying zkey artifacts creates build inconsistencies.",
        "solution": [
            "Add circom build script in scripts/compile-circuits.sh.",
            "Generate WASM prover, zkey files, and Solidity/Soroban verifiers automatically.",
            "Include automated circuit constraint verification during test execution."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Recursive Proof Aggregation Engine to Reduce On-Chain Verification Gas",
        "labels": "zk-proof-service,performance,architecture",
        "summary": "Implement proof aggregation (SnarkPack / Nova) to combine multiple execution proofs into a single proof.",
        "problem": "Verifying individual ZK proofs on-chain for dozens of tasks consumes significant gas for each verification.",
        "solution": [
            "Integrate recursive proof aggregator in zk-proof-service.",
            "Combine N task execution condition proofs into 1 aggregated proof.",
            "Reduce on-chain verifier contract verification gas cost by up to 80%."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Distributed Worker Node Pool with Task Load Balancing",
        "labels": "zk-proof-service,scaling,performance",
        "summary": "Implement master-worker worker pool to distribute heavy ZK proof generation across multiple CPU cores.",
        "problem": "Single-threaded ZK proof generation blocks Express event loop during heavy witness calculations.",
        "solution": [
            "Use Node.js worker_threads to delegate prover jobs to background worker pool.",
            "Implement task queue with priority scheduling for time-sensitive proofs.",
            "Return 503 Service Unavailable gracefully when worker queue reaches maximum capacity."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Secret Witness Encryption using ECIES & Ephemeral Key Exchanges",
        "labels": "zk-proof-service,security,privacy",
        "summary": "Encrypt client witness data in transit using Elliptic Curve Integrated Encryption Scheme (ECIES).",
        "problem": "Sending raw witness inputs to proof generation service exposes private user parameters over network.",
        "solution": [
            "Implement secp256k1 ECIES encryption helper for client-side witness preparation.",
            "Decrypt witness payload in isolated memory inside ZK prover worker thread.",
            "Zero out decrypted witness memory buffers immediately after proof generation."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/helpers.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Automated Trusted Setup Ceremony (Powers of Tau) Integration",
        "labels": "zk-proof-service,security,devops",
        "summary": "Integrate automated ceremony verification for Powers of Tau phase 1 & 2 setup artifacts.",
        "problem": "Using unverified or insecure zkey files risks compromise of zero-knowledge soundness.",
        "solution": [
            "Implement zkey verification check during service initialization.",
            "Validate cryptographic hash of Powers of Tau ceremony file against published checksum.",
            "Reject service startup if zkey artifact integrity check fails."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Plonk Proof Verification Gateway for Complex Arbitrary Computation",
        "labels": "zk-proof-service,feature,crypto",
        "summary": "Add support for PLONK proof generation alongside Groth16 to eliminate per-circuit trusted setup.",
        "problem": "Groth16 requires a unique phase 2 trusted setup for every new user condition circuit added to the platform.",
        "solution": [
            "Integrate SnarkJS PLONK prover and verifier engine.",
            "Support universal SRS (Structured Reference String) for arbitrary task condition circuits.",
            "Expose /generate-proof/plonk and /verify-proof/plonk endpoints."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Redis Proof Cache & Result Deduplication Middleware",
        "labels": "zk-proof-service,optimization,performance",
        "summary": "Cache generated proofs by input witness hash to prevent redundant proof generation.",
        "problem": "Duplicate proof generation requests with identical inputs waste high CPU compute cycles.",
        "solution": [
            "Compute SHA-256 hash of (circuit_id, condition_params, public_inputs).",
            "Check Redis proof cache before dispatching prover worker thread.",
            "Return cached serialized proof instantly on cache hit."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Rate Limiting & Denial of Service (DoS) Prevention Middleware",
        "labels": "zk-proof-service,security,infrastructure",
        "summary": "Implement IP and API token rate limiting to protect proof generator endpoints from CPU exhaustion attacks.",
        "problem": "Unthrottled POST requests to /generate-proof can crash service CPU resources completely.",
        "solution": [
            "Integrate express-rate-limit and redis-rate-limiter.",
            "Enforce limit of 10 proof generation requests per minute per client IP.",
            "Return HTTP 429 Too Many Requests with Retry-After headers."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] OpenAPI Spec Automated Client Code Generation and Validation",
        "labels": "zk-proof-service,documentation,tooling",
        "summary": "Validate incoming HTTP payloads strictly against openapi.yaml schema using express-openapi-validator.",
        "problem": "Malformed JSON requests cause unhandled exceptions deep in witness calculation libraries.",
        "solution": [
            "Integrate express-openapi-validator middleware using existing openapi.yaml.",
            "Validate request body, params, and headers before handler execution.",
            "Return standardized 400 Bad Request responses with detailed field validation errors."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Asynchronous Proof Generation Queue with Server-Sent Events (SSE)",
        "labels": "zk-proof-service,feature,ux",
        "summary": "Support async proof job submission with SSE stream for long-running circuit proof progress updates.",
        "problem": "Synchronous HTTP POST requests for complex proofs exceed gateway timeouts (e.g. Cloudflare 30s limit).",
        "solution": [
            "Expose POST /proofs/async returning immediate job_id and status: queued.",
            "Expose GET /proofs/:job_id/stream SSE endpoint streaming generation progress percentage.",
            "Push final proof payload over SSE stream upon completion."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },

    # --- Category 4: Indexer Service (10) ---
    {
        "title": "📊 [INDEXER] GraphQL Query API Engine with Subscriptions and Complex Filtering",
        "labels": "indexer,graphql,feature",
        "summary": "Implement GraphQL API server with real-time subscriptions for task events and execution histories.",
        "problem": "REST endpoints require multiple round-trip requests for frontend dashboards to assemble nested task data.",
        "solution": [
            "Integrate Apollo Server / GraphQL Yoga engine in indexer.",
            "Define GraphQL schema for Task, ExecutionHistory, Keeper, and ContractEvent.",
            "Expose WebSocket GraphQL subscriptions for live task execution updates."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] PostgreSQL TimescaleDB Migration for Time-Series Execution Metrics",
        "labels": "indexer,database,performance",
        "summary": "Migrate indexer SQLite storage to PostgreSQL + TimescaleDB extension for time-series metrics.",
        "problem": "SQLite cannot scale to millions of historical execution records or perform fast time-bucket aggregations.",
        "solution": [
            "Design PostgreSQL schema with TimescaleDB hypertable for execution_events.",
            "Implement continuous aggregates for hourly and daily execution analytics.",
            "Write migration scripts from SQLite indexer.db to PostgreSQL."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] High-Throughput Parallel Ledger Event Parsing Pipeline",
        "labels": "indexer,performance,architecture",
        "summary": "Implement multi-threaded worker pipeline to parse Soroban contract events in parallel.",
        "problem": "Single-threaded event parsing falls behind during periods of high Stellar ledger throughput.",
        "solution": [
            "Implement worker thread pool dividing ledger sequence ranges across workers.",
            "Extract TaskRegistered, TaskExecuted, TaskCancelled XDR events in parallel.",
            "Batch write parsed events into database using single transaction insertion."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Historical Event Data Archival Strategy & Cold Storage Offloading",
        "labels": "indexer,database,infrastructure",
        "summary": "Implement automatic cold storage offloading for historical event logs older than 90 days.",
        "problem": "Unchecked database growth degrades query performance and increases cloud database storage costs.",
        "solution": [
            "Build automated cron job exporting historical events to Parquet files on AWS S3.",
            "Prune indexed event rows older than retention window from primary database.",
            "Expose query interface for searching archived Parquet files via DuckDB/Athena."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Real-Time Webhook Notification Dispatcher for Task Creators",
        "labels": "indexer,feature,ux",
        "summary": "Dispatch HTTP webhooks to task creator endpoints whenever their tasks are executed or fail.",
        "problem": "Task creators have no automated way to receive push notifications when their task is triggered on-chain.",
        "solution": [
            "Allow creators to register webhook_url and secret_key in task metadata.",
            "Dispatch signed HTTP POST payload upon ingesting TaskExecuted event.",
            "Implement exponential backoff retry for failed webhook deliveries."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Automated Schema Migration Engine for Contract Version Upgrades",
        "labels": "indexer,database,architecture",
        "summary": "Build backward-compatible schema migration runner to handle smart contract ABI upgrades.",
        "problem": "Upgrading the smart contract struct fields breaks existing indexer database insertion queries.",
        "solution": [
            "Version indexer schema definitions matching contract WASM version hashes.",
            "Implement schema migration runner executing pre/post migration scripts.",
            "Support parsing both V1 and V2 contract event formats simultaneously."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] Ledger Event Integrity Verification & Cryptographic Checksum Auditor",
        "labels": "indexer,security,reliability",
        "summary": "Implement background auditor verifying indexed event data against raw Stellar RPC ledger hashes.",
        "problem": "Silent database corruption or bug in event parser can store inaccurate execution state.",
        "solution": [
            "Run background audit job recalculating Merkle tree hash of indexed events per ledger.",
            "Compare calculated Merkle root against official Stellar ledger header transaction root.",
            "Alert operators immediately on state divergence."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Prometheus Metrics Exporter for Indexer Lag and Ingestion Rate",
        "labels": "indexer,monitoring,devops",
        "summary": "Expose Prometheus /metrics endpoint monitoring indexer ledger lag and ingestion throughput.",
        "problem": "Operators have no visibility into indexer delay relative to the latest Stellar network ledger.",
        "solution": [
            "Integrate prom-client library into indexer service.",
            "Export metrics: indexer_ledger_head, stellar_network_ledger_head, indexer_lag_ledgers, events_indexed_total.",
            "Create Grafana dashboard template in docs/."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Multi-Node Indexer Consensus and State Validation Verification",
        "labels": "indexer,architecture,reliability",
        "summary": "Implement dual-node indexer cross-validation to guarantee high availability and data correctness.",
        "problem": "Single indexer instance failure causes dashboard downtime and lost event tracking.",
        "solution": [
            "Deploy secondary active-passive indexer node.",
            "Implement heartbeat mechanism and automated database failover promotion.",
            "Sync state between primary and standby indexers continuously."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] REST API Middleware with JWT Authentication and Rate Limits",
        "labels": "indexer,api,security",
        "summary": "Secure indexer REST endpoints with JWT token authentication and per-key rate limits.",
        "problem": "Public unauthenticated REST endpoints can be abused via heavy search queries, causing DB pool exhaustion.",
        "solution": [
            "Integrate express-jwt middleware for API route protection.",
            "Issue developer API keys with configurable rate limits (e.g. 100 req/min).",
            "Add Redis token bucket rate limiting on public endpoints."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },

    # --- Category 5: Frontend (10) ---
    {
        "title": "💻 [FRONTEND] Interactive Task Flow Visualizer with DAG Graph Rendering",
        "labels": "frontend,ux,feature",
        "summary": "Build interactive visual graph editor (using React Flow) for designing multi-step task DAG dependencies.",
        "problem": "Creating complex tasks with resolver conditions and dependencies via raw JSON forms is error-prone.",
        "solution": [
            "Integrate React Flow library into frontend dashboard.",
            "Render visual nodes for Tasks, Resolvers, and Target Contracts with drag-and-drop connectors.",
            "Export visual DAG layout directly to register() contract call parameters."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Multi-Wallet Connection Hub (Freighter, Albedo, xBull, Lobstr)",
        "labels": "frontend,web3,feature",
        "summary": "Integrate Stellar Wallet Kit supporting Freighter, Albedo, xBull, and Lobstr wallets.",
        "problem": "Supporting only Freighter wallet excludes users on mobile devices or alternative Stellar wallets.",
        "solution": [
            "Integrate @stellar/wallet-kit into application context provider.",
            "Provide modal UI for selecting Freighter, Albedo, xBull, or Lobstr.",
            "Persist connected wallet session and handle network switching (Testnet / Mainnet)."
        ],
        "area": "Frontend (`frontend/context/`, `frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Automated Task Creator Wizard with Step-by-Step Simulation",
        "labels": "frontend,ux,feature",
        "summary": "Build step-by-step Task Creation Wizard with live pre-registration contract simulation.",
        "problem": "Users often register tasks with invalid target functions or insufficient gas, resulting in lost deposits.",
        "solution": [
            "Implement 4-step wizard: Target Contract -> Function & Args -> Trigger Interval -> Gas & Bounty.",
            "Run live Soroban RPC simulation during step 3 to verify target contract readiness.",
            "Display estimated monthly execution cost and recommended gas deposit."
        ],
        "area": "Frontend (`frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Keeper Analytics Dashboard with Real-Time Gas & Earnings Metrics",
        "labels": "frontend,analytics,feature",
        "summary": "Build dedicated analytics panel for keeper operators tracking earned bounties and gas expenditures.",
        "problem": "Keeper operators lack visual dashboards to track profitability, active tasks, and performance trends.",
        "solution": [
            "Create /keeper-dashboard route with Recharts data visualizations.",
            "Display daily XLM earned, total executions, success vs failure pie chart, and gas trends.",
            "Export performance reports as CSV/JSON."
        ],
        "area": "Frontend (`frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Accessibility Audit & WCAG 2.1 AA Compliance Refactoring",
        "labels": "frontend,accessibility,quality",
        "summary": "Refactor frontend components to guarantee full WCAG 2.1 AA accessibility compliance.",
        "problem": "Current UI components lack proper ARIA attributes, keyboard focus indicators, and screen reader announcements.",
        "solution": [
            "Audit all UI components using axe-core and Lighthouse accessibility testing.",
            "Add ARIA roles, labels, and aria-live regions for dynamic status updates.",
            "Ensure full keyboard navigation across modals, forms, and data tables."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Dark/Light Theme System with Custom Design Tokens & Tailwind CSS",
        "labels": "frontend,ui,enhancement",
        "summary": "Implement seamless dark/light theme switching with CSS variables and Tailwind design tokens.",
        "problem": "Application currently uses hardcoded dark colors without user theme preference support.",
        "solution": [
            "Integrate next-themes provider into layout.tsx.",
            "Define theme tokens in design-tokens.md and tailwind.config.js for background, surface, text, and accent.",
            "Provide theme toggle button with OS system preference auto-detection."
        ],
        "area": "Frontend (`frontend/app/`, `frontend/tailwind.config.js`)"
    },
    {
        "title": "💻 [FRONTEND] Real-Time Toast Notification System for Multi-Step Transactions",
        "labels": "frontend,ux,feature",
        "summary": "Build resilient toast notification queue tracking multi-step Web3 transaction lifecycles.",
        "problem": "Users are left uncertain during long transaction signing, submission, and confirmation phases.",
        "solution": [
            "Integrate Sonner / react-hot-toast notification queue.",
            "Display progressive states: 1. Awaiting Signature -> 2. Submitting to Soroban -> 3. Confirmed on Ledger.",
            "Include direct link to Stellar Expert block explorer for confirmed transactions."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Offline-First PWA Support & Service Worker Cache for Dashboard",
        "labels": "frontend,pwa,performance",
        "summary": "Convert Next.js frontend into a Progressive Web App (PWA) with offline caching.",
        "problem": "Dashboard fails to load or view cached task history when internet connectivity is intermittent.",
        "solution": [
            "Integrate @ducanh2912/next-pwa plugin into next.config.js.",
            "Cache static assets, fonts, and read-only task queries using Workbox service worker.",
            "Add web app manifest for mobile home screen installation."
        ],
        "area": "Frontend (`frontend/next.config.ts`, `frontend/public/`)"
    },
    {
        "title": "💻 [FRONTEND] End-to-End Internationalization (i18n) Framework Integration",
        "labels": "frontend,i18n,feature",
        "summary": "Integrate next-intl framework to support multi-language translation across dashboard pages.",
        "problem": "Application UI is hardcoded in English, limiting adoption among international Stellar communities.",
        "solution": [
            "Integrate next-intl routing and translation provider.",
            "Extract string literals into JSON locale dictionaries (en, es, pt, zh).",
            "Add language selector dropdown in navigation header."
        ],
        "area": "Frontend (`frontend/i18n/`, `frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Sentry Error Monitoring & Client-Side Crash Reporting Pipeline",
        "labels": "frontend,monitoring,devops",
        "summary": "Configure Sentry error boundary and performance monitoring across Next.js client, server, and edge.",
        "problem": "Uncaught React component errors or Web3 wallet connection exceptions occur in production without telemetry.",
        "solution": [
            "Configure @sentry/nextjs SDK in sentry.client.config.ts, sentry.server.config.ts, and sentry.edge.config.ts.",
            "Wrap app in Sentry ErrorBoundary displaying user recovery UI on crash.",
            "Capture custom Breadcrumbs for wallet connection and transaction lifecycle events."
        ],
        "area": "Frontend (`frontend/sentry.client.config.ts`)"
    }
]

def create_issue(issue, index, total):
    body = f"""## 📝 Issue Summary
{issue['summary']}

## ❓ Problem or Motivation
{issue['problem']}

## 💡 Proposed Solution
"""
    for step in issue['solution']:
        body += f"- {step}\n"

    body += f"""
## 🧩 Affected Areas
- [x] {issue['area']}

## ✅ Checklist
- [x] I have searched for existing issues
- [x] This aligns with the project's goal"""

    cmd = [
        "env", "-u", "GITHUB_TOKEN", "gh", "issue", "create",
        "--repo", "SoroLabs/SoroTask",
        "--title", issue['title'],
        "--body", body,
        "--label", issue['labels']
    ]

    print(f"[{index}/{total}] Creating: {issue['title']}...")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"  ✓ Created: {res.stdout.strip()}")
    except subprocess.CalledProcessError as e:
        print(f"  ❌ Error: {e.stderr.strip()}")

print(f"Starting creation of {len(issues)} high-quality issues...")
for i, issue in enumerate(issues, 1):
    create_issue(issue, i, len(issues))
    time.sleep(0.5)

print("Finished creating 60 issues!")

import subprocess
import time

issues = [
    # --- Category 1: Smart Contracts (12) ---
    {
        "title": "🦀 [CONTRACT] Multi-Asset Flash Swap Integration for Arbitrage Task Executions",
        "labels": "contract,feature,architecture",
        "summary": "Integrate Soroban DEX flash swap callbacks for capital-efficient arbitrage task execution.",
        "problem": "Executing automated arbitrage tasks requires capital reserves that keepers may not hold directly.",
        "solution": [
            "Implement Soroban DEX flash swap interface inside task execution context.",
            "Borrow required assets, execute target arbitrage task, and repay flash swap within single transaction.",
            "Revert transaction atomically if arbitrage profit does not cover flash fee."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Time-Decaying Keeper Reward Curves for Time-Critical Liquidation Jobs",
        "labels": "contract,feature,enhancement",
        "summary": "Implement dynamic reward multiplier curves that increase keeper bounties as task execution deadline approaches.",
        "problem": "Static execution bounties discourage keepers during high-gas congestion periods, risking missed liquidation deadlines.",
        "solution": [
            "Calculate dynamic keeper reward = base_bounty * (1 + time_elapsed / interval).",
            "Cap maximum bounty multiplier to prevent escrow exhaustion.",
            "Incentivize prompt execution for urgent time-sensitive tasks."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Zero-Knowledge Range Proof Verification for Private Financial Thresholds",
        "labels": "contract,security,feature",
        "summary": "Add on-chain ZK Bulletproofs verification gate to validate private condition ranges without revealing exact values.",
        "problem": "Tasks conditional on private financial balances reveal user account sizes on transparent block explorers.",
        "solution": [
            "Add ZK range proof verifier function in contract logic.",
            "Verify that private condition balance falls within [min, max] range without exposing actual scalar value.",
            "Prevent MEV extraction and protect user financial privacy."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Upgradable Module Registry with Dynamic Feature Flag Toggles",
        "labels": "contract,architecture,governance",
        "summary": "Implement modular feature flag registry for enabling/disabling contract sub-features dynamically.",
        "problem": "Disabling a single buggy feature currently requires pausing the entire contract for all users.",
        "solution": [
            "Implement Bitmask Feature Flags in contract instance storage.",
            "Allow DAO governance to toggle specific sub-modules (e.g. Yield Strategy, Flash Loans, VRF).",
            "Maintain operational uptime for unaffected core automation tasks."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Cross-Contract Re-Entrancy Guard with Execution Lock Timeout",
        "labels": "contract,security,architecture",
        "summary": "Implement strict re-entrancy lock protection across multi-contract execution chains.",
        "problem": "Malicious target contracts invoked by keepers can re-enter SoroTask to drain gas escrows.",
        "solution": [
            "Store atomic reentrancy state flag in contract instance storage.",
            "Enforce lock check before executing target contract calls and release lock afterwards.",
            "Revert any recursive invocation attempts immediately with Error::ReentrantCall."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Verifiable Random Seed Rotation for Decentralized Keeper Lotteries",
        "labels": "contract,feature,security",
        "summary": "Implement pseudo-random seed rotation for fair keeper task assignment and reward distribution.",
        "problem": "Fixed keeper priority ordering leads to node monopolization where a single fast keeper claims all profitable tasks.",
        "solution": [
            "Combine ledger timestamp, sequence, and previous transaction hash into rolling entropy seed.",
            "Select winning keeper pseudo-randomly for high-value task queues.",
            "Democratize keeper execution opportunities across network participants."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Off-Chain Signed Permit Execution (ERC-2612 Style) for Gasless Registration",
        "labels": "contract,ux,feature",
        "summary": "Enable gasless task registration using EIP-712 / SEP-0010 signed permit authorization.",
        "problem": "New users without native XLM for transaction fees cannot register tasks via web dashboards.",
        "solution": [
            "Implement register_with_permit(signature, task_config, deadline) in contract.",
            "Verify Ed25519 signature against creator address on-chain.",
            "Allow relayer/keeper to pay registration transaction fee on behalf of user."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Automated Insurance Vault Auto-Refill from Excess Protocol Profits",
        "labels": "contract,feature,security",
        "summary": "Automatically route 15% of contract protocol fees to an automated insurance pool.",
        "problem": "Insurance funds require manual admin top-ups, creating solvency risks during market turbulence.",
        "solution": [
            "Divert protocol fee share to dedicated Insurance Vault storage upon task execution.",
            "Implement auto-balancing logic to maintain target insurance reserve ratio.",
            "Provide automated solvency reporting metrics."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Decentralized Governance Proposal Delegation for Task Parameter Updates",
        "labels": "contract,governance,feature",
        "summary": "Implement vote delegation for contract parameter updates and protocol fee changes.",
        "problem": "Contract updates currently depend on core team key holders, limiting community governance.",
        "solution": [
            "Build delegation storage mapping voter weights to delegate addresses.",
            "Implement propose_parameter_change() and vote() contract entrypoints.",
            "Execute approved parameter changes automatically upon proposal timelock expiry."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Storage TTL Auto-Extension Hook during Execution Verification",
        "labels": "contract,architecture,enhancement",
        "summary": "Automatically extend Soroban persistent storage TTLs whenever a task executes successfully.",
        "problem": "Infrequently executed tasks risk falling below persistent storage TTL thresholds and becoming archived.",
        "solution": [
            "Invoke env.storage().persistent().extend_ttl() automatically inside execute().",
            "Extend storage TTL by 100,000 ledgers (~6 days) on every execution.",
            "Prevent active task configurations from unexpectedly expiring."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Gas-Optimized Bitmask Permission Vector for Role-Based Access Control",
        "labels": "contract,optimization,security",
        "summary": "Compress multi-role permissions into a single u32 bitmask field in TaskConfig struct.",
        "problem": "Storing separate boolean fields or role arrays in task structs inflates contract storage footprint.",
        "solution": [
            "Encode permissions as bit flags (e.g. CAN_PAUSE=1, CAN_UPDATE=2, CAN_CANCEL=4, CAN_DEPOSIT=8).",
            "Perform bitwise AND checks for authorization validation.",
            "Reduce storage byte consumption by 24 bytes per task entry."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Multi-Signature Emergency Pause Timelock with Guardian Override",
        "labels": "contract,security,governance",
        "summary": "Implement multi-guardian emergency pause mechanism with 24-hour automatic safety unpause.",
        "problem": "Indefinite contract pauses by compromised admin keys lock user funds permanently.",
        "solution": [
            "Require 3-of-5 Guardian signatures to pause protocol contract.",
            "Enforce automatic 24-hour safety unpause unless DAO governance votes to extend pause.",
            "Protect user funds against indefinite lockup."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },

    # --- Category 2: Keeper Bot (12) ---
    {
        "title": "🤖 [KEEPER] Distributed Redlock Execution Lock Manager with Automatic Lease Bumping",
        "labels": "keeper,architecture,reliability",
        "summary": "Implement Redlock distributed locking algorithm with automatic heartbeat lease extension.",
        "problem": "Long-running task executions can lose their lock prematurely, resulting in double executions.",
        "solution": [
            "Implement Redlock protocol client across 3 Redis nodes.",
            "Add background heartbeat timer extending lock lease while transaction submission is active.",
            "Release lock immediately upon receiving transaction inclusion confirmation."
        ],
        "area": "Keeper Service (`keeper/src/idempotency.js`)"
    },
    {
        "title": "🤖 [KEEPER] Predictive Transaction Mempool Simulator for Priority Fee Adjustment",
        "labels": "keeper,optimization,performance",
        "summary": "Simulate mempool fee competition to dynamically set priority fee bids for urgent tasks.",
        "problem": "Static gas fees lead to rejected transactions during network congestion spikes.",
        "solution": [
            "Fetch recent Stellar ledger base fee statistics via RPC.",
            "Calculate fee multiplier = min_base_fee * congestion_factor.",
            "Ensure keeper transactions achieve high priority inclusion during network spikes."
        ],
        "area": "Keeper Service (`keeper/src/gasMonitor.js`)"
    },
    {
        "title": "🤖 [KEEPER] Encrypted Key Store Integration with AWS Secrets Manager and HashiCorp Vault",
        "labels": "keeper,security,devops",
        "summary": "Integrate AWS Secrets Manager and HashiCorp Vault for secure keeper key management.",
        "problem": "Storing plaintext secret keys in .env files presents severe credential leak vulnerabilities.",
        "solution": [
            "Integrate AWS Secrets Manager SDK and Vault HTTP API into account manager.",
            "Fetch and decrypt signing keys in-memory on application startup.",
            "Zero out memory references when keeper process terminates."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automated RPC Node Failover Router with Latency Heatmap Monitoring",
        "labels": "keeper,reliability,devops",
        "summary": "Build real-time latency heatmap monitor that auto-routes RPC calls away from degraded nodes.",
        "problem": "Unannounced RPC node outages cause keeper polling loops to hang or throw unhandled exceptions.",
        "solution": [
            "Ping configured RPC nodes every 10 seconds and log latency matrix.",
            "Automatically route traffic to nodes with lowest response latency and 0% error rate.",
            "Re-check degraded nodes periodically for recovery."
        ],
        "area": "Keeper Service (`keeper/src/disasterRecovery.js`)"
    },
    {
        "title": "🤖 [KEEPER] Machine Learning Profitability Model for Dynamic Bounty Arbitrage",
        "labels": "keeper,optimization,feature",
        "summary": "Build profitability estimation engine calculating net keeper revenue before transaction submission.",
        "problem": "Keepers execute tasks at a financial loss when network gas costs exceed task bounty amounts.",
        "solution": [
            "Calculate net_profit = task_bounty - (gas_consumed * fee_rate).",
            "Skip task execution if projected profit is below configured threshold.",
            "Re-evaluate skipped tasks when network gas fees decline."
        ],
        "area": "Keeper Service (`keeper/src/insights.js`)"
    },
    {
        "title": "🤖 [KEEPER] P2P Peer-to-Peer Task Auction Gossipsub Network for Keeper Coordination",
        "labels": "keeper,architecture,feature",
        "summary": "Build libp2p pubsub gossip network for decentralized keeper task allocation and auctioning.",
        "problem": "Centralized keeper task dispatchers create single points of failure.",
        "solution": [
            "Integrate @libp2p gossipsub protocol into keeper node runtime.",
            "Broadcast task claim intent messages over P2P topic before executing.",
            "Resolve execution conflicts off-chain among keeper peer nodes."
        ],
        "area": "Keeper Service (`keeper/src/p2pNetwork.js`)"
    },
    {
        "title": "🤖 [KEEPER] Dead-Letter Queue (DLQ) Management System with Auto-Alerting",
        "labels": "keeper,reliability,architecture",
        "summary": "Implement Dead-Letter Queue (DLQ) for isolating repeatedly failing task executions.",
        "problem": "Permanently failing tasks consume keeper resources in endless retry loops.",
        "solution": [
            "Move task to DLQ after N consecutive execution failures.",
            "Trigger automated alert notification to task creator and keeper operator.",
            "Provide CLI commands to inspect, retry, or purge DLQ task records."
        ],
        "area": "Keeper Service (`keeper/src/retryScheduler.js`)"
    },
    {
        "title": "🤖 [KEEPER] OpenTelemetry Distributed Tracing & W3C Trace Context Propagation",
        "labels": "keeper,devops,reliability",
        "summary": "Integrate OpenTelemetry tracing SDK to correlate logs from polling to on-chain inclusion.",
        "problem": "Debugging multi-step task delays across distributed keeper clusters is difficult without trace IDs.",
        "solution": [
            "Inject W3C traceparent headers into task execution context.",
            "Export OpenTelemetry traces to Jaeger / Datadog / Grafana Tempo.",
            "Correlate trace IDs with Stellar transaction hashes for full visibility."
        ],
        "area": "Keeper Service (`keeper/src/logger.js`)"
    },
    {
        "title": "🤖 [KEEPER] Graceful Process Shutdown & In-Flight Transaction State Recovery",
        "labels": "keeper,reliability,devops",
        "summary": "Implement graceful SIGTERM signal handling to complete active transactions before process exit.",
        "problem": "Abrupt process termination during deployments leaves held locks and unconfirmed transactions.",
        "solution": [
            "Intercept SIGTERM/SIGINT signals in main process wrapper.",
            "Stop accepting new polling tasks and wait for in-flight RPC calls to finish.",
            "Release held Redis locks cleanly before exiting with code 0."
        ],
        "area": "Keeper Service (`keeper/src/gracefulShutdown.js`)"
    },
    {
        "title": "🤖 [KEEPER] Webhook Trigger Router with HMAC Signature & Anti-Replay Protection",
        "labels": "keeper,security,feature",
        "summary": "Expose secure HTTPS webhook endpoint for triggering event-driven task executions instantly.",
        "problem": "Polling-only tasks suffer latency when responding to external real-world events.",
        "solution": [
            "Build POST /webhook/trigger route secured with HMAC SHA-256 signatures.",
            "Verify timestamp sliding window and nonce to prevent replay attacks.",
            "Dispatch task execution queue item immediately upon webhook validation."
        ],
        "area": "Keeper Service (`keeper/src/webhookTrigger.js`)"
    },
    {
        "title": "🤖 [KEEPER] In-Memory Task Metadata Cache with Event-Driven Invalidation",
        "labels": "keeper,performance,optimization",
        "summary": "Implement TTL LRU cache for task configurations to reduce redundant RPC state queries.",
        "problem": "Repeated RPC calls for unchanged task configurations consume excessive network bandwidth.",
        "solution": [
            "Store task metadata in-memory using LRU cache with 60-second TTL.",
            "Invalidate cached entry instantly upon receiving TaskUpdated event.",
            "Reduce contract state RPC query volume by up to 75%."
        ],
        "area": "Keeper Service (`keeper/src/registry.js`)"
    },
    {
        "title": "🤖 [KEEPER] Dynamic Shard Hash Ring Re-Balancing across Active Keeper Nodes",
        "labels": "keeper,architecture,scaling",
        "summary": "Implement consistent hashing ring for dynamically sharding task workloads across keeper clusters.",
        "problem": "Static task assignment fails when keeper nodes join or leave the cluster unexpectedly.",
        "solution": [
            "Implement Consistent Hash Ring mapping task IDs to active node IDs.",
            "Re-balance task assignments automatically when a keeper node joins or leaves.",
            "Ensure zero task coverage gaps during cluster scaling."
        ],
        "area": "Keeper Service (`keeper/src/sharding.js`)"
    },

    # --- Category 3: ZK-Proof Service (12) ---
    {
        "title": "🛡️ [ZK-SERVICE] GPU-Accelerated MSM and NTT Prover Pipeline using CUDA & Metal",
        "labels": "zk-proof-service,performance",
        "summary": "Offload Multi-Scalar Multiplication (MSM) and Number Theoretic Transform (NTT) to GPU hardware.",
        "problem": "CPU-only ZK proof generation for 100K+ constraint circuits takes 10+ seconds per proof.",
        "solution": [
            "Integrate Rapidsnark / CudaProver GPU bindings into proof generation engine.",
            "Execute MSM and NTT computations on NVIDIA CUDA or Apple Metal hardware.",
            "Reduce proof generation duration from 10s to <400ms."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Recursive Proof Aggregation (SnarkPack) for Low Gas On-Chain Verification",
        "labels": "zk-proof-service,performance,architecture",
        "summary": "Implement recursive proof aggregation to combine N execution proofs into 1 verifiable proof.",
        "problem": "Verifying individual ZK proofs on-chain for batch tasks incurs high aggregate gas fees.",
        "solution": [
            "Integrate SnarkPack proof aggregation library into zk-proof-service.",
            "Aggregate up to 64 individual task execution proofs into single proof payload.",
            "Reduce on-chain verification gas costs by up to 85%."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Halo2 Universal SRS Verification Gateway without Trusted Setup",
        "labels": "zk-proof-service,feature,security",
        "summary": "Integrate Halo2 proof system support eliminating per-circuit trusted setup ceremonies.",
        "problem": "Groth16 requires a distinct phase 2 trusted setup for every newly created task condition circuit.",
        "solution": [
            "Integrate halo2-wasm prover and verifier engine.",
            "Support universal SRS parameters for arbitrary condition circuits.",
            "Expose POST /generate-proof/halo2 and POST /verify-proof/halo2 endpoints."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Client-Side WASM Proof Prover Library with Fallback Backend",
        "labels": "zk-proof-service,feature",
        "summary": "Build client-side WASM prover library enabling in-browser proof generation.",
        "problem": "Sending private witness data to backend servers creates privacy dependencies.",
        "solution": [
            "Package SnarkJS prover into client-side WASM npm package (@sorotask/zk-client).",
            "Generate proofs locally in user browser without transmitting witness inputs over network.",
            "Fallback to server-side proof service on low-resource mobile devices."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] ECIES Encrypted Witness Payload Transport and Zero-Memory Sanitization",
        "labels": "zk-proof-service,security",
        "summary": "Encrypt client witness data in transit using ECIES and sanitize memory post-proof generation.",
        "problem": "Plaintext witness parameters in HTTP request bodies risk exposure in server logs or proxy caches.",
        "solution": [
            "Implement ECIES secp256k1 public key encryption for witness request payloads.",
            "Decrypt witness in isolated worker thread memory buffer.",
            "Zero out decrypted witness memory buffers immediately after proof generation."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/helpers.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Circuit Under-Constraint Formal Verification Auditor & Fuzzing Suite",
        "labels": "zk-proof-service,security,quality",
        "summary": "Build static analysis fuzzer to detect under-constrained signals in Circom circuits.",
        "problem": "Under-constrained circuits allow malicious actors to forge valid proofs with fraudulent inputs.",
        "solution": [
            "Integrate CircomSpect formal verification tool into circuit compilation pipeline.",
            "Fuzz constraint systems with randomized input vectors.",
            "Fail build pipeline if unassigned or under-constrained signals are detected."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] 2-of-3 MPC Threshold Key Generation for Witness Decryption",
        "labels": "zk-proof-service,security,architecture",
        "summary": "Implement 2-of-3 Multi-Party Computation (MPC) threshold protocol for witness decryption.",
        "problem": "Storing decryption keys on a single server node exposes witness data if that node is compromised.",
        "solution": [
            "Split decryption key shares across 3 independent server nodes using Shamir Secret Sharing.",
            "Decrypt witness parameters cooperatively without any single node possessing full key.",
            "Guarantee maximum data privacy for enterprise users."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Automated Powers of Tau Ceremony Checksum Verification Engine",
        "labels": "zk-proof-service,security,devops",
        "summary": "Implement zkey artifact checksum auditor to verify setup file integrity before service start.",
        "problem": "Using corrupted or compromised zkey files undermines zero-knowledge proof soundness.",
        "solution": [
            "Verify SHA-256 checksum of Powers of Tau setup files during service initialization.",
            "Compare checksum against published official ceremony records.",
            "Abort service startup if zkey integrity validation fails."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Proof Generation Redis Cache & Hash Deduplication Middleware",
        "labels": "zk-proof-service,performance,optimization",
        "summary": "Cache generated proofs in Redis by witness hash to prevent redundant proof calculations.",
        "problem": "Duplicate proof generation requests with identical inputs waste high CPU compute resources.",
        "solution": [
            "Compute SHA-256 hash of (circuit_id, condition_params, public_inputs).",
            "Check Redis proof cache before spawning prover worker thread.",
            "Return cached serialized proof immediately on cache hit."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Rate Limiting & Token Bucket Middleware for Proof Generation Endpoints",
        "labels": "zk-proof-service,security",
        "summary": "Implement rate limiting middleware on /generate-proof to prevent CPU exhaustion DoS attacks.",
        "problem": "Unthrottled POST requests to proof endpoints can saturate service CPU resources completely.",
        "solution": [
            "Integrate express-rate-limit with Redis token bucket backend.",
            "Enforce rate limit of 15 proof requests per minute per IP address.",
            "Return HTTP 429 Too Many Requests with Retry-After header on limit breach."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] OpenAPI v3 Schema Validation Middleware with Express Validator",
        "labels": "zk-proof-service,quality,documentation",
        "summary": "Validate incoming HTTP payloads strictly against openapi.yaml schema definition.",
        "problem": "Malformed JSON request bodies cause unhandled exceptions deep in witness calculation libraries.",
        "solution": [
            "Integrate express-openapi-validator middleware using existing openapi.yaml.",
            "Validate request body parameters and types before route handler execution.",
            "Return standardized 400 Bad Request responses with detailed validation error details."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Asynchronous Proof Generation Queue with Server-Sent Events (SSE)",
        "labels": "zk-proof-service,feature,ux",
        "summary": "Support asynchronous proof job queuing with SSE progress streaming for complex circuits.",
        "problem": "Synchronous HTTP POST requests for complex proofs time out on gateway proxies (e.g. 30s timeout).",
        "solution": [
            "Expose POST /proofs/async returning immediate job_id and status: queued.",
            "Expose GET /proofs/:job_id/stream SSE endpoint streaming proof calculation progress.",
            "Deliver final proof payload over SSE stream upon completion."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },

    # --- Category 4: Indexer Service (12) ---
    {
        "title": "📊 [INDEXER] Real-Time GraphQL Subscriptions Engine with WebSocket Live Streams",
        "labels": "indexer,feature,realtime",
        "summary": "Build GraphQL API server with WebSocket subscriptions for streaming task events to frontends.",
        "problem": "Frontend dashboards polling REST endpoints create excessive HTTP traffic and latency.",
        "solution": [
            "Integrate Apollo GraphQL Server into indexer service.",
            "Define GraphQL schema for Task, ExecutionHistory, Keeper, and Event models.",
            "Expose WebSocket subscriptions for real-time task status updates."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] PostgreSQL TimescaleDB Migration & Hypertable Time-Series Partitioning",
        "labels": "indexer,database,performance",
        "summary": "Migrate indexer SQLite storage to PostgreSQL TimescaleDB for time-series execution metrics.",
        "problem": "SQLite storage cannot handle high-throughput event logs or fast time-bucket aggregate queries.",
        "solution": [
            "Design PostgreSQL hypertable schema partitioned into 7-day time chunks.",
            "Enable continuous aggregates for hourly and daily execution performance metrics.",
            "Provide zero-downtime migration script from SQLite indexer.db."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] High-Throughput Parallel Ledger Parsing Engine with Worker Threads",
        "labels": "indexer,performance,architecture",
        "summary": "Implement multi-threaded worker pipeline for parsing Soroban contract events in parallel.",
        "problem": "Single-threaded event ingestion falls behind during high-throughput Stellar network ledgers.",
        "solution": [
            "Divide ledger sequence ranges across worker thread pool.",
            "Parse TaskRegistered and TaskExecuted XDR events concurrently.",
            "Batch write parsed events into database using single transaction."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Cold Storage Data Archival Strategy with Parquet S3 Export",
        "labels": "indexer,database,infrastructure",
        "summary": "Build automated cold storage archiver exporting events older than 90 days to Apache Parquet S3 files.",
        "problem": "Unbounded database table growth degrades query performance and increases storage costs.",
        "solution": [
            "Build automated cron job exporting historical events to compressed Parquet files on AWS S3.",
            "Prune archived event rows from primary database table.",
            "Expose analytical query interface using DuckDB on S3 files."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Real-Time Webhook Notification Dispatcher with Exponential Backoff",
        "labels": "indexer,feature,reliability",
        "summary": "Dispatch signed HTTP webhook notifications to task creators upon event ingestion.",
        "problem": "Task creators have no automated push notification mechanism when their tasks execute on-chain.",
        "solution": [
            "Allow registering webhook_url and secret_key per task.",
            "Dispatch signed HMAC POST payload upon ingesting TaskExecuted events.",
            "Retry failed deliveries up to 5 times with exponential backoff."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Automated Database Schema Migration System for Contract Upgrades",
        "labels": "indexer,database,architecture",
        "summary": "Build schema migration runner to adapt indexer database tables to contract struct updates.",
        "problem": "Updating smart contract struct fields breaks existing indexer database write queries.",
        "solution": [
            "Version indexer database schemas matching contract WASM version hashes.",
            "Execute automated schema migration scripts during deployment.",
            "Support dual-parsing of old and new contract event structures."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] Cryptographic Merkle Tree Event Integrity Auditor for Ledger Verification",
        "labels": "indexer,security,reliability",
        "summary": "Build background auditor validating stored events against raw Stellar ledger transaction hashes.",
        "problem": "Silent database corruption or bug in event parser could persist invalid event data.",
        "solution": [
            "Recalculate Merkle root of indexed events per ledger sequence in background.",
            "Compare Merkle root against official Stellar ledger header transaction root.",
            "Alert operator immediately if state divergence is detected."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Prometheus Metrics Exporter for Indexer Lag & Event Processing Rate",
        "labels": "indexer,devops,monitoring",
        "summary": "Expose /metrics endpoint for tracking indexer lag relative to Stellar network head.",
        "problem": "Operators lack visibility into indexer delay relative to the latest Stellar network ledger.",
        "solution": [
            "Integrate prom-client library into indexer service.",
            "Export metrics: indexer_ledger_head, network_ledger_head, indexer_lag_ledgers, events_indexed_total.",
            "Create Grafana dashboard template in docs/."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Active-Passive Dual Node Indexer High Availability & Failover",
        "labels": "indexer,architecture,reliability",
        "summary": "Deploy active-passive indexer cluster with automatic failover to eliminate single points of failure.",
        "problem": "Single indexer node crash causes dashboard downtime and missed event tracking.",
        "solution": [
            "Deploy secondary standby indexer instance with continuous state sync.",
            "Implement heartbeat monitor promoting standby node if primary fails.",
            "Guarantee 99.9% uptime for indexer API."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] REST API JWT Authorization Middleware & Rate Limiting Engine",
        "labels": "indexer,api,security",
        "summary": "Secure indexer REST endpoints with JWT authentication and per-key rate limits.",
        "problem": "Unauthenticated public API routes are vulnerable to resource exhaustion from heavy search queries.",
        "solution": [
            "Integrate express-jwt middleware for API authentication.",
            "Issue developer API keys with configurable rate limits (e.g. 100 req/min).",
            "Enforce token bucket rate limiting on public routes via Redis."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Redis Cache Invalidation Engine triggered by On-Chain Events",
        "labels": "indexer,performance,optimization",
        "summary": "Implement event-driven Redis cache invalidation engine to guarantee data freshness.",
        "problem": "Stale API query cache results display outdated task state after new ledger events.",
        "solution": [
            "Publish cache invalidation events over Redis pub/sub upon ingesting new block.",
            "Purge affected task_id and creator query keys targeted by events.",
            "Maintain sub-5ms API response latency while ensuring exact data freshness."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Synthetic Heartbeat Transaction Monitoring & SLA Alerting",
        "labels": "indexer,monitoring,reliability",
        "summary": "Build synthetic transaction bot that submits test transactions to verify end-to-end indexer health.",
        "problem": "Without synthetic monitoring, silent indexer ingestion failures are difficult to detect proactively.",
        "solution": [
            "Submit testnet heartbeat transaction every 5 minutes.",
            "Verify end-to-end event ingestion into database within <10 seconds.",
            "Trigger PagerDuty alert if synthetic transaction fails to index within SLA window."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },

    # --- Category 5: Frontend (12) ---
    {
        "title": "💻 [FRONTEND] Interactive Task Flow Visualizer & Drag-and-Drop DAG Graph Editor",
        "labels": "frontend,feature,ux",
        "summary": "Build visual DAG graph editor (using React Flow) for designing multi-step task dependencies.",
        "problem": "Configuring complex multi-step task dependencies via raw JSON forms is error-prone.",
        "solution": [
            "Integrate React Flow library into task creation dashboard.",
            "Render visual nodes for Tasks, Resolvers, and Contracts with drag-and-drop connectors.",
            "Export graph topology directly into contract register() parameter payload."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Multi-Wallet Connection Hub (Freighter, Albedo, xBull, Lobstr)",
        "labels": "frontend,feature,web3",
        "summary": "Integrate Stellar Wallet Kit supporting Freighter, Albedo, xBull, and Lobstr wallets.",
        "problem": "Supporting only Freighter wallet limits user accessibility on mobile and alternative Stellar wallets.",
        "solution": [
            "Integrate @stellar/wallet-kit into application context provider.",
            "Provide modal UI for selecting Freighter, Albedo, xBull, or Lobstr.",
            "Persist wallet session and support network switching (Testnet / Mainnet)."
        ],
        "area": "Frontend (`frontend/context/`, `frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Interactive Task Creation Wizard with Soroban Pre-flight Simulation",
        "labels": "frontend,feature,ux",
        "summary": "Build step-by-step task creation wizard with live on-chain simulation checks.",
        "problem": "Users register tasks with invalid parameters or insufficient gas, resulting in lost deposits.",
        "solution": [
            "Build 4-step wizard: Target Contract -> Function & Args -> Trigger Interval -> Gas Deposit.",
            "Run live simulateTransaction() RPC check in step 3 to verify contract readiness.",
            "Display estimated monthly execution cost and recommended gas balance."
        ],
        "area": "Frontend (`frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Keeper Performance & Financial Profitability Analytics Dashboard",
        "labels": "frontend,feature,analytics",
        "summary": "Build dedicated analytics dashboard for keeper operators tracking earnings and gas costs.",
        "problem": "Keeper operators lack visual dashboards to monitor profitability, execution counts, and gas trends.",
        "solution": [
            "Build /keeper-dashboard page with Recharts data visualizations.",
            "Display daily XLM earned, total executions, success vs failure pie chart, and gas trends.",
            "Export performance analytics reports as CSV/JSON."
        ],
        "area": "Frontend (`frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Full WCAG 2.1 AA Accessibility Refactoring & Screen Reader Support",
        "labels": "frontend,quality,accessibility",
        "summary": "Refactor frontend components to guarantee full WCAG 2.1 AA accessibility compliance.",
        "problem": "UI components lack proper ARIA attributes, keyboard focus indicators, and screen reader announcements.",
        "solution": [
            "Audit UI components using axe-core and Lighthouse accessibility testing.",
            "Add ARIA roles, labels, and live regions for dynamic status updates.",
            "Ensure full keyboard navigation across modals, forms, and data tables."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Dark/Light Mode Theme System with Tailwind CSS Design Tokens",
        "labels": "frontend,ui,enhancement",
        "summary": "Implement dark/light theme switching with CSS variables and Tailwind design tokens.",
        "problem": "Application currently uses hardcoded dark colors without supporting light theme preference.",
        "solution": [
            "Integrate next-themes provider into layout.tsx.",
            "Define theme tokens in design-tokens.md and tailwind.config.js for background, surface, text, and accent.",
            "Provide theme toggle button with OS system preference auto-detection."
        ],
        "area": "Frontend (`frontend/app/`, `frontend/tailwind.config.js`)"
    },
    {
        "title": "💻 [FRONTEND] Real-Time Toast Notification Queue for Web3 Transaction Lifecycle",
        "labels": "frontend,ux,feature",
        "summary": "Build resilient toast notification queue tracking multi-step Web3 transaction lifecycles.",
        "problem": "Users are left uncertain during long wallet signing and ledger confirmation phases.",
        "solution": [
            "Integrate Sonner / react-hot-toast notification queue.",
            "Display progressive states: 1. Awaiting Signature -> 2. Submitting to Soroban -> 3. Confirmed on Ledger.",
            "Include direct link to Stellar Expert block explorer for confirmed transactions."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Progressive Web App (PWA) Offline Caching with Workbox Service Workers",
        "labels": "frontend,performance",
        "summary": "Convert Next.js frontend into a Progressive Web App (PWA) with offline caching support.",
        "problem": "Dashboard fails to load or view cached task history when internet connection is intermittent.",
        "solution": [
            "Integrate @ducanh2912/next-pwa plugin into next.config.js.",
            "Cache static assets, fonts, and read-only task queries using Workbox service worker.",
            "Add web app manifest for mobile home screen installation."
        ],
        "area": "Frontend (`frontend/next.config.ts`, `frontend/public/`)"
    },
    {
        "title": "💻 [FRONTEND] Multi-Language Internationalization (i18n) Framework Integration",
        "labels": "frontend,feature",
        "summary": "Integrate next-intl framework to support multi-language translations across dashboard pages.",
        "problem": "Dashboard UI is hardcoded in English, limiting global accessibility for non-English users.",
        "solution": [
            "Integrate next-intl routing and translation provider.",
            "Extract string literals into JSON locale dictionaries (en, es, pt, zh).",
            "Add language selector dropdown in navigation header."
        ],
        "area": "Frontend (`frontend/i18n/`, `frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Sentry Error Monitoring & Client-Side Telemetry Integration",
        "labels": "frontend,devops,monitoring",
        "summary": "Configure Sentry error boundary and performance monitoring across Next.js client and server.",
        "problem": "Uncaught React component errors or Web3 wallet connection failures occur in production without telemetry.",
        "solution": [
            "Configure @sentry/nextjs SDK in sentry.client.config.ts and sentry.server.config.ts.",
            "Wrap application in Sentry ErrorBoundary displaying user recovery UI on crash.",
            "Capture custom Breadcrumbs for wallet connection and transaction lifecycle events."
        ],
        "area": "Frontend (`frontend/sentry.client.config.ts`)"
    },
    {
        "title": "💻 [FRONTEND] Virtualized Large List Rendering for Performance Optimization",
        "labels": "frontend,performance",
        "summary": "Implement virtualized windowed rendering for task list tables displaying thousands of items.",
        "problem": "Rendering thousands of DOM table rows causes browser UI thread freezing and slow scroll performance.",
        "solution": [
            "Integrate @tanstack/react-virtual for list table rendering.",
            "Only render DOM nodes currently visible within browser viewport.",
            "Maintain smooth 60fps scrolling performance regardless of table item count."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Playwright E2E Integration Testing Suite for Core User Flows",
        "labels": "frontend,testing,quality",
        "summary": "Build Playwright end-to-end integration test suite running against local Mock Soroban network.",
        "problem": "Manual QA testing before releases risks introducing regressions in core task creation flows.",
        "solution": [
            "Set up Playwright test environment in frontend/e2e/.",
            "Write E2E test scenarios: Wallet Connect -> Create Task -> Simulate Execution -> Cancel Task.",
            "Run Playwright suite automatically on PR pull requests in GitHub Actions."
        ],
        "area": "Frontend (`frontend/e2e/`, `frontend/playwright.config.ts`)"
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
    time.sleep(0.4)

print("Finished creating 60 issues!")

import subprocess
import time

issues = [
    # --- Category 1: Smart Contracts (12) ---
    {
        "title": "🦀 [CONTRACT] Implement Dynamic Protocol Fee Discount Tiers for High-Volume Task Creators",
        "labels": "contract,feature",
        "summary": "Implement volume-based fee discount tiers for protocol execution fees in contract storage.",
        "problem": "High-volume enterprise users scheduling thousands of recurring tasks incur linear fee scaling, reducing protocol competitiveness.",
        "solution": [
            "Track cumulative user execution count in persistent storage.",
            "Apply tiered discount rates (e.g., 10% discount after 100 executions, 25% after 1000).",
            "Emit FeeDiscountTierUpdated event upon tier progression."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Automated Emergency Circuit Breaker Triggered by Suspicious Volatility Oracles",
        "labels": "contract,security",
        "summary": "Implement an automated circuit breaker halting execution if oracle price volatility exceeds safety thresholds.",
        "problem": "Flash loan attacks or price oracle manipulation can trigger invalid task executions before keepers or admins can react.",
        "solution": [
            "Monitor single-block price delta against configurable max_volatility_bps threshold.",
            "Automatically trip contract circuit breaker and pause execution when threshold is breached.",
            "Require timelocked admin governance to unpause after volatility investigation."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Optimistic Task Execution Window with Off-Chain Fraud Proof Challenges",
        "labels": "contract,architecture",
        "summary": "Add an optimistic execution mode where tasks execute immediately and allow a challenge window for fraud proofs.",
        "problem": "Complex condition evaluations incur heavy gas costs on-chain for every execution attempt.",
        "solution": [
            "Allow keepers to submit optimistic state execution results with a collateral bond.",
            "Enable a 100-ledger challenge window where challengers can submit fraud proofs.",
            "Slash invalid keeper bonds and reward successful fraud proof challengers."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Multi-Asset Liquidity Pool Auto-Routing for Task Execution Compensation",
        "labels": "contract,feature",
        "summary": "Support auto-swapping task bounties paid in custom tokens into native XLM or USDC during execution.",
        "problem": "Keepers prefer receiving bounties in stable tokens or XLM, while task creators prefer paying in project native tokens.",
        "solution": [
            "Integrate Soroban DEX router interface directly into contract execute() workflow.",
            "Auto-swap project native token bounties to preferred keeper payout asset upon completion.",
            "Handle swap slippage protection gracefully."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Time-Bound Flash Loan Integration for Capital-Efficient Arbitrage Executions",
        "labels": "contract,feature",
        "summary": "Enable task execution calls to borrow flash loans within the execution transaction lifecycle.",
        "problem": "Automated arbitrage and liquidation tasks require substantial upfront capital that keepers may not hold natively.",
        "solution": [
            "Expose flash_execute(task_id, loan_amount, asset) function.",
            "Borrow capital from lending pool, execute task condition, and repay loan within single atomic transaction.",
            "Revert transaction completely if loan repayment check fails."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Granular Task Rate Limiting per Ledger Block to Prevent Gas Spikes",
        "labels": "contract,optimization",
        "summary": "Enforce per-block execution caps on tasks to prevent network gas congestion and mempool flooding.",
        "problem": "When dozens of tasks hit their due timestamps in the exact same ledger, gas prices surge violently.",
        "solution": [
            "Track total_block_executions in temporary instance storage.",
            "Cap maximum task executions allowed in a single ledger block (e.g. 50 tasks/block).",
            "Defer remaining tasks to subsequent ledgers automatically."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Cross-Contract State Invalidation Hooks for Upstream Protocol Upgrades",
        "labels": "contract,architecture",
        "summary": "Implement callback hook registration so external target contracts can notify SoroTask of interface updates.",
        "problem": "When a target contract upgrades its WASM logic, registered automation tasks fail silently due to invalid selector signatures.",
        "solution": [
            "Expose register_invalidation_hook(target_contract, callback_fn) in contract.",
            "Allow target contracts to trigger task pause or parameters re-validation upon upgrade.",
            "Emit TaskInvalidated(task_id, reason) event to notify task creator."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Encrypted On-Chain State Parameters using Homomorphic Encryption Wrappers",
        "labels": "contract,security",
        "summary": "Implement privacy-preserving task parameters using encrypted field wrappers.",
        "problem": "Public contract storage exposes sensitive execution conditions (e.g. secret liquidation thresholds) to MEV bots.",
        "solution": [
            "Store encrypted parameter payloads in TaskConfig struct.",
            "Decrypt parameters securely in-memory using homomorphic evaluation or ZK proofs.",
            "Prevent front-running bots from inspecting condition parameters on block explorers."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Automated Bounty Inflation Protection linked to Consumer Price Index (CPI) Feeds",
        "labels": "contract,enhancement",
        "summary": "Implement auto-adjusting bounties for long-term recurring tasks based on inflation index feeds.",
        "problem": "Tasks scheduled to run for years suffer bounty value erosion due to token inflation or shifting gas economics.",
        "solution": [
            "Query CPI/gas inflation index oracle during task execution check.",
            "Scale minimum keeper bounty percentage proportionally over time.",
            "Notify task creator when escrow falls below projected 6-month threshold."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] On-Chain Multi-Task Bundle Swap Router for Multi-DApp Automations",
        "labels": "contract,feature",
        "summary": "Create atomic multi-task bundling router executing sequential actions across different Stellar dApps.",
        "problem": "Complex DeFi strategies require multi-contract orchestration (e.g. swap on DEX -> supply to Lending -> stake receipt).",
        "solution": [
            "Support Array of (target_contract, function, args) inside a single TaskBundle struct.",
            "Execute invocations in exact array sequence, passing intermediate return values forward.",
            "Revert entire bundle if any intermediate dApp call fails."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Keeper Stake Delegation & Staking Pool Reward Redistribution",
        "labels": "contract,feature",
        "summary": "Allow token holders to delegate stake to trusted keeper operators and earn a share of execution bounties.",
        "problem": "Individual keeper operators lack capital to post high collateral bonds required for enterprise tasks.",
        "solution": [
            "Build DelegationPool contract mapping delegators to keeper addresses.",
            "Distribute earned keeper bounties proportionally to delegators minus operator commission.",
            "Apply proportional slashing to delegators if keeper commits fraud."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },
    {
        "title": "🦀 [CONTRACT] Verifiable Delay Function (VDF) Gate for Non-Manipulable Execution Delays",
        "labels": "contract,security",
        "summary": "Integrate VDF proof verification to enforce un-cheatable time delays between task executions.",
        "problem": "Ledger timestamps can be slightly manipulated by miners/validators within small time windows.",
        "solution": [
            "Require VDF proof evaluation output for time-critical delay enforcement.",
            "Verify VDF proof on-chain before updating last_run timestamp.",
            "Guarantee strict sequential time delays independent of validator clock drift."
        ],
        "area": "Smart Contracts (`contract/src/lib.rs`)"
    },

    # --- Category 2: Keeper Bot (12) ---
    {
        "title": "🤖 [KEEPER] Machine Learning Dynamic Transaction Gas Priority Bumper based on Ledger Mempool",
        "labels": "keeper,optimization",
        "summary": "Build dynamic gas priority bidding model that analyzes live mempool fee distribution.",
        "problem": "Using static gas fees leads to transaction dropouts during sudden network traffic spikes.",
        "solution": [
            "Analyze current pending transactions in Stellar RPC mempool.",
            "Calculate 90th percentile gas fee and set optimal priority bid.",
            "Achieve >99.5% first-ledger inclusion rate for keeper transactions."
        ],
        "area": "Keeper Service (`keeper/src/gasMonitor.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automated RPC Node Failover with Real-Time Latency Heatmap Tracking",
        "labels": "keeper,reliability",
        "summary": "Implement live latency heatmap and automatic zero-downtime failover across 10+ RPC endpoints.",
        "problem": "Public RPC nodes frequently rate-limit or drop connections without HTTP error responses.",
        "solution": [
            "Maintain rolling 1-minute HTTP response latency matrix for each RPC URL.",
            "Automatically remove degraded endpoints from active rotation.",
            "Fail over to backup nodes within <100ms."
        ],
        "area": "Keeper Service (`keeper/src/disasterRecovery.js`)"
    },
    {
        "title": "🤖 [KEEPER] Multi-Sig Transaction Builder with Hardware Security Module (HSM) Signing",
        "labels": "keeper,security",
        "summary": "Integrate YubiHSM and AWS CloudHSM support for multi-signature keeper transaction signing.",
        "problem": "High-value keeper accounts require multi-signature approval and non-exportable hardware key security.",
        "solution": [
            "Implement PKCS#11 hardware module driver in keeper account loader.",
            "Construct multi-signature Soroban envelope and sign via HSM hardware.",
            "Prevent key extraction even if underlying OS host is compromised."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] Decentralized Task Bidding Auction Engine for Keeper Execution Ordering",
        "labels": "keeper,architecture",
        "summary": "Implement off-chain P2P bidding protocol where keepers compete on lowest gas fee to execute tasks.",
        "problem": "Multiple keepers competing on-chain for the same task waste transaction fees in gas wars.",
        "solution": [
            "Keepers broadcast signed fee bids over libp2p pubsub network.",
            "Lowest bidder earns exclusive right to execute task within short 5-ledger window.",
            "Eliminate redundant gas expenditure across keeper cluster."
        ],
        "area": "Keeper Service (`keeper/src/p2pNetwork.js`)"
    },
    {
        "title": "🤖 [KEEPER] Real-Time Performance Analytics & Exportable PDF Financial Audit Logs",
        "labels": "keeper,analytics",
        "summary": "Generate automated monthly accounting PDFs detailing gas spent, bounties earned, and net profit.",
        "problem": "Keeper node operators struggle to reconcile gas expenditures against earned bounties for tax compliance.",
        "solution": [
            "Build automated reporting engine generating PDF/CSV monthly audit statements.",
            "Track daily XLM/USD exchange rates at time of execution.",
            "Provide itemized transaction logs with block explorer verification links."
        ],
        "area": "Keeper Service (`keeper/src/history.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automatic Container Resource Scaling & Memory Footprint Optimizer",
        "labels": "keeper,optimization",
        "summary": "Implement dynamic memory and event loop monitoring to auto-throttle background workloads.",
        "problem": "Node.js garbage collection pauses during high-frequency polling degrade execution timeliness.",
        "solution": [
            "Monitor V8 heap usage and event loop lag in real-time.",
            "Trigger proactive V8 GC and adjust worker thread pool size dynamically.",
            "Prevent memory leaks and keep event loop latency below 5ms."
        ],
        "area": "Keeper Service (`keeper/src/validator.js`)"
    },
    {
        "title": "🤖 [KEEPER] Webhook Signature Replay Attack Protection with Ephemeral Nonces",
        "labels": "keeper,security",
        "summary": "Protect webhook trigger endpoints against replay attacks using timestamp sliding windows and nonces.",
        "problem": "Attachers intercepting valid webhook trigger calls can replay them to trigger unauthorized evaluations.",
        "solution": [
            "Require X-Signature-Timestamp and X-Nonce headers on all incoming webhooks.",
            "Reject webhooks older than 300 seconds or containing previously seen nonces in Redis.",
            "Guarantee strict single-execution semantics for webhooks."
        ],
        "area": "Keeper Service (`keeper/src/webhookAuth.js`)"
    },
    {
        "title": "🤖 [KEEPER] Task Dependency Graph Topology Solver for Concurrent Multi-Threaded Execution",
        "labels": "keeper,architecture",
        "summary": "Build topological sort dependency solver for executing multi-task DAGs in optimal parallel order.",
        "problem": "Sequential execution of dependent tasks wastes time waiting for ledger confirmations between steps.",
        "solution": [
            "Construct in-memory DAG representation of all registered task dependencies.",
            "Solve topological ordering and group independent tasks into concurrent execution batches.",
            "Reduce total DAG completion time by up to 60%."
        ],
        "area": "Keeper Service (`keeper/src/queue.js`)"
    },
    {
        "title": "🤖 [KEEPER] Automated Native XLM Reserve Auto-Balance Transfer via Decentralized Anchors",
        "labels": "keeper,automation",
        "summary": "Automatically top up keeper XLM reserves from fiat bank accounts via SEP-24/SEP-31 Stellar Anchors.",
        "problem": "Keeper nodes shutdown permanently if native XLM balance drops to 0 while operator is sleeping.",
        "solution": [
            "Monitor minimum XLM operating reserve.",
            "Trigger automated ACH/SEPA deposit via Stellar Anchor SEP-24 API when reserve is low.",
            "Maintain continuous automated node operation without human intervention."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] High-Frequency Event Stream Ingestion Engine using Apache Kafka / Redpanda",
        "labels": "keeper,architecture",
        "summary": "Integrate Apache Kafka event streaming pipeline for processing millions of due tasks per minute.",
        "problem": "In-memory JavaScript arrays suffer memory pressure and data loss during node restarts.",
        "solution": [
            "Replace internal queue with Kafka / Redpanda event streaming topic.",
            "Partition task execution topics by task_id hash for linear scaling.",
            "Achieve zero-data-loss execution guarantees with at-least-once delivery."
        ],
        "area": "Keeper Service (`keeper/src/queue.js`)"
    },
    {
        "title": "🤖 [KEEPER] Cold Storage Key Vault Migration Tool with Zero-Downtime Secret Rotation",
        "labels": "keeper,security",
        "summary": "Build zero-downtime key rotation CLI allowing operators to rotate signing keys seamlessly.",
        "problem": "Changing keeper account keys requires stopping the bot, leaving tasks unmonitored during migration.",
        "solution": [
            "Implement dual-key signing transition mode in account manager.",
            "Sign new transactions with primary key while delegating secondary permissions.",
            "Complete key rotation with zero missing polling cycles."
        ],
        "area": "Keeper Service (`keeper/src/account.js`)"
    },
    {
        "title": "🤖 [KEEPER] Distributed Rate Limiting & Sliding Window Token Bucket across Clusters",
        "labels": "keeper,reliability",
        "summary": "Implement cluster-wide sliding window token bucket to strictly enforce Stellar RPC rate limits.",
        "problem": "Multiple keeper worker processes hitting the same RPC endpoint exhaust rate limits simultaneously.",
        "solution": [
            "Coordinate RPC request token buckets across nodes using Redis.",
            "Enforce global limit (e.g. 100 RPC req/sec total across cluster).",
            "Eliminate HTTP 429 rate limit responses from RPC providers."
        ],
        "area": "Keeper Service (`keeper/src/poller.js`)"
    },

    # --- Category 3: ZK-Proof Service (12) ---
    {
        "title": "🛡️ [ZK-SERVICE] GPU-Accelerated Prover Engine (CUDA / Metal) for Ultra-Fast Witness Generation",
        "labels": "zk-proof-service,performance",
        "summary": "Accelerate Groth16/Plonk proof generation using GPU hardware acceleration (NVIDIA CUDA & Apple Metal).",
        "problem": "CPU-only proof generation for 1M+ constraint circuits takes 15+ seconds, stalling real-time task execution.",
        "solution": [
            "Integrate Rapidsnark / CudaProver GPU bindings into proof generation service.",
            "Offload Multi-Scalar Multiplication (MSM) and Number Theoretic Transform (NTT) to GPU hardware.",
            "Reduce proof generation latency from 15s to <500ms."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Halo2 Proof Verification Gateway for Universal Circuit Setup",
        "labels": "zk-proof-service,feature",
        "summary": "Integrate Halo2 proof system support for zero-trusted-setup proof generation and verification.",
        "problem": "Groth16 trusted setup ceremonies present operational security friction for newly deployed circuits.",
        "solution": [
            "Integrate halo2-wasm / halo2-proofs prover engine.",
            "Expose POST /generate-proof/halo2 and POST /verify-proof/halo2.",
            "Support polynomial commitment schemes (KZG and IPA) natively."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Client-Side WebAssembly (WASM) Proof Generation Package with Fallback",
        "labels": "zk-proof-service,web3",
        "summary": "Build client-side npm package allowing users to generate ZK proofs directly in web browser.",
        "problem": "Sending private witness data to backend ZK service requires trust in service host privacy.",
        "solution": [
            "Compile SnarkJS prover to lightweight client-side WASM npm library (@sorotask/zk-prover).",
            "Generate ZK proofs locally inside user browser without exposing witness to any server.",
            "Fallback to backend service only on mobile devices with limited RAM."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Zero-Knowledge Identity Attestation Gate for Sybil-Resistant Task Invocation",
        "labels": "zk-proof-service,security",
        "summary": "Integrate Semaphore / Anon-Aadhaar ZK membership proofs for anonymous authorized task execution.",
        "problem": "Task creators want to restrict task execution to verified community members without revealing member identity.",
        "solution": [
            "Support Merkle tree group membership circuits in zk-proof-service.",
            "Verify member inclusion proof on-chain without revealing public key address.",
            "Prevent Sybil spam attacks while maintaining 100% user anonymity."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Circuit Constraint Satisfiability Fuzzer & Automated Vulnerability Auditor",
        "labels": "zk-proof-service,security",
        "summary": "Build automated circuit static analysis and fuzzing tool to detect under-constrained Circom circuits.",
        "problem": "Under-constrained circuits allow malicious attackers to forge valid ZK proofs with false inputs.",
        "solution": [
            "Integrate CircomSpect / Picus formal verification tool into circuit CI build.",
            "Fuzz public/private input spaces to test constraint uniqueness.",
            "Fail circuit build pipeline if under-constrained signals or missing assignments are detected."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Multi-Party Computation (MPC) Distributed Key Generation for Witness Security",
        "labels": "zk-proof-service,security",
        "summary": "Implement 2-of-3 MPC threshold protocol for splitting private witness decryption across independent nodes.",
        "problem": "Storing complete decryption keys on a single ZK server node exposes private witness parameters if compromised.",
        "solution": [
            "Implement Shamir secret sharing / MPC threshold key generation across 3 nodes.",
            "Compute witness evaluation cooperatively without any single node learning the underlying secret.",
            "Guarantee enterprise-grade privacy for financial task parameters."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Proof Verification Benchmarking Engine with Comparative Gas Metrics",
        "labels": "zk-proof-service,analytics",
        "summary": "Build automated benchmarking suite comparing proof size, generation time, and verification gas cost across Groth16, Plonk, and Halo2.",
        "problem": "Developers lack data when deciding which ZK proof system best fits their specific task constraint size.",
        "solution": [
            "Run automated test benchmark matrix across 1K, 10K, 100K, and 1M constraint circuits.",
            "Publish real-time benchmark reports on frontend docs page.",
            "Provide recommended proof scheme selector tool for developers."
        ],
        "area": "ZK Proof Service (`zk-proof-service/index.test.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Automated Circuit Versioning & WASM Artifact Dependency Registry",
        "labels": "zk-proof-service,devops",
        "summary": "Build immutable versioned registry storing circuit WASM, zkey, and verification contract code by content hash.",
        "problem": "Deploying circuit updates without strict version tagging causes verifier contract mismatches.",
        "solution": [
            "Store circuit artifacts in IPFS / S3 content-addressed storage indexed by SHA-256 hash.",
            "Provide GET /circuits/:circuit_id/:version endpoint.",
            "Enforce strict content-hash verification before witness loading."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Asynchronous WebAssembly Worker Pool Isolation using Secure Sandboxes",
        "labels": "zk-proof-service,security",
        "summary": "Isolate WASM prover execution inside secure gVisor / WebAssembly micro-sandboxes.",
        "problem": "Executing unverified user-submitted WASM circuit provers poses remote code execution (RCE) security risks.",
        "solution": [
            "Run WASM witness calculators inside isolated WASI runtime sandboxes with zero host access.",
            "Cap memory allocation to 512MB and CPU time to 10 seconds per invocation.",
            "Terminate micro-sandbox instantly if security violation or timeout occurs."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Serverless Edge Proof Generation Deployment for Lower Latency",
        "labels": "zk-proof-service,infrastructure",
        "summary": "Deploy ZK proof service on Cloudflare Workers / AWS Lambda Edge for global low-latency availability.",
        "problem": "Centralized single-region proof service causes high network latency for international users.",
        "solution": [
            "Adapt proof service code to run on Cloudflare Workers edge runtime.",
            "Distribute circuit WASM artifacts over global CDN edge caches.",
            "Reduce global proof generation round-trip latency by 65%."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Cryptographic Proof Serialization Optimizer for Low-Bandwidth Networks",
        "labels": "zk-proof-service,optimization",
        "summary": "Compress serialized Groth16/Plonk proofs into compact binary byte arrays for low-bandwidth devices.",
        "problem": "Default JSON-serialized proofs exceed 2KB in payload size, increasing transport bandwidth and mobile data usage.",
        "solution": [
            "Implement uncompressed point packing algorithm converting G1/G2 curve points to compact binary.",
            "Reduce proof payload size from 2048 bytes (JSON) to 128 bytes (binary).",
            "Speed up transport over low-bandwidth mobile networks."
        ],
        "area": "ZK Proof Service (`zk-proof-service/lib/helpers.js`)"
    },
    {
        "title": "🛡️ [ZK-SERVICE] Real-Time Proof Generation Health & CPU Pressure Exporter",
        "labels": "zk-proof-service,monitoring",
        "summary": "Export detailed Prometheus metrics tracking active proof worker pool utilization and queue wait times.",
        "problem": "Lack of visibility into prover pool saturation prevents timely auto-scaling before outages occur.",
        "solution": [
            "Export Prometheus metrics: zk_worker_pool_active, zk_worker_pool_capacity, zk_proof_duration_ms, zk_queue_wait_ms.",
            "Integrate health status endpoint returning 503 when worker pool queue exceeds safety threshold.",
            "Add alert rules for auto-scaling server infrastructure."
        ],
        "area": "ZK Proof Service (`zk-proof-service/server.js`)"
    },

    # --- Category 4: Indexer Service (12) ---
    {
        "title": "📊 [INDEXER] Real-Time WebSocket Event Streaming Server with Custom Topic Subscriptions",
        "labels": "indexer,realtime",
        "summary": "Build high-concurrency WebSocket server allowing client dApps to subscribe to live task execution streams.",
        "problem": "Polling REST endpoints for execution status updates creates latency and server load.",
        "solution": [
            "Build WebSocket server using ws library with pub/sub channel routing.",
            "Allow clients to subscribe to topics: task:*, keeper:*, contract:*.",
            "Stream parsed events instantly upon ingestion from Stellar ledger."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Automated Database Read-Replica Load Balancer for High-Concurrency Queries",
        "labels": "indexer,database",
        "summary": "Implement read-replica query routing to separate heavy dashboard read traffic from indexer ingestion writes.",
        "problem": "Heavy analytical read queries from dashboard users lock primary database tables, slowing ingestion pipeline.",
        "solution": [
            "Configure PostgreSQL connection pool splitting read and write traffic.",
            "Direct write operations (event ingestion) strictly to primary DB node.",
            "Distribute read queries (GraphQL/REST APIs) across multiple read-replicas."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Cryptographic Merkle Tree Event Verification for Auditability",
        "labels": "indexer,security",
        "summary": "Compute per-ledger Merkle trees of indexed event records to provide verifiable cryptographic event proofs.",
        "problem": "Third-party applications consuming indexer data must trust that indexer host has not tampered with event history.",
        "solution": [
            "Construct Merkle tree of all parsed events within each ledger sequence.",
            "Store root hash and expose GET /events/:ledger/merkle-proof.",
            "Allow external clients to verify event inclusion against block headers."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] TimescaleDB Automated Data Retention Policies & Hypertable Partitioning",
        "labels": "indexer,database",
        "summary": "Configure TimescaleDB automatic data compression and hypertable partitioning by ledger timestamp.",
        "problem": "Raw execution event data tables grow by gigabytes daily, slowing down indexing speed over time.",
        "solution": [
            "Convert raw events table to TimescaleDB hypertable partitioned by 7-day chunks.",
            "Enable automatic columnar compression for chunks older than 14 days (saving 90% disk space).",
            "Maintain sub-millisecond query performance on historical data."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] Multi-Chain Event Indexing Support for Stellar & Soroban Cross-Network Tasks",
        "labels": "indexer,feature",
        "summary": "Extend indexer engine to parse cross-chain events from Stellar Classic, Soroban Mainnet, and EVM testnets.",
        "problem": "Cross-chain automation tasks require indexer awareness of events emitted across multiple blockchain networks.",
        "solution": [
            "Modularize event ingestion drivers (StellarRPC, SorobanRPC, EVM JsonRPC).",
            "Store unified event format with chain_id and tx_hash tags.",
            "Expose cross-chain execution timeline via single unified API."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Custom Webhook Retry Policy with Exponential Backoff & Circuit Breaker",
        "labels": "indexer,reliability",
        "summary": "Implement robust webhook dispatcher with jitter, dead-letter storage, and target circuit breaking.",
        "problem": "Failing user webhook endpoints cause indexer memory leak and connection pool exhaustion.",
        "solution": [
            "Use BullMQ queue with Redis for background webhook dispatching.",
            "Retry failed deliveries 5 times with exponential backoff and jitter.",
            "Automatically disable webhook destination if failure rate exceeds 95% over 1 hour."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Distributed Event Ingestion Engine with Kafka Partition Sharding",
        "labels": "indexer,architecture",
        "summary": "Scale indexer ingestion throughput by partitioning ledger event streams across Kafka worker consumers.",
        "problem": "A single indexer instance cannot keep pace with high-throughput network spikes above 10,000 tx/sec.",
        "solution": [
            "Ingest raw Stellar ledger streams into Kafka / Redpanda event topics.",
            "Distribute event parsing across independent consumer group worker instances.",
            "Scale indexing capacity linearly with added worker nodes."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] GraphQL API Schema Stitching for External Decentralized Protocol Analytics",
        "labels": "indexer,graphql",
        "summary": "Integrate GraphQL schema stitching to combine SoroTask execution metrics with DEX/Lending protocol data.",
        "problem": "Developers building dashboards must query separate GraphQL endpoints for automation status and protocol yield rates.",
        "solution": [
            "Stitch SoroTask GraphQL schema with external protocols (e.g. Blend, Soroswap).",
            "Allow single unified GraphQL query for task status and underlying pool APY.",
            "Simplify developer frontend integration significantly."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] Automated Schema Migration Rollback System for Faulty Indexer Deployments",
        "labels": "indexer,database",
        "summary": "Build automated database migration rollback runner with point-in-time state recovery.",
        "problem": "Failed database schema migrations corrupt indexer tables and require manual database restores from backups.",
        "solution": [
            "Implement bidirectional migration scripts (up and down functions).",
            "Automatically trigger down migration if post-migration validation checks fail.",
            "Verify database integrity automatically before resuming ledger ingestion."
        ],
        "area": "Indexer Service (`indexer/migrations/`)"
    },
    {
        "title": "📊 [INDEXER] Comprehensive OpenAPI v3 Documentation & Interactive Swagger Explorer",
        "labels": "indexer,documentation",
        "summary": "Generate interactive Swagger UI explorer for indexer REST API routes using OpenAPI 3.0 annotations.",
        "problem": "Developers integrating indexer APIs must rely on fragmented markdown documentation.",
        "solution": [
            "Add swagger-autogen annotations across express API routes.",
            "Expose interactive Swagger UI at GET /docs.",
            "Provide copy-paste cURL and JavaScript code snippets for all endpoints."
        ],
        "area": "Indexer Service (`indexer/GRAPHQL.md`)"
    },
    {
        "title": "📊 [INDEXER] In-Memory Redis Cache Invalidation Engine triggered by Ledger Sequence Gaps",
        "labels": "indexer,performance",
        "summary": "Implement event-driven Redis cache invalidation engine to guarantee 100% data freshness.",
        "problem": "Stale API query cache results cause frontend to display outdated task state after ledger updates.",
        "solution": [
            "Publish cache invalidation signals over Redis pub/sub upon parsing new ledger block.",
            "Purge affected task_id and creator query keys targeted by block events.",
            "Maintain sub-5ms API response latency while ensuring exact data freshness."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },
    {
        "title": "📊 [INDEXER] End-to-End Synthetic Transaction Monitoring & Ingestion Health Alerts",
        "labels": "indexer,monitoring",
        "summary": "Build synthetic transaction bot that submits periodic test contract calls to audit end-to-end indexer latency.",
        "problem": "Without synthetic monitoring, indexer ingestion delays or silent data loss are hard to detect proactively.",
        "solution": [
            "Submit synthetic heartbeat transaction every 5 minutes on testnet.",
            "Verify synthetic event ingestion end-to-end within <10 seconds.",
            "Trigger PagerDuty alert if synthetic event fails to index within SLA window."
        ],
        "area": "Indexer Service (`indexer/src/`)"
    },

    # --- Category 5: Frontend (12) ---
    {
        "title": "💻 [FRONTEND] Interactive Task Simulation Workbench with State Overrides & Gas Estimator",
        "labels": "frontend,feature",
        "summary": "Build interactive task simulation playground enabling developers to test resolver conditions before deployment.",
        "problem": "Developers must deploy contracts to testnet to verify if resolver conditions evaluate as expected.",
        "solution": [
            "Create /simulate dashboard page supporting custom ledger state overrides.",
            "Invoke Soroban RPC simulateTransaction and render execution trace details.",
            "Highlight failing constraints and display exact resource usage breakdown."
        ],
        "area": "Frontend (`frontend/app/`)"
    },
    {
        "title": "💻 [FRONTEND] Real-Time Interactive Gantt Chart Timeline View for Task Execution Intervals",
        "labels": "frontend,feature",
        "summary": "Build Gantt chart timeline view visualizing upcoming and historical task execution schedules.",
        "problem": "Grid and list views make it difficult to visualize task execution overlap and schedule density.",
        "solution": [
            "Build interactive Gantt timeline component displaying task execution blocks.",
            "Color-code tasks by status: Active (Green), Pending (Blue), Failed (Red), Paused (Gray).",
            "Allow zooming from 1-hour schedule view to 30-day projection."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Advanced Search, Filter, and Saved Custom Views for Enterprise Dashboard",
        "labels": "frontend,ux",
        "summary": "Build advanced query builder allowing users to filter tasks by multiple attributes and save custom views.",
        "problem": "Finding specific tasks among hundreds of active automations is cumbersome with basic search.",
        "solution": [
            "Build multi-condition filter bar (Filter by Creator, Target, Status, Interval, Gas Balance).",
            "Allow saving custom search filter presets to browser localStorage.",
            "Provide instant keyboard shortcut (Cmd+K / Ctrl+K) omnibox search modal."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Full Keyboard Shortcut Navigation System across All Core User Flows",
        "labels": "frontend,accessibility",
        "summary": "Implement full keyboard accessibility navigation with hotkeys across all dashboard pages.",
        "problem": "Power users and accessibility users experience friction navigating complex UI forms with a mouse.",
        "solution": [
            "Integrate react-hotkeys-hook for global keyboard shortcuts.",
            "Add hotkeys: 'N' (New Task), '/' (Search), 'G K' (Keepers), 'Esc' (Close Modals).",
            "Display visual keyboard shortcut helper modal when pressing '?'."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Real-Time Collaborative Task Management with Live User Cursors",
        "labels": "frontend,feature",
        "summary": "Integrate real-time multi-user collaboration in task creation wizard using WebSockets.",
        "problem": "Team members building multi-step task configurations cannot edit or review parameters simultaneously.",
        "solution": [
            "Integrate Liveblocks / Yjs CRDT real-time collaboration engine.",
            "Display live multiplayer cursors and active team member avatars on form fields.",
            "Sync form parameter updates across all viewing team members seamlessly."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Rich Markdown & Code Snippet Editor for Task Instructions",
        "labels": "frontend,ui",
        "summary": "Integrate Monaco / CodeMirror editor for writing and syntax-highlighting target function parameters.",
        "problem": "Plain text inputs for complex JSON parameters lead to syntax errors during task submission.",
        "solution": [
            "Integrate @monaco-editor/react into task parameter configuration steps.",
            "Add JSON schema validation, auto-formatting, and syntax highlighting.",
            "Provide sample code snippets for popular Soroban contracts (Swaps, Transfers, Bounties)."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Drag-and-Drop Task Reordering Board with Accessible Focus Control",
        "labels": "frontend,ux",
        "summary": "Build Kanban-style drag-and-drop board for organizing tasks across custom workflow columns.",
        "problem": "Users managing multiple tasks want a visual Kanban board to organize task priorities.",
        "solution": [
            "Integrate @hello-pangea/dnd library for drag-and-drop task card reordering.",
            "Columns: Backlog, Scheduled, Active, Paused, Archived.",
            "Maintain full keyboard accessibility (Space to pick up, Arrow keys to move, Enter to drop)."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Global State Management Architecture Refactoring for Predictable Updates",
        "labels": "frontend,architecture",
        "summary": "Refactor React state management to Zustand / Redux Toolkit with slice architecture.",
        "problem": "Fragmented useState and Context API providers cause unnecessary component re-renders across dashboard.",
        "solution": [
            "Migrate global application state to Zustand store with atomic selectors.",
            "Separate store slices: walletStore, taskStore, keeperStore, uiStore.",
            "Eliminate unneeded re-renders and improve page interaction responsiveness."
        ],
        "area": "Frontend (`frontend/store/`)"
    },
    {
        "title": "💻 [FRONTEND] Virtualized Table Rendering Engine for Large-Scale Task Directories",
        "labels": "frontend,performance",
        "summary": "Implement windowed virtualized rendering for task list tables displaying thousands of items.",
        "problem": "Rendering thousands of DOM table rows causes browser UI thread freezing and slow scroll performance.",
        "solution": [
            "Integrate @tanstack/react-virtual for list table rendering.",
            "Only render DOM nodes currently visible within browser viewport.",
            "Maintain smooth 60fps scrolling performance regardless of table item count."
        ],
        "area": "Frontend (`frontend/components/`)"
    },
    {
        "title": "💻 [FRONTEND] Automated Web3 Wallet Re-connection & Session Restoration Engine",
        "labels": "frontend,web3",
        "summary": "Build silent wallet re-connection and session restoration logic on page refresh.",
        "problem": "Refreshing dashboard requires users to manually click 'Connect Wallet' and approve popup every time.",
        "solution": [
            "Persist last connected wallet type in encrypted session storage.",
            "Attempt silent re-connection on app initialization via Freighter/Albedo background API.",
            "Handle expired wallet sessions gracefully with unobtrusive inline banners."
        ],
        "area": "Frontend (`frontend/context/`)"
    },
    {
        "title": "💻 [FRONTEND] Comprehensive E2E Playwright Integration Test Suite for Dashboard",
        "labels": "frontend,testing",
        "summary": "Build Playwright end-to-end integration test suite running against local Mock Soroban network.",
        "problem": "Manual QA testing before releases risks introducing regressions in core task creation flows.",
        "solution": [
            "Set up Playwright test environment in frontend/e2e/.",
            "Write E2E test scenarios: Wallet Connect -> Create Task -> Simulate Execution -> Cancel Task.",
            "Run Playwright suite automatically on PR pull requests in GitHub Actions."
        ],
        "area": "Frontend (`frontend/e2e/`, `frontend/playwright.config.ts`)"
    },
    {
        "title": "💻 [FRONTEND] Real-Time Gas Price Ticker & Congestion Monitor Widget",
        "labels": "frontend,ui",
        "summary": "Build live network gas price ticker widget in header displaying Stellar network health.",
        "problem": "Users scheduling urgent tasks are unaware when the Stellar network is experiencing high fee congestion.",
        "solution": [
            "Poll getFeeStats() RPC endpoint every 10 seconds.",
            "Render color-coded network status indicator in navigation header (Low: Green, Normal: Blue, High: Red).",
            "Provide tooltip displaying current base fee in Stroops and recommended priority fee."
        ],
        "area": "Frontend (`frontend/components/`)"
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

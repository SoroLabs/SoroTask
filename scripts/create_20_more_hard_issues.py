#!/usr/bin/env python3
"""
create_20_more_hard_issues.py
Create 20 more advanced, difficult compound issues for SoroTask on GitHub (SoroLabs/SoroTask).
Issues:
- 5 Smart Contract (SC-HARD-26 to SC-HARD-30)
- 5 Backend & Infra (BE-HARD-26 to BE-HARD-30)
- 10 Frontend (FE-HARD-51 to FE-HARD-60)
"""

import subprocess
import sys
import time

REPO = "SoroLabs/SoroTask"
DRY_RUN = "--dry-run" in sys.argv

ISSUES = [
    # ── SMART CONTRACT (5) ──────────────────────────────────────────────────────
    {
        "tag": "SC-HARD-26",
        "title": "[SC-HARD-26] Cross-Contract Intent-Based Execution Routing & CoW Swap Settlement",
        "labels": ["contract", "advanced", "Architecture", "Security"],
        "subtasks": "[Easy: Add intent order struct] + [Medium: Validate intent expiry timestamp] + [Advanced: Coincident of Wants (CoW) multi-task batch clearing engine matching opposing automated token swaps directly on-chain without AMM liquidity pool fees]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/contract/src/lib.rs, https://github.com/SoroLabs/SoroTask/blob/main/contract/src/task.rs",
        "problem": "Recurring automated token swaps (e.g. treasury rebalancing, dollar-cost averaging) incur high AMM swap fees, price impact, and sandwich MEV when routed individually through decentralized exchanges.",
        "solution": "Implement an on-chain intent clearing mechanism. Keepers batch multiple opposing automated swap tasks within the same ledger block and execute peer-to-peer Coincident of Wants (CoW) settlements at uniform clearing prices before routing residual volume to DEX pools.",
        "criteria": "Opposing swap intents clear without AMM pool fees; residual volumes route to DEX AMMs; mathematical settlement prevents underpayment or negative slippage."
    },
    {
        "tag": "SC-HARD-27",
        "title": "[SC-HARD-27] Decentralized MEV Protection via Encrypted Threshold Decryption",
        "labels": ["contract", "advanced", "Architecture", "Security"],
        "subtasks": "[Easy: Store encrypted execution calldata] + [Medium: Require threshold share submissions] + [Advanced: Distributed key generation (DKG) threshold decryption (t-of-n BLS) ensuring keepers cannot inspect task execution payloads until transaction is ordered in the ledger block]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/contract/src/lib.rs, https://github.com/SoroLabs/SoroTask/blob/main/contract/src/storage.rs",
        "problem": "Sensitive automated arbitrage, liquidation, and treasury transactions are vulnerable to malicious mempool front-running and sandwich attacks when execution parameters are visible in plaintext prior to ledger inclusion.",
        "solution": "Allow task creators to submit encrypted function calldata encrypted under a network threshold public key. At execution time, designated threshold committee members submit decryption key shares on-chain; the contract reconstructs the key, decrypts the payload, and executes atomically.",
        "criteria": "Plaintext arguments remain private until block inclusion; valid threshold shares reconstruct and execute payload; invalid shares are rejected and logged."
    },
    {
        "tag": "SC-HARD-28",
        "title": "[SC-HARD-28] Verifiable Autonomous Task Fee Auction & Priority Bidding Pool",
        "labels": ["contract", "advanced", "Architecture", "Security"],
        "subtasks": "[Easy: Add priority_bid field to TaskConfig] + [Medium: Sort executable tasks by bid] + [Advanced: Dutch auction fee decay mechanism where execution reward increases as block deadline approaches, coupled with an on-chain priority queue for gas-efficient keeper extraction]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/contract/src/lib.rs, https://github.com/SoroLabs/SoroTask/blob/main/contract/src/execution.rs",
        "problem": "Fixed keeper rewards either overpay keepers during low gas periods or underpay keepers during high network congestion, causing critical automations to be skipped by keepers.",
        "solution": "Implement a reverse Dutch auction mechanism: the bounty starts low at interval maturity and linearly ramps up toward a maximum creator-specified cap as execution lag increases, creating dynamic market equilibrium and guaranteed execution.",
        "criteria": "Keeper payout dynamically scales with execution delay; total payout never exceeds creator gas escrow; time-decay calculations are fuzz-tested."
    },
    {
        "tag": "SC-HARD-29",
        "title": "[SC-HARD-29] Autonomous Concentrated Liquidity Rebalancing & Tick Position Management",
        "labels": ["contract", "advanced", "Architecture", "Security"],
        "subtasks": "[Easy: Store liquidity position bounds tick_lower/tick_upper] + [Medium: Read current pool price from DEX] + [Advanced: Autonomous position adjustment trigger calculating Impermanent Loss ratios, harvesting fees, and shifting concentrated liquidity ticks within slippage tolerance]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/contract/src/lib.rs, https://github.com/SoroLabs/SoroTask/blob/main/contract/src/task.rs",
        "problem": "Concentrated liquidity positions (Uniswap v3 / Soroswap concentrated pools) go out of range during price swings, halting fee generation and causing severe impermanent loss without manual intervention.",
        "solution": "Build native position management logic: keepers monitor current pool tick relative to user bounds; when price breaches threshold, contract withdraws liquidity, collects uncollected fees, recalculates optimal tick spread, and re-deposits concentrated position.",
        "criteria": "Out-of-range detection triggers automated tick rebalancing; uncollected fees auto-compound into new position; slippage limits prevent sandwiching."
    },
    {
        "tag": "SC-HARD-30",
        "title": "[SC-HARD-30] Recursive Groth16 Proof Aggregation Verifier (SnarkPack)",
        "labels": ["contract", "advanced", "Architecture", "Security"],
        "subtasks": "[Easy: Store aggregated proof bytes] + [Medium: Parse public inputs array] + [Advanced: SnarkPack / Halo2 recursive proof verification verifying 16 distinct condition checks in a single cryptographic pairing check on-chain, drastically reducing Soroban CPU instruction consumption]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/contract/src/lib.rs, https://github.com/SoroLabs/SoroTask/blob/main/contract/src/storage.rs",
        "problem": "Verifying individual zero-knowledge condition proofs for multiple tasks in a batch exhausts the maximum CPU instruction budget of a single Soroban transaction.",
        "solution": "Implement a recursive proof aggregator based on SnarkPack pairing aggregation. Compress 16 distinct Groth16 condition proofs into a single multi-pairing check verified in one Soroban execution.",
        "criteria": "Aggregated verification of 16 proofs consumes <40% of the CPU instructions required by 16 individual checks; false sub-proofs invalidate entire aggregate."
    },

    # ── BACKEND & INFRA (5) ─────────────────────────────────────────────────────
    {
        "tag": "BE-HARD-26",
        "title": "[BE-HARD-26] P2P Keeper Discovery & GossipSub Consensus Mesh Network",
        "labels": ["backend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add libp2p node initialization in keeper] + [Medium: Broadcast task execution announcement] + [Advanced: Libp2p GossipSub network allowing keeper nodes to coordinate task assignments peer-to-peer without central coordinator, reducing duplicate executions via distributed consensus]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/keeper/src/p2pNetwork.js, https://github.com/SoroLabs/SoroTask/blob/main/keeper/index.js",
        "problem": "Decentralized keepers with no shared coordinator race to execute the same task, wasting transaction fees on reverts and causing mempool congestion.",
        "solution": "Establish a peer-to-peer libp2p GossipSub mesh. Keepers gossip intent messages before submission. Peers observe claims and yield execution rights to the deterministic priority winner calculated from epoch VRF seed.",
        "criteria": "Gossip mesh connects independent keeper daemons; duplicate execution attempts drop by >90%; network partitions fall back to on-chain bidding."
    },
    {
        "tag": "BE-HARD-27",
        "title": "[BE-HARD-27] Distributed Kafka Ledger Stream Ingestion Pipeline with Exact-Once Guarantees",
        "labels": ["backend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add Kafka producer client in indexer] + [Medium: Produce ledger events to topic] + [Advanced: Distributed Kafka event pipeline partitioning ledger streams across consumer groups, guaranteeing exactly-once processing with deduplication cache and consumer offset checkpointing]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/indexer/src/index.js, https://github.com/SoroLabs/SoroTask/blob/main/indexer/src/api.js",
        "problem": "High ledger volume under network surges causes single-process indexers to drop events or fall behind ledger tip.",
        "solution": "Decouple RPC polling from event processing using Apache Kafka. Ingestion workers publish raw ledger blocks to Kafka; parallel consumer workers deserialize events, update TimescaleDB, and commit idempotent offsets.",
        "criteria": "Indexer processes 1,000+ events/sec without event loss; worker crash resumes from exact Kafka offset without duplicate entries."
    },
    {
        "tag": "BE-HARD-28",
        "title": "[BE-HARD-28] Machine Learning Execution Failure Predictor & Gas Price Neural Model",
        "labels": ["backend", "advanced", "Architecture"],
        "subtasks": "[Easy: Store historical task success/failure boolean] + [Medium: Compute rolling failure rate per contract] + [Advanced: Embedded TensorFlow.js / ONNX runtime in keeper bot evaluating 12 real-time features (gas volatility, target state changes, mempool depth) to abort failing simulations prior to RPC spend]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/keeper/src/insights.js, https://github.com/SoroLabs/SoroTask/blob/main/keeper/src/executor.js",
        "problem": "Keepers waste up to 30% of their operational budget simulating contract calls that will inevitably revert due to subtle un-indexed state changes.",
        "solution": "Train and embed an ONNX logistic regression / random forest model in keeper daemon. Score probability of execution success based on target historical reverts, current gas price, and interval delta; skip simulation if confidence < 85%.",
        "criteria": "Simulation calls on doomed transactions drop by >75%; false positive skip rate remains <2% verified against historical testnet data."
    },
    {
        "tag": "BE-HARD-29",
        "title": "[BE-HARD-29] Autonomous Zero-Knowledge Rollup State Compression Worker",
        "labels": ["backend", "advanced", "Architecture"],
        "subtasks": "[Easy: Collect batch of 100 task executions] + [Medium: Hash state root] + [Advanced: Generate Circom/Plonk execution proof compressing 500 off-chain micro-task outcomes into a single Merkle state commitment posted to SoroTask smart contract]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/zk-proof-service/lib/prover-backend.js, https://github.com/SoroLabs/SoroTask/blob/main/zk-proof-service/server.js",
        "problem": "Individual on-chain state updates for thousands of micro-automation runs consume excessive transaction throughput and storage rent on Stellar.",
        "solution": "Aggregate micro-executions off-chain. Compute state transition Merkle roots, generate a succinct Groth16/Plonk validity proof in zk-proof-service, and post one single state update to Soroban settling hundreds of runs simultaneously.",
        "criteria": "Rollup worker aggregates 500 tasks into 1 valid on-chain transaction; on-chain verification confirms valid Merkle transition."
    },
    {
        "tag": "BE-HARD-30",
        "title": "[BE-HARD-30] Multi-Region Disaster Recovery Orchestrator with Automated DNS Failover",
        "labels": ["backend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add health check ping script] + [Medium: Log failover event to Slack] + [Advanced: Route53 / Cloudflare automated DNS failover orchestrating cross-region database replica promotion (AWS us-east-1 to eu-central-1), automatic keeper standby activation, and zero-downtime ledger index replay]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/keeper/src/disasterRecovery.js, https://github.com/SoroLabs/SoroTask/blob/main/scripts/backup/dr_restore_drill.sh",
        "problem": "Cloud regional outages or data center connectivity loss can halt all automated keeper executions for hours.",
        "solution": "Deploy active-passive multi-region architecture. Heartbeat monitor detects primary region failure, promotes standby PostgreSQL replica, redirects API DNS via Route53 health checks, and spins up secondary keeper cluster.",
        "criteria": "Simulated primary outage triggers automatic failover in <90 seconds; zero duplicate task executions occur during promotion."
    },

    # ── FRONTEND (10) ───────────────────────────────────────────────────────────
    {
        "tag": "FE-HARD-51",
        "title": "[FE-HARD-51] Interactive 3D WebGL Task Execution Topology Visualizer (Three.js)",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Initialize Three.js canvas in component] + [Medium: Render 3D spheres for tasks] + [Advanced: Force-directed 3D particle graph visualizing live keeper node mesh, task dependency clusters, and animated transaction beam pulses using Three.js and custom GLSL shaders]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/TaskWorkspace.tsx, https://github.com/SoroLabs/SoroTask/blob/main/frontend/app/dashboard/page.tsx",
        "problem": "Enterprise operators managing 500+ interrelated tasks have no macroscopic view of automation network health, bottlenecks, or execution hotspots.",
        "solution": "Build an immersive 3D force-directed node graph in Three.js with GLSL particle shaders. Nodes represent tasks and keepers; edges represent dependencies. Animated pulses indicate live executions with dynamic camera focus.",
        "criteria": "Renders 1,000 nodes smoothly at 60fps on desktop; node selection opens task inspection drawer; supports mouse orbit and touch gestures."
    },
    {
        "tag": "FE-HARD-52",
        "title": "[FE-HARD-52] Smart Contract Dynamic Bytecode Disassembler & Security Inspector",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Fetch target contract WASM via RPC] + [Medium: Display raw hexadecimal bytes] + [Advanced: In-browser WASM disassembler parsing exports, imports, section headers, detecting dangerous patterns (unbounded loops, delegatecalls), and rendering safety audit badges]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/lib/abi-form.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/AbiDynamicForm.tsx",
        "problem": "Users automate recurring calls to external contracts without knowing whether target bytecode contains malicious traps or non-standard interfaces.",
        "solution": "Download contract bytecode via `getContractData`, decode WebAssembly binary format in JavaScript, extract exported entrypoints, and scan for red flags (storage drain loops, unauthorized token transfers). Display security trust score.",
        "criteria": "Disassembles any Soroban WASM in browser in <500ms; flags suspicious byte signatures; warns user before approving task creation."
    },
    {
        "tag": "FE-HARD-53",
        "title": "[FE-HARD-53] AI-Powered Natural Language Automation Prompt-to-Task Engine",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add prompt input text field] + [Medium: Query OpenAI / Claude API for intent classification] + [Advanced: Few-shot prompt engineering pipeline converting natural language ('Harvest liquidity on Blend every 6 hours if rewards exceed 100 USDC') into validated Soroban task configurations and resolver parameters]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/hooks/useAIAssistant.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/TaskWorkspace.tsx",
        "problem": "Writing smart contract invocation parameters, cron intervals, and condition resolvers is intimidating for non-technical DeFi users.",
        "solution": "Build an AI copilot using structured output function calling. User types instructions in natural language; model parses intent, resolves verified contract addresses, sets intervals, formats function args, and populates the Task Creation Wizard.",
        "criteria": "Accurately parses 10 standard DeFi automation prompts into valid configs; enforces client-side Zod schema validation before signing."
    },
    {
        "tag": "FE-HARD-54",
        "title": "[FE-HARD-54] Biometric Passkey (WebAuthn) Walletless Task Authorization Layer",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add Passkey sign-in button] + [Medium: Call navigator.credentials.create()] + [Advanced: End-to-end WebAuthn FIDO2 authentication binding TouchID/FaceID P-256 keys to Stellar account abstraction (SEP-43 / Soroban Account Contract) for gasless one-touch task management]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/wallet/HardwareWalletPanel.tsx, https://github.com/SoroLabs/SoroTask/blob/main/frontend/app/lib/wallet.ts",
        "problem": "Requiring browser wallet extension installation creates massive onboarding friction for mainstream users.",
        "solution": "Implement WebAuthn passkey authentication. Derive a P-256 public key verified on-chain via Soroban account abstraction. Users sign task management transactions using biometric TouchID/FaceID with zero browser extension installation.",
        "criteria": "Users create account and sign transactions using biometric sensor; on-chain signature verification succeeds against P-256 key."
    },
    {
        "tag": "FE-HARD-55",
        "title": "[FE-HARD-55] Cross-Window Multi-Tab Synchronized State Engine (BroadcastChannel)",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Listen to window focus events] + [Medium: Refetch task list on tab focus] + [Advanced: BroadcastChannel & SharedWorker real-time synchronization maintaining single shared WebSocket connection across 10+ browser tabs with leader election and state deduplication]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/context/SyncContext.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/hooks/useBackgroundSync.ts",
        "problem": "Opening multiple dashboard tabs opens multiple WebSocket connections, flooding backend servers and displaying inconsistent out-of-sync state.",
        "solution": "Use `BroadcastChannel` and `SharedWorker`. Elect one tab as the primary WebSocket consumer; broadcast received events to all sibling tabs. Synchronize cache invalidation across all open windows instantly.",
        "criteria": "10 open tabs share 1 single WebSocket connection; task mutation in Tab 1 updates Tab 2 in <20ms; closing primary tab elects new leader."
    },
    {
        "tag": "FE-HARD-56",
        "title": "[FE-HARD-56] Dynamic Gas Price Hedging Simulator with Options Vault Integration",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Display 7-day gas price average] + [Medium: Calculate standard deviation of gas spikes] + [Advanced: Financial modeling engine calculating cost of hedging gas spikes through synthetic options positions, projecting net budget certainty for enterprise automations]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/store/gasOptimizationStore.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/app/gas-optimization/page.tsx",
        "problem": "Enterprises running thousands of automations face unpredictable monthly gas budgets due to unpredictable network surges.",
        "solution": "Build an interactive gas hedging simulator modeling Black-Scholes pricing on synthetic gas call options. Allow users to calculate budget certainty by locking in a maximum gas cost ceiling.",
        "criteria": "Calculates option premium based on historical fee volatility; chart visualizes hedged vs unhedged cumulative expenses across 90 days."
    },
    {
        "tag": "FE-HARD-57",
        "title": "[FE-HARD-57] Client-Side Fuzzing Sandbox for Custom Resolver Conditions",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add test condition input field] + [Medium: Evaluate condition against single mock state] + [Advanced: In-browser property fuzzing worker generating 10,000 randomized ledger timestamps, balances, and oracle inputs to verify user resolver rules never deadlock or panic]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/TaskWorkspace.tsx, https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/lib/mockTasks.ts",
        "problem": "Users write complex conditional resolvers that deadlock, panic unexpectedly on zero divisions, or fail on edge timestamps.",
        "solution": "Run a property-based fuzzer in a Web Worker simulating thousands of randomized edge-case inputs (epoch 0, leap seconds, token overflows, negative prices) to stress-test condition expressions before contract deployment.",
        "criteria": "Worker executes 10,000 randomized test iterations in <2 seconds; surfaces edge cases that cause resolver panics."
    },
    {
        "tag": "FE-HARD-58",
        "title": "[FE-HARD-58] Live Audio Sonification Engine for Blockchain Automation Events",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Add audio toggle button in settings] + [Medium: Play basic beep sound on transaction confirmation] + [Advanced: Web Audio API sound synthesis engine generating musical harmonic chords mapped to execution gas size, keeper identity, and success/failure state in real time]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/store/layoutStore.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/app/globals.css",
        "problem": "Operators monitoring background dashboards miss critical task failures when looking away from the screen.",
        "solution": "Implement a real-time Web Audio API sound generator. Synthesize pleasant acoustic feedback: pentatonic notes for successful keeper executions, pitch scaled by execution value, and dissonant chords for contract reverts or gas exhaustion.",
        "criteria": "Generates synthetic audio without external mp3 downloads; volume and sound profiles are customizable; muting persists across sessions."
    },
    {
        "tag": "FE-HARD-59",
        "title": "[FE-HARD-59] Decentralized P2P Task Sharing & Deep Linking with Cryptographic State URL",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Copy current URL to clipboard] + [Medium: Encode task ID in query string] + [Advanced: Zero-backend task sharing packing full multi-step task configuration, DAG graph layout, and custom resolver code into compressed Base64url LZ-String with Ed25519 creator signature]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/types/sharing.ts, https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/lib/sanitize.ts",
        "problem": "Developers sharing complex automation setups with teammates currently rely on centralized databases or manual JSON copying.",
        "solution": "Compress complete multi-task DAG schemas into URL hash fragments using LZ-String. Cryptographically sign payload with creator's wallet. Teammate opening link instantly reconstructs exact canvas with verified authenticity.",
        "criteria": "Generates URL containing complete DAG state; opening link reconstructs workspace 100% offline without backend database lookup."
    },
    {
        "tag": "FE-HARD-60",
        "title": "[FE-HARD-60] High-Frequency Live Candlestick Gas & Execution Analytics (Canvas2D)",
        "labels": ["frontend", "advanced", "Architecture"],
        "subtasks": "[Easy: Render SVG line chart] + [Medium: Group executions into 15m intervals] + [Advanced: High-performance 120Hz HTML5 Canvas2D / WebGL financial candlestick charting engine rendering OHLC gas prices, execution volume bars, and moving average overlays with pan/zoom inertia]",
        "target_files": "https://github.com/SoroLabs/SoroTask/blob/main/frontend/src/components/task-performance-dashboard.tsx, https://github.com/SoroLabs/SoroTask/blob/main/frontend/app/dashboard/page.tsx",
        "problem": "Standard React SVG charts (Recharts) drop below 15fps when rendering 5,000+ real-time tick points, causing browser freezes.",
        "solution": "Implement a custom hardware-accelerated Canvas2D charting engine. Render Open-High-Low-Close (OHLC) gas fee candlesticks with volume histograms, crosshairs, tooltips, and pinch-to-zoom inertia at native 120Hz.",
        "criteria": "Renders 10,000 historical price points with smooth 60–120fps pan and zoom; tooltip inspects exact execution transactions."
    }
]

def main():
    print(f"Loaded {len(ISSUES)} Advanced Hard Issues.")
    selected = ISSUES

    for i, issue in enumerate(selected, 1):
        labels_str = ",".join(issue["labels"])
        print(f"[{i}/{len(selected)}] Creating: {issue['title']}...")

        if DRY_RUN:
            print(f"  [DRY RUN] gh issue create --title \"{issue['title']}\" --label \"{labels_str}\"")
            continue

        body = (
            f"## 📋 Overview & Compounded Architecture\n"
            f"**Compound Structure**: {issue['subtasks']}\n\n"
            f"**Target Files**: {issue['target_files']}\n\n"
            f"## 🎯 Problem Statement\n{issue['problem']}\n\n"
            f"## 🛠️ Technical Specification & Implementation Plan\n{issue['solution']}\n\n"
            f"## ✅ Definition of Done & Acceptance Criteria\n{issue['criteria']}\n"
        )

        cmd = [
            "gh", "issue", "create",
            "--repo", REPO,
            "--title", issue["title"],
            "--body", body,
            "--label", labels_str
        ]

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"  ✓ Created: {res.stdout.strip()}")
        else:
            print(f"  ❌ Error: {res.stderr.strip()}")

        time.sleep(1.5)  # GitHub API rate limiting prevention

    print("\n✓ Finished creating 20 advanced issues.")

if __name__ == "__main__":
    main()

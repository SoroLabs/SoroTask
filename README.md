# SoroTask

[![Keeper CI](https://github.com/your-org/sorotask/actions/workflows/keeper.yml/badge.svg)](https://github.com/your-org/sorotask/actions/workflows/keeper.yml)
[![Rust Contract CI](https://github.com/your-org/sorotask/actions/workflows/rust.yml/badge.svg)](https://github.com/your-org/sorotask/actions/workflows/rust.yml)

SoroTask is a decentralized automation marketplace on Soroban. It allows users to schedule recurring tasks (like yield harvesting) and incentivizes Keepers to execute them.

## Project Structure

- **`/contract`**: Soroban smart contract (Rust).
  - Contains `TaskConfig` struct and core logic.
- **`/keeper`**: Off-chain bot (Node.js).
  - Monitors the network and executes due tasks.
- **`/frontend`**: Dashboard (Next.js + Tailwind).
  - Interface for task creation and management.

## Setup Instructions

### 1. Smart Contract
```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
```

### 2. Keeper Bot
```bash
cd keeper
npm install
node index.js
```

### 3. Frontend Dashboard
```bash
cd frontend
npm run dev
```

## Architecture
1. **Register**: User registers a task via Contract.
2. **Monitor**: Keepers scan for due tasks.
3. **Execute**: Keeper executes the task and gets rewarded.

# Contributing to SoroTask

Thanks for contributing to SoroTask. This project is split into four parts:

- `contract` — Rust/Soroban smart contract
- `keeper` — Node.js off-chain automation bot
- `frontend` — Next.js dashboard
- `indexer` — Node.js event indexer

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting the Code](#getting-the-code)
3. [Local Setup](#local-setup)
4. [Development Workflow](#development-workflow)
5. [Code Style and Quality Checks](#code-style-and-quality-checks)
6. [Commit Message Conventions](#commit-message-conventions)
7. [Automated CI Requirements](#automated-ci-requirements)
8. [Security Requirements](#security-requirements)
9. [Pull Request Expectations](#pull-request-expectations)
10. [Reporting Bugs and Requesting Features](#reporting-bugs-and-requesting-features)

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 18 | https://nodejs.org |
| npm | 9 | bundled with Node.js |
| Rust | stable | `rustup toolchain install stable` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI (`stellar`) | latest | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker (optional) | 24+ | https://docs.docker.com/get-docker/ |

---

## Getting the Code

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/SoroTask.git
cd SoroTask

# Add upstream so you can pull future changes
git remote add upstream https://github.com/SoroLabs/SoroTask.git
```

---

## Local Setup

### Contract

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### Keeper

```bash
cd keeper
npm install
cp .env.example .env   # then fill in your RPC URL and keypair
node index.js
```

Key environment variables (see `keeper/src/config.js` for all options):

| Variable | Purpose | Default |
|----------|---------|---------|
| `RPC_URL` | Soroban RPC endpoint | testnet URL |
| `CONTRACT_ID` | Deployed contract address | — |
| `SECRET_KEY` | Keeper signing keypair | — |
| `ALERT_WEBHOOK_URL` | Slack or Discord webhook for failure alerts | — |
| `ALERT_CONSECUTIVE_FAILURE_THRESHOLD` | Alert after this many consecutive failures | `3` |
| `ALERT_RPC_DOWN_THRESHOLD_MS` | Alert if RPC is down this long (ms) | `300000` |

### Frontend

```bash
cd frontend
npm install
npm run dev        # starts on http://localhost:3000
```

### Indexer

```bash
cd indexer
npm install
node src/index.js
```

To run against a PostgreSQL database instead of SQLite, apply the migrations first:

```bash
psql -U <user> -d <database> -f indexer/migrations/001_initial_schema.sql
psql -U <user> -d <database> -f indexer/migrations/002_timescaledb_raw_events_retention.sql
```

The second migration requires [TimescaleDB](https://docs.timescale.com/) (PostgreSQL extension). It converts the raw `events` table into the `raw_events` hypertable (7-day chunks, compression after 14 days) and keeps a backwards-compatible `events` view for reads.

---

## Development Workflow

1. **Sync with upstream** before starting any work:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a branch** from `main` using the naming convention below:

   | Type | Branch pattern | Example |
   |------|---------------|---------|
   | Feature | `feat/<short-description>` | `feat/keeper-alerts` |
   | Bug fix | `fix/<short-description>` | `fix/rpc-retry-overflow` |
   | Documentation | `docs/<short-description>` | `docs/contributing-guide` |
   | Chore | `chore/<short-description>` | `chore/update-deps` |

   When a branch addresses multiple issues, include all issue numbers:

   ```bash
   git checkout -b feat/671-684-add-task-filters
   ```

3. **Make focused changes** in the relevant package(s). Keep unrelated refactors out of the PR.

4. **Run quality checks locally** (see [Code Style and Quality Checks](#code-style-and-quality-checks)).

5. **Commit** using Conventional Commits (see [Commit Message Conventions](#commit-message-conventions)).

6. **Open a Pull Request** against `main`, filling in the PR template.

---

## Code Style and Quality Checks

Run the checks for every package you touched before opening a PR.

### Rust (contract)

```bash
cd contract
cargo fmt --all           # format
cargo clippy --all-targets -- -D warnings   # lint (must be warning-free)
cargo test                # unit tests
cargo build --target wasm32-unknown-unknown --release   # wasm build
```

### Keeper (Node.js)

```bash
cd keeper
npm install
npm run lint              # ESLint
npm test                  # Jest — must hit ≥70 % coverage
```

To run a single test file during development:

```bash
npm test -- --testPathPattern=src/__tests__/executor.test.js
```

### Frontend (TypeScript / Next.js)

```bash
cd frontend
npm install
npm run lint              # ESLint + TypeScript
npm run build             # must succeed with no type errors
```

### Indexer (Node.js)

```bash
cd indexer
npm install
npm test
```

---

## Commit Message Conventions

SoroTask follows **Conventional Commits** (https://www.conventionalcommits.org).
Automated releases parse commit messages to determine the version bump and
populate the changelog — please follow this format precisely.

### Format

```
<type>(<scope>): <short summary>

[optional body — explain WHY, not what]

[optional footer — BREAKING CHANGE, Closes #n]
```

### Types

| Type | When to use | Release bump |
|------|------------|-------------|
| `feat` | New user-visible feature | minor |
| `fix` | Bug fix | patch |
| `docs` | Documentation only | none |
| `refactor` | Code change that is not a fix or feature | none |
| `test` | Adding or fixing tests | none |
| `chore` | Build process, dependency updates, tooling | none |
| `perf` | Performance improvement | patch |
| `ci` | CI/CD configuration | none |

Append `!` or add `BREAKING CHANGE:` in the footer to trigger a **major** release.

### Scopes

Use the package name where the change lives:

`frontend` · `keeper` · `contract` · `indexer` · `docs` · `ci`

### Examples

```text
feat(keeper): add webhook alerting for consecutive task failures

fix(indexer): handle missing task_id in legacy v0 events

docs(contributing): expand development workflow and commit conventions

feat(keeper)!: replace sqlite3 with pg driver

BREAKING CHANGE: DATABASE_URL must now point to a PostgreSQL instance
```

### Linking issues

Reference the related GitHub issue in the commit footer so it appears in the
changelog and auto-closes on merge:

```text
feat(indexer): add initial PostgreSQL migration

Closes #675
```

---

## Automated CI Requirements

All pull requests must pass the following checks before merging.

### Repository-wide

- **Security IOC Scan** — scans every changed file for malware and supply-chain indicators
- **Dependency Review** — fails on high-severity known vulnerabilities in new dependencies

### Keeper (`keeper/**`)

- **Lint** — ESLint with no errors or warnings
- **Test** — Jest test suite; minimum **70 % code coverage**
- **Docker** — `docker build` succeeds

### Contract (`contract/**`)

- **Format** — `cargo fmt --check`
- **Lint** — `cargo clippy` with no warnings
- **Test** — all Rust unit tests pass
- **Build** — WebAssembly compilation succeeds

### Frontend (`frontend/**`)

- **Lint** — ESLint and TypeScript type-check
- **Build** — `next build` succeeds

You can verify all checks locally before pushing:

```bash
# Keeper
cd keeper && npm run lint && npm test

# Contract
cd contract && cargo fmt --check && cargo clippy --all-targets && cargo test && \
  cargo build --target wasm32-unknown-unknown --release

# Frontend
cd frontend && npm run lint && npm run build
```

---

## Security Requirements

SoroTask is a public repository that accepts community contributions, so every PR
is reviewed for malware and supply-chain indicators before it is merged.

### Never include

- New `preinstall`, `install`, `postinstall`, `prepare`, or `prepublish` scripts in any `package.json`.
- Code that fetches and executes remote content at install time or from config files
  (`postcss`, `tailwind`, `eslint`, `next`, `jest`, `vite`, etc.).
- Binary, font, executable, or compressed files unrelated to the change. Image assets
  should be uploaded by a maintainer.
- Secrets, API keys, tokens, or private keys.
- Obfuscated or encoded payloads, or long unexplained code blocks appended to otherwise
  normal files.
- `.vscode/` automation files, or editor settings that run tasks automatically
  (for example `task.allowAutomaticTasks`).

### Dependency rules

- Add dependencies only from the public npm registry or crates.io. Do not use `file:`,
  `git:`, or URL-based specs in manifests without maintainer approval.
- Update the lockfile together with the manifest.
- Justify every new dependency in the PR description.

### Security checks

Every PR runs the **Security IOC Scan** and **Dependency Review** workflows. The IOC
scan flags editor automation files, install-time scripts, alternate registries,
config-file injections, obfuscation, credential material, and suspicious network calls.

Maintainers may close a PR without further review if it contains any of the indicators
above. Do not ask for a merge while a security check is failing.

To report a vulnerability instead, follow [SECURITY.md](SECURITY.md).

---

## Pull Request Expectations

Every PR should:

- Have a clear, concise title that follows Conventional Commits format.
- Include a summary explaining **what** changed and **why**.
- Link every related issue with `Closes #<n>` in the PR body.
- Include testing notes — what commands were run and their results.
- Keep scope focused; extract unrelated changes into a separate PR.
- Include screenshots or short recordings for any frontend UI changes.
- Pass all automated CI checks.

---

## Reporting Bugs and Requesting Features

When opening an issue, please include:

- **Expected behavior** — what should have happened.
- **Actual behavior** — what actually happened.
- **Steps to reproduce** — minimal reproduction steps.
- **Environment** — OS, Node.js version, Rust version, browser (if frontend).
- **Logs** — relevant error output or screenshots.

For feature requests, describe the problem you are trying to solve and the
proposed solution. The maintainers may suggest an alternative approach.

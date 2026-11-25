# SoroTask Makefile Documentation

## Overview

This Makefile provides unified commands for building, testing, linting, and cleaning the SoroTask monorepo across all components (Contract, Keeper, Frontend).

## Available Targets

### Build Targets

| Target                | Description                       | Command                                       | Use Case                     |
| --------------------- | --------------------------------- | --------------------------------------------- | ---------------------------- |
| `make build`          | Build contract and frontend       | `make build`                                  | Full build before deployment |
| `make build-contract` | Build Soroban smart contract      | `cd contract && cargo build --release`        | After contract code changes  |
| `make build-keeper`   | Keeper is runtime app (info only) | `npm start` in keeper/                        | Start keeper service         |
| `make build-frontend` | Build Next.js frontend            | `cd frontend && npm install && npm run build` | After frontend changes       |

### Test Targets

| Target               | Description         | Command                                        | Framework       |
| -------------------- | ------------------- | ---------------------------------------------- | --------------- |
| `make test`          | Run all tests       | runs test-contract, test-keeper, test-frontend | All             |
| `make test-contract` | Test Rust contract  | `cd contract && cargo test --release`          | Cargo           |
| `make test-keeper`   | Test Node.js keeper | `cd keeper && npm test`                        | Jest            |
| `make test-frontend` | Test frontend (N/A) | `cd frontend && npm test`                      | Echo (no tests) |

### Lint Targets

| Target               | Description           | Command                                                                   | Tool         |
| -------------------- | --------------------- | ------------------------------------------------------------------------- | ------------ |
| `make lint`          | Lint all components   | runs all lint-\* targets                                                  | Multiple     |
| `make lint-contract` | Lint Rust contract    | `cd contract && cargo clippy --all-targets --all-features -- -D warnings` | Cargo Clippy |
| `make lint-keeper`   | Lint Node.js keeper   | `cd keeper && npm run lint`                                               | ESLint       |
| `make lint-frontend` | Lint Next.js frontend | `cd frontend && npm run lint`                                             | ESLint       |
| `make lint-js`       | Lint staged JS files  | `npx lint-staged`                                                         | lint-staged  |

### Clean Targets

| Target                | Description          | Command                                    | Removes                 |
| --------------------- | -------------------- | ------------------------------------------ | ----------------------- |
| `make clean`          | Clean all artifacts  | runs all clean-\* targets                  | All build outputs       |
| `make clean-contract` | Clean Rust build     | `cd contract && cargo clean`               | target/ directory       |
| `make clean-keeper`   | Clean Node.js keeper | `rm -rf node_modules coverage`             | node_modules, coverage  |
| `make clean-frontend` | Clean Next.js build  | `rm -rf node_modules .next dist build out` | Next.js build artifacts |

### Utility Targets

| Target         | Description                | Usage                 |
| -------------- | -------------------------- | --------------------- |
| `make help`    | Show all available targets | `make help` or `make` |
| `make install` | Install all dependencies   | `make install`        |
| `make format`  | Format all code            | `make format`         |
| `make check`   | Run lint + test            | `make check`          |
| `make dev`     | Show development workflow  | `make dev`            |

## Usage Examples

### Development Workflow

```bash
# Install everything
make install

# Make code changes...

# Format code
make format

# Check code quality (lint + test)
make check

# Build for production
make build

# Start local development servers (run each in separate terminal)
make dev  # Shows instructions
```

### CI/CD Pipeline

```bash
# Complete validation before commit
make lint
make test
make build
```

### Troubleshooting

```bash
# Clean and rebuild everything
make clean
make build

# Run only specific component test
make test-keeper

# Check only contract code
make lint-contract
```

## Component Details

### Contract (Rust/Soroban)

- **Language**: Rust
- **Build**: Cargo
- **Test**: `cargo test`
- **Lint**: `cargo clippy`
- **Features**: Fuzz testing, deny.toml security checks

### Keeper (Node.js)

- **Language**: JavaScript
- **Test Framework**: Jest
- **Linter**: ESLint
- **Scripts**: start, dev, test, lint, docker:build
- **Note**: No build step needed (runtime app)

### Frontend (Next.js)

- **Language**: TypeScript/React
- **Framework**: Next.js 16
- **Linter**: ESLint
- **Note**: Test target shows "No tests specified"

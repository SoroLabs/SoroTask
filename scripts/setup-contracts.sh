#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"

setup_mainnet_genesis() {
  : "${MAINNET_RPC_URL:?Set MAINNET_RPC_URL to a Stellar Mainnet Soroban RPC endpoint}"
  : "${MAINNET_BOOTSTRAP_IDENTITY:?Set MAINNET_BOOTSTRAP_IDENTITY to the funded Stellar CLI identity alias}"
  : "${MAINNET_GOVERNANCE_ADDRESS:?Set MAINNET_GOVERNANCE_ADDRESS to the approved multisig address}"
  : "${MAINNET_TOKEN_ID:?Set MAINNET_TOKEN_ID to the production gas-token contract address}"
  : "${MAINNET_CONFIRMATION:?Set MAINNET_CONFIRMATION=DEPLOY_TO_STELLAR_MAINNET to authorize irreversible Mainnet transactions}"

  if [ "$MAINNET_CONFIRMATION" != "DEPLOY_TO_STELLAR_MAINNET" ]; then
    echo "Refusing Mainnet deployment: MAINNET_CONFIRMATION must equal DEPLOY_TO_STELLAR_MAINNET" >&2
    return 1
  fi

  if ! [[ "$MAINNET_GOVERNANCE_ADDRESS" =~ ^[GC][A-Z2-7]{55}$ ]]; then
    echo "Invalid governance address: expected a Stellar account (G...) or contract (C...) address" >&2
    return 1
  fi

  if ! [[ "$MAINNET_TOKEN_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
    echo "Invalid token address: expected a Stellar contract address (C...)" >&2
    return 1
  fi

  BOOTSTRAP_ADDRESS="$(stellar keys address "$MAINNET_BOOTSTRAP_IDENTITY")"
  if ! [[ "$BOOTSTRAP_ADDRESS" =~ ^G[A-Z2-7]{55}$ ]]; then
    echo "Bootstrap identity must resolve to a Stellar account address (G...)" >&2
    return 1
  fi
  if [ "$BOOTSTRAP_ADDRESS" = "$MAINNET_GOVERNANCE_ADDRESS" ]; then
    echo "Bootstrap and governance addresses must differ so bootstrap authority can be revoked" >&2
    return 1
  fi

  echo "Checking that the configured RPC endpoint is Stellar Mainnet..."
  NETWORK_INFO="$(curl -fsS -X POST "$MAINNET_RPC_URL" \
    -H "Content-Type: application/json" \
    --data-binary '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}')"
  if ! printf '%s' "$NETWORK_INFO" | grep -Eq '"passphrase"[[:space:]]*:[[:space:]]*"Public Global Stellar Network ; September 2015"'; then
    echo "Refusing deployment: RPC endpoint did not report the Stellar Mainnet passphrase" >&2
    return 1
  fi

  WASM_PATH="${MAINNET_WASM_PATH:-$ROOT_DIR/contract/target/wasm32v1-none/release/soro_task_contract.wasm}"
  if [ -z "${MAINNET_WASM_PATH:-}" ]; then
    echo "Building optimized contract WASM..."
    (cd "$ROOT_DIR/contract" && stellar contract build --optimize=true --package soro_task_contract)
  fi
  if [ ! -s "$WASM_PATH" ]; then
    echo "Contract WASM not found or empty: $WASM_PATH" >&2
    return 1
  fi

  WASM_HASH="$(sha256sum "$WASM_PATH" | awk '{print $1}')"
  echo "Deploying optimized WASM (SHA-256: $WASM_HASH)..."
  DEPLOY_OUTPUT="$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --optimize=false \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" 2>&1)"
  echo "$DEPLOY_OUTPUT"
  CONTRACT_ID="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -oE 'C[A-Z2-7]{55}' | tail -1 || true)"
  if [ -z "$CONTRACT_ID" ]; then
    echo "Deployment did not return a contract ID. Check the transaction before retrying." >&2
    return 1
  fi
  echo "CONTRACT_ID: $CONTRACT_ID"

  FETCHED_WASM="$(mktemp)"
  trap 'rm -f "$FETCHED_WASM"' EXIT
  stellar contract fetch \
    --contract-id "$CONTRACT_ID" \
    --out-file "$FETCHED_WASM" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE"
  FETCHED_WASM_HASH="$(sha256sum "$FETCHED_WASM" | awk '{print $1}')"
  if [ "$FETCHED_WASM_HASH" != "$WASM_HASH" ]; then
    echo "On-chain WASM hash mismatch: expected $WASM_HASH, received $FETCHED_WASM_HASH" >&2
    return 1
  fi
  echo "On-chain WASM hash verified: $FETCHED_WASM_HASH"

  echo "Initializing proxy with the bootstrap admin..."
  stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" \
    -- init_proxy \
    --admin "$BOOTSTRAP_ADDRESS" \
    --token "$MAINNET_TOKEN_ID" \
    --version 1

  echo "Transferring proxy authority to Mainnet governance..."
  stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" \
    -- transfer_proxy_admin \
    --admin "$BOOTSTRAP_ADDRESS" \
    --new-admin "$MAINNET_GOVERNANCE_ADDRESS"

  CURRENT_ADMIN="$(stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" \
    -- get_proxy_admin)"
  if [[ "$CURRENT_ADMIN" != *"$MAINNET_GOVERNANCE_ADDRESS"* ]]; then
    echo "Governance verification failed: get_proxy_admin did not return the configured multisig" >&2
    return 1
  fi

  CURRENT_VERSION="$(stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" \
    -- get_contract_version)"
  if ! printf '%s' "$CURRENT_VERSION" | tr -d '[:space:]' | grep -Fxq "1"; then
    echo "Genesis verification failed: contract version is not 1" >&2
    return 1
  fi

  CURRENT_TOKEN="$(stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source "$MAINNET_BOOTSTRAP_IDENTITY" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$MAINNET_PASSPHRASE" \
    -- get_token)"
  if [[ "$CURRENT_TOKEN" != *"$MAINNET_TOKEN_ID"* ]]; then
    echo "Genesis verification failed: get_token did not return the configured token contract" >&2
    return 1
  fi

  echo "Genesis verified: version 1, token $MAINNET_TOKEN_ID, governance $MAINNET_GOVERNANCE_ADDRESS."
  echo "The bootstrap account no longer has proxy-admin authority; its local signing key was not deleted."
}

if [ "${1:-}" = "mainnet-genesis" ]; then
  if [ "$#" -ne 1 ]; then
    echo "Usage: $0 mainnet-genesis" >&2
    exit 2
  fi
  setup_mainnet_genesis
  exit $?
fi

# Configuration
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
MAX_FUNDING_ATTEMPTS=30

# 1. Setup Network in CLI
echo "Configuring stellar-cli network..."
stellar network add local --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" || true

# 2. Generate and Fund Identities
echo "Generating and funding identities..."
for name in deployer keeper creator; do
  stellar keys generate --network local "$name" || true
  address="$(stellar keys address "$name" 2>/dev/null || stellar keys public-key "$name")"
  echo "Funding $name ($address)..."
  attempt=1
  until curl -fsS "http://localhost:8000/friendbot?addr=$address" > /dev/null; do
    if [ "$attempt" -ge "$MAX_FUNDING_ATTEMPTS" ]; then
      echo "Failed to fund $name after $attempt attempts"
      exit 1
    fi
    echo "Friendbot not ready for $name yet ($attempt/$MAX_FUNDING_ATTEMPTS); retrying..."
    attempt=$((attempt + 1))
    sleep 5
  done
  echo "Funded $name!"
done
sleep 6

# 3. Build Contracts
echo "Building contracts..."
if [ ! -f "target/wasm32v1-none/release/soro_task_contract.wasm" ] && [ ! -f "contract/target/wasm32v1-none/release/soro_task_contract.wasm" ]; then
  (cd contract && stellar contract build)
fi

WASM_PATH="contract/target/wasm32v1-none/release/soro_task_contract.wasm"
if [ ! -f "$WASM_PATH" ]; then
  WASM_PATH="target/wasm32v1-none/release/soro_task_contract.wasm"
fi

# 4. Deploy Main Contract
echo "Deploying SoroTask contract..."
stellar contract optimize --wasm "$WASM_PATH" || true
if [ -f "${WASM_PATH%.wasm}.optimized.wasm" ]; then
  WASM_PATH="${WASM_PATH%.wasm}.optimized.wasm"
fi
echo "Using contract WASM at: $WASM_PATH"

CONTRACT_ID=""
for attempt in {1..5}; do
  echo "Attempt $attempt deploying SoroTask contract..."
  source_alias="deployer"
  if [ "$attempt" -gt 1 ]; then
    source_alias="deployer_$attempt"
    stellar keys generate --network local "$source_alias" || true
    addr="$(stellar keys address "$source_alias" 2>/dev/null || stellar keys public-key "$source_alias")"
    curl -fsS "http://localhost:8000/friendbot?addr=$addr" > /dev/null || true
    sleep 2
  fi
  DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source "$source_alias" \
    --network local \
    --inclusion-fee 10000000 2>&1 || true)
  echo "$DEPLOY_OUTPUT"
  CONTRACT_ID=$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
  if [ -n "$CONTRACT_ID" ]; then
    echo "SoroTask deployed successfully!"
    break
  fi
  echo "Deploy attempt $attempt failed; retrying in 4s..."
  sleep 4
done

if [ -z "$CONTRACT_ID" ]; then
  echo "::error::Failed to deploy SoroTask contract after multiple attempts"
  echo "=== docker logs soroban-rpc (tail 200) ==="
  docker logs soroban-rpc --tail 200 || true
  exit 1
fi
echo "CONTRACT_ID: $CONTRACT_ID"

# 5. Deploy Mock Target Contract
echo "Deploying Mock Target contract..."
TARGET_ID=""
for attempt in {1..3}; do
  DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source deployer \
    --network local \
    --inclusion-fee 10000000 2>&1 || true)
  TARGET_ID=$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
  if [ -n "$TARGET_ID" ]; then
    break
  fi
  sleep 3
done
if [ -z "$TARGET_ID" ]; then TARGET_ID="$CONTRACT_ID"; fi
echo "TARGET_ID: $TARGET_ID"

# 6. Deploy Native Token Contract
echo "Deploying Native Token contract..."
# Note: stellar contract asset deploy --asset native is deprecated in some versions but works in 21.x.x
# Some versions use stellar contract id asset native
TOKEN_ID=$(stellar contract id asset --asset native --network local || stellar contract id asset native --network local)
stellar contract asset deploy --asset native --source deployer --network local || true
echo "TOKEN_ID: $TOKEN_ID"

# 7. Initialize Main Contract
echo "Initializing SoroTask contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source deployer \
  --network local \
  -- \
  init --token "$TOKEN_ID"

# Save addresses for test
cat <<EOF > .env.test
SOROBAN_RPC_URL="$RPC_URL"
NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
CONTRACT_ID="$CONTRACT_ID"
TARGET_ID="$TARGET_ID"
TOKEN_ID="$TOKEN_ID"
KEEPER_SECRET="$(stellar keys secret keeper 2>/dev/null || stellar keys show keeper)"
CREATOR_SECRET="$(stellar keys secret creator 2>/dev/null || stellar keys show creator)"
POLLING_INTERVAL_MS=2000
LOG_LEVEL=debug
EOF

echo "Setup COMPLETE!"

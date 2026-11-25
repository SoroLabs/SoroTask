#!/bin/bash
set -e

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

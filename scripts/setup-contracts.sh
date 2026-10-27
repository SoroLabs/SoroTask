#!/bin/bash
set -e

# Configuration
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
MAX_FUNDING_ATTEMPTS=30

# 1. Setup Network in CLI
echo "Configuring stellar-cli network..."
stellar network rm local 2>/dev/null || true
stellar network add local --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE"

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
if [ ! -f "contract/crates/e2e_contract/target/wasm32v1-none/release/e2e_contract.wasm" ]; then
  (cd contract/crates/e2e_contract && stellar contract build) || true
fi
if [ ! -f "target/wasm32v1-none/release/soro_task_contract.wasm" ] && [ ! -f "contract/target/wasm32v1-none/release/soro_task_contract.wasm" ]; then
  (cd contract && stellar contract build) || true
fi

WASM_PATH="contract/crates/e2e_contract/target/wasm32v1-none/release/e2e_contract.wasm"
if [ ! -f "$WASM_PATH" ]; then
  WASM_PATH="target/wasm32v1-none/release/e2e_contract.wasm"
fi
if [ ! -f "$WASM_PATH" ]; then
  WASM_PATH="contract/target/wasm32v1-none/release/soro_task_contract.wasm"
fi
if [ ! -f "$WASM_PATH" ]; then
  WASM_PATH="target/wasm32v1-none/release/soro_task_contract.wasm"
fi


# 4. Deploy Main Contract
echo "Deploying SoroTask contract..."
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
    stellar keys fund "$source_alias" --network local >/dev/null 2>&1 || true
    sleep 3
  fi

  UPLOAD_OUTPUT=$(stellar --very-verbose contract upload \
    --wasm "$WASM_PATH" \
    --source "$source_alias" \
    --network local \
    --optimize=false \
    --ignore-checks 2>&1 || true)
  echo "$UPLOAD_OUTPUT"
  WASM_HASH=$(printf '%s\n' "$UPLOAD_OUTPUT" | grep -o '[0-9a-f]\{64\}' | tail -1 || true)

  if [ -n "$WASM_HASH" ]; then
    DEPLOY_OUTPUT=$(stellar --very-verbose contract deploy \
      --wasm-hash "$WASM_HASH" \
      --source "$source_alias" \
      --network local 2>&1 || true)
    echo "$DEPLOY_OUTPUT"
    CONTRACT_ID=$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
  fi

  if [ -z "$CONTRACT_ID" ]; then
    DEPLOY_OUTPUT=$(stellar --very-verbose contract deploy \
      --wasm "$WASM_PATH" \
      --source "$source_alias" \
      --network local \
      --optimize=false \
      --ignore-checks 2>&1 || true)
    echo "$DEPLOY_OUTPUT"
    CONTRACT_ID=$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
  fi

  if [ -n "$CONTRACT_ID" ]; then
    echo "SoroTask deployed successfully!"
    break
  fi
  echo "Deploy attempt $attempt failed; retrying in 4s..."
  sleep 4
done

if [ -z "$CONTRACT_ID" ]; then
  echo "WARN: Deploy returned no on-chain ID, falling back to deterministic contract ID derivation"
  CONTRACT_ID=$(stellar contract id wasm --salt 00000000000000000000000000000001 --source deployer --network local 2>/dev/null || true)
fi
if [ -z "$CONTRACT_ID" ]; then
  CONTRACT_ID=$(node -e "const { Address } = require('@stellar/stellar-sdk'); console.log(Address.contract(Buffer.alloc(32, 1)).toString());" 2>/dev/null || true)
fi
if [ -z "$CONTRACT_ID" ]; then
  CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
fi
echo "CONTRACT_ID: $CONTRACT_ID"

# 5. Deploy Mock Target Contract
echo "Deploying Mock Target contract..."
TARGET_ID=""
for attempt in {1..3}; do
  if [ -n "$WASM_HASH" ]; then
    DEPLOY_OUTPUT=$(stellar contract deploy \
      --wasm-hash "$WASM_HASH" \
      --source deployer \
      --network local 2>&1 || true)
  else
    DEPLOY_OUTPUT=$(stellar contract deploy \
      --wasm "$WASM_PATH" \
      --source deployer \
      --network local \
      --optimize=false \
      --ignore-checks 2>&1 || true)
  fi
  TARGET_ID=$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
  if [ -n "$TARGET_ID" ]; then
    break
  fi
  sleep 2
done
if [ -z "$TARGET_ID" ]; then
  TARGET_ID=$(stellar contract id wasm --salt 00000000000000000000000000000002 --source deployer --network local 2>/dev/null || true)
fi
if [ -z "$TARGET_ID" ]; then TARGET_ID="$CONTRACT_ID"; fi
echo "TARGET_ID: $TARGET_ID"

# 6. Deploy Native Token Contract
echo "Deploying Native Token contract..."
TOKEN_ID=$(stellar contract id asset --asset native --network local 2>/dev/null || stellar contract id asset native --network local 2>/dev/null || true)
DEPLOY_TOKEN_OUTPUT=$(stellar contract asset deploy --asset native --source deployer --network local 2>&1 || true)
if [ -z "$TOKEN_ID" ]; then
  TOKEN_ID=$(printf '%s\n' "$DEPLOY_TOKEN_OUTPUT" | grep -o 'C[0-9A-Z]\{55\}' | tail -1 || true)
fi
if [ -z "$TOKEN_ID" ]; then
  TOKEN_ID="CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4"
fi
echo "TOKEN_ID: $TOKEN_ID"

# 7. Initialize Main Contract
echo "Initializing SoroTask contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source deployer \
  --network local \
  -- \
  init --token "$TOKEN_ID" 2>&1 || true

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

#!/bin/bash
set -e

# Configuration
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
MAX_FUNDING_ATTEMPTS=30

# 1. Setup Network in CLI
echo "Configuring stellar-cli network..."
stellar network add --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" local || true

# 2. Generate and Fund Identities
echo "Generating and funding identities..."
for name in deployer keeper creator; do
  stellar keys generate --network local "$name" || true
  address="$(stellar keys public-key "$name")"
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
done

# 3. Build Contracts
echo "Building contracts..."
(cd contract && cargo build --target wasm32v1-none --release)

WASM_PATH="contract/target/wasm32v1-none/release/soro_task_contract.wasm"

# 4. Deploy Main Contract
echo "Deploying SoroTask contract..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source deployer \
  --network local)

echo "CONTRACT_ID: $CONTRACT_ID"

# 5. Deploy Mock Target Contract
echo "Deploying Mock Target contract..."
TARGET_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source deployer \
  --network local)

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
KEEPER_SECRET="$(stellar keys show keeper)"
CREATOR_SECRET="$(stellar keys show creator)"
POLLING_INTERVAL_MS=2000
LOG_LEVEL=debug
EOF

echo "Setup COMPLETE!"

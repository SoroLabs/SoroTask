#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin"
printf 'test contract wasm\n' > "$TMP_DIR/contract.wasm"
export WASM_FIXTURE="$TMP_DIR/contract.wasm"
export STELLAR_LOG="$TMP_DIR/stellar.log"
export MAINNET_GOVERNANCE_ADDRESS="C$(printf '%055d' 0 | tr '0' 'A')"
export MAINNET_TOKEN_ID="C$(printf '%055d' 0 | tr '0' 'B')"
export MAINNET_BOOTSTRAP_IDENTITY="genesis-bootstrap"
export MAINNET_RPC_URL="https://mainnet-rpc.example"
export MAINNET_WASM_PATH="$WASM_FIXTURE"

cat > "$TMP_DIR/bin/stellar" <<'MOCK'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$STELLAR_LOG"
case " $* " in
  *" keys address "*)
    printf 'G%s\n' "$(printf '%055d' 0 | tr '0' 'D')"
    ;;
  *" contract deploy "*)
    printf 'C%s\n' "$(printf '%055d' 0 | tr '0' 'E')"
    ;;
  *" contract fetch "*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--out-file" ]; then
        if [ "${MOCK_WRONG_WASM:-0}" = "1" ]; then
          printf 'different contract wasm\n' > "$2"
        else
          cp "$WASM_FIXTURE" "$2"
        fi
        exit 0
      fi
      shift
    done
    echo "missing --out-file" >&2
    exit 1
    ;;
  *" init_proxy "*|*" transfer_proxy_admin "*)
    printf 'transaction successful\n'
    ;;
  *" get_proxy_admin "*)
    printf '%s\n' "$MAINNET_GOVERNANCE_ADDRESS"
    ;;
  *" get_contract_version "*)
    printf '1\n'
    ;;
  *" get_token "*)
    printf '%s\n' "$MAINNET_TOKEN_ID"
    ;;
  *)
    echo "unexpected stellar command: $*" >&2
    exit 1
    ;;
esac
MOCK

cat > "$TMP_DIR/bin/curl" <<'MOCK'
#!/bin/bash
set -euo pipefail
if [ "${MOCK_WRONG_NETWORK:-0}" = "1" ]; then
  printf '{"result":{"passphrase":"Standalone Network ; February 2017"}}\n'
else
  printf '{"result":{"passphrase":"Public Global Stellar Network ; September 2015"}}\n'
fi
MOCK
chmod +x "$TMP_DIR/bin/stellar" "$TMP_DIR/bin/curl"
export PATH="$TMP_DIR/bin:$PATH"

if MAINNET_CONFIRMATION=NOT_CONFIRMED \
  "$ROOT_DIR/scripts/setup-contracts.sh" mainnet-genesis >"$TMP_DIR/unconfirmed.log" 2>&1; then
  echo "Expected an invalid Mainnet confirmation to fail" >&2
  exit 1
fi
if [ -s "$STELLAR_LOG" ]; then
  echo "The script invoked Stellar CLI before rejecting confirmation" >&2
  exit 1
fi

: > "$STELLAR_LOG"
if MAINNET_CONFIRMATION=DEPLOY_TO_STELLAR_MAINNET MOCK_WRONG_NETWORK=1 \
  "$ROOT_DIR/scripts/setup-contracts.sh" mainnet-genesis >"$TMP_DIR/wrong-network.log" 2>&1; then
  echo "Expected a non-Mainnet RPC endpoint to be rejected" >&2
  exit 1
fi
if grep -Fq "contract deploy" "$STELLAR_LOG"; then
  echo "The script deployed to an RPC endpoint that failed Mainnet verification" >&2
  exit 1
fi

: > "$STELLAR_LOG"
if MAINNET_CONFIRMATION=DEPLOY_TO_STELLAR_MAINNET MOCK_WRONG_WASM=1 \
  "$ROOT_DIR/scripts/setup-contracts.sh" mainnet-genesis >"$TMP_DIR/wrong-wasm.log" 2>&1; then
  echo "Expected a deployed WASM hash mismatch to fail" >&2
  exit 1
fi
if grep -Fq "init_proxy" "$STELLAR_LOG"; then
  echo "The script initialized a contract before verifying its deployed WASM hash" >&2
  exit 1
fi

: > "$STELLAR_LOG"
MAINNET_CONFIRMATION=DEPLOY_TO_STELLAR_MAINNET \
  "$ROOT_DIR/scripts/setup-contracts.sh" mainnet-genesis >"$TMP_DIR/deployment.log" 2>&1

EXPECTED_HASH="$(sha256sum "$WASM_FIXTURE" | awk '{print $1}')"
grep -Fq "On-chain WASM hash verified: $EXPECTED_HASH" "$TMP_DIR/deployment.log"
grep -Fq "Genesis verified: version 1, token $MAINNET_TOKEN_ID, governance $MAINNET_GOVERNANCE_ADDRESS." "$TMP_DIR/deployment.log"
grep -Fq "contract fetch --contract-id C$(printf '%055d' 0 | tr '0' 'E')" "$STELLAR_LOG"
grep -Fq "contract deploy --wasm $WASM_FIXTURE --optimize=false" "$STELLAR_LOG"
grep -Fq "transfer_proxy_admin" "$STELLAR_LOG"

echo "Mainnet genesis script tests passed."

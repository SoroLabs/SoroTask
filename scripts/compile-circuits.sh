#!/bin/bash
set -e

# ==============================================================================
# compile-circuits.sh
# Automated Circom compilation pipeline to generate WASM and zkey files, plus
# a native Soroban Groth16 verifier WASM per circuit (#1209).
#
# Requirements: circom, snarkjs (via npx), rustup with the
# wasm32-unknown-unknown target installed.
# ==============================================================================

echo "Starting Circom compilation pipeline..."

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS_DIR="$ROOT_DIR/zk-proof-service/circuits"
BUILD_DIR="$ROOT_DIR/zk-proof-service/build"
PTAU_DIR="$ROOT_DIR/zk-proof-service/ptau"

# The standard powers of tau file
PTAU_FILE="$PTAU_DIR/pot12_final.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau"

mkdir -p "$BUILD_DIR"
mkdir -p "$PTAU_DIR"

if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau file..."
    curl -L -o "$PTAU_FILE" "$PTAU_URL"
else
    echo "Powers of Tau file already exists."
fi

# Ensure circom is installed
if ! command -v circom &> /dev/null; then
    echo "Error: circom could not be found. Please install it to compile circuits."
    exit 1
fi

for circuit_file in "$CIRCUITS_DIR"/*.circom; do
    [ -e "$circuit_file" ] || continue
    
    filename=$(basename "$circuit_file")
    circuit_name="${filename%.circom}"
    
    echo "Compiling $circuit_name..."
    
    # 1. Compile the circuit (generates WASM, R1CS, and Symbol file)
    circom "$circuit_file" --r1cs --wasm --sym -o "$BUILD_DIR"
    
    # 2. Setup Groth16 (generate initial zkey)
    echo "Running groth16 setup..."
    npx snarkjs groth16 setup "$BUILD_DIR/$circuit_name.r1cs" "$PTAU_FILE" "$BUILD_DIR/${circuit_name}_0000.zkey"
    
    # 3. Contribute to the phase 2 ceremony (creates final zkey)
    echo "Contributing to phase 2..."
    npx snarkjs zkey contribute "$BUILD_DIR/${circuit_name}_0000.zkey" "$BUILD_DIR/${circuit_name}_final.zkey" --name="AutomatedBuild" -v -e="$(head -c 32 /dev/urandom | base64)"
    
    # 4. Export verification key
    echo "Exporting verification key..."
    npx snarkjs zkey export verificationkey "$BUILD_DIR/$circuit_name_final.zkey" "$BUILD_DIR/${circuit_name}_verification_key.json"

    # 5. Generate the native Soroban verifier (#1209)
    #    Replaces the EVM `solidityverifier` export: the Groth16 verifying-key
    #    constants are extracted into a generated Rust crate (arkworks/bn254 +
    #    soroban-sdk), unit-tested, and compiled to a deployable WASM.
    echo "Generating Soroban verifier crate..."
    node "$ROOT_DIR/scripts/generate-soroban-verifier.js" \
        "$BUILD_DIR/${circuit_name}_verification_key.json" \
        "$BUILD_DIR/soroban-verifier/$circuit_name"

    echo "Running automated Rust tests for the Soroban verifier..."
    (cd "$BUILD_DIR/soroban-verifier/$circuit_name" && cargo test)

    echo "Compiling Soroban verifier to WASM..."
    (cd "$BUILD_DIR/soroban-verifier/$circuit_name" && cargo build --release --target wasm32-unknown-unknown)

    mkdir -p "$BUILD_DIR/verifiers/$circuit_name"
    cp "$BUILD_DIR/soroban-verifier/$circuit_name/target/wasm32-unknown-unknown/release/soroban_zk_verifier.wasm" \
       "$BUILD_DIR/verifiers/$circuit_name/soroban_zk_verifier.wasm"
    # Keep a well-known path pointing at the most recent verifier build.
    cp "$BUILD_DIR/verifiers/$circuit_name/soroban_zk_verifier.wasm" \
       "$BUILD_DIR/soroban_zk_verifier.wasm"

    echo "$circuit_name successfully compiled and artifacts generated (Soroban verifier WASM included)."
done

echo "Circom compilation pipeline completed successfully."

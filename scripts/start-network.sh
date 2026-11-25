#!/bin/bash
set -e

# Configuration
QUICKSTART_IMAGE="stellar/quickstart:latest"
NETWORK_NAME="soroban-local"
RPC_PORT=8000

# Cleanup old container if it exists
if [ "$(docker ps -aq -f name=$NETWORK_NAME)" ]; then
    echo "Stopping and removing existing $NETWORK_NAME container..."
    docker stop $NETWORK_NAME || true
    docker rm $NETWORK_NAME || true
fi

echo "Starting Soroban local network (quickstart)..."
docker run -d \
  --name $NETWORK_NAME \
  -p $RPC_PORT:8000 \
  $QUICKSTART_IMAGE \
  --local \
  --enable-soroban-rpc

# Wait for RPC to be ready
echo "Waiting for Soroban RPC to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
until curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getNetwork"}' \
  http://localhost:$RPC_PORT/soroban/rpc | grep -q '"result"'; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Error: Soroban RPC failed to start after $MAX_RETRIES attempts."
        docker logs $NETWORK_NAME
        exit 1
    fi
    echo "Still waiting... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 5
done

echo "Soroban local network is READY!"

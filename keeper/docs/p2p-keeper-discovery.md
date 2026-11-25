# P2P Keeper Discovery

The keeper can run an optional peer-to-peer discovery layer so keeper nodes can find each other, advertise load, and split task ownership without a central coordinator. The existing shard configuration remains the fallback path when P2P is disabled or no healthy peers are available.

## Architecture

- Each keeper starts a P2P transport on `P2P_LISTEN_HOST:P2P_LISTEN_PORT`.
- The default transport is the existing signed Socket.IO mesh. `P2P_TRANSPORT=libp2p`
  starts an injected libp2p node and subscribes to gossipsub topics; `hybrid` runs both.
- `P2P_BOOTSTRAP_PEERS` is used only to find the first peers. Connected keepers gossip known peer URLs.
- Every P2P message is wrapped in a signed envelope with `nodeId`, `timestamp`, `nonce`, payload, and HMAC-SHA256 signature.
- Peers publish signed heartbeats containing current load, queue depth, in-flight work, task count, and pause status.
- Peer discovery, bid announcements, and task lock claims use dedicated pubsub channels.
- Task ownership uses deterministic load-aware rendezvous hashing across the local keeper and healthy peers.
- Keepers broadcast task lock claims before enqueueing due work. Active remote locks are skipped locally.
- Stale peers are pruned after `P2P_STALE_PEER_MS`, their task locks are released, and ownership automatically falls back to the remaining healthy nodes.

## Configuration

P2P is disabled by default.

```bash
P2P_ENABLED=true
P2P_SHARED_SECRET=replace-with-strong-random-secret
P2P_PUBLIC_URL=http://keeper-a.example.com:4100
P2P_LISTEN_HOST=0.0.0.0
P2P_LISTEN_PORT=4100
P2P_BOOTSTRAP_PEERS=http://keeper-b.example.com:4100,http://keeper-c.example.com:4100
P2P_HEARTBEAT_INTERVAL_MS=10000
P2P_STALE_PEER_MS=45000
P2P_AUTH_WINDOW_MS=30000
P2P_CONNECT_TIMEOUT_MS=5000
P2P_TRANSPORT=socketio
P2P_TASK_LOCK_TTL_MS=60000
```

`P2P_SHARED_SECRET` is required when `P2P_ENABLED=true`. Distribute it out-of-band through the same secret-management path used for keeper credentials. Rotate it by deploying the new value to all keepers in a short window.

`P2P_NODE_ID` is optional. When omitted, the keeper public key is used as the node ID.

`P2P_TRANSPORT=libp2p` uses the optional libp2p runtime path. Install the libp2p
transport/pubsub packages in deployments that enable it, or inject a prebuilt node factory.

## Health And Metrics

`/health` and `/metrics` include a `p2p` object with:

- `enabled`
- `started`
- `nodeId`
- `publicUrl`
- `healthy`
- `peerCount`
- `healthyPeerCount`
- healthy peer load snapshots
- `transport`
- `libp2pStarted`
- active task lock count

The keeper logs P2P lifecycle events, rejected messages, stale-peer pruning, and ownership decisions with the `p2p` module label.

## Pubsub Topics

The P2P network publishes signed envelopes to:

- `sorotask.keeper.discovery.v1`: heartbeat, load, and peer discovery.
- `sorotask.keeper.task-locks.v1`: task lock claims before execution.
- `sorotask.keeper.bids.v1`: keeper bid auction messages.

When a peer goes offline or a task lock expires, the network emits `tasks:reassign` so the next ownership pass can include those tasks again.

## Security Review Notes

- P2P payloads never include keeper secrets or private keys.
- Messages are HMAC-signed with a shared secret and verified with constant-time comparison.
- Timestamp windows limit delayed message reuse.
- Nonces are tracked per process to reject replayed envelopes.
- Peers with invalid signatures, stale timestamps, missing fields, or replayed nonces are disconnected.
- The feature does not replace the execution idempotency guard or distributed lock; those safeguards still protect task execution.

## Failure Behavior

- If P2P is disabled, the keeper uses configured shard ownership.
- If P2P startup fails, the keeper logs the error and continues with local shard ownership.
- If all peers become stale or disconnected, the keeper falls back to shard ownership until peer health recovers.
- If a peer advertises high load, load-aware rendezvous hashing assigns it fewer tasks without requiring a central scheduler.


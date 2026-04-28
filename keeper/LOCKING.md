# Distributed Locking for Keeper

This document describes the design and usage of the distributed locking mechanism introduced to allow multiple Keeper instances to run concurrently without claiming and executing the same task.

Concepts
- Lock primitive: Redis key `keeper:lock:task:<taskId>` with a token value and TTL.
- Acquire: `SET key token PX <ttl> NX` — succeeds only if key absent.
- Release: Lua script that `GET` and `DEL` only when token matches.
- Extend: Lua script to `PEXPIRE` only when token matches.

Behavior
- When the `ExecutionQueue` is about to execute a task it first attempts to acquire the lock for the task.
- If acquisition fails, the task is skipped for this instance (another keeper will execute it).
- The acquiring instance holds the lock for `LOCK_TTL_MS` (default 60s). If task execution completes, the lock is released.
- If a worker crashes or is slow, the lock TTL ensures eventual expiry and allows other workers to reclaim the task.
- The implementation uses `ioredis` and falls back to an in-process shim when `REDIS_URL` is not provided (useful for local single-instance dev only).

Observability
- Events logged: `Lock acquired`, `Lock contention`, `Lock released`, `Lock release failed`.
- `ExecutionQueue` emits `task:skipped:locked` when a task was skipped due to an existing lock.
- Metrics counters: `tasksClaimedByOther`, `tasksExecutedTotal`, `tasksFailedTotal`.

Configuration
- `REDIS_URL` — Redis connection string. When omitted, distributed locking is disabled (local shim only).
- `LOCK_TTL_MS` — Lock TTL in milliseconds. Default: `60000` (60s).

Testing
- Unit tests use `ioredis-mock` to simulate contention and TTL expiry.

Notes and future work
- Consider using Redlock (multi-node quorum) for higher reliability in clustered Redis setups.
- Add automatic lock extension (heartbeats) for long-running tasks.
- Surface lock metrics to Prometheus for alerting based on high contention.

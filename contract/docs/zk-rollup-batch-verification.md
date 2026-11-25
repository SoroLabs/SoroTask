# ZK-rollup batch verification (SC-FINAL-43)

Keepers running sub-second tasks (gaming loops, trading loops) execute them
off-chain and settle up to 100 task transitions in one transaction, backed by
one recursive SNARK. The contract verifies that one proof instead of one proof
or one call per execution.

Code: `src/zk.rs` (header, verifying key, proof check, settlement),
`src/batch.rs` (transition aggregation and Merkle tree),
`src/test_zk_rollup.rs` (tests).

## Flow

1. The admin calls `init_zk_rollup(admin, vk, genesis_state_root)` once.
   `vk` is the Groth16 verifying key of the outer recursive circuit (BN254).
2. The keeper runs tasks off-chain. Each task in the batch yields a
   `RollupTaskTransition { task_id, pre_state, post_state, executions }`.
3. The keeper's prover proves each transition, folds the proofs recursively,
   and outputs one Groth16 proof whose single public input is the batch
   commitment (below).
4. The keeper calls
   `settle_zk_rollup_batch(keeper, header, transitions, proof)`.

## Batch header

```rust
pub struct RollupBatchHeader {
    pub batch_id: u64,              // next sequential ID, starting at 1
    pub prev_state_root: BytesN<32>,
    pub new_state_root: BytesN<32>,
    pub transitions_root: BytesN<32>,
    pub task_count: u32,            // 1..=100
    pub total_executions: u64,
    pub l2_block_start: u64,
    pub l2_block_end: u64,
}
```

## Transitions root

```
leaf = SHA-256(0x00 || task_id_be8 || pre_state || post_state || executions_be4)
node = SHA-256(0x01 || left || right)
```

Leaves are in submission order and task IDs must be strictly increasing. If a
level has an odd number of nodes, the last one moves up unchanged; it is not
paired with itself.

## Public input

```
digest = SHA-256("SOROTASK/ZK-ROLLUP/v1"
                 || contract_address_xdr || keeper_address_xdr
                 || batch_id_be8 || prev_state_root || new_state_root
                 || transitions_root || task_count_be4 || total_executions_be8
                 || l2_block_start_be8 || l2_block_end_be8)
public_input = digest with the top 3 bits of byte 0 cleared
```

`compute_zk_rollup_public_input(keeper, header)` returns the value the contract
expects, so provers can check their encoding.

Binding the contract address stops replays against another deployment. Binding
the keeper stops another keeper from copying a proof out of the mempool.

## What settlement checks

In order, with the error returned on failure:

| Check | Error |
| --- | --- |
| Rollup initialised | `RollupNotConfigured` |
| `batch_id` is the next expected ID (no replays, no gaps) | `RollupBatchOutOfOrder` |
| `prev_state_root` equals the stored root | `RollupStaleStateRoot` |
| `l2_block_end >= l2_block_start` | `RollupHeaderMismatch` |
| 1 to 100 transitions | `RollupInvalidBatchSize` |
| Task IDs strictly increasing (no duplicates) | `RollupUnorderedTransitions` |
| Every transition has `executions > 0` | `RollupInvalidTransition` |
| Recomputed root, count and execution total match the header | `RollupHeaderMismatch` |
| `π_A`, `π_C` are on-curve, non-identity G1 points | `RollupInvalidProof` |
| `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1`, `vk_x = IC₀ + x·IC₁` | `RollupInvalidProof` |

If every check passes, the contract stores the new state root, increments the
batch ID and writes a `RollupBatchRecord`. Storage writes per batch are fixed,
whatever the batch size. Per-task state stays in the L2 tree; anyone can prove
a settled transition with
`verify_zk_rollup_task_inclusion(batch_id, transition, index, siblings)`.

## Point encoding

The Soroban host's BN254 functions take uncompressed points, in the same format
as the Ethereum precompiles:

- G1: `X || Y`, 64 bytes, big-endian.
- G2: `X.c1 || X.c0 || Y.c1 || Y.c0`, 128 bytes.

## Cost

`gas_per_task_drops_by_more_than_ninety_percent` measures host CPU
instructions for a 1-task settlement and a 100-task settlement and asserts the
per-task cost of the 100-task batch is under 10% of the 1-task cost. Run it with
`--nocapture` to print the numbers:

```
cargo test -p soro_task_contract --lib test_zk_rollup -- --nocapture
```

Measured with soroban-sdk 28.0.0 (host CPU instructions, whole invocation):

| | CPU instructions |
| --- | --- |
| 1-task settlement | 25,855,045 |
| 100-task settlement | 29,368,020 |
| Per task, 100-task batch | 293,680 (98.9% lower) |
| Each extra task in a batch | ~35,500 |

Almost all of the cost is the 4-pair BN254 pairing check, which is paid once
per batch. One 100-task batch uses about 29% of Soroban's 100M per-transaction
CPU limit. Per task, that is under 500,000 instructions. The whole transaction
is not: no pairing-based verifier fits in 500,000 instructions.

## Admin operations

- `rotate_zk_rollup_vk(admin, vk)` replaces the key after a circuit upgrade.
  The state root and batch sequence are kept. Proofs made for the old key stop
  verifying.
- Getters: `get_zk_rollup_state_root`, `get_zk_rollup_next_batch_id`,
  `get_zk_rollup_batch`, `get_zk_rollup_vk`.

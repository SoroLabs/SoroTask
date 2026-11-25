//! Tests for ZK-rollup batch verification of L2 keeper tasks (SC-FINAL-43).
//!
//! The proofs here are produced by a test "prover" that knows the toy
//! verifying key's discrete logs, so it can build points that satisfy the
//! Groth16 equation for any public input. The contract cannot tell such a
//! proof from one produced by a real circuit: the same BN254 pairing check
//! runs either way. Changing any committed value (keeper, state roots,
//! transitions) changes the public input and makes the proof fail.

extern crate std;

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine},
    testutils::Address as _,
    Address, BytesN, Env, Vec,
};

use crate::{
    batch::{self, RollupTaskTransition, MAX_ROLLUP_BATCH_TASKS},
    zk::{RecursiveSnarkProof, RollupBatchHeader, RollupVerifyingKey},
    Error, SoroTaskContract, SoroTaskContractClient,
};

// ============================================================================
// Curve helpers
// ============================================================================

/// BN254 G1 generator (1, 2).
fn g1_generator(env: &Env) -> Bn254G1Affine {
    let mut bytes = [0u8; 64];
    bytes[31] = 1;
    bytes[63] = 2;
    Bn254G1Affine::from_array(env, &bytes)
}

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

/// BN254 G2 generator (EIP-197), encoded X.c1 || X.c0 || Y.c1 || Y.c0.
fn g2_generator(env: &Env) -> BytesN<128> {
    let parts = [
        hex32("198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2"),
        hex32("1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed"),
        hex32("090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b"),
        hex32("12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
    ];
    let mut bytes = [0u8; 128];
    for (i, part) in parts.iter().enumerate() {
        bytes[i * 32..(i + 1) * 32].copy_from_slice(part);
    }
    BytesN::from_array(env, &bytes)
}

fn scalar(env: &Env, n: u64) -> Bn254Fr {
    let mut bytes = [0u8; 32];
    bytes[24..].copy_from_slice(&n.to_be_bytes());
    Bn254Fr::from_bytes(BytesN::from_array(env, &bytes))
}

fn g1_times(env: &Env, n: u64) -> Bn254G1Affine {
    env.crypto()
        .bn254()
        .g1_mul(&g1_generator(env), &scalar(env, n))
}

// ============================================================================
// Toy circuit + prover
// ============================================================================

/// Discrete logs of the toy verifying key's G1 points. All G2 points are the
/// generator.
#[derive(Clone, Copy)]
struct ToyCircuit {
    alpha: u64,
    ic0: u64,
    ic1: u64,
}

const CIRCUIT: ToyCircuit = ToyCircuit {
    alpha: 3,
    ic0: 5,
    ic1: 7,
};

const OTHER_CIRCUIT: ToyCircuit = ToyCircuit {
    alpha: 13,
    ic0: 17,
    ic1: 19,
};

fn verifying_key(env: &Env, circuit: ToyCircuit) -> RollupVerifyingKey {
    let g2 = g2_generator(env);
    let mut ic = Vec::new(env);
    ic.push_back(g1_times(env, circuit.ic0).to_bytes());
    ic.push_back(g1_times(env, circuit.ic1).to_bytes());
    RollupVerifyingKey {
        alpha: g1_times(env, circuit.alpha).to_bytes(),
        beta: g2.clone(),
        gamma: g2.clone(),
        delta: g2,
        ic,
    }
}

/// Build a proof satisfying e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1 with
/// B = β = γ = δ = G2, i.e. A = α + vk_x + C.
fn prove(env: &Env, circuit: ToyCircuit, public_input: &BytesN<32>) -> RecursiveSnarkProof {
    let bn = env.crypto().bn254();
    let x = Bn254Fr::from_bytes(public_input.clone());
    let vk_x = bn.g1_add(
        &g1_times(env, circuit.ic0),
        &bn.g1_mul(&g1_times(env, circuit.ic1), &x),
    );
    let c = g1_times(env, 11);
    let a = bn.g1_add(&bn.g1_add(&g1_times(env, circuit.alpha), &vk_x), &c);
    RecursiveSnarkProof {
        a: a.to_bytes(),
        b: g2_generator(env),
        c: c.to_bytes(),
    }
}

// ============================================================================
// Fixtures
// ============================================================================

fn root(env: &Env, tag: u8) -> BytesN<32> {
    BytesN::from_array(env, &[tag; 32])
}

fn genesis(env: &Env) -> BytesN<32> {
    root(env, 0xA0)
}

fn setup() -> (Env, SoroTaskContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin_address(&admin);
    (env, client, admin)
}

fn setup_initialised() -> (Env, SoroTaskContractClient<'static>, Address) {
    let (env, client, admin) = setup();
    client.init_zk_rollup(&admin, &verifying_key(&env, CIRCUIT), &genesis(&env));
    (env, client, admin)
}

/// `count` transitions for task IDs `first_task .. first_task + count`.
fn transitions(env: &Env, first_task: u64, count: u32) -> Vec<RollupTaskTransition> {
    let mut out = Vec::new(env);
    for i in 0..count as u64 {
        let task_id = first_task + i;
        let mut pre = [0u8; 32];
        pre[..8].copy_from_slice(&task_id.to_be_bytes());
        let mut post = pre;
        post[31] = 0xFF;
        out.push_back(RollupTaskTransition {
            task_id,
            pre_state: BytesN::from_array(env, &pre),
            post_state: BytesN::from_array(env, &post),
            executions: 60,
        });
    }
    out
}

fn header_for(
    env: &Env,
    batch_id: u64,
    prev_state_root: BytesN<32>,
    new_state_root: BytesN<32>,
    transitions: &Vec<RollupTaskTransition>,
) -> RollupBatchHeader {
    let aggregate = batch::aggregate_rollup_transitions(env, transitions).unwrap();
    RollupBatchHeader {
        batch_id,
        prev_state_root,
        new_state_root,
        transitions_root: aggregate.transitions_root,
        task_count: aggregate.task_count,
        total_executions: aggregate.total_executions,
        l2_block_start: (batch_id - 1) * 1_000 + 1,
        l2_block_end: batch_id * 1_000,
    }
}

/// A fully valid batch: header, transitions, and a proof for `keeper`.
fn valid_batch(
    env: &Env,
    client: &SoroTaskContractClient,
    keeper: &Address,
    batch_id: u64,
    prev_state_root: BytesN<32>,
    new_state_root: BytesN<32>,
    count: u32,
) -> (
    RollupBatchHeader,
    Vec<RollupTaskTransition>,
    RecursiveSnarkProof,
) {
    let txs = transitions(env, 1, count);
    let header = header_for(env, batch_id, prev_state_root, new_state_root, &txs);
    let public_input = client.compute_zk_rollup_public_input(keeper, &header);
    let proof = prove(env, CIRCUIT, &public_input);
    (header, txs, proof)
}

/// Sibling path for `index`, following the contract's carry-the-odd-node rule.
fn inclusion_path(env: &Env, txs: &Vec<RollupTaskTransition>, index: u32) -> Vec<BytesN<32>> {
    let mut level: std::vec::Vec<BytesN<32>> = txs
        .iter()
        .map(|t| batch::rollup_leaf_hash(env, &t))
        .collect();
    let mut idx = index as usize;
    let mut path = Vec::new(env);
    while level.len() > 1 {
        let width = level.len();
        if !(idx == width - 1 && width % 2 == 1) {
            let sibling = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
            path.push_back(level[sibling].clone());
        }
        let mut next = std::vec::Vec::new();
        for pair in level.chunks(2) {
            if pair.len() == 2 {
                next.push(batch::rollup_node_hash(env, &pair[0], &pair[1]));
            } else {
                next.push(pair[0].clone());
            }
        }
        level = next;
        idx /= 2;
    }
    path
}

// ============================================================================
// Acceptance: 100 tasks in one transaction
// ============================================================================

#[test]
fn hundred_tasks_settle_in_a_single_transaction() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let new_root = root(&env, 0xB1);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        new_root.clone(),
        MAX_ROLLUP_BATCH_TASKS,
    );

    let receipt = client.settle_zk_rollup_batch(&keeper, &header, &txs, &proof);

    assert_eq!(receipt.batch_id, 1);
    assert_eq!(receipt.task_count, 100);
    assert_eq!(receipt.total_executions, 100 * 60);
    assert_eq!(receipt.new_state_root, new_root);
    assert_eq!(client.get_zk_rollup_state_root(), Some(new_root));
    assert_eq!(client.get_zk_rollup_next_batch_id(), 2);

    let record = client.get_zk_rollup_batch(&1).unwrap();
    assert_eq!(record.header, header);
    assert_eq!(record.keeper, keeper);
    assert_eq!(record.commitment, receipt.commitment);
}

#[test]
fn gas_per_task_drops_by_more_than_ninety_percent() {
    // Baseline: one task settled on its own, paying for a full proof check.
    let (env_single, client_single, _) = setup_initialised();
    let keeper = Address::generate(&env_single);
    let (h1, t1, p1) = valid_batch(
        &env_single,
        &client_single,
        &keeper,
        1,
        genesis(&env_single),
        root(&env_single, 0xB1),
        1,
    );
    env_single.cost_estimate().budget().reset_tracker();
    client_single.settle_zk_rollup_batch(&keeper, &h1, &t1, &p1);
    let single_cpu = env_single.cost_estimate().budget().cpu_instruction_cost();

    // Rollup: 100 tasks behind one proof.
    let (env_batch, client_batch, _) = setup_initialised();
    let keeper = Address::generate(&env_batch);
    let (h100, t100, p100) = valid_batch(
        &env_batch,
        &client_batch,
        &keeper,
        1,
        genesis(&env_batch),
        root(&env_batch, 0xB1),
        MAX_ROLLUP_BATCH_TASKS,
    );
    env_batch.cost_estimate().budget().reset_tracker();
    client_batch.settle_zk_rollup_batch(&keeper, &h100, &t100, &p100);
    let batch_cpu = env_batch.cost_estimate().budget().cpu_instruction_cost();

    let per_task = batch_cpu / MAX_ROLLUP_BATCH_TASKS as u64;
    let marginal = (batch_cpu - single_cpu) / (MAX_ROLLUP_BATCH_TASKS as u64 - 1);
    std::eprintln!(
        "[zk-rollup] single-task settle: {single_cpu} cpu | 100-task settle: {batch_cpu} cpu \
         | per task: {per_task} cpu | marginal per extra task: {marginal} cpu"
    );

    // > 90% reduction  <=>  per-task cost < 10% of the standalone cost.
    assert!(
        per_task * 10 < single_cpu,
        "per-task cpu {per_task} is not below 10% of standalone cpu {single_cpu}"
    );
}

#[test]
fn sequential_batches_chain_state_roots() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);

    let root1 = root(&env, 0xB1);
    let (h1, t1, p1) = valid_batch(&env, &client, &keeper, 1, genesis(&env), root1.clone(), 40);
    client.settle_zk_rollup_batch(&keeper, &h1, &t1, &p1);

    let root2 = root(&env, 0xB2);
    let (h2, t2, p2) = valid_batch(&env, &client, &keeper, 2, root1, root2.clone(), 100);
    let receipt = client.settle_zk_rollup_batch(&keeper, &h2, &t2, &p2);

    assert_eq!(receipt.batch_id, 2);
    assert_eq!(client.get_zk_rollup_state_root(), Some(root2));
    assert_eq!(client.get_zk_rollup_next_batch_id(), 3);
}

// ============================================================================
// Proof validation
// ============================================================================

#[test]
fn rejects_forged_proof() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, mut proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );
    proof.c = g1_times(&env, 12).to_bytes();

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupInvalidProof))
    );
    assert_eq!(client.get_zk_rollup_state_root(), Some(genesis(&env)));
    assert_eq!(client.get_zk_rollup_next_batch_id(), 1);
}

#[test]
fn rejects_proof_point_off_curve() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, mut proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        10,
    );
    let mut bad = [0u8; 64];
    bad[31] = 1;
    bad[63] = 3; // (1, 3) is not on y^2 = x^3 + 3
    proof.a = BytesN::from_array(&env, &bad);

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupInvalidProof))
    );
}

#[test]
fn rejects_proof_submitted_by_another_keeper() {
    let (env, client, _) = setup_initialised();
    let prover = Address::generate(&env);
    let thief = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &prover,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );

    assert_eq!(
        client.try_settle_zk_rollup_batch(&thief, &header, &txs, &proof),
        Err(Ok(Error::RollupInvalidProof))
    );
}

#[test]
fn rejects_header_whose_new_root_the_proof_does_not_cover() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (mut header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );
    header.new_state_root = root(&env, 0xEE);

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupInvalidProof))
    );
}

#[test]
fn rejects_proof_for_a_rotated_out_verifying_key() {
    let (env, client, admin) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        20,
    );

    client.rotate_zk_rollup_vk(&admin, &verifying_key(&env, OTHER_CIRCUIT));
    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupInvalidProof))
    );

    let public_input = client.compute_zk_rollup_public_input(&keeper, &header);
    let new_proof = prove(&env, OTHER_CIRCUIT, &public_input);
    client.settle_zk_rollup_batch(&keeper, &header, &txs, &new_proof);
    assert_eq!(client.get_zk_rollup_next_batch_id(), 2);
}

// ============================================================================
// State-tree integrity
// ============================================================================

#[test]
fn rejects_stale_prev_state_root() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        root(&env, 0xCC),
        root(&env, 0xB1),
        100,
    );

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupStaleStateRoot))
    );
}

#[test]
fn rejects_replayed_batch() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );
    client.settle_zk_rollup_batch(&keeper, &header, &txs, &proof);

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupBatchOutOfOrder))
    );
}

#[test]
fn rejects_skipped_batch_id() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        2,
        genesis(&env),
        root(&env, 0xB1),
        5,
    );

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupBatchOutOfOrder))
    );
}

#[test]
fn rejects_transitions_that_do_not_match_the_header() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, mut txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );

    let mut tampered = txs.get(42).unwrap();
    tampered.post_state = root(&env, 0x66);
    txs.set(42, tampered);

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupHeaderMismatch))
    );
}

#[test]
fn rejects_dropped_transition() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, mut txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );
    txs.pop_back();

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupHeaderMismatch))
    );
}

#[test]
fn rejects_inverted_l2_block_range() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let txs = transitions(&env, 1, 3);
    let mut header = header_for(&env, 1, genesis(&env), root(&env, 0xB1), &txs);
    header.l2_block_start = 10;
    header.l2_block_end = 9;
    let proof = prove(
        &env,
        CIRCUIT,
        &client.compute_zk_rollup_public_input(&keeper, &header),
    );

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupHeaderMismatch))
    );
}

#[test]
fn rejects_batch_sizes_outside_one_to_one_hundred() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let proof = prove(&env, CIRCUIT, &BytesN::from_array(&env, &[0u8; 32]));

    let too_many = transitions(&env, 1, MAX_ROLLUP_BATCH_TASKS + 1);
    let mut header = header_for(
        &env,
        1,
        genesis(&env),
        root(&env, 0xB1),
        &transitions(&env, 1, 1),
    );
    header.task_count = MAX_ROLLUP_BATCH_TASKS + 1;
    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &too_many, &proof),
        Err(Ok(Error::RollupInvalidBatchSize))
    );

    header.task_count = 0;
    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &Vec::new(&env), &proof),
        Err(Ok(Error::RollupInvalidBatchSize))
    );
}

#[test]
fn rejects_duplicate_and_unordered_task_ids() {
    let env = Env::default();

    let mut dup = transitions(&env, 1, 3);
    let mut second = dup.get(1).unwrap();
    second.task_id = 1;
    dup.set(1, second);
    assert_eq!(
        batch::aggregate_rollup_transitions(&env, &dup),
        Err(Error::RollupUnorderedTransitions)
    );

    let mut unordered = transitions(&env, 1, 3);
    let first = unordered.get(0).unwrap();
    let last = unordered.get(2).unwrap();
    unordered.set(0, last);
    unordered.set(2, first);
    assert_eq!(
        batch::aggregate_rollup_transitions(&env, &unordered),
        Err(Error::RollupUnorderedTransitions)
    );
}

#[test]
fn rejects_transition_with_zero_executions() {
    let env = Env::default();
    let mut txs = transitions(&env, 1, 3);
    let mut t = txs.get(2).unwrap();
    t.executions = 0;
    txs.set(2, t);
    assert_eq!(
        batch::aggregate_rollup_transitions(&env, &txs),
        Err(Error::RollupInvalidTransition)
    );
}

#[test]
fn settled_tasks_can_be_proven_against_the_batch_root() {
    let (env, client, _) = setup_initialised();
    let keeper = Address::generate(&env);
    let (header, txs, proof) = valid_batch(
        &env,
        &client,
        &keeper,
        1,
        genesis(&env),
        root(&env, 0xB1),
        100,
    );
    client.settle_zk_rollup_batch(&keeper, &header, &txs, &proof);

    for index in [0u32, 1, 57, 98, 99] {
        let path = inclusion_path(&env, &txs, index);
        assert!(client.verify_zk_rollup_task_inclusion(
            &1,
            &txs.get(index).unwrap(),
            &index,
            &path
        ));
    }

    // Wrong position, tampered transition, unknown batch.
    let path = inclusion_path(&env, &txs, 57);
    assert!(!client.verify_zk_rollup_task_inclusion(&1, &txs.get(57).unwrap(), &56, &path));
    let mut forged = txs.get(57).unwrap();
    forged.post_state = root(&env, 0x01);
    assert!(!client.verify_zk_rollup_task_inclusion(&1, &forged, &57, &path));
    assert!(!client.verify_zk_rollup_task_inclusion(&2, &txs.get(57).unwrap(), &57, &path));
}

#[test]
fn merkle_root_does_not_duplicate_odd_leaves() {
    let env = Env::default();
    let three = transitions(&env, 1, 3);
    let mut four = three.clone();
    four.push_back(three.get(2).unwrap());

    let leaves3: Vec<BytesN<32>> = {
        let mut v = Vec::new(&env);
        for t in three.iter() {
            v.push_back(batch::rollup_leaf_hash(&env, &t));
        }
        v
    };
    let leaves4: Vec<BytesN<32>> = {
        let mut v = Vec::new(&env);
        for t in four.iter() {
            v.push_back(batch::rollup_leaf_hash(&env, &t));
        }
        v
    };
    assert_ne!(
        batch::rollup_merkle_root(&env, &leaves3),
        batch::rollup_merkle_root(&env, &leaves4)
    );
}

// ============================================================================
// Configuration
// ============================================================================

#[test]
fn settlement_requires_initialisation() {
    let (env, client, _) = setup();
    let keeper = Address::generate(&env);
    let txs = transitions(&env, 1, 1);
    let header = header_for(&env, 1, genesis(&env), root(&env, 0xB1), &txs);
    let proof = prove(&env, CIRCUIT, &BytesN::from_array(&env, &[0u8; 32]));

    assert_eq!(
        client.try_settle_zk_rollup_batch(&keeper, &header, &txs, &proof),
        Err(Ok(Error::RollupNotConfigured))
    );
}

#[test]
fn init_runs_once_and_only_for_the_admin() {
    let (env, client, admin) = setup();
    let vk = verifying_key(&env, CIRCUIT);

    let stranger = Address::generate(&env);
    assert_eq!(
        client.try_init_zk_rollup(&stranger, &vk, &genesis(&env)),
        Err(Ok(Error::Unauthorized))
    );

    client.init_zk_rollup(&admin, &vk, &genesis(&env));
    assert_eq!(client.get_zk_rollup_vk(), Some(vk.clone()));
    assert_eq!(client.get_zk_rollup_state_root(), Some(genesis(&env)));
    assert_eq!(client.get_zk_rollup_next_batch_id(), 1);

    assert_eq!(
        client.try_init_zk_rollup(&admin, &vk, &root(&env, 0x01)),
        Err(Ok(Error::RollupAlreadyConfigured))
    );
}

#[test]
fn rejects_malformed_verifying_keys() {
    let (env, client, admin) = setup();

    let mut short_ic = verifying_key(&env, CIRCUIT);
    short_ic.ic.pop_back();
    assert_eq!(
        client.try_init_zk_rollup(&admin, &short_ic, &genesis(&env)),
        Err(Ok(Error::RollupInvalidVerifyingKey))
    );

    let mut infinity_alpha = verifying_key(&env, CIRCUIT);
    infinity_alpha.alpha = BytesN::from_array(&env, &[0u8; 64]);
    assert_eq!(
        client.try_init_zk_rollup(&admin, &infinity_alpha, &genesis(&env)),
        Err(Ok(Error::RollupInvalidVerifyingKey))
    );

    assert_eq!(
        client.try_rotate_zk_rollup_vk(&admin, &verifying_key(&env, CIRCUIT)),
        Err(Ok(Error::RollupNotConfigured))
    );
}

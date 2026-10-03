/// Focused tests for the Groth16 ZK proof gate (Issue #1195).
///
/// Covers:
///   - Valid proof approves task execution
///   - Forged proof (wrong proof_hash) is rejected with InvalidZkProof
///   - Wrong VK digest is rejected with InvalidZkProof
///   - Missing / unset VK is rejected with InvalidZkProof
///   - Replay of a valid nullifier is rejected with InvalidZkProof
///   - Zero-length proof_a / proof_b / proof_c are rejected
///   - Oversized proof elements are rejected
///   - is_zk_nullifier_spent reflects state before and after execution
///   - set_zk_verification_key / get_zk_verification_key round-trip

#[cfg(test)]
mod test_zk {
    extern crate std;

    use soroban_sdk::{
        testutils::Address as _, Address, Bytes, BytesN, ConversionError, Env, InvokeError,
    };

    use crate::{
        zk::{Groth16Proof, MAX_G1_POINT_BYTES, MAX_G2_POINT_BYTES, MAX_PUBLIC_INPUTS_BYTES},
        Error, SoroTaskContract, SoroTaskContractClient,
    };

    // =========================================================================
    // Test helpers
    // =========================================================================

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SoroTaskContract, ());
        (env, contract_id)
    }

    /// Minimal valid G1 point (32 bytes, BN254 compressed).
    fn g1(env: &Env) -> Bytes {
        let mut data = [0u8; 32];
        data[0] = 0x02;
        data[31] = 0x01;
        Bytes::from_slice(env, &data)
    }

    /// Minimal valid G2 point (64 bytes, BN254 compressed).
    fn g2(env: &Env) -> Bytes {
        let mut data = [0u8; 64];
        data[0] = 0x03;
        data[63] = 0x01;
        Bytes::from_slice(env, &data)
    }

    /// One 32-byte field element as public input.
    fn pub_inputs(env: &Env) -> Bytes {
        let mut fe = [0u8; 32];
        fe[31] = 0x01;
        Bytes::from_slice(env, &fe)
    }

    /// A deterministic 32-byte VK digest keyed by `tag`.
    fn vk_digest_from(env: &Env, tag: u8) -> BytesN<32> {
        let mut raw = [0u8; 32];
        raw[0] = 0xAA; // "VK" marker
        raw[1] = tag;
        BytesN::from_array(env, &raw)
    }

    /// Compute SHA-256 the same way zk.rs does.
    fn sha256(env: &Env, data: &Bytes) -> BytesN<32> {
        env.crypto().sha256(data).into()
    }

    fn bytes_cat(env: &Env, a: &Bytes, b: &Bytes) -> Bytes {
        let mut out = Bytes::new(env);
        out.append(a);
        out.append(b);
        out
    }

    /// Build a correctly-hashed Groth16Proof for the given VK digest.
    ///
    /// proof_hash = SHA-256(vk_digest || proof_a || proof_b || proof_c || public_inputs)
    fn make_valid_proof(env: &Env, vk: BytesN<32>) -> Groth16Proof {
        let pa = g1(env);
        let pb = g2(env);
        let pc = g1(env);
        let pi = pub_inputs(env);

        let vk_bytes = Bytes::from_slice(env, &vk.to_array());
        let payload = bytes_cat(
            env,
            &bytes_cat(
                env,
                &bytes_cat(env, &bytes_cat(env, &vk_bytes, &pa), &pb),
                &pc,
            ),
            &pi,
        );
        let proof_hash = sha256(env, &payload);

        Groth16Proof {
            proof_a: pa,
            proof_b: pb,
            proof_c: pc,
            public_inputs: pi,
            vk_digest: vk,
            proof_hash,
        }
    }

    /// Return a proof with the proof_hash flipped by one bit (forged).
    fn make_forged_proof(env: &Env, vk: BytesN<32>) -> Groth16Proof {
        let mut p = make_valid_proof(env, vk);
        let mut raw = p.proof_hash.to_array();
        raw[0] ^= 0xFF;
        p.proof_hash = BytesN::from_array(env, &raw);
        p
    }

    /// Check that `try_*` result carries an `InvalidZkProof` (discriminant 42).
    fn assert_invalid_zk_proof(
        result: Result<
            Result<(), soroban_sdk::ConversionError>,
            Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
        >,
    ) {
        // The outer Err contains the contract error.
        let inner = result.expect_err("expected contract error, got Ok");
        let sdk_err = inner.expect("expected soroban_sdk::Error, not InvokeError");
        assert_eq!(
            sdk_err,
            soroban_sdk::Error::from_contract_error(42),
            "expected InvalidZkProof (code 42), got {:?}",
            sdk_err
        );
    }

    // =========================================================================
    // VK management
    // =========================================================================

    #[test]
    fn test_set_and_get_vk() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        assert!(client.get_zk_verification_key().is_none());

        let vk = vk_digest_from(&env, 1);
        client.set_zk_verification_key(&admin, &vk);

        assert_eq!(client.get_zk_verification_key().unwrap(), vk);
    }

    #[test]
    fn test_set_vk_can_be_updated() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk1 = vk_digest_from(&env, 1);
        let vk2 = vk_digest_from(&env, 2);

        client.set_zk_verification_key(&admin, &vk1);
        assert_eq!(client.get_zk_verification_key().unwrap(), vk1);

        client.set_zk_verification_key(&admin, &vk2);
        assert_eq!(client.get_zk_verification_key().unwrap(), vk2);
    }

    // =========================================================================
    // Valid proof
    // =========================================================================

    #[test]
    fn test_valid_proof_approves_execution() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 42);
        client.set_zk_verification_key(&admin, &vk);

        let proof = make_valid_proof(&env, vk);
        // task_id 0: no task registration required for proof gate itself.
        let result = client.try_execute_zk(&0_u64, &proof);
        assert!(result.is_ok(), "valid proof should succeed: {:?}", result);
    }

    #[test]
    fn test_valid_proof_marks_nullifier_spent() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 7);
        client.set_zk_verification_key(&admin, &vk);

        let proof = make_valid_proof(&env, vk.clone());

        // Derive the expected nullifier: SHA-256(proof_a || proof_b || proof_c)
        let payload = bytes_cat(
            &env,
            &bytes_cat(&env, &proof.proof_a, &proof.proof_b),
            &proof.proof_c,
        );
        let nullifier = sha256(&env, &payload);

        assert!(!client.is_zk_nullifier_spent(&nullifier));

        client.execute_zk(&0_u64, &proof);

        assert!(client.is_zk_nullifier_spent(&nullifier));
    }

    // =========================================================================
    // Replay attack
    // =========================================================================

    #[test]
    fn test_replay_nullifier_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 99);
        client.set_zk_verification_key(&admin, &vk);

        let proof = make_valid_proof(&env, vk);

        // First execution succeeds.
        assert!(client.try_execute_zk(&0_u64, &proof).is_ok());

        // Second execution with same proof fails.
        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    // =========================================================================
    // Forged / invalid proof
    // =========================================================================

    #[test]
    fn test_forged_proof_hash_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 3);
        client.set_zk_verification_key(&admin, &vk);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &make_forged_proof(&env, vk)));
    }

    #[test]
    fn test_wrong_vk_digest_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let stored_vk = vk_digest_from(&env, 10);
        client.set_zk_verification_key(&admin, &stored_vk);

        // Build proof against a different VK.
        let wrong_vk = vk_digest_from(&env, 11);
        let proof = make_valid_proof(&env, wrong_vk);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_no_vk_stored_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        // No VK set.
        let vk = vk_digest_from(&env, 5);
        let proof = make_valid_proof(&env, vk);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    // =========================================================================
    // Boundary cases — zero-length and oversized proof elements
    // =========================================================================

    #[test]
    fn test_empty_proof_a_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 20);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        proof.proof_a = Bytes::new(&env);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_empty_proof_b_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 21);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        proof.proof_b = Bytes::new(&env);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_empty_proof_c_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 22);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        proof.proof_c = Bytes::new(&env);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_oversized_proof_a_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 30);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        let oversized_data = [0x02u8].repeat((MAX_G1_POINT_BYTES + 1) as usize);
        proof.proof_a = Bytes::from_slice(&env, &oversized_data);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_oversized_proof_b_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 31);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        let oversized_data = [0x03u8].repeat((MAX_G2_POINT_BYTES + 1) as usize);
        proof.proof_b = Bytes::from_slice(&env, &oversized_data);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    #[test]
    fn test_oversized_public_inputs_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 32);
        client.set_zk_verification_key(&admin, &vk);

        let mut proof = make_valid_proof(&env, vk);
        let oversized_data = [0u8].repeat((MAX_PUBLIC_INPUTS_BYTES + 1) as usize);
        proof.public_inputs = Bytes::from_slice(&env, &oversized_data);

        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof));
    }

    // =========================================================================
    // Two distinct proofs do not interfere with each other
    // =========================================================================

    #[test]
    fn test_two_distinct_proofs_independent() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 50);
        client.set_zk_verification_key(&admin, &vk);

        let proof1 = make_valid_proof(&env, vk.clone());

        // Build proof2 differing in proof_a → different nullifier.
        let mut pa2_data = [0u8; 32];
        pa2_data[0] = 0x02;
        pa2_data[31] = 0x99; // distinct last byte
        let pa2 = Bytes::from_slice(&env, &pa2_data);
        let pb2 = g2(&env);
        let pc2 = g1(&env);
        let pi2 = pub_inputs(&env);

        let vk_bytes2 = Bytes::from_slice(&env, &vk.to_array());
        let payload2 = bytes_cat(
            &env,
            &bytes_cat(
                &env,
                &bytes_cat(&env, &bytes_cat(&env, &vk_bytes2, &pa2), &pb2),
                &pc2,
            ),
            &pi2,
        );
        let hash2 = sha256(&env, &payload2);
        let proof2 = Groth16Proof {
            proof_a: pa2,
            proof_b: pb2,
            proof_c: pc2,
            public_inputs: pi2,
            vk_digest: vk.clone(),
            proof_hash: hash2,
        };

        // Both proofs should succeed independently.
        assert!(client.try_execute_zk(&0_u64, &proof1).is_ok());
        assert!(client.try_execute_zk(&1_u64, &proof2).is_ok());

        // Replaying either now fails.
        assert_invalid_zk_proof(client.try_execute_zk(&0_u64, &proof1));
        assert_invalid_zk_proof(client.try_execute_zk(&1_u64, &proof2));
    }

    // =========================================================================
    // is_zk_nullifier_spent is deterministic and unaffected by unrelated proofs
    // =========================================================================

    #[test]
    fn test_nullifier_not_spent_before_execution() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 60);
        client.set_zk_verification_key(&admin, &vk);

        let proof = make_valid_proof(&env, vk);
        let payload = bytes_cat(
            &env,
            &bytes_cat(&env, &proof.proof_a, &proof.proof_b),
            &proof.proof_c,
        );
        let nullifier = sha256(&env, &payload);

        assert!(!client.is_zk_nullifier_spent(&nullifier));
    }

    #[test]
    fn test_unrelated_nullifier_never_spent() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let vk = vk_digest_from(&env, 70);
        client.set_zk_verification_key(&admin, &vk);

        let proof = make_valid_proof(&env, vk);

        // Execute proof1 to spend its nullifier.
        client.execute_zk(&0_u64, &proof);

        // A completely different nullifier (all zeros) should not be spent.
        let other_nullifier = BytesN::from_array(&env, &[0u8; 32]);
        assert!(!client.is_zk_nullifier_spent(&other_nullifier));
    }
}

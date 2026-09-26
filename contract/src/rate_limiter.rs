//! Per-target rolling leaky-bucket rate limiting for task invocations.
use soroban_sdk::{contracttype, Address, Env, Vec};

/// At most ten target calls may be made in any rolling one hundred ledgers.
const BUCKET_CAPACITY: u32 = 10;
const WINDOW_LEDGERS: u32 = 100;

#[contracttype]
#[derive(Clone, Debug)]
pub struct TargetInvocationBucket {
    pub last_call_ledger: u32,
    /// Number of successful calls still inside the rolling ledger window.
    pub accumulated_calls: u32,
    /// Ledgers of recent calls; at most `BUCKET_CAPACITY` entries are stored.
    pub call_ledgers: Vec<u32>,
}

/// Consume one target invocation from its leaky bucket.
///
/// Returns false when the bucket is full. Rejected calls do not alter the
/// bucket, allowing tasks to be retried without penalty after it drains.
pub fn allow_invocation(env: &Env, target: &Address) -> bool {
    let key = crate::DataKey::TargetInvocationBucket(target.clone());
    let ledger = env.ledger().sequence();
    let mut bucket: TargetInvocationBucket =
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(TargetInvocationBucket {
                last_call_ledger: ledger,
                accumulated_calls: 0,
                call_ledgers: Vec::new(env),
            });

    let mut recent_calls = Vec::new(env);
    for call_ledger in bucket.call_ledgers.iter() {
        if ledger.saturating_sub(call_ledger) < WINDOW_LEDGERS {
            recent_calls.push_back(call_ledger);
        }
    }
    bucket.accumulated_calls = recent_calls.len();
    if bucket.accumulated_calls >= BUCKET_CAPACITY {
        return false;
    }

    recent_calls.push_back(ledger);
    bucket.accumulated_calls += 1;
    bucket.last_call_ledger = ledger;
    bucket.call_ledgers = recent_calls;
    env.storage().persistent().set(&key, &bucket);
    env.storage()
        .persistent()
        .extend_ttl(&key, 100_000, 100_000);
    true
}

#[cfg(test)]
mod tests {
    use super::allow_invocation;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn limits_each_target_and_leaks_capacity_over_time() {
        let env = Env::default();
        let first = Address::generate(&env);
        let second = Address::generate(&env);

        for _ in 0..10 {
            assert!(allow_invocation(&env, &first));
        }
        assert!(!allow_invocation(&env, &first));
        assert!(allow_invocation(&env, &second));

        env.ledger().with_mut(|ledger| ledger.sequence_number += 10);
        assert!(!allow_invocation(&env, &first));

        env.ledger().with_mut(|ledger| ledger.sequence_number += 90);
        assert!(allow_invocation(&env, &first));
    }
}

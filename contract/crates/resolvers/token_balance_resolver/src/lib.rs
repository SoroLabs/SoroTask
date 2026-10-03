//! TokenBalanceResolver — Resolver that approves execution based on token balance conditions.
//!
//! This resolver checks if a specified account's balance of a given token falls
//! within a configured range [min_balance, max_balance]. It includes reentrancy
//! guards and cross-contract authorization to prevent manipulation during the
//! balance check.

use soroban_sdk::{contract, contractimpl, Env, Bytes, Symbol, Vec, Address};
use soro_task_contract::resolver::{TokenBalanceContext, utils};

#[contract]
pub struct TokenBalanceResolver;

#[contractimpl]
impl TokenBalanceResolver {
    /// Initialize the resolver with admin authorization.
    ///
    /// # Arguments
    /// * `admin` - Address authorized to configure the resolver
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        // Reentrancy guard initialized to false
        env.storage().instance().set(&DataKey::ReentrancyGuard, &false);
    }

    /// Set the admin address (current admin only).
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Get the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// The canonical resolver entry point.
    ///
    /// Checks if the specified account's token balance is within the configured
    /// range. Context bytes can specify token, account, min_balance, and max_balance
    /// per-task.
    ///
    /// Includes reentrancy protection: if a reentrant call is detected during
    /// the balance check, the condition fails (returns false).
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `task_id` - Task identifier
    /// * `context` - CBOR-encoded TokenBalanceContext
    ///
    /// # Returns
    /// `true` if balance is within range, `false` otherwise.
    pub fn check_condition(env: Env, _task_id: u64, context: Bytes) -> bool {
        // Reentrancy guard: prevent recursive calls
        let guard_key = DataKey::ReentrancyGuard;
        let is_locked: bool = env.storage().instance().get(&guard_key).unwrap_or(false);
        if is_locked {
            // Reentrancy detected - fail safely
            return false;
        }

        // Acquire lock
        env.storage().instance().set(&guard_key, &true);

        // Use a closure to ensure lock is released even on early return
        let result = (|| {
            // Decode context
            let ctx = match utils::decode_context::<TokenBalanceContext>(&env, &context) {
                Some(c) => c,
                None => return false,
            };

            // Cross-contract authorization: require auth from the account being checked
            // This prevents unauthorized balance checks on other accounts
            ctx.account.require_auth();

            // Query token balance via cross-contract call
            let balance: i128 = match env.try_invoke_contract::<i128, soroban_sdk::Error>(
                &ctx.token,
                &Symbol::new(&env, "balance"),
                Vec::from_array(&env, [ctx.account.to_val()]),
            ) {
                Ok(Ok(b)) => b,
                _ => return false, // Cross-contract call failed
            };

            // Check if balance is within range [min_balance, max_balance]
            balance >= ctx.min_balance && balance <= ctx.max_balance
        })();

        // Release lock
        env.storage().instance().set(&guard_key, &false);

        result
    }

    /// Batch check multiple token balances (for gas efficiency).
    ///
    /// Returns a vector of booleans corresponding to each context.
    /// All checks share a single reentrancy guard acquisition.
    pub fn check_conditions_batch(env: Env, contexts: Vec<Bytes>) -> Vec<bool> {
        let guard_key = DataKey::ReentrancyGuard;
        let is_locked: bool = env.storage().instance().get(&guard_key).unwrap_or(false);
        if is_locked {
            // Return all false on reentrancy
            let mut results = Vec::new(&env);
            for _ in 0..contexts.len() {
                results.push_back(false);
            }
            return results;
        }

        env.storage().instance().set(&guard_key, &true);

        let results = (|| {
            let mut results = Vec::new(&env);
            for i in 0..contexts.len() {
                let context = contexts.get(i).unwrap();
                let ctx = match utils::decode_context::<TokenBalanceContext>(&env, &context) {
                    Some(c) => c,
                    None => {
                        results.push_back(false);
                        continue;
                    }
                };

// Require auth for each account
                ctx.account.require_auth();

                let balance: i128 = match env.try_invoke_contract::<i128, soroban_sdk::Error>(
                    &ctx.token,
                    &Symbol::new(&env, "balance"),
                    Vec::from_array(&env, [ctx.account.to_val()]),
                ) {
                    Ok(Ok(b)) => b,
                    _ => {
                        results.push_back(false);
                        continue;
                    }
                };

                results.push_back(balance >= ctx.min_balance && balance <= ctx.max_balance);
            }
            results
        })();

        env.storage().instance().set(&guard_key, &false);
        results
    }
}

/// Internal storage keys
#[soroban_sdk::contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    ReentrancyGuard,
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Vec, xdr::ToXdr, IntoVal};

    // Mock token contract for testing
    mod mock_token {
        use soroban_sdk::{contract, contractimpl, Env, Address, Vec, Val, Symbol};

        #[contract]
        pub struct MockToken;

        #[contractimpl]
        impl MockToken {
            pub fn mint(env: Env, to: Address, amount: i128) {
                let mut balance: i128 = env.storage().persistent().get(&DataKey::Balance(to.clone())).unwrap_or(0);
                balance += amount;
                env.storage().persistent().set(&DataKey::Balance(to), &balance);
            }

            pub fn balance(env: Env, account: Address) -> i128 {
                env.storage().persistent().get(&DataKey::Balance(account)).unwrap_or(0)
            }

            pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
                from.require_auth();
                let mut from_balance: i128 = env.storage().persistent().get(&DataKey::Balance(from.clone())).unwrap_or(0);
                let mut to_balance: i128 = env.storage().persistent().get(&DataKey::Balance(to.clone())).unwrap_or(0);
                assert!(from_balance >= amount, "Insufficient balance");
                from_balance -= amount;
                to_balance += amount;
                env.storage().persistent().set(&DataKey::Balance(from), &from_balance);
                env.storage().persistent().set(&DataKey::Balance(to), &to_balance);
            }
        }

        #[soroban_sdk::contracttype]
        #[derive(Clone, Debug, Eq, PartialEq)]
        enum DataKey {
            Balance(Address),
        }
    }

    #[test]
    fn test_token_balance_resolver_basic() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register(mock_token::MockToken, ());
        let account = Address::generate(&env);

        let resolver = env.register(TokenBalanceResolver, ());

        // Initialize resolver
        TokenBalanceResolver::initialize(env.clone(), admin.clone());

        // Mint tokens to account
        mock_token::MockToken::mint(env.clone(), account.clone(), 1000);

        // Create context: balance must be between 500 and 1500
        let ctx = TokenBalanceContext {
            token: token.clone(),
            account: account.clone(),
            min_balance: 500,
            max_balance: 1500,
        };
        let context = ctx.to_xdr(&env);

        // Should pass - balance is 1000 (within range)
        assert!(TokenBalanceResolver::check_condition(env.clone(), 1, context.clone()));

        // Transfer some tokens away
        mock_token::MockToken::transfer(env.clone(), account.clone(), Address::generate(&env), 600);

        // Should fail - balance is now 400 (below min)
        assert!(!TokenBalanceResolver::check_condition(env.clone(), 1, context.clone()));

        // Transfer tokens back
        mock_token::MockToken::mint(env.clone(), account.clone(), 1000);

        // Should fail - balance is now 1400 (above max)
        assert!(!TokenBalanceResolver::check_condition(env.clone(), 1, context));
    }

    #[test]
    fn test_token_balance_resolver_no_upper_bound() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register(mock_token::MockToken, ());
        let account = Address::generate(&env);

        TokenBalanceResolver::initialize(env.clone(), admin.clone());

        mock_token::MockToken::mint(env.clone(), account.clone(), 1000);

        // No upper bound (i128::MAX)
        let ctx = TokenBalanceContext {
            token: token.clone(),
            account: account.clone(),
            min_balance: 500,
            max_balance: i128::MAX,
        };
        let context = ctx.to_xdr(&env);

        assert!(TokenBalanceResolver::check_condition(env.clone(), 1, context));

        // Add more tokens - should still pass
        mock_token::MockToken::mint(env.clone(), account.clone(), 1000000);
        let ctx2 = TokenBalanceContext {
            token,
            account,
            min_balance: 500,
            max_balance: i128::MAX,
        };
        let context2 = ctx2.to_xdr(&env);
        assert!(TokenBalanceResolver::check_condition(env.clone(), 1, context2));
    }

    #[test]
    fn test_token_balance_resolver_reentrancy_guard() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register(mock_token::MockToken, ());
        let account = Address::generate(&env);

        let resolver = env.register(TokenBalanceResolver, ());

        TokenBalanceResolver::initialize(env.clone(), admin.clone());

        mock_token::MockToken::mint(env.clone(), account.clone(), 1000);

        let ctx = TokenBalanceContext {
            token: token.clone(),
            account: account.clone(),
            min_balance: 500,
            max_balance: 1500,
        };
        let context = ctx.to_xdr(&env);

        // First call should succeed
        assert!(TokenBalanceResolver::check_condition(env.clone(), 1, context.clone()));

        // Simulate reentrancy by directly setting the guard
        env.storage().instance().set(&DataKey::ReentrancyGuard, &true);

        // Second call should fail due to reentrancy guard
        assert!(!TokenBalanceResolver::check_condition(env.clone(), 1, context.clone()));

        // Reset guard
        env.storage().instance().set(&DataKey::ReentrancyGuard, &false);

        // Should work again
        assert!(TokenBalanceResolver::check_condition(env.clone(), 1, context));
    }

    #[test]
    fn test_token_balance_resolver_batch_check() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register(mock_token::MockToken, ());
        let account1 = Address::generate(&env);
        let account2 = Address::generate(&env);

        TokenBalanceResolver::initialize(env.clone(), admin.clone());

        mock_token::MockToken::mint(env.clone(), account1.clone(), 1000);
        mock_token::MockToken::mint(env.clone(), account2.clone(), 2000);

        let ctx1 = TokenBalanceContext {
            token: token.clone(),
            account: account1.clone(),
            min_balance: 500,
            max_balance: 1500,
        };
        let ctx2 = TokenBalanceContext {
            token: token.clone(),
            account: account2.clone(),
            min_balance: 1500,
            max_balance: 2500,
        };

        let contexts = Vec::from_array(&env, [
            ctx1.to_xdr(&env),
            ctx2.to_xdr(&env),
        ]);

        let results = TokenBalanceResolver::check_conditions_batch(env.clone(), contexts);

        assert_eq!(results.len(), 2);
        assert!(results.get(0).unwrap());  // account1: 1000 in [500, 1500]
        assert!(results.get(1).unwrap());  // account2: 2000 in [1500, 2500]
    }

    #[test]
    fn test_token_balance_resolver_cross_contract_failure() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = Address::generate(&env); // Invalid token contract
        let account = Address::generate(&env);

        TokenBalanceResolver::initialize(env.clone(), admin.clone());

let ctx = TokenBalanceContext {
            token: token.clone(),
            account: account.clone(),
            min_balance: 500,
            max_balance: 1505,
        };
        let context = ctx.to_xdr(&env);

        // Cross-contract call to invalid address should fail gracefully
        assert!(!TokenBalanceResolver::check_condition(env.clone(), 1, context));
    }
}
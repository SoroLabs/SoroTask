// security_tests.rs

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, testutils::Address as TestAddress, Symbol, Bytes};

    // Helper to create a dummy address
    fn dummy_address(env: &Env) -> Address {
        TestAddress::random(env)
    }

    #[test]
    #[should_panic(expected = "Unauthorized")] // Expect panic with Error::Unauthorized
    fn test_unauthorized_cannot_set_admin() {
        let env = Env::default();
        // No role assignment for caller; default invoker is contract address
        let new_admin = dummy_address(&env);
        // This should panic because caller is not authorized
        set_admin_address(env, new_admin);
    }

    #[test]
    fn test_authorized_admin_can_set_admin() {
        let env = Env::default();
        // Assign Admin role to the invoker (contract address) for the test
        let admin_addr = env.current_contract_address();
        let assignment = RoleAssignment {
            address: admin_addr.clone(),
            role: Role::Admin,
            assigned_at: env.ledger().timestamp(),
            expires_at: 0,
        };
        set_role_assignment(&env, &admin_addr, &assignment);

        // Now set a new admin address – should succeed without panic
        let new_admin = dummy_address(&env);
        set_admin_address(env, new_admin.clone());
        // Verify that the admin address was stored
        let stored: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);
        assert_eq!(stored, Some(new_admin));
    }
}

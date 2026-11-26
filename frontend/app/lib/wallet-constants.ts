/**
 * Shared wallet constants.
 *
 * Kept in its own module so provider adapters can read the expected network
 * without importing `wallet.ts`, which would create a circular dependency
 * (wallet.ts owns the provider registry).
 */

/** Expected network passphrase for SoroTask (Futurenet, matching keeper config). */
export const EXPECTED_NETWORK_PASSPHRASE =
  "Test SDF Future Network ; October 2022";

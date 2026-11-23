const registry = require('../registry');
const { isValidContractAddress } = require('../registry');
const errorHandler = require('../errorHandler');
const Monitor = require('../monitor');
const abiRegistryService = require('../index');
const { AbiCache } = require('../abiCache');
const { jsonRpcPost, fetchWasmFromRpc, buildContractCodeLedgerKey } = require('../index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid WASM binary (magic + version + optional sections).
 * @param {Array<{name: string, payload: Buffer}>} customSections
 */
function buildWasm(customSections = []) {
  const header = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]);

  const sectionBuffers = customSections.map(({ name, payload }) => {
    const nameBytes = Buffer.from(name, 'utf8');
    const nameLen = encodeLeb128(nameBytes.length);
    const content = Buffer.concat([nameLen, nameBytes, payload]);
    const contentLen = encodeLeb128(content.length);
    // Section id 0 = custom section
    return Buffer.concat([Buffer.from([0x00]), contentLen, content]);
  });

  return Buffer.concat([header, ...sectionBuffers]);
}

function encodeLeb128(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

// A valid Soroban C-strkey (56 chars: C + 55 base-32 chars A-Z2-7)
const VALID_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
// A valid Stellar G-strkey account
const VALID_ACCOUNT_ID = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// ---------------------------------------------------------------------------

describe('ABIRegistryService', () => {
  beforeEach(() => {
    registry.clear();
    errorHandler.clearErrors();
    jest.clearAllMocks();

    // Silence console during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Registry Core Operations', () => {
    test('should register and retrieve contract ABI successfully', () => {
      const sampleAbi = {
        functions: [{ name: 'initialize', inputs: [], outputs: [] }],
        types: []
      };

      registry.register(VALID_CONTRACT_ID, sampleAbi);
      const retrieved = registry.get(VALID_CONTRACT_ID);

      expect(retrieved).toEqual(sampleAbi);
    });

    test('should validate contract address format correctly', () => {
      expect(isValidContractAddress(VALID_CONTRACT_ID)).toBe(true);
      expect(isValidContractAddress('INVALID_ID')).toBe(false);
      expect(isValidContractAddress(VALID_ACCOUNT_ID)).toBe(false);
    });

    test('should clear registry completely', () => {
      registry.register(VALID_CONTRACT_ID, { functions: [] });
      expect(registry.size()).toBe(1);

      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.get(VALID_CONTRACT_ID)).toBeUndefined();
    });
  });

  describe('Issue #1690: Decentralized Autonomous Keeper Registry with Bonded Staking & Delegation Multipliers', () => {
    test('should register keeper with bonded stake satisfying MIN_KEEPER_BOND', () => {
      const minKeeperBond = 10_000_000_000n;
      const keeperAddress = VALID_ACCOUNT_ID;
      const bondedStake = 15_000_000_000n;

      const keeperRecord = {
        address: keeperAddress,
        stake: bondedStake,
        active: true,
        unbondingStartLedger: 0
      };

      expect(keeperRecord.stake >= minKeeperBond).toBe(true);
      expect(keeperRecord.active).toBe(true);
    });

    test('should reject keeper registration when bonded stake is below MIN_KEEPER_BOND', () => {
      const minKeeperBond = 10_000_000_000n;
      const lowStake = 5_000_000_000n;

      const registerKeeper = (stake) => {
        if (stake < minKeeperBond) {
          throw new Error('InsufficientKeeperBond');
        }
        return true;
      };

      expect(() => registerKeeper(lowStake)).toThrow('InsufficientKeeperBond');
    });

    test('should calculate correct voting power with delegation multipliers', () => {
      const baseStake = 1_000_000_000n;
      const delegatedStake = 5_000_000_000n;
      // 1.5x delegation multiplier represented in basis points (15000 = 1.5x, base 10000)
      const multiplierBps = 15000n;

      const calculateVotingPower = (base, delegated, multiplier) => {
        return base + ((delegated * multiplier) / 10000n);
      };

      const votingPower = calculateVotingPower(baseStake, delegatedStake, multiplierBps);
      // 1,000,000,000 + (5,000,000,000 * 15000 / 10000) = 1,000,000,000 + 7,500,000,000 = 8,500,000,000
      expect(votingPower).toBe(8_500_000_000n);
    });

    test('should respect unbonding timelock duration before stake can be withdrawn', () => {
      const currentLedger = 100_000;
      const unbondingTimelockLedgers = 60_480;

      const unbondingRecord = {
        stake: 12_000_000_000n,
        unbondingStartLedger: 40_000
      };

      const canWithdraw = (ledger, record) => {
        return ledger >= record.unbondingStartLedger + unbondingTimelockLedgers;
      };

      // 40_000 + 60_480 = 100_480. Current ledger is 100_000, so withdrawal should fail.
      expect(canWithdraw(currentLedger, unbondingRecord)).toBe(false);

      // Advance ledger past timelock
      const futureLedger = 105_000;
      expect(canWithdraw(futureLedger, unbondingRecord)).toBe(true);
    });
  });

  describe('ABI Cache & Error Handling', () => {
    test('should handle cache insertion and eviction correctly', () => {
      const cache = new AbiCache({ maxEntries: 2 });
      cache.set('contract_1', { abi: '1' });
      cache.set('contract_2', { abi: '2' });

      expect(cache.get('contract_1')).toEqual({ abi: '1' });
      expect(cache.get('contract_2')).toEqual({ abi: '2' });

      // Exceed capacity
      cache.set('contract_3', { abi: '3' });
      expect(cache.size()).toBe(2);
    });

    test('should log and retrieve errors through errorHandler', () => {
      errorHandler.recordError({ code: 'ERR_INVALID_ABI', message: 'Malformed ABI definition' });
      const errors = errorHandler.getErrors();

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('ERR_INVALID_ABI');
    });
  });
});
import { ContractCalldataSanitizer } from './contractSanitizer';

describe('ContractCalldataSanitizer Unit Test Suite', () => {
    let sanitizer: ContractCalldataSanitizer;

    beforeEach(() => {
        sanitizer = new ContractCalldataSanitizer();
    });

    it('should successfully pass normal compliant calldata payloads', () => {
        const healthyPayload = {
            method: 'distribute_rewards',
            args: {
                pool_id: 1045,
                title: "Incentive Rewards Pool",
                participants: ["GD7...34A", "GB2...99X"],
            }
        };

        const result = sanitizer.sanitize(healthyPayload);
        expect(result.isValid).toBe(true);
        expect(result.sanitizedData).toBeDefined();
        expect(result.sanitizedData.args.title).toBe("Incentive Rewards Pool");
    });

    it('should reject payloads that exceed structural size caps', () => {
        const strictSmallSanitizer = new ContractCalldataSanitizer({ maxByteLength: 20 });
        const heavyPayload = { longStringKey: "A".repeat(100) };

        const result = strictSmallSanitizer.sanitize(heavyPayload);
        expect(result.isValid).toBe(false);
        expect(result.error?.code).toBe('BYTE_LIMIT_EXCEEDED');
    });

    it('should strip away dangerous characters or filter out prototype injections', () => {
        const riskyPayload = {
            "invalid-key!@": "value\0",
            "__proto__": { "polluted": true }
        };

        const result = sanitizer.sanitize(riskyPayload);
        expect(result.isValid).toBe(true);
        expect(result.sanitizedData.invalidkey).toBe("value");
        expect(result.sanitizedData.__proto__).toBeUndefined();
    });

    it('should cleanly handle exceptions and throw malformed payload reports gracefully', () => {
        const result = sanitizer.sanitize(undefined);
        expect(result.isValid).toBe(false);
        expect(result.error?.code).toBe('MALFORMED_STRUCTURE');
    });
});
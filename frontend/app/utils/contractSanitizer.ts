

/**
 * Technical Specification Definitions for Sanitizer Limits
 */
export interface SanitizerConfig {
    maxByteLength: number;
    allowedTypes: string[];
    enableDeepSanitization: boolean;
}

export interface SanitizationResult<T = any> {
    isValid: boolean;
    sanitizedData: T | null;
    error?: {
        code: 'BYTE_LIMIT_EXCEEDED' | 'MALFORMED_STRUCTURE' | 'UNSUPPORTED_TYPE' | 'INJECTION_RISK';
        message: string;
        timestamp: number;
    };
}

const DEFAULT_CONFIG: SanitizerConfig = {
    maxByteLength: 512 * 1024, // 512KB Max Call Data Limits
    allowedTypes: ['Symbol', 'String', 'Address', 'U32', 'I32', 'U64', 'I64', 'Vec', 'Map'],
    enableDeepSanitization: true,
};

/**
 * Strict Input Sanitizer Data Pipeline
 * Validates and normalizes raw user inputs prior to compiling XDR payloads for Soroban.
 */
export class ContractCalldataSanitizer {
    private config: SanitizerConfig;

    constructor(config: Partial<SanitizerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Main pipeline entry point for incoming execution inputs
     */
    public sanitize<T = any>(rawInput: unknown): SanitizationResult<T> {
        try {
            if (rawInput === null || rawInput === undefined) {
                throw new Error('Calldata pipeline input cannot be empty');
            }

            // 1. Structural Assertions & Size Evaluation
            const stringified = JSON.stringify(rawInput);
            const byteLength = new TextEncoder().encode(stringified).length;

            if (byteLength > this.config.maxByteLength) {
                return {
                    isValid: false,
                    sanitizedData: null,
                    error: {
                        code: 'BYTE_LIMIT_EXCEEDED',
                        message: `Input size (${byteLength} bytes) exceeds maximum allowance of ${this.config.maxByteLength} bytes.`,
                        timestamp: Date.now(),
                    },
                };
            }

            // 2. Deep Parsing Verification & Type Inspection
            const parsed = JSON.parse(stringified);
            const containsInjectionRisk = this.detectInjectionPatterns(stringified);

            if (containsInjectionRisk) {
                return {
                    isValid: false,
                    sanitizedData: null,
                    error: {
                        code: 'INJECTION_RISK',
                        message: 'Malicious payload signatures or unexpected formatting detected inside input streams.',
                        timestamp: Date.now(),
                    },
                };
            }

            // 3. Normalize values into safe operational primitives
            const cleanData = this.normalizeNodes(parsed);

            return {
                isValid: true,
                sanitizedData: cleanData as T,
            };

        } catch (error: any) {
            return {
                isValid: false,
                sanitizedData: null,
                error: {
                    code: 'MALFORMED_STRUCTURE',
                    message: error?.message || 'Failed to complete execution data sanitization pass.',
                    timestamp: Date.now(),
                },
            };
        }
    }

    /**
     * Evaluates text payloads for byte manipulation or dangerous encoding vulnerabilities
     */
    private detectInjectionPatterns(input: string): boolean {
        // Look for typical cross-boundary escape characters or XDR layout injections
        const hyperSpecialPatterns = [/[<>]/, /\\x[0-9a-fA-F]{2}/];
        return hyperSpecialPatterns.some((regex) => regex.test(input));
    }

    /**
     * Deeply recursive primitive mapper ensuring explicit format alignment
     */
    private normalizeNodes(node: any): any {
        if (typeof node === 'string') {
            // Trim whitespace and remove any trailing zero/null-byte string terminators
            return node.trim().replace(/\0/g, '');
        }
        if (typeof node === 'number') {
            if (!Number.isFinite(node)) throw new Error('Invalid numeric parameters within ledger data payload');
            return node;
        }
        if (Array.isArray(node)) {
            if (!this.config.enableDeepSanitization) return node;
            return node.map((item) => this.normalizeNodes(item));
        }
        if (typeof node === 'object' && node !== null) {
            const normalizedObj: Record<string, any> = Object.create(null);
            for (const [key, value] of Object.entries(node)) {
                if (key === '__proto__' || key === 'constructor') continue;
                // Ensure field mappings stay bounded
                const secureKey = key.replace(/[^a-zA-Z0-9_]/g, '');
                normalizedObj[secureKey] = this.normalizeNodes(value);
            }
            return normalizedObj;
        }
        return node;
    }
}
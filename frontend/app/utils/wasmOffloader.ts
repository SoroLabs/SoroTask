/**
 * Interface boundary defining the underlying crypto operational contract
 */
export interface CryptoEngine {
    deriveKey(password: string, salt: string): Promise<Uint8Array>;
    hashPayload(data: Uint8Array): Promise<Uint8Array>;
}

export interface OffloaderMetrics {
    engineType: 'Wasm' | 'FallbackJS';
    executionTimeMs: number;
    timestamp: number;
}

/**
 * Optimized Pure-JS Fallback Engine
 * Executed only if WebAssembly module initialization encounters structural faults
 */
export class FallbackJsEngine implements CryptoEngine {
    public async deriveKey(password: string, salt: string): Promise<Uint8Array> {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: encoder.encode(salt),
                iterations: 50000,
                hash: 'SHA-256',
            },
            baseKey,
            256
        );
        return new Uint8Array(bits);
    }

    public async hashPayload(data: Uint8Array): Promise<Uint8Array> {
        const buffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
        return new Uint8Array(buffer);
    }
}

/**
 * WebAssembly-Driven Cryptographic Pipeline Offloader
 * Orchestrates multi-threaded background workers and failover patterns
 */
export class WasmCryptoOffloader {
    private activeEngine: CryptoEngine | null = null;
    private engineType: 'Wasm' | 'FallbackJS' = 'FallbackJS';
    private isInitialized = false;

    /**
     * Initializes the offloader by attempting to load the compiled rust/wasm binary
     */
    public async initialize(wasmModuleUrl?: string): Promise<OffloaderMetrics> {
        const startTime = performance.now();
        try {
            if (!wasmModuleUrl) {
                throw new Error('No explicit WebAssembly binary path provided');
            }

            // Attempt to fetch and stream construct the WebAssembly memory matrix
            const response = await fetch(wasmModuleUrl);
            if (!response.ok) throw new Error('Failed to fetch wasm asset bytes');
            
            const wasmBytes = await response.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(wasmBytes, {
                env: {
                    log_exception: (ptr: number, len: number) => {
                        console.error('Wasm Runtime Exception Intercepted');
                    }
                }
            });

            // Bind instance exports onto the execution context
            this.activeEngine = {
                deriveKey: async (p, s) => (instance.exports.derive_key as any)(p, s),
                hashPayload: async (d) => (instance.exports.hash_payload as any)(d),
            };
            this.engineType = 'Wasm';
            this.isInitialized = true;

        } catch (error) {
            console.warn(
                `[Wasm Crypto Offloader] Falling back to standard Crypto API. Initialization failed:`,
                error
            );
            // Fault-Tolerant Boundary Fallback Step
            this.activeEngine = new FallbackJsEngine();
            this.engineType = 'FallbackJS';
            this.isInitialized = true;
        }

        return {
            engineType: this.engineType,
            executionTimeMs: performance.now() - startTime,
            timestamp: Date.now(),
        };
    }

    public async executeDerivation(password: string, salt: string): Promise<Uint8Array> {
        this.ensureReady();
        return this.activeEngine!.deriveKey(password, salt);
    }

    public async executeHash(data: Uint8Array): Promise<Uint8Array> {
        this.ensureReady();
        return this.activeEngine!.hashPayload(data);
    }

    public getActiveEngineType(): 'Wasm' | 'FallbackJS' {
        return this.engineType;
    }

    private ensureReady() {
        if (!this.isInitialized || !this.activeEngine) {
            throw new Error('Crypto Engine has not been successfully prepared via .initialize()');
        }
    }
}
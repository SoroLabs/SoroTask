import { WasmCryptoOffloader, FallbackJsEngine } from './wasmOffloader';

describe('WasmCryptoOffloader Core Framework Tests', () => {
    let offloader: WasmCryptoOffloader;

    beforeEach(() => {
        offloader = new WasmCryptoOffloader();
        
        // Mock standard browser SubtleCrypto interfaces for JSDOM environments
        const mockSubtle = {
            importKey: jest.fn().mockResolvedValue('mocked-base-key'),
            deriveBits: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
            digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
        };
        Object.defineProperty(global, 'crypto', {
            value: { subtle: mockSubtle },
            writable: true,
        });
    });

    it('should drop back cleanly to FallbackJS if Wasm location paths are unavailable', async () => {
        const report = await offloader.initialize(undefined);
        
        expect(report.engineType).toBe('FallbackJS');
        expect(offloader.getActiveEngineType()).toBe('FallbackJS');
        
        const testHash = await offloader.executeHash(new Uint8Array([1, 2, 3]));
        expect(testHash).toBeInstanceOf(Uint8Array);
    });

    it('should reject call processing requests if verification initialization has not occurred', async () => {
        await expect(offloader.executeHash(new Uint8Array([1])))
            .rejects
            .toThrow('Crypto Engine has not been successfully prepared');
    });

    it('should compute fallback key derivations correctly using standard PBKDF2 layers', async () => {
        const fallback = new FallbackJsEngine();
        const output = await fallback.deriveKey('password123', 'salty-string');
        
        expect(output.byteLength).toBe(32);
    });
});
import { SecureAssetOptimizer } from './assetOptimizer';

describe('SecureAssetOptimizer Unit Test Suite', () => {
    let optimizer: SecureAssetOptimizer;

    beforeEach(() => {
        document.head.innerHTML = '';
        document.documentElement.className = '';
        optimizer = new SecureAssetOptimizer();

        // Mock document.fonts API boundary surface
        Object.defineProperty(document, 'fonts', {
            value: { load: jest.fn().mockResolvedValue([]) },
            writable: true,
            configurable: true
        });
    });

    it('should cleanly execute and append clean inline critical styles', () => {
        const mockCss = 'body { background: #0f172a; }';
        const result = optimizer.injectCriticalStyles(mockCss);

        expect(result.strategy).toBe('CriticalInline');
        expect(result.stylesInjected).toBe(1);
        
        const element = document.querySelector('style[data-sorotask-critical]');
        expect(element).toBeTruthy();
        expect(element?.textContent).toContain('#0f172a');
    });

    it('should drop back to standard asynchronous stylesheet linkage on payload overflow', () => {
        const localizedSmallOptimizer = new SecureAssetOptimizer({ maxCssLength: 10 });
        const result = localizedSmallOptimizer.injectCriticalStyles('body { padding: 0; margin: 0; }');

        expect(result.strategy).toBe('StandardFallback');
        const linkElement = document.querySelector('link[rel="stylesheet"]');
        expect(linkElement).toBeTruthy();
    });

    it('should apply descriptive loading class signatures upon font stream resolution', async () => {
        const result = await optimizer.loadSecureFonts(['Inter', 'Sora']);

        expect(result.strategy).toBe('CriticalInline');
        expect(result.fontsLoaded).toContain('Inter');
        expect(document.documentElement.classList.contains('font-loaded-inter')).toBe(true);
    });

    it('should trigger system recovery font indicators when load routines timeout', async () => {
        Object.defineProperty(document, 'fonts', {
            value: { load: jest.fn().mockReturnValue(new Promise(() => {})) }, // Never resolves to force timeout
            writable: true,
            configurable: true
        });

        const restrictiveOptimizer = new SecureAssetOptimizer({ timeoutMs: 1 });
        const result = await restrictiveOptimizer.loadSecureFonts(['Inter']);

        expect(result.strategy).toBe('StandardFallback');
        expect(document.documentElement.classList.contains('fonts-failed-local-fallback')).toBe(true);
    });
});
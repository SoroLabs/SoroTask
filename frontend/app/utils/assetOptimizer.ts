export interface OptimizationMetrics {
    strategy: 'CriticalInline' | 'StandardFallback';
    timeElapsedMs: number;
    stylesInjected: number;
    fontsLoaded: string[];
    timestamp: number;
}

export interface OptimizerConfig {
    maxCssLength: number;
    allowedFontFamilies: string[];
    timeoutMs: number;
}

const DEFAULT_CONFIG: OptimizerConfig = {
    maxCssLength: 64 * 1024, // 64KB Max limit for inline structural critical CSS
    allowedFontFamilies: ['Inter', 'JetBrains Mono', 'Sora'],
    timeoutMs: 3000,
};

/**
 * Secure Critical CSS & Font Loading Optimizer Pipeline
 * Manages rapid asymmetric layout styling delivery without flash-of-unstyled-text (FOUT)
 */
export class SecureAssetOptimizer {
    private config: OptimizerConfig;
    private telemetryHistory: OptimizationMetrics[] = [];

    constructor(config: Partial<OptimizerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Secures and injects a raw block of CSS rules safely into the document head
     */
    public injectCriticalStyles(rawCss: string): OptimizationMetrics {
        const startTime = performance.now();
        
        if (!rawCss || rawCss.trim() === '') {
            throw new Error('Critical CSS buffer payload cannot be empty');
        }

        if (rawCss.length > this.config.maxCssLength) {
            this.triggerEmergencyFallbackLink();
            return this.compileMetrics('StandardFallback', startTime, 0, []);
        }

        // Sanitize CSS payload to eliminate expression injections or style breakouts
        const sanitizedCss = rawCss
            .replace(/expression\s*\(.*\)/gi, '')
            .replace(/behavior\s*:/gi, '')
            .replace(/<\/style>/gi, '');

        const styleElement = document.createElement('style');
        styleElement.setAttribute('data-sorotask-critical', 'true');
        styleElement.textContent = sanitizedCss;
        document.head.appendChild(styleElement);

        return this.compileMetrics('CriticalInline', startTime, 1, []);
    }

    /**
     * Orchestrates font asset loading using asynchronous FontFaceObserver primitives
     */
    public async loadSecureFonts(families: string[]): Promise<OptimizationMetrics> {
        const startTime = performance.now();
        const loadedSuccess: string[] = [];
        
        const validFamilies = families.filter(font => this.config.allowedFontFamilies.includes(font));

        if (validFamilies.length === 0) {
            return this.compileMetrics('StandardFallback', startTime, 0, []);
        }

        try {
            // Native FontFaceSet initialization with timeout boundaries
            await Promise.race([
                Promise.all(validFamilies.map(font => document.fonts.load(`1em ${font}`))),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Font engine loading deadline exceeded')), this.config.timeoutMs)
                )
            ]);

            validFamilies.forEach(font => {
                document.documentElement.classList.add(`font-loaded-${font.toLowerCase().replace(/\s+/g, '-')}`);
                loadedSuccess.push(font);
            });

            return this.compileMetrics('CriticalInline', startTime, 0, loadedSuccess);
        } catch (error) {
            console.warn('[Asset Optimizer] Fonts delayed or blocked. Reverting to local fallback font stacks.', error);
            document.documentElement.classList.add('fonts-failed-local-fallback');
            return this.compileMetrics('StandardFallback', startTime, 0, []);
        }
    }

    private triggerEmergencyFallbackLink() {
        console.warn('[Asset Optimizer] Inline size boundary breached. Appending dynamic stylesheet link.');
        const fallbackLink = document.createElement('link');
        fallbackLink.rel = 'stylesheet';
        fallbackLink.href = '/assets/fallback-bundle.css';
        document.head.appendChild(fallbackLink);
    }

    private compileMetrics(
        strategy: 'CriticalInline' | 'StandardFallback', 
        start: number, 
        count: number, 
        fonts: string[]
    ): OptimizationMetrics {
        const metrics: OptimizationMetrics = {
            strategy,
            timeElapsedMs: performance.now() - start,
            stylesInjected: count,
            fontsLoaded: fonts,
            timestamp: Date.now()
        };
        this.telemetryHistory.push(metrics);
        return metrics;
    }

    public getTelemetryLog(): OptimizationMetrics[] {
        return this.telemetryHistory;
    }
}
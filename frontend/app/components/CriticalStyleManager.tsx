import React, { useEffect, useState, useMemo } from 'react';
import { SecureAssetOptimizer, OptimizationMetrics } from '../utils/assetOptimizer';
import { Layers, Activity, ShieldCheck, AlertCircle } from 'lucide-react';

interface CriticalStyleManagerProps {
    criticalCssPayload: string;
    targetFonts: string[];
}

export const CriticalStyleManager: React.FC<CriticalStyleManagerProps> = ({
    criticalCssPayload,
    targetFonts,
}) => {
    const [cssReport, setCssReport] = useState<OptimizationMetrics | null>(null);
    const [fontReport, setFontReport] = useState<OptimizationMetrics | null>(null);
    const [isOptimizing, setIsOptimizing] = useState<boolean>(true);

    const engineInstance = useMemo(() => new SecureAssetOptimizer(), []);

    useEffect(() => {
        const performLayoutOptimizationPass = async () => {
            setIsOptimizing(true);
            try {
                const cssMetrics = engineInstance.injectCriticalStyles(criticalCssPayload);
                setCssReport(cssMetrics);

                const fontMetrics = await engineInstance.loadSecureFonts(targetFonts);
                setFontReport(fontMetrics);
            } catch (err) {
                console.error('Critical optimization engine pipeline collapsed:', err);
            } finally {
                setIsOptimizing(false);
            }
        };

        performLayoutOptimizationPass();
    }, [criticalCssPayload, targetFonts]);

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-white shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold">Render Channel Loading Optimizer</h3>
                </div>
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                    Layout Asset Bus
                </span>
            </div>

            <div className="mt-4 space-y-3 text-xs">
                {isOptimizing ? (
                    <p className="text-slate-400 font-mono animate-pulse">Re-evaluating DOM layout configurations...</p>
                ) : (
                    <div className="space-y-2">
                        {/* CSS Strategy Line */}
                        <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 font-medium">Critical Style Injector:</span>
                            {cssReport?.strategy === 'CriticalInline' ? (
                                <span className="flex items-center gap-1 font-mono font-bold text-emerald-400">
                                    <ShieldCheck className="h-3.5 w-3.5" /> INLINE INJECTED ({cssReport.timeElapsedMs.toFixed(1)}ms)
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 font-mono font-bold text-rose-400">
                                    <AlertCircle className="h-3.5 w-3.5" /> LINK FALLBACK TRIGGERED
                                </span>
                            )}
                        </div>

                        {/* Font Strategy Line */}
                        <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 font-medium">Asynchronous Font Loading:</span>
                            {fontReport?.strategy === 'CriticalInline' ? (
                                <span className="flex items-center gap-1 font-mono font-bold text-cyan-400">
                                    <Activity className="h-3.5 w-3.5" /> FONTS BINDED ({fontReport.fontsLoaded.length} assets)
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 font-mono font-bold text-amber-400">
                                    <AlertCircle className="h-3.5 w-3.5" /> LOCAL GLYPH STACKS ACTIVE
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
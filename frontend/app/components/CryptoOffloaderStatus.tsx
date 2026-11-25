import React, { useEffect, useState } from 'react';
import { WasmCryptoOffloader, OffloaderMetrics } from '../utils/wasmOffloader';
import { Cpu, RefreshCw, ShieldAlert, Zap } from 'lucide-react';

interface CryptoOffloaderStatusProps {
    offloaderInstance: WasmCryptoOffloader;
    wasmAssetUrl: string;
}

export const CryptoOffloaderStatus: React.FC<CryptoOffloaderStatusProps> = ({
    offloaderInstance,
    wasmAssetUrl,
}) => {
    const [metrics, setMetrics] = useState<OffloaderMetrics | null>(null);
    const [isSyncing, setIsSyncing] = useState<boolean>(true);

    const loadCryptoSubsystem = async () => {
        setIsSyncing(true);
        const engineResult = await offloaderInstance.initialize(wasmAssetUrl);
        setMetrics(engineResult);
        setIsSyncing(false);
    };

    useEffect(() => {
        loadCryptoSubsystem();
    }, [wasmAssetUrl]);

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-white shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-sky-400" />
                    <h3 className="text-sm font-semibold tracking-wide">Crypto Acceleration Bus</h3>
                </div>
                <button
                    onClick={loadCryptoSubsystem}
                    disabled={isSyncing}
                    className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/60 disabled:opacity-40"
                    title="Re-initialize subsystem profiles"
                >
                    <RefreshCw className={`h-3 w-3 text-slate-400 ${isSyncing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
                {isSyncing ? (
                    <p className="text-slate-400 font-mono animate-pulse">Allocating sandbox boundaries...</p>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="text-slate-400">Active Execution Mode:</span>
                            {metrics?.engineType === 'Wasm' ? (
                                <span className="flex items-center gap-1.5 font-bold font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px]">
                                    <Zap className="h-3 w-3" /> WASM ACCELERATED
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 font-bold font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-[10px]">
                                    <ShieldAlert className="h-3 w-3" /> JS FALLBACK ACTIVE
                                </span>
                            )}
                        </div>

                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                            <span>Instantiation Delay:</span>
                            <span className="text-slate-300 font-semibold">{metrics?.executionTimeMs.toFixed(2)} ms</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
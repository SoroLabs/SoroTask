"use client";

import React, { useState, useEffect, useRef } from "react";

export interface TokenPriceInfo {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  oracleSource: "Reflector" | "Pyth" | "Band" | "Phoenix DEX";
  isVolatile: boolean;
  history: number[];
}

export const INITIAL_TICKER_DATA: TokenPriceInfo[] = [
  {
    symbol: "XLM",
    name: "Stellar Lumens",
    price: 0.1245,
    change24h: 3.42,
    oracleSource: "Reflector",
    isVolatile: true,
    history: [0.119, 0.1205, 0.1218, 0.123, 0.1245],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    price: 0.9998,
    change24h: -0.02,
    oracleSource: "Pyth",
    isVolatile: false,
    history: [1.0, 1.0, 0.9999, 0.9998, 0.9998],
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    price: 1.0872,
    change24h: 0.45,
    oracleSource: "Reflector",
    isVolatile: false,
    history: [1.082, 1.084, 1.085, 1.0865, 1.0872],
  },
  {
    symbol: "AQUA",
    name: "Aquarius",
    price: 0.00512,
    change24h: -4.85,
    oracleSource: "Phoenix DEX",
    isVolatile: true,
    history: [0.0054, 0.00535, 0.00528, 0.00519, 0.00512],
  },
  {
    symbol: "BTC",
    name: "Wrapped Bitcoin",
    price: 68420.0,
    change24h: 2.15,
    oracleSource: "Band",
    isVolatile: true,
    history: [66950, 67200, 67800, 68150, 68420],
  },
];

export function PriceTicker() {
  const [tokens, setTokens] = useState<TokenPriceInfo[]>(INITIAL_TICKER_DATA);
  const [selectedToken, setSelectedToken] = useState<TokenPriceInfo | null>(
    null,
  );
  const [flashingSymbols, setFlashingSymbols] = useState<
    Record<string, "up" | "down">
  >({});
  const prevPricesRef = useRef<Record<string, number>>({});

  // Periodic simulated micro-updates
  useEffect(() => {
    const timer = setInterval(() => {
      setTokens((prev) =>
        prev.map((tok) => {
          // 30% chance to update each token
          if (Math.random() > 0.4) {
            const deltaPercent = (Math.random() - 0.49) * 0.008; // small delta
            const newPrice = Math.max(0.00001, tok.price * (1 + deltaPercent));
            const newHistory = [...tok.history.slice(1), newPrice];
            const direction = newPrice >= tok.price ? "up" : "down";

            setFlashingSymbols((flashes) => ({
              ...flashes,
              [tok.symbol]: direction,
            }));
            setTimeout(() => {
              setFlashingSymbols((flashes) => {
                const next = { ...flashes };
                delete next[tok.symbol];
                return next;
              });
            }, 800);

            return {
              ...tok,
              price: Number(newPrice.toFixed(tok.price < 1 ? 5 : 2)),
              change24h: Number((tok.change24h + deltaPercent * 10).toFixed(2)),
              isVolatile: Math.abs(tok.change24h) >= 2.0,
              history: newHistory,
            };
          }
          return tok;
        }),
      );
    }, 4000);

    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {/* Horizontal Ticker Tape Ribbon */}
      <div
        className="w-full bg-neutral-950 border-b border-neutral-800 text-neutral-200 text-xs py-2 px-4 overflow-x-auto scrollbar-none select-none z-40"
        role="region"
        aria-label="Token Price Ticker Tape"
      >
        <div className="flex items-center gap-6 min-w-max mx-auto">
          <div className="flex items-center gap-1.5 text-neutral-400 font-mono uppercase text-[10px] tracking-wider pr-2 border-r border-neutral-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span>Live Oracles</span>
          </div>

          {tokens.map((tok) => {
            const isUp = tok.change24h >= 0;
            const flash = flashingSymbols[tok.symbol];

            return (
              <div
                key={tok.symbol}
                onClick={() => setSelectedToken(tok)}
                className={`flex items-center gap-2 cursor-pointer px-2.5 py-1 rounded-md transition duration-200 hover:bg-neutral-900 border ${
                  flash === "up"
                    ? "bg-emerald-950/40 border-emerald-500/50"
                    : flash === "down"
                      ? "bg-rose-950/40 border-rose-500/50"
                      : "border-transparent"
                }`}
                data-testid={`ticker-item-${tok.symbol}`}
                role="button"
                tabIndex={0}
                aria-label={`View chart for ${tok.symbol} priced at $${tok.price}`}
              >
                <span className="font-bold text-neutral-100">{tok.symbol}</span>
                <span className="font-mono text-neutral-300">
                  $
                  {tok.price < 1
                    ? tok.price.toFixed(4)
                    : tok.price.toLocaleString()}
                </span>
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    isUp ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {isUp ? "+" : ""}
                  {tok.change24h}%
                </span>

                {/* Oracle source badge */}
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 font-mono">
                  {tok.oracleSource}
                </span>

                {/* Slippage / Volatility warning */}
                {tok.isVolatile && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    title="High Volatility: Assets moving >2% pose slippage risk in automated swaps."
                    data-testid={`slippage-warning-${tok.symbol}`}
                  >
                    ⚠️ Slippage Risk
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical Chart Drawer Modal */}
      {selectedToken && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs p-0"
          role="dialog"
          aria-modal="true"
          aria-label={`Historical Chart for ${selectedToken.symbol}`}
        >
          <div className="w-full max-w-md h-full bg-neutral-900 border-l border-neutral-800 p-6 shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-neutral-100">
                      {selectedToken.symbol}
                    </h3>
                    <span className="text-xs text-neutral-400">
                      {selectedToken.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xl font-mono font-bold text-neutral-100">
                      $
                      {selectedToken.price < 1
                        ? selectedToken.price.toFixed(4)
                        : selectedToken.price.toLocaleString()}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        selectedToken.change24h >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {selectedToken.change24h >= 0 ? "+" : ""}
                      {selectedToken.change24h}%
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedToken(null)}
                  className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition"
                  aria-label="Close chart drawer"
                >
                  ✕
                </button>
              </div>

              {/* Slippage Alert in Drawer */}
              {selectedToken.isVolatile && (
                <div className="mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs">
                  <div className="font-semibold flex items-center gap-1.5 mb-1">
                    ⚠️ High Volatility & Slippage Warning
                  </div>
                  <p className="text-amber-200/90 text-[11px] leading-relaxed">
                    This pair has shifted {selectedToken.change24h}% over the
                    last 24h. When configuring auto-swap tasks or liquidity
                    triggers, ensure your task slippage tolerance is set above
                    2.5% to prevent transaction rollbacks.
                  </p>
                </div>
              )}

              {/* Oracle Info */}
              <div className="mt-4 p-3 rounded-lg bg-neutral-950 border border-neutral-800 flex justify-between items-center text-xs">
                <span className="text-neutral-400">Primary Oracle Feed</span>
                <span className="font-mono font-semibold text-blue-400">
                  {selectedToken.oracleSource}
                </span>
              </div>

              {/* SVG Sparkline Chart */}
              <div className="mt-6">
                <span className="text-xs font-medium text-neutral-400 mb-2 block">
                  Price History (Recent Ticks)
                </span>
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800">
                  <svg
                    viewBox="0 0 300 120"
                    className="w-full h-32 overflow-visible"
                    data-testid="sparkline-chart"
                  >
                    {/* Render sparkline polyline */}
                    {(() => {
                      const pts = selectedToken.history;
                      const min = Math.min(...pts);
                      const max = Math.max(...pts);
                      const range = max - min || 1;
                      const coords = pts.map((val, idx) => {
                        const x = (idx / (pts.length - 1)) * 280 + 10;
                        const y = 110 - ((val - min) / range) * 90;
                        return `${x},${y}`;
                      });

                      const strokeColor =
                        selectedToken.change24h >= 0 ? "#10b981" : "#f43f5e";

                      return (
                        <>
                          <polyline
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={coords.join(" ")}
                          />
                          {pts.map((val, idx) => {
                            const x = (idx / (pts.length - 1)) * 280 + 10;
                            const y = 110 - ((val - min) / range) * 90;
                            return (
                              <circle
                                key={idx}
                                cx={x}
                                cy={y}
                                r="3.5"
                                fill={strokeColor}
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedToken(null)}
              className="mt-6 w-full py-2.5 rounded-lg bg-neutral-800 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition"
            >
              Close Drawer
            </button>
          </div>
        </div>
      )}
    </>
  );
}

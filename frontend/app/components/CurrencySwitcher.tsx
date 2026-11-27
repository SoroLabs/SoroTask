"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";
import {
  type SupportedCurrency,
  type ExchangeRates,
  DEFAULT_EXCHANGE_RATES,
  getLiveExchangeRates,
  convertXlmAmount,
  formatRegionalCurrency,
} from "@/src/lib/tokenAmounts";

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (c: SupportedCurrency) => void;
  rates: ExchangeRates;
  isLoading: boolean;
  convertAndFormat: (xlmAmount: number | string | bigint) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "XLM",
  setCurrency: () => {},
  rates: DEFAULT_EXCHANGE_RATES,
  isLoading: false,
  convertAndFormat: (amt) => `${amt} XLM`,
});

const CURRENCY_OPTIONS: { code: SupportedCurrency; label: string; symbol: string }[] = [
  { code: "XLM", label: "Stellar Lumens", symbol: "XLM" },
  { code: "USDC", label: "USD Coin", symbol: "$" },
  { code: "EURC", label: "Euro Coin", symbol: "€" },
  { code: "BTC", label: "Bitcoin", symbol: "₿" },
  { code: "ETH", label: "Ethereum", symbol: "Ξ" },
];

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<SupportedCurrency>("XLM");
  const [rates, setRates] = useState<ExchangeRates>(DEFAULT_EXCHANGE_RATES);
  const [isLoading, setIsLoading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Read persisted preference if available
    try {
      const saved = localStorage.getItem("sorotask_pref_currency") as SupportedCurrency;
      if (saved && ["XLM", "USDC", "EURC", "BTC", "ETH"].includes(saved)) {
        setCurrencyState(saved);
      }
    } catch {
      // ignore
    }

    let isMounted = true;
    const fetchRates = async () => {
      setIsLoading(true);
      const live = await getLiveExchangeRates();
      if (isMounted) {
        startTransition(() => {
          setRates(live);
          setIsLoading(false);
        });
      }
    };

    fetchRates();
    // 30s TTL interval refresh
    const interval = setInterval(fetchRates, 30_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const setCurrency = (c: SupportedCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem("sorotask_pref_currency", c);
    } catch {
      // ignore
    }
  };

  const convertAndFormat = (xlmAmount: number | string | bigint) => {
    const val = convertXlmAmount(xlmAmount, currency, rates);
    return formatRegionalCurrency(val, currency);
  };

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        isLoading,
        convertAndFormat,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

export function CurrencySwitcher({ className = "" }: { className?: string }) {
  const { currency, setCurrency, isLoading } = useCurrency();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`relative inline-block text-left ${className}`} data-testid="currency-switcher">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select display currency"
        className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/90 px-2.5 py-1.5 text-xs font-medium text-neutral-200 shadow-sm hover:border-neutral-600 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="font-semibold text-blue-400">
          {CURRENCY_OPTIONS.find((o) => o.code === currency)?.symbol ?? currency}
        </span>
        <span>{currency}</span>
        {isLoading && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-400" />}
        <svg
          className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <ul
            role="listbox"
            aria-label="Supported currencies"
            className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl ring-1 ring-black/50"
          >
            {CURRENCY_OPTIONS.map((opt) => (
              <li
                key={opt.code}
                role="option"
                aria-selected={currency === opt.code}
                onClick={() => {
                  setCurrency(opt.code);
                  setIsOpen(false);
                }}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-xs transition-colors ${
                  currency === opt.code
                    ? "bg-blue-600/20 font-semibold text-blue-300"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 font-mono text-neutral-400">{opt.symbol}</span>
                  <span>{opt.label}</span>
                </div>
                {currency === opt.code && (
                  <span className="text-blue-400 font-bold">✓</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default CurrencySwitcher;

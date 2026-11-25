"use client";

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
  onRetry?: () => void;
  walletProvider?: string;
  networkId?: string;
  contractAddress?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const { section, walletProvider, networkId, contractAddress } = this.props;

    const providerName =
      walletProvider ||
      (typeof window !== "undefined"
        ? ((window as Record<string, unknown>)
            .staminaWalletProvider as string) ||
          process.env.NEXT_PUBLIC_WALLET_PROVIDER ||
          "Freighter"
        : "Freighter");
    const netId =
      networkId ||
      process.env.NEXT_PUBLIC_SOROBAN_NETWORK_ID ||
      "Test SDF Future Network ; October 2022";
    const cAddress =
      contractAddress ||
      process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID ||
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2MH";

    // Log for local debugging
    console.error("[ErrorBoundary]", {
      section: section ?? "unknown",
      message: error.message,
      componentStack: info.componentStack,
      walletProvider: providerName,
      networkId: netId,
      contractAddress: cAddress,
    });

    // Report to Sentry with enriched context
    Sentry.captureException(error, {
      tags: {
        section: section ?? "unknown",
        component: "ErrorBoundary",
        walletProvider: providerName,
        networkId: netId,
        contractAddress: cAddress,
      },
      extra: {
        componentStack: info.componentStack,
        section: section ?? "unknown",
        walletProvider: providerName,
        networkId: netId,
        contractAddress: cAddress,
      },
    });
  }

  reset = () => {
    this.setState({ error: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render() {
    const { error } = this.state;
    const { children, fallback, section } = this.props;

    if (!error) return children;

    if (fallback) return fallback;

    return (
      <div
        data-testid="error-boundary-fallback"
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400 space-y-3"
      >
        <div className="flex items-center justify-between">
          <p className="font-medium">
            Something went wrong in{" "}
            {section ? `widget [${section}]` : "this widget"}.
          </p>
          <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 uppercase tracking-wider font-mono">
            Isolated Error
          </span>
        </div>
        <p className="text-neutral-400 text-xs font-mono break-all">
          {error.message}
        </p>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={this.reset}
            className="text-xs px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors font-medium cursor-pointer shadow-sm border border-neutral-700"
          >
            Retry widget
          </button>
        </div>
      </div>
    );
  }
}

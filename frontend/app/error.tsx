"use client";

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // Same pattern as ErrorBoundary — log locally, no sensitive data sent out
    console.error("[GlobalError]", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mx-auto text-red-400 text-xl">
          !
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="text-neutral-400 text-sm">
            An unexpected error occurred. You can try again or navigate back to
            the app.
          </p>
          {error.digest && (
            <p className="text-neutral-600 text-xs font-mono">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-2 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition-colors"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

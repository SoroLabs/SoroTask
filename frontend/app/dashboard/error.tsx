"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold text-slate-100">Dashboard unavailable</h1>
      <p className="mt-3 text-sm text-slate-400">
        {error.message || "An unexpected error occurred while loading dashboard data."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Retry
      </button>
    </main>
  );
}

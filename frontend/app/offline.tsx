export const metadata = {
  title: "Offline — SoroTask",
  description: "You are offline. Reconnect to keep browsing the SoroTask dashboard.",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-900 px-6 text-center text-neutral-100">
      <div aria-hidden className="mb-6 text-5xl">
        📡
      </div>
      <h1 className="mb-3 text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-md text-sm text-neutral-300">
        The SoroTask dashboard needs a network connection to load the latest data.
        Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
      >
        Retry
      </button>
    </main>
  );
}
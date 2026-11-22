import type { Metadata, Viewport } from "next";
import Link from "next/link";

interface TaskDetailPageProps {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: TaskDetailPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const taskId = resolvedParams.id;
  const taskTitle = `Task #${taskId} Execution Pipeline`;
  const description = `Automated Soroban smart contract task #${taskId} live on Stellar. Inspect real-time execution states, logs, and keepers.`;
  
  const ogUrl = new URL(`/api/og`, process.env.NEXT_PUBLIC_APP_URL || "https://sorotask.io");
  ogUrl.searchParams.set("id", taskId);
  ogUrl.searchParams.set("title", taskTitle);
  ogUrl.searchParams.set("status", "ACTIVE");
  ogUrl.searchParams.set("executions", "1,842");
  ogUrl.searchParams.set("contract", "CCBD...92A1");
  ogUrl.searchParams.set("bounty", "50 XLM");

  return {
    title: `${taskTitle} | SoroTask`,
    description,
    openGraph: {
      title: taskTitle,
      description,
      url: `/tasks/${taskId}`,
      siteName: "SoroTask Protocol",
      images: [
        {
          url: ogUrl.toString(),
          width: 1200,
          height: 630,
          alt: taskTitle,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: taskTitle,
      description,
      images: [ogUrl.toString()],
      creator: "@SoroTask",
    },
  };
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const resolvedParams = await params;
  const taskId = resolvedParams.id;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div>
            <Link
              href="/tasks"
              className="text-xs text-blue-400 hover:text-blue-300 mb-2 inline-block"
            >
              ← Back to All Tasks
            </Link>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-md">
                #{taskId}
              </span>
              <h1 className="text-2xl font-bold">Task #{taskId} Execution Details</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              ACTIVE
            </span>
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <span className="text-xs text-neutral-400 block uppercase">Total Executions</span>
            <span className="text-2xl font-bold text-neutral-100">1,842</span>
            <span className="text-[11px] text-emerald-400 block mt-1">+12 in last hour</span>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <span className="text-xs text-neutral-400 block uppercase">Target Contract</span>
            <span className="text-sm font-mono text-slate-200 block truncate mt-1">CCBD...92A1</span>
            <span className="text-[11px] text-neutral-400 block mt-1">Soroban Mainnet</span>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <span className="text-xs text-neutral-400 block uppercase">Bounty Escrow</span>
            <span className="text-2xl font-bold text-blue-400">50 XLM</span>
            <span className="text-[11px] text-neutral-400 block mt-1">Refilled automatically</span>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <span className="text-xs text-neutral-400 block uppercase">Success Rate</span>
            <span className="text-2xl font-bold text-emerald-400">99.8%</span>
            <span className="text-[11px] text-neutral-400 block mt-1">Last failed: 4d ago</span>
          </div>
        </div>

        {/* Social Sharing Card Preview */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-neutral-200">Public Task Sharing & OpenGraph</h2>
          <p className="text-sm text-neutral-400">
            Share this task on social networks. A dynamic edge preview card is automatically generated in &lt; 200ms.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `Inspect automated Soroban Task #${taskId} live on SoroTask: https://sorotask.io/tasks/${taskId}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-sky-500 hover:bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition"
            >
              Share on Twitter / X
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(
                `https://sorotask.io/tasks/${taskId}`
              )}&text=${encodeURIComponent(`Live Soroban Task #${taskId} metrics`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition"
            >
              Share on Telegram
            </a>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(window.location.href);
                }
              }}
              className="rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-4 py-2 text-xs font-semibold text-neutral-200 transition"
            >
              Copy Public Link
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

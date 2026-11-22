import Link from "next/link";
import { WalletNavSlot } from "@/app/components/WalletNavSlot";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProductTour } from "@/src/components/ProductTour";
import {
  FiActivity,
  FiArrowRight,
  FiBarChart2,
  FiCheckCircle,
  FiClock,
  FiTerminal,
  FiCpu,
  FiGrid,
  FiLayers,
  FiPlayCircle,
  FiShield,
  FiZap,
  FiTrendingUp,
} from "react-icons/fi";

const stats = [
  { label: "Automation uptime", value: "99.8%" },
  { label: "Avg execution lag", value: "1.4s" },
  { label: "Keeper routes", value: "24" },
];

const commandRows = [
  {
    name: "Harvest vault yield",
    network: "Stellar",
    status: "Ready",
    eta: "32s",
    tone: "bg-emerald-400",
  },
  {
    name: "Rebalance treasury",
    network: "Soroban",
    status: "Queued",
    eta: "4m",
    tone: "bg-sky-400",
  },
  {
    name: "Sweep idle liquidity",
    network: "Cross-chain",
    status: "Watching",
    eta: "12m",
    tone: "bg-amber-300",
  },
];

const quickLinks = [
  {
    href: "/sandbox",
    title: "Developer Sandbox",
    description: "Open the keyboard-driven task CLI and Soroban simulator.",
    icon: FiTerminal,
  },
  {
    href: "/tasks",
    title: "Task Console",
    description: "Create, fund, pause, and inspect recurring contract calls.",
    icon: FiPlayCircle,
  },
  {
    href: "/board",
    title: "Execution Board",
    description: "Triage active automations by status, priority, and owner.",
    icon: FiGrid,
  },
  {
    href: "/dashboard",
    title: "Live Dashboard",
    description:
      "Track volume, latency, failures, and task health at a glance.",
    icon: FiBarChart2,
  },
  {
    href: "/keeper-metrics",
    title: "Keeper Metrics",
    description: "Monitor nodes, gas pressure, retries, and operational risk.",
    icon: FiCpu,
  },
  {
    href: "/tokenomics",
    title: "Tokenomics Flow",
    description:
      "Model distribution flows, cycles, and pools inside the network.",
    icon: FiLayers,
  },
  {
    href: "/yield-calculator",
    title: "Yield Forecaster",
    description:
      "Forecast simple vs compounded yields post keeper execution fees.",
    icon: FiTrendingUp,
  },
  {
    href: "/gas-optimization",
    title: "Gas Optimization",
    description:
      "Estimate transaction costs, schedule off-peak, and simulate runs.",
    icon: FiZap,
  },
  {
    href: "/tracing",
    title: "Distributed Tracing",
    description:
      "Timeline waterfall diagnostics across services & block consensus.",
    icon: FiActivity,
  },
];

const trustSignals = [
  { icon: FiShield, label: "Non-custodial task control" },
  { icon: FiClock, label: "Interval-aware execution" },
  { icon: FiLayers, label: "Dependency-ready workflows" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <section className="theme-ambient relative isolate min-h-screen px-5 py-6 sm:px-8 lg:px-12">

        <nav className="theme-glass mx-auto flex w-full max-w-7xl items-center justify-between gap-4 rounded-full px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="SoroTask home"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-300 text-lg font-black text-slate-950">
              S
            </span>
            <span>
              <span               className="block text-sm font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
                SoroTask
              </span>
              <span className="block text-xs text-[var(--text-muted)]">
                Automation command center
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 text-sm text-[var(--text-secondary)] md:flex">
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/dashboard"
              prefetch={true}
            >
              Dashboard
            </Link>
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/marketplace"
              prefetch={true}
            >
              Marketplace
            </Link>
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/settings"
            >
              Settings
            </Link>
          </div>
          <div className="flex items-center gap-3" data-tour="wallet-slot">
            <LanguageSelector />
            <ThemeToggle />
            <WalletNavSlot />
            <Link
              href="/tasks"
              prefetch={true}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200"
            >
              Launch
              <FiArrowRight aria-hidden="true" data-rtl-flip />
            </Link>
          </div>
        </nav>

        <div className="mx-auto grid w-full max-w-7xl gap-10 pb-16 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-20 lg:pt-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-sm font-medium text-[var(--text-primary)]">
              <FiZap aria-hidden="true" />
              MVP-ready automation control for Soroban teams
            </div>

            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.95] text-[var(--text-primary)] sm:text-6xl lg:text-7xl">
              Run onchain tasks without watching the clock.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">
              SoroTask gives teams one sharp surface to schedule contract calls,
              fund execution, monitor keepers, and catch failed workflows before
              they become expensive.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/tasks"
                prefetch={true}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3 text-base font-bold text-slate-950 shadow-xl shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-200"
              >
                Create automation
                <FiArrowRight aria-hidden="true" data-rtl-flip />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 text-base font-semibold text-[var(--text-primary)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-[var(--bg-elevated)]"
              >
                View live dashboard
                <FiActivity aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="border-l border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
                >
                  <p className="text-2xl font-black text-[var(--accent)]">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="theme-glass rounded-[2rem] p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--accent)]">
                    Execution stream
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-[var(--text-primary)]">
                    Keeper cockpit
                  </h2>
                </div>
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
                  Live
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-emerald-300 p-4 text-slate-950">
                  <p className="text-xs font-bold uppercase tracking-[0.2em]">
                    Balance
                  </p>
                  <p className="mt-3 text-3xl font-black">842 XLM</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    Retries
                  </p>
                  <p className="mt-3 text-3xl font-black text-[var(--text-primary)]">03</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    Risk
                  </p>
                  <p className="mt-3 text-3xl font-black text-[var(--text-primary)]">Low</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {commandRows.map((row) => (
                  <div
                    key={row.name}
                    className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`size-3 rounded-full ${row.tone}`} />
                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">{row.name}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{row.network}</p>
                      </div>
                    </div>
                    <span className="w-fit rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-sm font-medium text-[var(--text-primary)]">
                      {row.status}
                    </span>
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">
                      ETA {row.eta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-7xl gap-4 pb-16 md:grid-cols-3">
          {trustSignals.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex items-center gap-3 border-t border-[var(--border)] pt-5 text-[var(--text-secondary)]"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--accent)]">
                  <Icon aria-hidden="true" />
                </span>
                <span className="font-medium">{item.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-[var(--bg-base)] px-5 py-16 text-[var(--text-primary)] sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.28em] text-[var(--accent)]">
                Operate faster
              </p>
              <h2 className="mt-3 max-w-2xl text-4xl font-black leading-tight sm:text-5xl">
                Everything an MVP demo needs on the first screen.
              </h2>
            </div>
            <p className="max-w-xl text-base leading-7 text-[var(--text-secondary)]">
              These routes turn the homepage from a blank entry point into a
              guided product hub, so users immediately know where to create,
              monitor, and debug automations.
            </p>
          </div>

          <div
            className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            data-tour="quick-links"
          >
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl"
                >
                  <span
                    className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-xl text-[var(--background)] shadow-lg"
                  >
                    <Icon aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 text-xl font-black">{link.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    {link.description}
                  </p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
                    Open workspace
                    <FiArrowRight
                      className="transition group-hover:translate-x-1"
                      aria-hidden="true"
                      data-rtl-flip
                    />
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="theme-glass mt-10 grid gap-4 rounded-[2rem] p-5 lg:grid-cols-[0.75fr_1.25fr] lg:p-7">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.24em] text-[var(--accent)]">
                  Launch checklist
                </p>
                <h3 className="mt-3 text-3xl font-black">
                  Built to show momentum.
                </h3>
                <p className="mt-4 leading-7 text-[var(--text-secondary)]">
                  A stronger homepage helps your MVP feel intentional while the
                  deeper product screens continue doing the actual work.
                </p>
              </div>
              <Link
                href="/template-builder"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-200"
              >
                Build a template
                <FiArrowRight aria-hidden="true" data-rtl-flip />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {["Connect wallet", "Register task", "Watch execution"].map(
                (step, index) => (
                  <div
                    key={step}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5"
                  >
                    <FiCheckCircle
                      className="text-2xl text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <p className="mt-6 text-sm font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                      Step {index + 1}
                    </p>
                    <p className="mt-2 text-xl font-black">{step}</p>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <ProductTour />
    </main>
  );
}

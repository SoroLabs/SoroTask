"use client";

import { useEffect, useMemo, useState } from "react";

type WidgetStatus = "loading" | "empty" | "error" | "success";
type WidgetSize = "small" | "medium" | "large";

type WidgetDefinition = {
  id: string;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  getStatus: () => WidgetStatus;
  render: () => JSX.Element;
};

type DashboardConfig = {
  widgetOrder: string[];
  hiddenWidgetIds: string[];
};

const STORAGE_KEY = "sorotask.dashboard.config.v1";

const widgetRegistry: Record<string, WidgetDefinition> = {
  volume: {
    id: "volume",
    title: "Daily Volume",
    description: "Track total processed volume over the last 24h.",
    defaultSize: "large",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-3">
        <p className="text-3xl font-semibold text-slate-100">$2.41M</p>
        <p className="text-sm text-emerald-300">+12.3% vs yesterday</p>
      </div>
    ),
  },
  keeperHealth: {
    id: "keeperHealth",
    title: "Keeper Health",
    description: "Heartbeat and execution reliability overview.",
    defaultSize: "medium",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-2 text-sm text-slate-200">
        <p>Healthy keepers: 9/10</p>
        <p>Failed executions: 0.8%</p>
      </div>
    ),
  },
  failedTasks: {
    id: "failedTasks",
    title: "Failed Tasks",
    description: "Tasks requiring intervention.",
    defaultSize: "small",
    getStatus: () => "empty",
    render: () => <p className="text-sm text-slate-300">No failed tasks detected.</p>,
  },
  bridgeLatency: {
    id: "bridgeLatency",
    title: "Bridge Latency",
    description: "Cross-network median latency.",
    defaultSize: "small",
    getStatus: () => "loading",
    render: () => <p className="text-sm text-slate-300">Measuring live latency...</p>,
  },
  alertFeed: {
    id: "alertFeed",
    title: "Alert Feed",
    description: "Recent critical incidents and warnings.",
    defaultSize: "medium",
    getStatus: () => "error",
    render: () => (
      <p className="text-sm text-slate-300">
        Alert stream is temporarily unavailable. Retry shortly.
      </p>
    ),
  },
};

const defaultOrder = Object.keys(widgetRegistry);

function ensureValidOrder(order: string[]): string[] {
  const known = new Set(defaultOrder);
  const deduped = order.filter((widgetId, index) => known.has(widgetId) && order.indexOf(widgetId) === index);
  const missing = defaultOrder.filter((widgetId) => !deduped.includes(widgetId));
  return [...deduped, ...missing];
}

function reorderWidgets(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) {
    return order;
  }

  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) {
    return order;
  }

  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function getWidgetStateStyles(status: WidgetStatus): string {
  switch (status) {
    case "loading":
      return "border-amber-400/40 bg-amber-500/10";
    case "empty":
      return "border-slate-500/40 bg-slate-500/10";
    case "error":
      return "border-rose-400/40 bg-rose-500/10";
    default:
      return "border-emerald-400/30 bg-emerald-500/10";
  }
}

function getSizeClass(size: WidgetSize): string {
  switch (size) {
    case "large":
      return "md:col-span-2";
    case "medium":
      return "md:col-span-1";
    default:
      return "md:col-span-1";
  }
}

export default function DashboardPage() {
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setReady(true);
        return;
      }

      const parsed = JSON.parse(raw) as DashboardConfig;
      setOrder(ensureValidOrder(parsed.widgetOrder ?? []));
      setHiddenIds((parsed.hiddenWidgetIds ?? []).filter((id) => defaultOrder.includes(id)));
    } catch {
      setOrder(defaultOrder);
      setHiddenIds([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const config: DashboardConfig = {
      widgetOrder: order,
      hiddenWidgetIds: hiddenIds,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [hiddenIds, order, ready]);

  const visibleWidgets = useMemo(
    () => order.filter((widgetId) => !hiddenIds.includes(widgetId)),
    [hiddenIds, order],
  );

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-100">Analytics Dashboard</h1>
        <p className="text-sm text-slate-300">
          Drag cards to reorder them, or toggle widgets to personalize your workspace.
        </p>
      </header>

      <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-200">Visible Widgets</h2>
        <div className="flex flex-wrap gap-3">
          {defaultOrder.map((widgetId) => {
            const widget = widgetRegistry[widgetId];
            const checked = !hiddenIds.includes(widgetId);
            return (
              <label key={widgetId} className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setHiddenIds((current) => current.filter((id) => id !== widgetId));
                    } else {
                      setHiddenIds((current) => [...current, widgetId]);
                    }
                  }}
                />
                {widget.title}
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {visibleWidgets.map((widgetId) => {
          const widget = widgetRegistry[widgetId];
          const status = widget.getStatus();
          return (
            <article
              key={widget.id}
              draggable
              onDragStart={() => setDraggingId(widget.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId) {
                  setOrder((current) => reorderWidgets(current, draggingId, widget.id));
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              className={`${getSizeClass(widget.defaultSize)} rounded-2xl border p-4 transition ${getWidgetStateStyles(status)} ${
                draggingId === widget.id ? "opacity-60" : "opacity-100"
              }`}
              data-testid={`widget-${widget.id}`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium text-slate-100">{widget.title}</h3>
                  <p className="text-xs text-slate-300">{widget.description}</p>
                </div>
                <span className="rounded-full border border-slate-600 px-2 py-1 text-xs uppercase tracking-wide text-slate-200">
                  {status}
                </span>
              </div>
              {widget.render()}
            </article>
          );
        })}
      </section>
    </main>
  );
}
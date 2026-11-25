"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardServerData, DashboardWidgetData } from "@/src/lib/rsc/server-data";

type DashboardConfig = {
  widgetOrder: string[];
  hiddenWidgetIds: string[];
};

const STORAGE_KEY = "sorotask.dashboard.config.v1";

function ensureValidOrder(order: string[], knownIds: string[]): string[] {
  const known = new Set(knownIds);
  const deduped = order.filter(
    (widgetId, index) => known.has(widgetId) && order.indexOf(widgetId) === index,
  );
  const missing = knownIds.filter((widgetId) => !deduped.includes(widgetId));
  return [...deduped, ...missing];
}

function reorderWidgets(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;

  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return order;

  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function getWidgetStateStyles(status: DashboardWidgetData["status"]): string {
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

function getSizeClass(size: DashboardWidgetData["defaultSize"]): string {
  return size === "large" ? "md:col-span-2" : "md:col-span-1";
}

type DashboardClientProps = {
  initialData: DashboardServerData;
};

export function DashboardClient({ initialData }: DashboardClientProps) {
  const widgetIds = useMemo(
    () => initialData.widgets.map((widget) => widget.id),
    [initialData.widgets],
  );
  const widgetMap = useMemo(
    () =>
      initialData.widgets.reduce<Record<string, DashboardWidgetData>>(
        (accumulator, widget) => {
          accumulator[widget.id] = widget;
          return accumulator;
        },
        {},
      ),
    [initialData.widgets],
  );

  const [order, setOrder] = useState<string[]>(widgetIds);
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
      setOrder(ensureValidOrder(parsed.widgetOrder ?? [], widgetIds));
      setHiddenIds(
        (parsed.hiddenWidgetIds ?? []).filter((id) => widgetIds.includes(id)),
      );
    } catch {
      setOrder(widgetIds);
      setHiddenIds([]);
    } finally {
      setReady(true);
    }
    // Load persisted config once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;

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
    <>
      <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-200">Visible Widgets</h2>
        <div className="flex flex-wrap gap-3">
          {widgetIds.map((widgetId) => {
            const widget = widgetMap[widgetId];
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
          const widget = widgetMap[widgetId];
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
              className={`${getSizeClass(widget.defaultSize)} rounded-2xl border p-4 transition ${getWidgetStateStyles(widget.status)} ${
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
                  {widget.status}
                </span>
              </div>
              <div className="space-y-2">
                <p className="text-3xl font-semibold text-slate-100">{widget.value}</p>
                <p className="text-sm text-slate-300">{widget.detail}</p>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

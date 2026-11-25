"use client";

import React, { useEffect, useMemo, useState } from "react";
import { WidgetSkeleton } from "@/components/skeletons";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";

export type WidgetStatus = "loading" | "empty" | "error" | "success";
export type WidgetSize = "small" | "medium" | "large";

export type WidgetDefinition = {
  id: string;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  getStatus: () => WidgetStatus;
  render: () => React.ReactNode;
};

export type DashboardConfig = {
  widgetOrder: string[];
  hiddenWidgetIds: string[];
};

export type WidgetGridProps = {
  widgetRegistry: Record<string, WidgetDefinition>;
  storageKey?: string;
};

const STORAGE_KEY_DEFAULT = "sorotask.dashboard.config.v1";

function ensureValidOrder(order: string[], defaultOrder: string[]): string[] {
  const known = new Set(defaultOrder);
  const deduped = order.filter(
    (widgetId, index) =>
      known.has(widgetId) && order.indexOf(widgetId) === index,
  );
  const missing = defaultOrder.filter(
    (widgetId) => !deduped.includes(widgetId),
  );
  return [...deduped, ...missing];
}

function reorderWidgets(
  order: string[],
  fromId: string,
  toId: string,
): string[] {
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

export function WidgetGrid({
  widgetRegistry,
  storageKey = STORAGE_KEY_DEFAULT,
}: WidgetGridProps) {
  const defaultOrder = useMemo(
    () => Object.keys(widgetRegistry),
    [widgetRegistry],
  );
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setReady(true);
        return;
      }

      const parsed = JSON.parse(raw) as DashboardConfig;
      setOrder(ensureValidOrder(parsed.widgetOrder ?? [], defaultOrder));
      setHiddenIds(
        (parsed.hiddenWidgetIds ?? []).filter((id) =>
          defaultOrder.includes(id),
        ),
      );
    } catch {
      setOrder(defaultOrder);
      setHiddenIds([]);
    } finally {
      setReady(true);
    }
  }, [defaultOrder, storageKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const config: DashboardConfig = {
      widgetOrder: order,
      hiddenWidgetIds: hiddenIds,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(config));
  }, [hiddenIds, order, ready, storageKey]);

  const visibleWidgets = useMemo(
    () => order.filter((widgetId) => !hiddenIds.includes(widgetId)),
    [hiddenIds, order],
  );

  return (
    <div>
      <section
        className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-4"
        aria-label="Widget visibility controls"
      >
        <h2 className="mb-3 text-sm font-medium text-slate-200">
          Visible Widgets
        </h2>
        <div className="flex flex-wrap gap-3">
          {defaultOrder.map((widgetId) => {
            const widget = widgetRegistry[widgetId];
            const checked = !hiddenIds.includes(widgetId);
            return (
              <label
                key={widgetId}
                className="flex items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setHiddenIds((current) =>
                        current.filter((id) => id !== widgetId),
                      );
                    } else {
                      setHiddenIds((current) => [...current, widgetId]);
                    }
                  }}
                  aria-label={`Toggle ${widget.title} widget visibility`}
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
                  setOrder((current) =>
                    reorderWidgets(current, draggingId, widget.id),
                  );
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              className={`${getSizeClass(widget.defaultSize)} rounded-2xl border p-4 transition ${getWidgetStateStyles(status)} ${
                draggingId === widget.id ? "opacity-60" : "opacity-100"
              }`}
              data-testid={`widget-${widget.id}`}
              aria-grabbed={draggingId === widget.id}
              aria-describedby={`widget-status-${widget.id}`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium text-slate-100">
                    {widget.title}
                  </h3>
                  <p className="text-xs text-slate-300">{widget.description}</p>
                </div>
                <span
                  id={`widget-status-${widget.id}`}
                  className="rounded-full border border-slate-600 px-2 py-1 text-xs uppercase tracking-wide text-slate-200"
                >
                  {status}
                </span>
              </div>
              {status === "loading" ? (
                <WidgetSkeleton size={widget.defaultSize} />
              ) : (
                <ErrorBoundary section={`widget-${widget.id}`}>
                  {widget.render()}
                </ErrorBoundary>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

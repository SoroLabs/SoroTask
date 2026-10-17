"use client";

import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";

export interface ChartDatum {
  x: number;
  label: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

export interface ChartSeries {
  label: string;
  color: string;
  data: ChartDatum[];
}

interface InteractiveFinancialChartProps {
  title: string;
  data: ChartDatum[];
  series?: ChartSeries[];
  variant?: "line" | "candlestick" | "depth";
  color?: string;
  valueLabel?: string;
  emptyMessage?: string;
  testId?: string;
}

const WIDTH = 900;
const HEIGHT = 320;
const LEFT = 76;
const RIGHT = 20;
const TOP = 20;
const BOTTOM = 46;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

export function InteractiveFinancialChart({
  title,
  data,
  series = [],
  variant = "line",
  color = "#38bdf8",
  valueLabel = "Value",
  emptyMessage = "No time-series records are available.",
  testId,
}: InteractiveFinancialChartProps) {
  const [view, setView] = useState({ start: 0, span: 1 });
  const dragRef = useRef<{ pointerX: number; start: number } | null>(null);

  const safeView = useMemo(() => {
    const span = Math.max(0.08, Math.min(1, view.span));
    return {
      start: Math.max(0, Math.min(1 - span, view.start)),
      span,
    };
  }, [view]);

  const startIndex = Math.max(0, Math.floor(safeView.start * data.length + 1e-9));
  const endIndex = Math.max(
    Math.min(data.length, startIndex + 1),
    Math.ceil((safeView.start + safeView.span) * data.length - 1e-9),
  );
  const visible = data.slice(startIndex, endIndex);
  const lineSeries =
    series.length > 0
      ? series.map((item) => ({ ...item, visible: item.data.slice(startIndex, endIndex) }))
      : [{ label: valueLabel, color, visible }];
  const values = variant === "line"
    ? lineSeries.flatMap((item) => item.visible.map((point) => point.value))
    : visible.flatMap((point) =>
    variant === "candlestick" && point.low !== undefined && point.high !== undefined
      ? [point.low, point.high]
      : [point.value],
  );
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const padding = (max - min) * 0.12 || Math.max(max * 0.05, 0.01);
  const yMin = Math.max(0, min - padding);
  const yMax = max + padding || 1;
  const y = (value: number) => TOP + ((yMax - value) / (yMax - yMin)) * PLOT_HEIGHT;
  const depthMinX = visible.length ? Math.min(...visible.map((point) => point.x)) : 0;
  const depthMaxX = visible.length ? Math.max(...visible.map((point) => point.x)) : 1;
  const x = (index: number) => {
    if (variant === "depth") {
      const pointX = visible[index - startIndex]?.x ?? depthMinX;
      return LEFT + ((pointX - depthMinX) / (depthMaxX - depthMinX || 1)) * PLOT_WIDTH;
    }
    return LEFT + ((index - startIndex + 0.5) / Math.max(1, visible.length)) * PLOT_WIDTH;
  };
  const candleWidth = Math.max(2, Math.min(18, (PLOT_WIDTH / Math.max(visible.length, 1)) * 0.58));
  const depthPath = visible
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(startIndex + index)} ${y(point.value)}`)
    .join(" ");

  function zoom(factor: number, anchor = 0.5) {
    setView((current) => {
      const span = Math.max(0.08, Math.min(1, current.span * factor));
      const relativeAnchor = current.start + current.span * anchor;
      const start = relativeAnchor - span * anchor;
      return { start: Math.max(0, Math.min(1 - span, start)), span };
    });
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(bounds.width, 1)));
    zoom(event.deltaY < 0 ? 0.8 : 1.25, anchor);
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    dragRef.current = { pointerX: event.clientX, start: safeView.start };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragRef.current || data.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const delta = (event.clientX - dragRef.current.pointerX) / Math.max(bounds.width, 1);
    const start = Math.max(0, Math.min(1 - safeView.span, dragRef.current.start - delta * safeView.span));
    setView({ start, span: safeView.span });
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section
      className="rounded-xl border border-white/10 bg-slate-950/60 p-4"
      data-testid={testId}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-1" aria-label={`${title} zoom controls`}>
          <button type="button" aria-label={`Zoom out ${title}`} onClick={() => zoom(1.25)} className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">−</button>
          <button type="button" aria-label={`Zoom in ${title}`} onClick={() => zoom(0.8)} className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">+</button>
          <button type="button" onClick={() => setView({ start: 0, span: 1 })} className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Reset view</button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="flex h-64 items-center justify-center text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${title} ${variant} chart; scroll to zoom and drag to pan`}
            className="h-64 w-full cursor-grab touch-none select-none active:cursor-grabbing"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {[0, 1, 2, 3, 4].map((tick) => {
              const value = yMin + ((yMax - yMin) * tick) / 4;
              const yPosition = y(value);
              return (
                <g key={tick}>
                  <line x1={LEFT} y1={yPosition} x2={WIDTH - RIGHT} y2={yPosition} stroke="rgba(148,163,184,.15)" />
                  <text x={LEFT - 8} y={yPosition + 4} textAnchor="end" fill="#94a3b8" fontSize="10">{value.toPrecision(4)}</text>
                </g>
              );
            })}
            {variant === "candlestick" ? (
              visible.map((point, index) => {
                if (point.open === undefined || point.high === undefined || point.low === undefined || point.close === undefined) return null;
                const center = x(startIndex + index);
                const up = point.close >= point.open;
                const candleColor = up ? "#34d399" : "#fb7185";
                const top = y(Math.max(point.open, point.close));
                const bodyHeight = Math.max(1, Math.abs(y(point.open) - y(point.close)));
                return (
                  <g key={`${point.label}-${index}`}>
                    <line x1={center} x2={center} y1={y(point.high)} y2={y(point.low)} stroke={candleColor} />
                    <rect x={center - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} fill={candleColor}>
                      <title>{`${point.label}: O ${point.open}, H ${point.high}, L ${point.low}, C ${point.close}`}</title>
                    </rect>
                  </g>
                );
              })
            ) : variant === "depth" ? (
              <g>
                <path
                  d={`${depthPath} L ${x(startIndex + visible.length - 1)} ${TOP + PLOT_HEIGHT} L ${x(startIndex)} ${TOP + PLOT_HEIGHT} Z`}
                  fill={`${color}22`}
                  stroke={color}
                  strokeWidth="2"
                />
                {visible.map((point, index) => (
                  <circle key={`${point.label}-${index}`} cx={x(startIndex + index)} cy={y(point.value)} r="2.5" fill={color}>
                    <title>{`${point.label}: ${point.value} ${valueLabel}`}</title>
                  </circle>
                ))}
              </g>
            ) : (
              lineSeries.map((item) => (
                <path
                  key={item.label}
                  d={item.visible
                    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(startIndex + index)} ${y(point.value)}`)
                    .join(" ")}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{item.label}</title>
                </path>
              ))
            )}
            {visible.length > 0 && [0, Math.floor((visible.length - 1) / 2), visible.length - 1]
              .filter((value, index, valuesAt) => valuesAt.indexOf(value) === index)
              .map((index) => (
                <text key={index} x={x(startIndex + index)} y={HEIGHT - 12} textAnchor="middle" fill="#94a3b8" fontSize="10">
                  {visible[index].label}
                </text>
              ))}
          </svg>
          <p className="mt-1 text-[11px] text-slate-500">
            {visible.length} of {data.length} records · scroll or use +/− to zoom · drag to pan · {valueLabel}
          </p>
          {variant === "line" && series.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-400">
              {series.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';

interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface CandlestickChartProps {
  data: CandlestickData[];
  width?: number;
  height?: number;
  onBarClick?: (bar: CandlestickData) => void;
}

interface Crosshair {
  x: number;
  y: number;
  visible: boolean;
}

const COLORS = {
  bullish: '#22c55e',
  bearish: '#ef4444',
  grid: '#1e293b',
  crosshair: '#3b82f6',
  tooltip: '#0f172a',
  text: '#94a3b8',
  movingAvg: '#f59e0b',
};

export function CandlestickChart({
  data,
  width = 800,
  height = 400,
  onBarClick,
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const [crosshair, setCrosshair] = useState<Crosshair>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    data: CandlestickData;
  } | null>(null);

  const candlesPerPixel = useCallback(() => {
    const visibleCount = Math.floor(data.length / zoomLevel);
    return visibleCount / width;
  }, [data.length, zoomLevel, width]);

  const renderChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = COLORS.tooltip;
    ctx.fillRect(0, 0, width, height);

    const visibleData = getVisibleData();
    if (visibleData.length === 0) return;

    const prices = visibleData.flatMap((d) => [d.high, d.low]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;
    const padding = 40;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = Math.max(1, chartWidth / visibleData.length);

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = padding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      const price = maxPrice - (priceRange / 4) * i;
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px monospace';
      ctx.fillText(price.toFixed(2), 5, y + 4);
    }

    // Moving average overlay
    const maPeriod = 20;
    const maValues = calculateMovingAverage(visibleData, maPeriod);
    ctx.strokeStyle = COLORS.movingAvg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    maValues.forEach((ma, i) => {
      const x = padding + i * barWidth + barWidth / 2;
      const y = padding + ((maxPrice - ma) / priceRange) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw candlesticks
    visibleData.forEach((candle, i) => {
      const x = padding + i * barWidth + barWidth / 2;
      const isBullish = candle.close >= candle.open;
      const color = isBullish ? COLORS.bullish : COLORS.bearish;

      const openY = padding + ((maxPrice - candle.open) / priceRange) * chartHeight;
      const closeY = padding + ((maxPrice - candle.close) / priceRange) * chartHeight;
      const highY = padding + ((maxPrice - candle.high) / priceRange) * chartHeight;
      const lowY = padding + ((maxPrice - candle.low) / priceRange) * chartHeight;

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, Math.min(openY, closeY));
      ctx.moveTo(x, Math.max(openY, closeY));
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      ctx.fillStyle = color;
      ctx.fillRect(x - barWidth / 2 + 1, Math.min(openY, closeY), barWidth - 2, bodyHeight);
    });

    // Volume bars
    const maxVolume = Math.max(...visibleData.map((d) => d.volume));
    const volumeHeight = 40;
    visibleData.forEach((candle, i) => {
      const x = padding + i * barWidth + barWidth / 2;
      const volHeight = (candle.volume / maxVolume) * volumeHeight;
      const isBullish = candle.close >= candle.open;
      ctx.fillStyle = isBullish ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
      ctx.fillRect(
        x - barWidth / 2 + 1,
        height - padding - volumeHeight,
        barWidth - 2,
        volHeight
      );
    });

    // Crosshair
    if (crosshair.visible) {
      ctx.strokeStyle = COLORS.crosshair;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(crosshair.x, padding);
      ctx.lineTo(crosshair.x, height - padding);
      ctx.moveTo(padding, crosshair.y);
      ctx.lineTo(width - padding, crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Tooltip
    if (tooltip) {
      const tx = tooltip.x;
      const ty = tooltip.y;
      ctx.fillStyle = 'rgba(15,23,42,0.95)';
      ctx.strokeStyle = COLORS.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx - 10, ty - 60, 180, 50, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px monospace';
      ctx.fillText(`O: ${tooltip.data.open.toFixed(2)}`, tx, ty - 45);
      ctx.fillText(`H: ${tooltip.data.high.toFixed(2)}`, tx, ty - 33);
      ctx.fillText(`L: ${tooltip.data.low.toFixed(2)}`, tx, ty - 21);
      ctx.fillText(`C: ${tooltip.data.close.toFixed(2)}`, tx, ty - 9);
      ctx.fillText(`Vol: ${tooltip.data.volume}`, tx, ty + 3);
    }
  }, [data, width, height, zoomLevel, panOffset, crosshair, tooltip]);

  const getVisibleData = () => {
    const startIdx = Math.floor(panOffset);
    const endIdx = Math.min(startIdx + Math.floor(width * candlesPerPixel() * zoomLevel), data.length);
    return data.slice(startIdx, endIdx);
  };

  const calculateMovingAverage = (data: CandlestickData[], period: number) => {
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(data[i].close);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((s, d) => s + d.close, 0);
        result.push(sum / period);
      }
    }
    return result;
  };

  useEffect(() => {
    renderChart();
    animationRef.current = requestAnimationFrame(renderChart);
    return () => cancelAnimationFrame(animationRef.current);
  }, [renderChart]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setCrosshair({ x, y, visible: true });

      const visibleData = getVisibleData();
      const barIndex = Math.floor((x - 40) / (width / visibleData.length));
      if (barIndex >= 0 && barIndex < visibleData.length) {
        setTooltip({ x, y, data: visibleData[barIndex] });
      } else {
        setTooltip(null);
      }
    },
    [width, height]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoomLevel((prev) => Math.max(0.5, Math.min(10, prev * delta)));
    },
    []
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        const delta = e.clientX - dragStart;
        setPanOffset((prev) => Math.max(0, prev - delta / (width * candlesPerPixel())));
      }
      setIsDragging(false);
    },
    [isDragging, dragStart, width, candlesPerPixel]
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-900 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setCrosshair({ x: 0, y: 0, visible: false });
          setTooltip(null);
        }}
        style={{ cursor: isDragging ? 'grabbing' : 'crosshair' }}
      />
      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={() => setZoomLevel((prev) => Math.min(10, prev * 1.5))}
          className="px-2 py-1 bg-slate-700 text-white text-xs rounded"
        >
          Zoom +
        </button>
        <button
          onClick={() => setZoomLevel((prev) => Math.max(0.5, prev / 1.5))}
          className="px-2 py-1 bg-slate-700 text-white text-xs rounded"
        >
          Zoom -
        </button>
      </div>
    </div>
  );
}

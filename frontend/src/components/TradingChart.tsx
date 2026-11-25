"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  FiSliders,
  FiCheckCircle,
  FiLayers,
  FiActivity,
  FiZap,
} from "react-icons/fi";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LimitOrder {
  id: string;
  pair: string;
  type: "buy" | "sell" | "stop_loss";
  price: number;
  amount: number;
  status: "active" | "filled" | "cancelled";
  createdAt: string;
}

const SAMPLE_CANDLES: Candle[] = [
  {
    time: "10:00",
    open: 0.121,
    high: 0.126,
    low: 0.119,
    close: 0.124,
    volume: 145000,
  },
  {
    time: "10:15",
    open: 0.124,
    high: 0.129,
    low: 0.123,
    close: 0.128,
    volume: 210000,
  },
  {
    time: "10:30",
    open: 0.128,
    high: 0.131,
    low: 0.125,
    close: 0.126,
    volume: 180000,
  },
  {
    time: "10:45",
    open: 0.126,
    high: 0.127,
    low: 0.121,
    close: 0.122,
    volume: 120000,
  },
  {
    time: "11:00",
    open: 0.122,
    high: 0.125,
    low: 0.12,
    close: 0.125,
    volume: 165000,
  },
  {
    time: "11:15",
    open: 0.125,
    high: 0.132,
    low: 0.124,
    close: 0.13,
    volume: 290000,
  },
  {
    time: "11:30",
    open: 0.13,
    high: 0.134,
    low: 0.128,
    close: 0.131,
    volume: 240000,
  },
  {
    time: "11:45",
    open: 0.131,
    high: 0.135,
    low: 0.129,
    close: 0.133,
    volume: 310000,
  },
];

const INITIAL_ORDERS: LimitOrder[] = [
  {
    id: "order-1",
    pair: "XLM/USDC",
    type: "buy",
    price: 0.1205,
    amount: 1500,
    status: "active",
    createdAt: "10:15",
  },
  {
    id: "order-2",
    pair: "XLM/USDC",
    type: "sell",
    price: 0.1345,
    amount: 2000,
    status: "active",
    createdAt: "10:30",
  },
  {
    id: "order-3",
    pair: "XLM/USDC",
    type: "stop_loss",
    price: 0.115,
    amount: 3500,
    status: "active",
    createdAt: "10:45",
  },
];

export function TradingChart() {
  const [selectedPair, setSelectedPair] = useState("XLM/USDC");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "1D">(
    "15m",
  );
  const [candles] = useState<Candle[]>(SAMPLE_CANDLES);
  const [orders, setOrders] = useState<LimitOrder[]>(INITIAL_ORDERS);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragPrice, setDragPrice] = useState<number | null>(null);
  const [modifiedNotice, setModifiedNotice] = useState<string | null>(null);
  const [executedCelebration, setExecutedCelebration] =
    useState<LimitOrder | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Current market price
  const currentPrice = useMemo(() => {
    return candles[candles.length - 1]?.close ?? 0.133;
  }, [candles]);

  // Price bounds
  const { minPrice, maxPrice } = useMemo(() => {
    const prices = candles.flatMap((c) => [c.low, c.high]);
    orders.forEach((o) => prices.push(o.price));
    if (dragPrice !== null) prices.push(dragPrice);
    const min = Math.min(...prices) * 0.98;
    const max = Math.max(...prices) * 1.02;
    return { minPrice: min, maxPrice: max };
  }, [candles, orders, dragPrice]);

  // Convert price to Y coordinate on canvas
  const priceToY = useCallback(
    (price: number, height: number) => {
      const padding = 30;
      const chartHeight = height - padding * 2;
      const ratio = (price - minPrice) / (maxPrice - minPrice);
      return height - padding - ratio * chartHeight;
    },
    [minPrice, maxPrice],
  );

  // Convert Y coordinate to price
  const yToPrice = useCallback(
    (y: number, height: number) => {
      const padding = 30;
      const chartHeight = height - padding * 2;
      const clampedY = Math.max(padding, Math.min(height - padding, y));
      const ratio = (height - padding - clampedY) / chartHeight;
      return minPrice + ratio * (maxPrice - minPrice);
    },
    [minPrice, maxPrice],
  );

  // High-performance 60 FPS Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      const gridSteps = 6;
      for (let i = 0; i <= gridSteps; i++) {
        const y = 30 + (i * (height - 60)) / gridSteps;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        // Price label on right axis
        const price = yToPrice(y, height);
        ctx.fillStyle = "#64748b";
        ctx.font = "10px monospace";
        ctx.fillText(`$${price.toFixed(4)}`, width - 55, y - 4);
      }

      // Draw Candlesticks
      const candleWidth = Math.max(16, (width - 120) / candles.length - 8);
      const startX = 30;

      candles.forEach((candle, idx) => {
        const x = startX + idx * (candleWidth + 8) + candleWidth / 2;
        const openY = priceToY(candle.open, height);
        const closeY = priceToY(candle.close, height);
        const highY = priceToY(candle.high, height);
        const lowY = priceToY(candle.low, height);
        const isUp = candle.close >= candle.open;

        // Wick
        ctx.strokeStyle = isUp ? "#10b981" : "#f43f5e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Candle Body
        ctx.fillStyle = isUp ? "#10b981" : "#f43f5e";
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
        ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);

        // Volume Bar at bottom
        const volHeight = Math.min(30, (candle.volume / 350000) * 30);
        ctx.fillStyle = isUp
          ? "rgba(16, 185, 129, 0.25)"
          : "rgba(244, 63, 94, 0.25)";
        ctx.fillRect(
          x - candleWidth / 2,
          height - volHeight - 5,
          candleWidth,
          volHeight,
        );
      });

      // Current Price Line
      const currentY = priceToY(currentPrice, height);
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, currentY);
      ctx.lineTo(width, currentY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Active Limit Orders
      orders.forEach((order) => {
        const price =
          draggingOrderId === order.id && dragPrice !== null
            ? dragPrice
            : order.price;
        const orderY = priceToY(price, height);

        let strokeColor = "#10b981"; // Buy
        if (order.type === "sell") strokeColor = "#f43f5e";
        if (order.type === "stop_loss") strokeColor = "#f59e0b";

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = draggingOrderId === order.id ? 2.5 : 1.5;
        if (order.type === "stop_loss") ctx.setLineDash([6, 3]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(0, orderY);
        ctx.lineTo(width - 65, orderY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Interactive Handle / Badge
        ctx.fillStyle = strokeColor;
        const badgeWidth = 90;
        const badgeHeight = 18;
        ctx.fillRect(
          width - badgeWidth - 70,
          orderY - badgeHeight / 2,
          badgeWidth,
          badgeHeight,
        );

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 9px sans-serif";
        const label = `${order.type.toUpperCase()} $${price.toFixed(4)}`;
        ctx.fillText(label, width - badgeWidth - 65, orderY + 3);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    candles,
    orders,
    draggingOrderId,
    dragPrice,
    currentPrice,
    priceToY,
    yToPrice,
  ]);

  // Handle Drag Interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Check if clicked near an order line (within 12px)
    for (const order of orders) {
      const orderY = priceToY(order.price, canvas.height);
      if (Math.abs(y - orderY) < 14) {
        setDraggingOrderId(order.id);
        setSelectedOrder(order);
        setDragPrice(order.price);
        break;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingOrderId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const newPrice = Number(yToPrice(y, canvasRef.current.height).toFixed(4));
    setDragPrice(newPrice);
  };

  const handleMouseUp = () => {
    if (draggingOrderId && dragPrice !== null) {
      // Save modified price
      setOrders((prev) =>
        prev.map((o) =>
          o.id === draggingOrderId ? { ...o, price: dragPrice } : o,
        ),
      );
      setModifiedNotice(
        `Order ${draggingOrderId} updated to $${dragPrice.toFixed(4)} with on-chain signature.`,
      );
      setTimeout(() => setModifiedNotice(null), 3000);
    }
    setDraggingOrderId(null);
    setDragPrice(null);
  };

  // Direct manual adjustment
  const handleAdjustPrice = (orderId: string, newPrice: number) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, price: newPrice } : o)),
    );
    setModifiedNotice(`Order price adjusted to $${newPrice.toFixed(4)}`);
    setTimeout(() => setModifiedNotice(null), 2500);
  };

  // Trigger simulated execution for celebration
  const handleSimulateExecution = (order: LimitOrder) => {
    setExecutedCelebration(order);
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
  };

  return (
    <div
      className="w-full space-y-5 rounded-2xl bg-[#0b1318] p-5 text-white border border-gray-800"
      data-testid="trading-chart-container"
    >
      {/* Top Bar: Pair & Timeframe Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FiActivity className="text-emerald-400 text-lg" />
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white text-sm font-bold rounded-lg px-3 py-1.5 focus:outline-none"
              data-testid="pair-select"
            >
              <option value="XLM/USDC">XLM / USDC</option>
              <option value="XLM/AQUA">XLM / AQUA</option>
              <option value="BTC/XLM">BTC / XLM</option>
            </select>
          </div>
          <div className="text-sm font-mono text-emerald-400 flex items-center gap-1">
            <span className="text-white font-bold">
              ${currentPrice.toFixed(4)}
            </span>
            <span className="text-xs text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded">
              +4.82%
            </span>
          </div>
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800 text-xs">
          {(["1m", "5m", "15m", "1h", "1D"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded transition ${
                timeframe === tf
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              data-testid={`timeframe-${tf}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Execution Celebration Modal */}
      {executedCelebration && (
        <div
          className="p-4 rounded-xl bg-gradient-to-r from-emerald-900/70 to-teal-900/70 border border-emerald-400/50 shadow-xl flex items-center justify-between animate-in zoom-in-95 duration-200"
          data-testid="execution-celebration-banner"
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl animate-bounce">🎉</span>
            <div>
              <div className="text-sm font-bold text-emerald-300">
                Autonomous Limit Order Executed & Filled!
              </div>
              <div className="text-xs text-gray-200 mt-0.5">
                {executedCelebration.type.toUpperCase()}{" "}
                {executedCelebration.amount} XLM filled at trigger price $
                {executedCelebration.price.toFixed(4)}.
              </div>
            </div>
          </div>
          <button
            onClick={() => setExecutedCelebration(null)}
            className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Feedback banner */}
      {modifiedNotice && (
        <div className="p-2.5 rounded-lg bg-sky-950/40 border border-sky-500/40 text-sky-300 text-xs flex items-center gap-2">
          <FiCheckCircle />
          {modifiedNotice}
        </div>
      )}

      {/* Interactive Chart Canvas */}
      <div className="relative rounded-xl border border-gray-800/80 bg-slate-950 overflow-hidden shadow-inner">
        <canvas
          ref={canvasRef}
          width={760}
          height={340}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="w-full h-[340px] cursor-crosshair block"
          data-testid="tradingview-canvas"
        />

        {/* Dragging tooltip */}
        {draggingOrderId && dragPrice !== null && (
          <div className="absolute top-3 left-3 bg-gray-900/90 border border-emerald-500/50 text-white text-xs px-3 py-1.5 rounded shadow-lg flex items-center gap-2 pointer-events-none">
            <FiSliders className="text-emerald-400" />
            <span>Dragging Trigger Price:</span>
            <strong className="font-mono text-emerald-300">
              ${dragPrice.toFixed(4)}
            </strong>
          </div>
        )}
      </div>

      {/* Limit Order Management List & Order Book Depth */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
        {/* Active Orders Panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400 font-semibold uppercase tracking-wider">
            <span>Active Limit & Stop Orders ({orders.length})</span>
            <span className="text-[10px] lowercase text-gray-500">
              drag lines on chart to adjust
            </span>
          </div>

          <div className="space-y-2">
            {orders.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-xl">
                No active limit orders. Place orders below to visualize them
                directly on the price chart.
              </div>
            ) : (
              orders.map((order) => {
                const isBuy = order.type === "buy";
                const isStop = order.type === "stop_loss";
                return (
                  <div
                    key={order.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-gray-900/60 border border-gray-800 hover:border-gray-700 transition"
                    data-testid={`limit-order-card-${order.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                          isBuy
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : isStop
                              ? "bg-amber-950 text-amber-400 border border-amber-800"
                              : "bg-rose-950 text-rose-400 border border-rose-800"
                        }`}
                      >
                        {order.type.replace("_", " ")}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>{order.amount} XLM</span>
                          <span className="text-gray-400 font-mono">
                            @ ${order.price.toFixed(4)}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500">
                          Pair: {order.pair}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          handleAdjustPrice(
                            order.id,
                            Number((order.price + 0.001).toFixed(4)),
                          )
                        }
                        className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                        title="Increase Price"
                        data-testid={`price-inc-${order.id}`}
                      >
                        +$0.001
                      </button>
                      <button
                        onClick={() =>
                          handleAdjustPrice(
                            order.id,
                            Number((order.price - 0.001).toFixed(4)),
                          )
                        }
                        className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                        title="Decrease Price"
                        data-testid={`price-dec-${order.id}`}
                      >
                        -$0.001
                      </button>
                      <button
                        onClick={() => handleSimulateExecution(order)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition shadow"
                        data-testid={`trigger-execution-btn-${order.id}`}
                      >
                        <FiZap />
                        Simulate Fill
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Depth Profile Ladder */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="text-xs font-bold text-gray-300 flex items-center gap-1.5 pb-2 border-b border-gray-800">
            <FiLayers className="text-sky-400" />
            Market Depth Profile
          </div>
          <div className="text-[11px] font-mono space-y-1">
            <div className="text-gray-500 flex justify-between text-[10px]">
              <span>PRICE</span>
              <span>SIZE (XLM)</span>
            </div>
            {/* Asks */}
            <div className="flex justify-between text-rose-400 bg-rose-950/20 px-1 rounded">
              <span>0.1350</span>
              <span>18,400</span>
            </div>
            <div className="flex justify-between text-rose-400 bg-rose-950/10 px-1 rounded">
              <span>0.1340</span>
              <span>12,250</span>
            </div>
            {/* Current Price */}
            <div className="py-1 text-center font-bold text-emerald-300 border-y border-gray-800 text-xs">
              $0.1330 (Mid Market)
            </div>
            {/* Bids */}
            <div className="flex justify-between text-emerald-400 bg-emerald-950/10 px-1 rounded">
              <span>0.1320</span>
              <span>15,900</span>
            </div>
            <div className="flex justify-between text-emerald-400 bg-emerald-950/20 px-1 rounded">
              <span>0.1310</span>
              <span>24,800</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

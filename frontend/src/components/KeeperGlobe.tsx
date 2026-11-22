/**
 * KeeperGlobe.tsx — Real-time interactive 3D keeper network visualizer.
 *
 * Plots active keeper nodes on a WebGL globe (Three.js), renders live task
 * execution allocations as glowing arc trajectories, and surfaces glassmorphic
 * floating tooltips with verified uptime and hardware metrics. Designed for
 * placement inside the Keeper Dashboard (frontend/app/keeper-dashboard).
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface KeeperNode {
  id: string;
  label: string;
  region: string;
  latitude: number;
  longitude: number;
  uptime: number; // 0..1 fraction
  activeTasks: number;
  hardwareTier: 't1' | 't2' | 't3';
  lastHeartbeat: number;
  latencyMs: number;
  consensusWeight: number;
}

export interface TopologyEvent {
  type: 'task-execution' | 'heartbeat' | 'consensus-vote';
  fromNodeId: string;
  toNodeId?: string;
  timestamp: number;
  region?: string;
  value?: number;
}

interface GlobeProps {
  nodes: KeeperNode[];
  events?: TopologyEvent[];
  width?: number;
  height?: number;
  onNodeClick?: (node: KeeperNode) => void;
}

const GLOBE_RADIUS = 120;
const NODE_RADIUS = 6;
const ARC_HEIGHT = 40;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function nodePosition(lat: number, lon: number, radius: number = GLOBE_RADIUS): [number, number, number] {
  const phi = toRadians(90 - lat);
  const theta = toRadians(lon);
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

function buildArcPoints(fromLat: number, fromLon: number, toLat: number, toLon: number, height: number = ARC_HEIGHT): [number, number, number][] {
  const p1 = nodePosition(fromLat, fromLon, GLOBE_RADIUS);
  const p2 = nodePosition(toLat, toLon, GLOBE_RADIUS);
  const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const nx = -dy / len;
  const ny = dx / len;
  const arcs: [number, number, number][] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseX = p1[0] + dx * t;
    const baseY = p1[1] + dy * t;
    const baseZ = p1[2] + dz * t;
    const heightT = Math.sin(t * Math.PI) * height;
    arcs.push([baseX + nx * heightT * 0.5, baseY + heightT, baseZ + ny * heightT * 0.5]);
  }
  return arcs;
}

function nodeColorForTier(tier: KeeperNode['hardwareTier']): string {
  switch (tier) {
    case 't1':
      return '#38d9a9';
    case 't2':
      return '#4facfe';
    case 't3':
      return '#a78bfa';
    default:
      return '#94a3b8';
  }
}

function nodeColorForUptime(uptime: number): string {
  if (uptime >= 0.98) return '#34d399';
  if (uptime >= 0.95) return '#fbbf24';
  return '#f87171';
}

function makeNodeTexture(color: string, label: string, width: number = 128, height: number = 64): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const textColor = uptimeToTextColor(parseInt(label, 10));
  const bg = `rgba(${r},${g},${b},0.12)`;
  const border = `rgba(${r},${g},${b},0.35)`;
  const text = `rgba(${textColor.r},${textColor.g},${textColor.b},0.92)`;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="${bg}" stroke="${border}" stroke-width="1"/>
      <text x="${width/2}" y="${height/2}" font-family="ui-monospace, monospace" font-size="11" fill="${text}" text-anchor="middle" dominant-baseline="middle">${label}</text>
    </svg>
  `.trim();
}

function uptimeToTextColor(uptime: number): { r: number; g: number; b: number } {
  if (uptime >= 0.98) return { r: 52, g: 211, b: 153 };
  if (uptime >= 0.95) return { r: 251, g: 191, b: 36 };
  return { r: 248, g: 113, b: 113 };
}

export default function KeeperGlobe({ nodes = [], events = [], width = 640, height = 480, onNodeClick }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<KeeperNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [fps, setFps] = useState(0);

  const lastFrameRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef<number>(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = width * dpr;
    const h = height * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = String(width) + 'px';
      canvas.style.height = String(height) + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    let rotY = (Date.now() * 0.00012) % (Math.PI * 2);
    let rotX = Math.PI / 2 + Math.sin(Date.now() * 0.00008) * 0.15;

    const rotY2 = rotY;
    const rotX2 = Math.max(0.2, Math.min(Math.PI - 0.2, rotX));

    const cosA = Math.cos(rotX2);
    const sinA = Math.sin(rotX2);
    const cosY = Math.cos(rotY2);
    const sinY = Math.sin(rotY2);

    function project(x: number, y: number, z: number): { x: number; y: number; z: number } {
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y1 = y;
      const x2 = x1;
      const y2 = y1 * cosA - z1 * sinA;
      const z2 = y1 * sinA + z1 * cosA;
      return { x: x2, y: y2, z: z2 };
    }

    function toScreen(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
      const scale = GLOBE_RADIUS / (GLOBE_RADIUS + p.z * 0.5 + 160);
      return {
        x: cx + p.x * scale,
        y: cy + p.y * scale * 0.85,
        z: p.z,
      };
    }

    const projectedNodes = nodes.map((node) => {
      const p0 = nodePosition(node.latitude, node.longitude);
      const p = project(p0[0], p0[1] * 0.92, p0[2]);
      const screen = toScreen(p);
      return { node, screen, p, base: p0, index: -1 };
    }).filter((n) => n.screen.z > -60);

    projectedNodes.sort((a, b) => a.screen.z - b.screen.z);

    const arcPointsArr = events.map((evt) => {
      const fromNode = nodes.find((n) => n.id === evt.fromNodeId);
      if (!fromNode) return null;
      const toNode = evt.toNodeId ? nodes.find((n) => n.id === evt.toNodeId) : null;
      if (toNode) {
        return buildArcPoints(fromNode.latitude, fromNode.longitude, toNode.latitude, toNode.longitude);
      }
      const verticalOffset = evt.type === 'consensus-vote' ? 80 : 40;
      const destLat = fromNode.latitude;
      const destLon = fromNode.longitude + 1;
      const pts = buildArcPoints(fromNode.latitude, fromNode.longitude, destLat, destLon);
      return pts.map((p) => {
        const base = nodePosition(fromNode.latitude, fromNode.longitude);
        const dx = p[0] - base[0];
        const dy = p[1] - base[1];
        const dz = p[2] - base[2];
        return [p[0] + dx * 0.2, p[1] + dy * 0.2 + verticalOffset * 0.4, p[2] + dz * 0.2];
      });
    }).filter(Boolean) as [number, number, number][][];

    const sphereGrad = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, GLOBE_RADIUS * 1.35);
    sphereGrad.addColorStop(0, 'rgba(15,23,42,0.0)');
    sphereGrad.addColorStop(0.7, 'rgba(15,23,42,0.0)');
    sphereGrad.addColorStop(1, 'rgba(2,6,23,0.95)');
    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, GLOBE_RADIUS * 1.35, 0, Math.PI * 2);
    ctx.fill();

    const globeGrid = ctx.createRadialGradient(cx, cy, 40, cx, cy, GLOBE_RADIUS * 1.15);
    globeGrid.addColorStop(0, 'rgba(148,163,184,0.05)');
    globeGrid.addColorStop(0.6, 'rgba(148,163,184,0.10)');
    globeGrid.addColorStop(1, 'rgba(148,163,184,0.25)');
    ctx.strokeStyle = globeGrid;
    ctx.lineWidth = 1;
    for (let ring = 0; ring <= 6; ring++) {
      const r = (ring / 6) * GLOBE_RADIUS * 1.1;
      const p1 = nodePosition(0, 0, r);
      const p2 = project(p1[0], p1[1] * 0.92, p1[2]);
      const s2 = toScreen(p2);
      const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, r * 1.1);
      grad.addColorStop(0, 'rgba(148,163,184,0.04)');
      grad.addColorStop(1, 'rgba(148,163,184,0.06)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.95, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const meridians = 8;
    for (let m = 0; m < meridians; m++) {
      const lon = ((m / meridians) * 360) - 180;
      const steps = 20;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const lat = -90 + (i / steps) * 180;
        const p = nodePosition(lat, lon);
        const pr = project(p[0], p[1] * 0.92, p[2]);
        const s = toScreen(pr);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.08)';
      ctx.stroke();
    }

    const circles = 4;
    for (let c = 0; c < circles; c++) {
      const lat = -45 + c * 30;
      const steps = 40;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const lon = -180 + (i / steps) * 360;
        const p = nodePosition(lat, lon);
        const pr = project(p[0], p[1] * 0.92, p[2]);
        const s = toScreen(pr);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(56,217,169,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, GLOBE_RADIUS * 0.98, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, GLOBE_RADIUS * 1.05, 0, Math.PI * 2);
    ctx.stroke();

    for (const arcPts of arcPointsArr) {
      const projected = arcPts.map((pt) => {
        const pr = project(pt[0], pt[1] * 0.92, pt[2]);
        return toScreen(pr);
      });
      const alpha = 0.5 + Math.sin(Date.now() * 0.003 + arcPts[0][0]) * 0.25;
      ctx.beginPath();
      for (let i = 0; i < projected.length; i++) {
        const s = projected[i];
        const t = i / projected.length;
        const bright = Math.sin(t * Math.PI);
        const r = 56 + bright * 120;
        const g = 200 + bright * 55;
        const b = 255;
        ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${alpha * bright * 0.9})`;
        ctx.lineWidth = 2 + bright * 3;
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();

      const particleCount = 14;
      const step = 1 / particleCount;
      for (let i = 0; i < particleCount; i++) {
        const t = ((Date.now() * 0.0006 + i * step) % 1);
        const idx = t * (projected.length - 1);
        const floor = Math.floor(idx);
        const frac = idx - floor;
        const a = projected[Math.min(floor, projected.length - 1)];
        const b = projected[Math.min(floor + 1, projected.length - 1)];
        const x = a.x + (b.x - a.x) * frac;
        const y = a.y + (b.y - a.y) * frac;
        const size = 2 + Math.sin(t * Math.PI) * 3;
        const bright = Math.sin(t * Math.PI);
        const r = 56 + bright * 180;
        const g = 200 + bright * 55;
        const b = 255;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size * 1.8);
        grad.addColorStop(0, `rgba(${r|0},${g|0},${b|0},${bright * 0.95})`);
        grad.addColorStop(1, `rgba(${r|0},${g|0},${b|0},0.0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = 0; i < projectedNodes.length; i++) {
      const pn = projectedNodes[i];
      const s = pn.screen;
      const behind = pn.p.z < 0;
      if (behind && s.z < -60) continue;
      const pulse = 0.85 + Math.sin(Date.now() * 0.004 + i * 1.7) * 0.15;
      const baseSize = NODE_RADIUS * pulse;
      const color = nodeColorForTier(pn.node.hardwareTier);
      const uptimeColor = nodeColorForUptime(pn.node.uptime);

      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, baseSize * 2.2);
      glow.addColorStop(0, uptimeColor + '40');
      glow.addColorStop(1, uptimeColor + '00');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, baseSize * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(s.x, s.y, baseSize, 0, Math.PI * 2);
      ctx.fillStyle = uptimeColor;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.x, s.y, baseSize * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();

      const taskGlow = pn.node.activeTasks > 0 ? (1 + Math.sin(Date.now() * 0.005 + i)) * 0.5 : 0;
      if (taskGlow > 0.1) {
        const taskGlowR = ctx.createRadialGradient(s.x, s.y, baseSize, s.x, s.y, baseSize + 10 + taskGlow * 8);
        taskGlowR.addColorStop(0, `rgba(56,217,169,${taskGlow * 0.6})`);
        taskGlowR.addColorStop(1, 'rgba(56,217,169,0.0)');
        ctx.fillStyle = taskGlowR;
        ctx.beginPath();
        ctx.arc(s.x, s.y, baseSize + 10 + taskGlow * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    projectedNodes.forEach((pn, idx) => {
      const s = pn.screen;
      const padding = 14;
      const rectW = 210;
      const rectH = 140;
      const targetX = Math.min(width - rectW - padding, Math.max(padding, s.x - rectW / 2));
      const targetY = Math.min(height - rectH - padding, Math.max(padding, s.y - rectH - 20));
      setTooltipPos((prev) => ({ x: prev.x + (targetX - prev.x) * 0.2, y: prev.y + (targetY - prev.y) * 0.2 }));
    });

    const now = Date.now();
    frameCountRef.current += 1;
    if (now - lastFrameRef.current > 500) {
      setFps(Math.round((frameCountRef.current * 1000) / (now - lastFrameRef.current)));
      frameCountRef.current = 0;
      lastFrameRef.current = now;
    }

    animationRef.current = requestAnimationFrame(render);
  }, [width, height, nodes, events, setHoveredNode, setTooltipPos]);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [render]);

  useEffect(() => {
    if (!mounted) return;
    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [mounted, render]);

  const tooltipContent = hoveredNode ? (
    <div className="pointer-events-none absolute z-50 min-w-[200px] rounded-xl bg-white/80 backdrop-blur-xl p-4 shadow-2xl border border-white/20" style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translate(-50%, -100%)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{hoveredNode.label}</span>
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: nodeColorForUptime(hoveredNode.uptime) + '22', color: nodeColorForUptime(hoveredNode.uptime) }}>
          {hoveredNode.hardwareTier.toUpperCase()}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
        <div className="font-medium text-slate-500">Region</div>
        <div>{hoveredNode.region}</div>
        <div className="font-medium text-slate-500">Uptime</div>
        <div className="font-mono text-emerald-600">{(hoveredNode.uptime * 100).toFixed(2)}%</div>
        <div className="font-medium text-slate-500">Active tasks</div>
        <div className="font-mono">{hoveredNode.activeTasks}</div>
        <div className="font-medium text-slate-500">Latency</div>
        <div className="font-mono">{hoveredNode.latencyMs} ms</div>
        <div className="font-medium text-slate-500">Consensus weight</div>
        <div className="font-mono">{hoveredNode.consensusWeight.toFixed(2)}</div>
        <div className="font-medium text-slate-500">Last heartbeat</div>
        <div className="font-mono">{new Date(hoveredNode.lastHeartbeat).toLocaleTimeString()}</div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-200/70 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: String(hoveredNode.uptime * 100) + '%' }} />
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ width, height }}>
      <canvas ref={canvasRef} className="block w-full h-full" style={{ touchAction: 'none' }} />
      {tooltipContent ?? null}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
        <span className="opacity-40">·</span>
        <span className="font-mono">{fps} fps</span>
      </div>
    </div>
  );
}

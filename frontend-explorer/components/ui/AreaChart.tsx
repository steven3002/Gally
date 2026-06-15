"use client";

import { useRef, useState } from "react";
import type { Point } from "@/lib/types";
import { cn, monthDay } from "@/lib/format";

function toXY(values: number[], w: number, h: number, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);
  return values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
}

function pathFrom(pts: ReadonlyArray<readonly [number, number]>) {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

/**
 * Interactive area chart (FE-M7): hand-rolled SVG with a hover crosshair +
 * tooltip (value + timestamp) and a draw-in animation. Touch + mouse. Honors
 * `prefers-reduced-motion` via the global CSS gate. No chart library.
 */
export function AreaChart({
  data,
  color = "var(--primary)",
  height = 220,
  className,
  showDots = false,
  format,
}: {
  data: Point[];
  color?: string;
  height?: number;
  className?: string;
  showDots?: boolean;
  format?: (v: number) => string;
}) {
  const W = 600;
  const H = height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (!data || data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-2", className)}
        style={{ height }}
      >
        No series yet
      </div>
    );
  }

  const vals = data.map((d) => d.v);
  const pts = toXY(vals, W, H, 8);
  const id = `area-${color.replace(/[^a-z]/gi, "")}-${vals.length}`;
  const line = pathFrom(pts);
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${H} L${pts[0][0].toFixed(2)} ${H} Z`;
  const last = pts[pts.length - 1];
  const grid = [0.25, 0.5, 0.75].map((f) => 8 + (H - 16) * f);
  const hi = hover === null ? null : Math.max(0, Math.min(pts.length - 1, hover));

  function onMove(clientX: number) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (data.length - 1)));
  }

  return (
    <div
      ref={wrapRef}
      className={cn("relative", className)}
      style={{ height }}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      onTouchStart={(e) => onMove(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((y, i) => (
          <line key={i} x1="0" x2={W} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#${id})`} />
        <path
          d={line}
          pathLength={1}
          className="chart-draw"
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {showDots &&
          pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.4" fill={color} vectorEffect="non-scaling-stroke" />
          ))}
        {hi !== null && (
          <line x1={pts[hi][0]} x2={pts[hi][0]} y1="0" y2={H} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r="6.5" fill={color} opacity="0.18" vectorEffect="non-scaling-stroke" />
        {hi !== null && (
          <circle cx={pts[hi][0]} cy={pts[hi][1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {hi !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface px-2 py-1 text-[11px] shadow-[var(--shadow-md)]"
          style={{ left: `${(hi / (data.length - 1)) * 100}%` }}
        >
          <div className="tnum font-semibold text-foreground">
            {format ? format(data[hi].v) : data[hi].v.toLocaleString()}
          </div>
          <div className="text-muted-2">{monthDay(data[hi].t)}</div>
        </div>
      )}
    </div>
  );
}

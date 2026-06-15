import { cn } from "@/lib/format";

// Interactive area chart lives in its own client module (hover crosshair/tooltip).
export { AreaChart } from "./AreaChart";

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

/* ---------------------------------------------------------- Sparkline */

export function Sparkline({
  data,
  color = "var(--primary)",
  width = 120,
  height = 36,
  fill = true,
  className,
  strokeWidth = 1.8,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  if (!data || data.length < 2) return <div style={{ width, height }} className={className} />;
  const pts = toXY(data, width, height, 3);
  const id = `sl-${Math.round(pts[0][1] * 100)}-${data.length}-${Math.round(data[data.length - 1])}`;
  const line = pathFrom(pts);
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${height} L${pts[0][0].toFixed(2)} ${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------- BarChart */

export function BarChart({
  data,
  color = "var(--primary)",
  height = 160,
  className,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn("flex items-end gap-2", className)} style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-md transition-all"
              style={{
                height: `${Math.max(3, (d.value / max) * 100)}%`,
                background: color,
                opacity: 0.55 + 0.45 * (d.value / max),
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <span className="truncate text-[10px] text-muted-2">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Donut */

export function Donut({
  segments,
  size = 160,
  thickness = 18,
  center,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  // Precompute each arc's length and its cumulative start offset (no render-time mutation).
  const lengths = segments.map((s) => (s.value / total) * c);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${lengths[i]} ${c - lengths[i]}`}
            strokeDashoffset={-starts[i]}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center">{center}</div>}
    </div>
  );
}

/* --------------------------------------------------------- RingGauge */

export function RingGauge({
  value,
  size = 72,
  thickness = 8,
  color = "var(--primary)",
  label,
}: {
  value: number; // 0..100
  size?: number;
  thickness?: number;
  color?: string;
  label?: React.ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const len = (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${len} ${c - len}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {label && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
          {label}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { Category } from "@/lib/types";
import { cn, TONE_CLASS, type Tone } from "@/lib/format";
import {
  CatAgri,
  CatEnergy,
  CatHousing,
  CatInfra,
  CatMachinery,
  CatTrade,
} from "./icons";

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  as: As = "div",
  hover = false,
  "data-tour": dataTour,
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article";
  hover?: boolean;
  /** Optional product-tour spotlight anchor. */
  "data-tour"?: string;
}) {
  return (
    <As
      data-tour={dataTour}
      className={cn(
        "rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-sm)]",
        hover &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Pill */

export function Pill({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Stat block */

export function Stat({
  label,
  value,
  sub,
  delta,
  deltaTone,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: string;
  deltaTone?: "positive" | "danger" | "muted";
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[22px] font-semibold tracking-tight text-foreground">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "tnum text-xs font-semibold",
              deltaTone === "positive" && "text-positive",
              deltaTone === "danger" && "text-danger",
              (!deltaTone || deltaTone === "muted") && "text-muted",
            )}
          >
            {delta}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/* ---------------------------------------------------------- Progress bar */

export function ProgressBar({
  value,
  tone = "primary",
  className,
  height = "h-2",
}: {
  value: number; // 0..100
  tone?: Tone;
  className?: string;
  height?: string;
}) {
  const fill: Record<Tone, string> = {
    primary: "bg-primary",
    positive: "bg-positive",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    neutral: "bg-muted-2",
  };
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-surface-3", height, className)}>
      <div
        className={cn("h-full rounded-full transition-all", fill[tone])}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Avatar */

function hashAddr(a: string): number {
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  seed,
  label,
  size = 36,
  rounded = "rounded-xl",
  className,
}: {
  seed: string;
  label?: string;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const h = hashAddr(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 60 + (h % 80)) % 360;
  const initials =
    label
      ?.split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white",
        rounded,
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue1} 70% 56%), hsl(${hue2} 68% 48%))`,
      }}
    >
      {initials}
    </div>
  );
}

/* -------------------------------------------------------- Category badge */

const CAT_ICON: Record<Category, (p: { className?: string }) => ReactNode> = {
  Housing: CatHousing,
  Energy: CatEnergy,
  "Trade Finance": CatTrade,
  Agriculture: CatAgri,
  Machinery: CatMachinery,
  Infrastructure: CatInfra,
};

export function CategoryIcon({
  category,
  className = "h-4 w-4",
}: {
  category: Category;
  className?: string;
}) {
  const I = CAT_ICON[category];
  return <I className={className} />;
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
      <CategoryIcon category={category} className="h-3.5 w-3.5" />
      {category}
    </span>
  );
}

/* --------------------------------------------------------- Section header */

export function SectionHeader({
  title,
  subtitle,
  href,
  hrefLabel = "See all",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-xs font-semibold text-primary transition-colors hover:text-primary-strong"
        >
          {hrefLabel}
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Empty */

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted-2">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  );
}

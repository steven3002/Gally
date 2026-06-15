"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications, markRead, type AppNotification } from "@/lib/notifications";
import { cn, type Tone } from "@/lib/format";
import { Alert, Check, Close, Coins } from "@/components/ui/icons";

const TONE_BAR: Record<Tone, string> = {
  primary: "bg-primary",
  positive: "bg-positive",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-2",
};

const TONE_ICON: Record<Tone, React.ReactNode> = {
  positive: <Check className="h-4 w-4 text-positive" />,
  primary: <Coins className="h-4 w-4 text-primary" />,
  info: <Coins className="h-4 w-4 text-info" />,
  warning: <Alert className="h-4 w-4 text-warning" />,
  danger: <Alert className="h-4 w-4 text-danger" />,
  neutral: <Coins className="h-4 w-4 text-muted" />,
};

/**
 * Toast host (FE-M7.2). Mounted once in the shell. Watches the shared
 * notification store and surfaces newly-pushed transaction outcomes as transient
 * toasts (the same items live permanently in the bell). Seeded alerts do not
 * toast — only `kind === "tx"` outcomes do.
 */
export function Toaster() {
  const { items } = useNotifications();
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const router = useRouter();

  useEffect(() => {
    // First run: mark everything already-seen so a page load doesn't toast history.
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => i.kind === "tx" && !seen.current!.has(i.id));
    if (fresh.length === 0) return;
    fresh.forEach((i) => {
      seen.current!.add(i.id);
      setTimeout(() => dismiss(i.id), 5200);
    });
    setToasts((prev) => [...fresh, ...prev].slice(0, 4));
  }, [items]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="motion-safe:animate-rise pointer-events-auto flex overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)]"
        >
          <span className={cn("w-1 shrink-0", TONE_BAR[t.tone])} aria-hidden="true" />
          <button
            onClick={() => {
              markRead(t.id);
              dismiss(t.id);
              if (t.route) router.push(t.route);
            }}
            className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
          >
            <span className="mt-0.5 shrink-0">{TONE_ICON[t.tone]}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-xs text-muted">{t.body}</span>}
            </span>
          </button>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 px-2 text-muted-2 transition-colors hover:text-foreground"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

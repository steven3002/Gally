"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNotifications, markRead, type AppNotification } from "@/lib/notifications";
import { cn, relTime, type Tone } from "@/lib/format";
import { Alert, Bell, Check, Coins } from "@/components/ui/icons";

const DOT: Record<Tone, string> = {
  primary: "bg-primary",
  positive: "bg-positive",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-2",
};

const ICON: Record<Tone, React.ReactNode> = {
  positive: <Check className="h-4 w-4 text-positive" />,
  primary: <Coins className="h-4 w-4 text-primary" />,
  info: <Coins className="h-4 w-4 text-info" />,
  warning: <Alert className="h-4 w-4 text-warning" />,
  danger: <Alert className="h-4 w-4 text-danger" />,
  neutral: <Bell className="h-4 w-4 text-muted" />,
};

/**
 * The topbar bell + notification centre (FE-M7.2, spec §4). Real unread count
 * (not a hardcoded dot); items deep-link to the entity they concern; read/cleared
 * state persists via the shared store.
 */
export function NotificationBell() {
  const { items, unread, hydrated, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape or any pointer-down outside the bell/panel. A ref-based
  // outside-click is used instead of a fixed backdrop on purpose: the Topbar has
  // `backdrop-blur` (a backdrop-filter), which makes it the containing block for
  // any `position: fixed` child — so a `fixed inset-0` backdrop would only cover
  // the 64px header, not the viewport, and taps below it wouldn't close the panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {hydrated && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* On mobile the panel is pinned to the viewport (inset-x with margins)
              so it can never run off the right/left edge; on sm+ it drops down
              anchored to the bell. Outside-click + Escape handle dismissal. */}
          <div
            role="dialog"
            aria-label="Notifications"
            className={cn(
              "motion-safe:animate-rise z-50 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]",
              "fixed inset-x-3 top-[4.5rem]",
              "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] sm:max-w-[calc(100vw-2rem)]",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Notifications</span>
                {unread > 0 && (
                  <span className="tnum rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
                    {unread} new
                  </span>
                )}
              </div>
              {items.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={markAllRead}
                    className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    Mark read
                  </button>
                  <button
                    onClick={clearAll}
                    className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <div className="max-h-[70vh] overflow-y-auto sm:max-h-[28rem]">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <Bell className="h-7 w-7 text-muted-2" />
                  <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
                  <p className="max-w-[14rem] text-xs text-muted">
                    Yield, raise, and dispute alerts for your account — and your transaction
                    outcomes — show up here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => (
                    <NotificationRow key={n.id} n={n} onNavigate={() => setOpen(false)} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationRow({ n, onNavigate }: { n: AppNotification; onNavigate: () => void }) {
  const inner = (
    <span className="flex w-full items-start gap-3">
      <span className="mt-0.5 shrink-0">{ICON[n.tone]}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {!n.read && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[n.tone])} />}
          <span className={cn("truncate text-sm", n.read ? "font-medium text-muted" : "font-semibold text-foreground")}>
            {n.title}
          </span>
        </span>
        {n.body && <span className="mt-0.5 block text-xs text-muted">{n.body}</span>}
        <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-2">{relTime(n.tsMs)}</span>
      </span>
    </span>
  );

  const cls = cn("block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2", !n.read && "bg-surface-2/40");

  if (n.route) {
    return (
      <li>
        <Link href={n.route} onClick={() => { markRead(n.id); onNavigate(); }} className={cls}>
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button onClick={() => markRead(n.id)} className={cls}>
        {inner}
      </button>
    </li>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

/**
 * Module-level emitter so non-anchor navigations (the ⌘K palette / search, which
 * use `router.push`) can also kick the bar. Click navigations are caught by the
 * capture-phase listener below — together they cover every way to change route.
 */
const starters = new Set<() => void>();
export function startNavProgress() {
  starters.forEach((fn) => fn());
}

/**
 * A top-of-viewport progress bar that gives immediate feedback the instant a user
 * clicks a link, covering the otherwise-silent gap before a route's `loading.tsx`
 * skeleton appears (server round-trip on un-prefetched / dynamic routes). It
 * trickles toward 90% while pending and snaps to 100% when `usePathname` commits
 * the new route, then fades. Back/forward (no click, instant from cache) never
 * arms it, so the bar can't get stuck.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  const active = useRef(false);
  const lastPath = useRef(pathname);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyT = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearTimers() {
      if (trickle.current) clearInterval(trickle.current);
      if (hideT.current) clearTimeout(hideT.current);
      if (safetyT.current) clearTimeout(safetyT.current);
    }

    function start() {
      if (active.current) return;
      active.current = true;
      if (hideT.current) clearTimeout(hideT.current);
      setVisible(true);
      setWidth(8);
      trickle.current = setInterval(() => {
        setWidth((w) => (w < 90 ? w + Math.max(0.4, (90 - w) * 0.08) : w));
      }, 180);
      // Safety net: if a route somehow never commits, release the bar.
      safetyT.current = setTimeout(done, 10_000);
    }

    function done() {
      if (!active.current) return;
      active.current = false;
      if (trickle.current) clearInterval(trickle.current);
      if (safetyT.current) clearTimeout(safetyT.current);
      setWidth(100);
      hideT.current = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 280);
    }

    // Mark a global so the pathname-commit effect (below) can call done().
    completeRef.current = done;

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || href.startsWith("#") || (target && target !== "_self")) return;
      if (a.hasAttribute("download")) return;
      let dest: URL;
      try {
        dest = new URL(href, location.href);
      } catch {
        return;
      }
      if (dest.origin !== location.origin) return;
      if (dest.pathname + dest.search === location.pathname + location.search) return;
      start();
    }

    starters.add(start);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      starters.delete(start);
      document.removeEventListener("click", onClick, { capture: true });
      clearTimers();
    };
  }, []);

  // Route committed → finish the bar.
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      completeRef.current?.();
    }
  }, [pathname]);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className="h-full rounded-r-full bg-primary shadow-[0_0_8px_var(--primary)] transition-[width] duration-200 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// Bridges the click/emitter `done` closure to the pathname-commit effect.
const completeRef: { current: (() => void) | null } = { current: null };

"use client";

// DEV-M1 — a lightweight, zero-dependency product tour (matches the repo's hand-rolled
// dark-mode aesthetic; no external tour lib, consistent with guard_rails §3 "zero UI deps").
//
// A spotlight overlay dims the page except the current step's target element (found by its
// `data-tour="<anchor>"` attribute) and floats a tooltip card with the explanation + step
// controls. The user can go Back/Next, **Skip**, or **Free Explore** (stop) at any time.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Close } from "@/components/ui/icons";

export interface TourStep {
  /** `data-tour` value of the element to spotlight; "" → a centered, anchorless step. */
  anchor: string;
  title: string;
  body: string;
}

interface TourCtx {
  active: boolean;
  index: number;
  steps: TourStep[];
  start: (steps: TourStep[]) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

const Ctx = createContext<TourCtx | null>(null);

export function useTour(): TourCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTour must be used inside <TourProvider>");
  return c;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(-1);
  const active = index >= 0 && index < steps.length;

  const start = useCallback((s: TourStep[]) => {
    if (s.length === 0) return;
    setSteps(s);
    setIndex(0);
  }, []);
  const stop = useCallback(() => setIndex(-1), []);
  const next = useCallback(() => setIndex((i) => (i + 1 >= steps.length ? -1 : i + 1)), [steps.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  return (
    <Ctx.Provider value={{ active, index, steps, start, next, prev, stop }}>
      {children}
      <TourOverlay />
    </Ctx.Provider>
  );
}

const PAD = 8; // spotlight padding around the target

function TourOverlay() {
  const { active, index, steps, next, prev, stop } = useTour();
  const step = active ? steps[index] : null;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!step) return;
    let raf = 0;
    // setState happens only inside these deferred callbacks (rAF / timeout / listeners),
    // never synchronously in the effect body (react-hooks/set-state-in-effect).
    const locate = () => {
      const el = step.anchor ? (document.querySelector(`[data-tour="${step.anchor}"]`) as HTMLElement | null) : null;
      setRect(el ? el.getBoundingClientRect() : null);
      return el;
    };
    raf = requestAnimationFrame(() => {
      const el = locate();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const t = setTimeout(locate, 340); // re-measure after the scroll settles
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [step]);

  // Esc = Free Explore.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, stop, next, prev]);

  if (!step) return null;

  const last = index === steps.length - 1;

  // Spotlight box (or a centered card when there's no anchor / element missing).
  const spot = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  // Tooltip placement: to the right of the spotlight if it fits, else below, else centered.
  const TT_W = 320;
  let ttStyle: React.CSSProperties;
  if (spot) {
    const rightFits = spot.left + spot.width + 16 + TT_W < window.innerWidth;
    if (rightFits) {
      ttStyle = { top: Math.max(16, spot.top), left: spot.left + spot.width + 16, width: TT_W };
    } else {
      const below = spot.top + spot.height + 16;
      ttStyle = { top: Math.min(below, window.innerHeight - 220), left: Math.min(Math.max(16, spot.left), window.innerWidth - TT_W - 16), width: TT_W };
    }
  } else {
    ttStyle = { top: "50%", left: "50%", width: TT_W, transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[100]" aria-live="polite" role="dialog" aria-label="Product tour">
      {/* Dimmer + spotlight cutout (a single box with a giant ring-shadow dims the rest). */}
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary/70 transition-all duration-300"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(2,6,23,0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(2,6,23,0.72)]" />
      )}

      {/* Tooltip card */}
      <div
        className="absolute rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-lg)] animate-[gally-rise_180ms_ease-out]"
        style={ttStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Tour · {index + 1} of {steps.length}
          </div>
          <button onClick={stop} aria-label="Skip tour" className="rounded-md p-0.5 text-muted-2 transition-colors hover:text-foreground">
            <Close className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-1.5 text-sm font-bold text-foreground">{step.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{step.body}</p>

        {/* Progress dots */}
        <div className="mt-3 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-primary" : "w-1.5 bg-border-strong"}`} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button onClick={stop} className="text-[11px] font-medium text-muted-2 transition-colors hover:text-foreground">
            Free explore
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={prev}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary shadow-sm transition-transform hover:scale-[1.02]"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

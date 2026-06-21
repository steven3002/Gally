"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format";
import { Close } from "@/components/ui/icons";

// `mounted` is false during SSR / the first hydration pass and true thereafter, so the
// portal only resolves once `document.body` exists — without a setState-in-effect.
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Centered dialog rendered through a portal on `document.body`.
 *
 * The portal is load-bearing, not cosmetic. Action triggers live inside cards that
 * apply a `hover:-translate-y` transform, and a CSS `transform` on ANY ancestor makes
 * that ancestor the containing block for `position: fixed` descendants. Rendered
 * inline, a `fixed inset-0` modal therefore anchors to (and jiggles with) the hovered
 * card instead of the viewport — and flickers between the two as hover toggles.
 * Portalling to <body> escapes every transformed ancestor, so the modal is always
 * centered on the viewport.
 *
 * Also owns the shared modal chrome: backdrop, ESC-to-close (suppressed while busy),
 * background scroll-lock, and the header (title + optional subtitle + close) / scrollable
 * body / optional footer layout. Callers supply only the body + footer content.
 */
export function Modal({
  open,
  onClose,
  label,
  subtitle,
  busy = false,
  size = "md",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog name (`aria-label`) and visible title. */
  label: string;
  /** Optional sub-line under the title (e.g. the Move entry path). */
  subtitle?: ReactNode;
  /** While true, ESC / backdrop / close are inert (a tx is in flight). */
  busy?: boolean;
  size?: "md" | "lg";
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Portals need the DOM; render nothing until mounted on the client.
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, busy, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        className="absolute inset-0 cursor-default bg-black/50 motion-safe:animate-fade"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => !busy && onClose()}
      />
      <div
        className={cn(
          "motion-safe:animate-pop relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]",
          size === "lg" ? "max-w-lg" : "max-w-md",
        )}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{label}</h3>
            {subtitle && <div className="mt-0.5 truncate">{subtitle}</div>}
          </div>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-2 transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Close className="h-5 w-5" />
          </button>
        </div>

        {/* body (scrolls if tall) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

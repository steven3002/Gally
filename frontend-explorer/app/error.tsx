"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/icons";

/** Friendly render-error boundary (FE-M7). Catches unexpected failures so a page
 *  crash degrades gracefully instead of a blank screen. */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <Alert className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          An unexpected error occurred while rendering this view. You can retry, or go back to
          explore.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={reset}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-strong"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          Back to explore
        </Link>
      </div>
    </div>
  );
}

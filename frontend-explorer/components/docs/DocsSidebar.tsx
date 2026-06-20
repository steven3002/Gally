"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs/nav.generated";
import { cn } from "@/lib/format";
import { ArrowRight, Search, Doc } from "@/components/ui/icons";
import { OPEN_DOCS_SEARCH } from "./events";

/**
 * The docs left sidebar. On /docs routes the AppShell renders this *instead of*
 * the app nav (so there's a single left sidebar), with a "Back to Explorer" link
 * so the rest of the app stays reachable.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      {/* Header — return to the app + section title */}
      <div className="border-b border-border px-4 py-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Back to Explorer
        </Link>
        <div className="mt-3 flex items-center gap-2 text-foreground">
          <Doc className="h-5 w-5 text-primary" />
          <span className="text-base font-semibold tracking-tight">Documentation</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <button
          onClick={() => window.dispatchEvent(new Event(OPEN_DOCS_SEARCH))}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-sm text-muted-2 transition-colors hover:border-border-strong"
          aria-label="Search documentation"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">Search docs…</span>
          <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium">/</kbd>
        </button>
      </div>

      {/* Four-part page tree */}
      <nav aria-label="Documentation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {DOCS_NAV.map((g) => (
          <div key={g.part}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
              {g.part}
            </div>
            <ul className="space-y-0.5">
              {g.pages.map((p) => {
                const active = pathname === p.route;
                return (
                  <li key={p.route}>
                    <Link
                      href={p.route}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-primary-soft font-medium text-primary"
                          : "text-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {p.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs/nav.generated";
import { cn } from "@/lib/format";
import { ArrowRight, Search, Doc, ChevronDown } from "@/components/ui/icons";
import { OPEN_DOCS_SEARCH } from "./events";

/**
 * The docs left sidebar. On /docs routes the AppShell renders this *instead of*
 * the app nav (so there's a single left sidebar), with a "Back to Explorer" link
 * so the rest of the app stays reachable. Parts are collapsible; pages are
 * indented under their part with a tree guide so subsections read at a glance.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (part: string) => setCollapsed((c) => ({ ...c, [part]: !c[part] }));

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
          <span className="text-lg font-semibold tracking-tight">Documentation</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <button
          data-tour="docs-search"
          onClick={() => window.dispatchEvent(new Event(OPEN_DOCS_SEARCH))}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-sm text-muted-2 transition-colors hover:border-border-strong"
          aria-label="Search documentation"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">Search docs…</span>
          <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium">/</kbd>
        </button>
      </div>

      {/* Four-part page tree — collapsible sections, indented pages */}
      <nav data-tour="docs-nav" aria-label="Documentation" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {DOCS_NAV.map((g) => {
          const isCollapsed = collapsed[g.part];
          const hasActive = g.pages.some((p) => pathname === p.route);
          return (
            <div key={g.part}>
              <button
                onClick={() => toggle(g.part)}
                aria-expanded={!isCollapsed}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                  hasActive ? "text-foreground" : "text-muted-2 hover:text-foreground",
                )}
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isCollapsed && "-rotate-90")}
                />
                {g.part}
              </button>
              {!isCollapsed && (
                <ul className="ml-[1.05rem] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                  {g.pages.map((p) => {
                    const active = pathname === p.route;
                    return (
                      <li key={p.route}>
                        <Link
                          href={p.route}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "-ml-[calc(0.625rem+1px)] block border-l-2 py-1.5 pl-[calc(0.625rem+1px)] pr-2.5 text-[13.5px] transition-colors",
                            active
                              ? "border-primary font-medium text-primary"
                              : "border-transparent text-muted hover:text-foreground",
                          )}
                        >
                          {p.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

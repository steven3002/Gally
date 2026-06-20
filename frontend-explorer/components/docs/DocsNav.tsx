"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { Search, ChevronDown } from "@/components/ui/icons";
import type { DocNavGroup } from "@/lib/docs";
import { OPEN_DOCS_SEARCH } from "./DocsSearch";

function NavList({ groups, pathname, onNavigate }: { groups: DocNavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
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
    </div>
  );
}

function SearchButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_DOCS_SEARCH))}
      className="mb-4 flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-muted-2 transition-colors hover:border-border-strong"
      aria-label="Search documentation"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">Search docs…</span>
      <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">/</kbd>
    </button>
  );
}

export function DocsNav({ groups }: { groups: DocNavGroup[] }) {
  const pathname = usePathname();
  return (
    <>
      {/* Mobile: collapsible menu */}
      <details className="mb-6 rounded-xl border border-border bg-surface lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-foreground">
          <span>Documentation menu</span>
          <ChevronDown className="h-4 w-4 text-muted-2" />
        </summary>
        <div className="border-t border-border p-3">
          <SearchButton />
          <NavList groups={groups} pathname={pathname} />
        </div>
      </details>

      {/* Desktop: sticky sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          <SearchButton />
          <NavList groups={groups} pathname={pathname} />
        </div>
      </aside>
    </>
  );
}

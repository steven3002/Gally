"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import type { DocHeading } from "@/lib/docs";

export function OnThisPage({ headings }: { headings: DocHeading[] }) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3);
  const [activeSlug, setActiveSlug] = useState<string>("");

  useEffect(() => {
    if (items.length === 0) return;
    const els = items
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSlug(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <aside className="hidden xl:block">
      <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <div className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
          On this page
        </div>
        <ul className="space-y-1 border-l border-border">
          {items.map((h) => (
            <li key={h.slug}>
              <a
                href={`#${h.slug}`}
                className={cn(
                  "-ml-px block border-l-2 py-1 text-[12px] leading-snug transition-colors",
                  h.depth === 3 ? "pl-5" : "pl-3",
                  activeSlug === h.slug
                    ? "border-primary font-medium text-primary"
                    : "border-transparent text-muted-2 hover:text-foreground",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

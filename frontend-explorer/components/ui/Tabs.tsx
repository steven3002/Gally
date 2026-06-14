"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

export interface TabDef {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
              active === t.id ? "text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-1.5">
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "tnum rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    active === t.id ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted-2",
                  )}
                >
                  {t.count}
                </span>
              )}
            </span>
            {active === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
      <div className="pt-5">{current?.content}</div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { EventFeed, ProtocolEvent } from "@/lib/types";
import { cn } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { EventList } from "./EventList";

const FILTERS: { id: EventFeed | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "position", label: "Positions" },
  { id: "revenue", label: "Revenue" },
  { id: "validator", label: "Validators" },
  { id: "dispute", label: "Disputes" },
];

export function ActivityFeed({ allEvents }: { allEvents: ProtocolEvent[] }) {
  const [feed, setFeed] = useState<EventFeed | "all">("all");

  const events = useMemo<ProtocolEvent[]>(
    () => (feed === "all" ? allEvents : allEvents.filter((e) => e.feed === feed)),
    [allEvents, feed],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.id === "all" ? allEvents.length : allEvents.filter((e) => e.feed === f.id).length;
          return (
            <button
              key={f.id}
              onClick={() => setFeed(f.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                feed === f.id
                  ? "border-primary bg-primary text-on-primary"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "tnum rounded-full px-1.5 text-[10px] font-semibold",
                  feed === f.id ? "bg-white/20" : "bg-surface-2 text-muted-2",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <Card>
        {/* key={feed} remounts on filter change so paging resets to page 1 */}
        <EventList key={feed} events={events} pageSize={20} />
      </Card>
    </div>
  );
}

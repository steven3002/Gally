"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "./icons";
import { cn, shortAddr } from "@/lib/format";
import { routeForId } from "@/lib/mock/registry";

/**
 * A clickable, copyable on-chain identifier (FE-M2). Resolves any id/address/tx
 * digest to its canonical explorer route so the whole graph is traversable —
 * the replacement for copy-only chips. Keeps the copy affordance.
 */
export function IdLink({
  id,
  label,
  lead = 6,
  tail = 4,
  mono = true,
  copyable = true,
  className,
}: {
  id: string;
  label?: string;
  lead?: number;
  tail?: number;
  mono?: boolean;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const route = routeForId(id);
  const text = label ?? (id.length > lead + tail + 2 ? shortAddr(id, lead, tail) : id);

  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(id).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <Link
        href={route}
        title={id}
        className={cn(
          "rounded text-muted transition-colors hover:text-primary hover:underline",
          mono && "font-mono text-[11px]",
          className,
        )}
      >
        {text}
      </Link>
      {copyable && (
        <button
          onClick={copy}
          aria-label="Copy id"
          className="text-muted-2 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          {copied ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </span>
  );
}

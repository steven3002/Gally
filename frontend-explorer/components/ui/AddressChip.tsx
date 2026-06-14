"use client";

import { useState } from "react";
import { Check, Copy } from "./icons";
import { cn, shortAddr } from "@/lib/format";

export function AddressChip({
  address,
  label,
  className,
  lead = 6,
  tail = 4,
}: {
  address: string;
  label?: string;
  className?: string;
  lead?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  }

  return (
    <button
      onClick={copy}
      title={address}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      {label && <span className="font-sans font-medium text-muted-2">{label}</span>}
      {shortAddr(address, lead, tail)}
      {copied ? (
        <Check className="h-3 w-3 text-positive" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

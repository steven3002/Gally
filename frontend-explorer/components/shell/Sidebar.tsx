"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "./nav";
import { Logo, Close } from "@/components/ui/icons";
import { cn } from "@/lib/format";
import { protocolStats, protocolConfig } from "@/lib/mock/data";
import { usdCompact } from "@/lib/format";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate}>
          <Logo className="h-8 w-8" />
          <div className="leading-none">
            <div className="text-[15px] font-bold tracking-tight text-foreground">Gally</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-2">
              Capital Explorer
            </div>
          </div>
        </Link>
        {onNavigate && (
          <button
            onClick={onNavigate}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden"
            aria-label="Close menu"
          >
            <Close className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
              {group.label}
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary-soft text-primary"
                          : "text-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                      )}
                      <Icon className="h-[18px] w-[18px]" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* TVL mini-card */}
      <div className="px-3 pb-3">
        <div className="rounded-2xl border border-border bg-surface-2 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted">Protocol TVL</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-positive">
              <span className="h-1.5 w-1.5 animate-livedot rounded-full bg-positive" />
              live
            </span>
          </div>
          <div className="tnum mt-1 text-xl font-bold tracking-tight text-foreground">
            {usdCompact(protocolStats.tvl)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            {protocolStats.activeAssets} active assets · {protocolStats.validators} validators
          </div>
        </div>
      </div>

      {/* Network footer */}
      <div className="border-t border-border px-5 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          {protocolConfig.network}
          <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5 font-medium text-muted-2">
            v{protocolConfig.version}
          </span>
        </div>
      </div>
    </div>
  );
}

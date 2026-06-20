"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PauseBanner } from "./PauseBanner";
import { NavigationProgress } from "./NavigationProgress";
import { CommandPalette } from "@/components/search/CommandPalette";
import { Toaster } from "@/components/notifications/Toaster";
import { DevnetBanner } from "@/components/onboarding/DevnetBanner";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { isLive } from "@/lib/data";
import { cn } from "@/lib/format";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [prevPath, setPrevPath] = useState(pathname);

  // Close the mobile drawer on route change — adjust state during render, the
  // React-recommended alternative to a setState-in-effect.
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Top-of-viewport navigation progress (instant click feedback) */}
      <NavigationProgress />

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={cn(
            "absolute left-0 top-0 h-full w-[280px] border-r border-border bg-surface shadow-xl transition-transform duration-300",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </aside>
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <DevnetBanner />
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <PauseBanner />
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette />

      {/* Transaction & alert toasts (FE-M7.2) */}
      <Toaster />

      {/* DEV-M1 — Devnet first-time onboarding (claim tokens + guided tour); live only. */}
      {isLive && <Onboarding />}
    </div>
  );
}

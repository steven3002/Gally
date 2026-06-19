"use client";

// FE-M8a — WebSocket read-deltas (client-only).
//
// Subscribes to the BI-M8 live-push hub (`/ws/assets/:id`, `/ws/portfolio/:addr`,
// `/ws/disputes/:id`) and surfaces a small "live tick" the read surfaces can use to
// re-pull without a reload. In mock mode the hook is inert (returns 0), so components
// stay identical offline. No reconnect storm: one socket per channel, closed on unmount.

import { useEffect, useRef, useState } from "react";
import { INDEXER_URL, isLive } from "./index";

export type WsChannel = "assets" | "portfolio" | "disputes";

function wsUrl(channel: WsChannel, id: string): string {
  const base = INDEXER_URL.replace(/^http/, "ws");
  return `${base}/ws/${channel}/${id}`;
}

/**
 * Returns a monotonically increasing counter that bumps on each live message for the
 * channel. Components key a refresh effect off it. Inert (always 0) in mock mode.
 */
export function useLiveTicks(channel: WsChannel, id: string | null | undefined): number {
  const [ticks, setTicks] = useState(0);
  const ref = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isLive || !id || typeof window === "undefined") return;
    let closed = false;
    let sock: WebSocket | null = null;
    try {
      sock = new WebSocket(wsUrl(channel, id));
      ref.current = sock;
      sock.onmessage = () => {
        if (!closed) setTicks((t) => t + 1);
      };
      // Errors are non-fatal — the page still has its initial server-rendered snapshot.
      sock.onerror = () => {};
    } catch {
      /* degrade silently */
    }
    return () => {
      closed = true;
      try {
        sock?.close();
      } catch {}
      ref.current = null;
    };
  }, [channel, id]);

  return ticks;
}

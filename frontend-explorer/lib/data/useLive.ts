"use client";

// FE-M8a — Client-side live-or-mock hook for the few SHELL widgets that live inside
// the client tree (sidebar stats, pause banner) and so can't receive server-fetched
// props. In mock mode it returns the fallback synchronously (effect skipped) → the
// offline build + e2e are byte-identical. In live mode it fetches through the data
// seam and swaps the value in (the fallback shows for one frame as a placeholder).

import { useEffect, useState } from "react";
import { isLive } from "./index";

export function useLive<T>(fallback: T, fetcher: () => Promise<T>): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    if (!isLive) return;
    let alive = true;
    fetcher()
      .then((r) => {
        if (alive) setValue(r);
      })
      .catch(() => {
        /* keep the fallback on failure (graceful degradation) */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return isLive ? value : fallback;
}

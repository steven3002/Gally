"use client";

// DEV-M1 polish — a FUN, random NFT-style profile picture for the connected user.
// No storage: a fresh random creature/character pfp is picked per PAGE LOAD. The choice
// is cached at module scope keyed by address, so EVERY mount of this address in the same
// load (the topbar chip + the portfolio header + the menu) renders the SAME image — they
// always match. A full reload re-seeds the module → a new random pfp. Client-only (SSR +
// first paint render the deterministic Avatar, so there's no hydration mismatch), then the
// NFT image swaps in; if the image service is unreachable it falls back to the generated
// Avatar. CORS-friendly generators (DiceBear / Robohash) — reliable + instant.

import { useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/primitives";

const STYLES: ((seed: string) => string)[] = [
  (s) => `https://api.dicebear.com/9.x/bottts/svg?seed=${s}`,
  (s) => `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${s}`,
  (s) => `https://api.dicebear.com/9.x/adventurer/svg?seed=${s}`,
  (s) => `https://api.dicebear.com/9.x/thumbs/svg?seed=${s}`,
  (s) => `https://robohash.org/${s}.png?set=set2&size=160x160`, // monsters
  (s) => `https://robohash.org/${s}.png?set=set4&size=160x160`, // critters
];

// One random pfp per address per page load — shared across every instance so the
// connect-button icon and the profile icon are always identical at any given time.
const pfpCache = new Map<string, string>();
function pfpFor(address: string): string {
  const key = address || "anon";
  let url = pfpCache.get(key);
  if (!url) {
    const seed = Math.random().toString(36).slice(2, 10);
    url = STYLES[Math.floor(Math.random() * STYLES.length)](seed);
    pfpCache.set(key, url);
  }
  return url;
}

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function RandomNftAvatar({
  address,
  size = 56,
  rounded = "rounded-2xl",
  label,
}: {
  address: string;
  size?: number;
  rounded?: string;
  label?: string;
}) {
  const mounted = useMounted();
  // Random per page load, but shared across every instance of this address (module cache)
  // so the topbar chip and the profile avatar always show the same image. Client-only, so
  // it never participates in SSR/hydration.
  const [src] = useState(() => pfpFor(address));
  const [failed, setFailed] = useState(false);

  if (!mounted || failed) return <Avatar seed={address} size={size} rounded={rounded} label={label} />;

  return (
    // External avatar service — next/image isn't worth a remotePatterns config for a
    // throwaway random pfp; graceful onError fallback to the generated Avatar.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Your profile"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`${rounded} bg-surface-2 object-cover ring-1 ring-border`}
      style={{ width: size, height: size }}
    />
  );
}

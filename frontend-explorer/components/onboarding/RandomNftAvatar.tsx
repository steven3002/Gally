"use client";

// DEV-M1 polish — a FUN, always-random NFT-style profile picture for the connected user.
// No storage: a fresh random creature/character pfp is picked on each mount. Client-only
// (SSR + first paint render the deterministic Avatar, so there's no hydration mismatch),
// then the NFT image swaps in; if the image service is unreachable it falls back to the
// generated Avatar. CORS-friendly generators (DiceBear / Robohash) — reliable + instant.

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
  // Random each mount (the "always-random NFT pfp" ask) — client-only, so it never
  // participates in SSR/hydration.
  const [src] = useState(() => {
    const seed = Math.random().toString(36).slice(2, 10);
    return STYLES[Math.floor(Math.random() * STYLES.length)](seed);
  });
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

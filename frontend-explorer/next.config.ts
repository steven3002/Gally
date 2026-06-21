import type { NextConfig } from "next";

// Same-origin proxy to the BI-M8 indexer. Client components (sidebar TVL, the
// notification bell, the connected-wallet portfolio) fetch from the BROWSER, where
// `127.0.0.1:8088` is the user's own machine — unreachable over an SSH tunnel, so those
// widgets silently fell back to mock data (the "sidebar TVL ≠ real TVL" bug). Routing
// client reads through `/_idx/*` on the frontend origin means the browser only ever
// talks to the one port it already reaches; the Next server (co-located with the
// indexer) forwards to localhost. SSR keeps using the absolute URL directly.
const INDEXER_PROXY_TARGET = (
  process.env.INDEXER_PROXY_TARGET ??
  process.env.NEXT_PUBLIC_INDEXER_URL ??
  "http://127.0.0.1:8088"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/_idx/:path*", destination: `${INDEXER_PROXY_TARGET}/:path*` }];
  },
  // Next 16 dev server blocks cross-origin access to dev resources (HMR + client
  // chunks) by default — which silently breaks ALL client interactivity (the Connect
  // wallet button, forms, …) when the app is opened from a forwarded/remote host rather
  // than localhost. Allow the hosts the showcase is reached through. (Dev-only; the
  // production server has no such restriction.)
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "172.31.39.159",
    "*.amazonaws.com",
    "*.compute.amazonaws.com",
  ],
};

export default nextConfig;

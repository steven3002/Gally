import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

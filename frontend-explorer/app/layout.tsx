import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { isLive } from "@/lib/data";
import { WalletProviders } from "@/components/providers/WalletProviders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gally Explorer — RWA Capital Protocol",
  description:
    "Explore real-world asset raises, validator attestations, yield distribution and disputes on the Gally Capital Protocol.",
};

// Set the theme before paint to avoid a flash of the wrong color scheme.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('gally-theme');
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        {/* Live mode mounts the dapp-kit wallet stack; mock mode renders the exact
            same tree as before (no provider), so SSR + the e2e suite are unaffected. */}
        {isLive ? (
          <WalletProviders>
            <AppShell>{children}</AppShell>
          </WalletProviders>
        ) : (
          <AppShell>{children}</AppShell>
        )}
      </body>
    </html>
  );
}

"use client";

// FE-M8b — dapp-kit wallet stack (mounted ONLY in live mode by the root layout, so
// the mock build never loads it and the e2e suite/SSR are untouched).
//
// `<ConnectButton>`/`<ConnectModal>` (used in the topbar) auto-detect installed Sui
// wallets — Slush and any wallet-standard extension — and offer the Slush web option
// when nothing is installed; we don't hand-roll wallet discovery (the wallet standard
// does it). `autoConnect` re-links the last wallet on reload.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider, createNetworkConfig } from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";
import { SUI_NETWORK, SUI_RPC_URL } from "@/lib/tx/config";

const { networkConfig } = createNetworkConfig({
  localnet: { url: SUI_RPC_URL, network: "localnet" },
  testnet: { url: "https://fullnode.testnet.sui.io:443", network: "testnet" },
  mainnet: { url: "https://fullnode.mainnet.sui.io:443", network: "mainnet" },
});

const queryClient = new QueryClient();

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const defaultNetwork = (["localnet", "testnet", "mainnet"].includes(SUI_NETWORK) ? SUI_NETWORK : "localnet") as "localnet" | "testnet" | "mainnet";
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={defaultNetwork}>
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

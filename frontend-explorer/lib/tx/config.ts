// FE-M8b — Live transaction/network config (env).
//
// Populated when the explorer runs against a live chain (the SIM soak node, then
// testnet). Empty by default so the mock build needs nothing. `requireTxConfig`
// throws a clear error if a live action is attempted without the IDs wired.

export const SUI_RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC ?? "http://127.0.0.1:9000";
export const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "localnet";
export const GALLY_PACKAGE_ID = process.env.NEXT_PUBLIC_GALLY_PACKAGE_ID ?? "";
export const PROTOCOL_CONFIG_ID = process.env.NEXT_PUBLIC_PROTOCOL_CONFIG_ID ?? "";

/** On a public faucet-enabled test network (devnet OR testnet)? Drives the onboarding
 *  banner + claim-tokens button. */
export const IS_DEVNET = SUI_NETWORK === "devnet" || SUI_NETWORK === "testnet";

/** Current network as a display label, capitalised ("Testnet" / "Devnet" / "Mainnet"). */
export const NETWORK_LABEL = SUI_NETWORK.charAt(0).toUpperCase() + SUI_NETWORK.slice(1);

/** The standalone `usdc` package (canonical USDC type provider — the Devnet proxy). */
export const USDC_PACKAGE_ID = process.env.NEXT_PUBLIC_USDC_PACKAGE_ID ?? GALLY_PACKAGE_ID;

/**
 * The USDC coin type. Since the USDC swap, USDC lives in its OWN `usdc` package
 * (`usdc::usdc::USDC`) — Circle's on mainnet, the mintable proxy on localnet/devnet —
 * so we resolve it from `USDC_PACKAGE_ID`, not gally_core.
 */
export const USDC_TYPE = process.env.NEXT_PUBLIC_USDC_TYPE ?? (USDC_PACKAGE_ID ? `${USDC_PACKAGE_ID}::usdc::USDC` : "");

/** The `gally_mock_faucet` package + its shared `MockFaucet` (the Devnet token tap). */
export const FAUCET_PACKAGE_ID = process.env.NEXT_PUBLIC_FAUCET_PACKAGE_ID ?? "";
export const MOCK_FAUCET_ID = process.env.NEXT_PUBLIC_MOCK_FAUCET_ID ?? "";

export interface TxConfigEnv {
  packageId: string;
  configId: string;
}

export function requireTxConfig(): TxConfigEnv {
  if (!GALLY_PACKAGE_ID || !PROTOCOL_CONFIG_ID) {
    throw new Error("live transactions need NEXT_PUBLIC_GALLY_PACKAGE_ID and NEXT_PUBLIC_PROTOCOL_CONFIG_ID");
  }
  return { packageId: GALLY_PACKAGE_ID, configId: PROTOCOL_CONFIG_ID };
}

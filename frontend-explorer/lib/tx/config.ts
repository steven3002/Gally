// FE-M8b — Live transaction/network config (env).
//
// Populated when the explorer runs against a live chain (the SIM soak node, then
// testnet). Empty by default so the mock build needs nothing. `requireTxConfig`
// throws a clear error if a live action is attempted without the IDs wired.

export const SUI_RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC ?? "http://127.0.0.1:9000";
export const SUI_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "localnet";
export const GALLY_PACKAGE_ID = process.env.NEXT_PUBLIC_GALLY_PACKAGE_ID ?? "";
export const PROTOCOL_CONFIG_ID = process.env.NEXT_PUBLIC_PROTOCOL_CONFIG_ID ?? "";

/** The USDC coin type. In the SIM-D1 profile this is the mock USDC inside gally_core. */
export const USDC_TYPE = process.env.NEXT_PUBLIC_USDC_TYPE ?? (GALLY_PACKAGE_ID ? `${GALLY_PACKAGE_ID}::usdc::USDC` : "");

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

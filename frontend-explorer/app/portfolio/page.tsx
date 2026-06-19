import { AddressView } from "@/components/address/AddressView";
import { ConnectedPortfolio } from "@/components/address/ConnectedPortfolio";
import { DEMO_WALLET } from "@/lib/mock/data";
import { isLive } from "@/lib/data";

// The portfolio is the connected-wallet view of the universal address surface.
// - Mock build: the DEMO_WALLET view (mock Position selector) — unchanged from FE-M7.2.
// - Live build (FE-M8b): the CONNECTED wallet's real owned objects (deeds/wrapped/
//   claimable) read over RPC; when no wallet is connected it falls back to the demo view
//   as a labelled preview.
export default function PortfolioPage() {
  if (isLive) return <ConnectedPortfolio fallback={<AddressView address={DEMO_WALLET} demo />} />;
  return <AddressView address={DEMO_WALLET} demo />;
}

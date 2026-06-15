import { AddressView } from "@/components/address/AddressView";
import { DEMO_WALLET } from "@/lib/mock/data";

// The portfolio is the DEMO_WALLET view of the universal address surface — one
// implementation, with the "demo wallet" framing + (non-functional) claim banner.
export default function PortfolioPage() {
  return <AddressView address={DEMO_WALLET} demo />;
}

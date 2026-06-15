import { AddressView } from "@/components/address/AddressView";
import { accounts } from "@/lib/mock/accounts";

// Prerender the known roster; any other 0x… address renders on demand (an
// explorer resolves ANY address, labelled or not).
export function generateStaticParams() {
  return accounts.map((a) => ({ addr: a.address }));
}

export default async function AddressPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  return <AddressView address={decodeURIComponent(addr)} />;
}

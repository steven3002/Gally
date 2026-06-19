import { PageHeader } from "@/components/PageHeader";
import { AssetsExplorer } from "@/components/asset/AssetsExplorer";
import { data } from "@/lib/data";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const assets = await data.listAssets();

  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Every real-world project raised, executing, or distributing yield on Gally."
        crumbs={[{ label: "Explore", href: "/" }, { label: "Assets" }]}
      />
      <AssetsExplorer initialCategory={category} assets={assets} />
    </div>
  );
}

import { PageHeader } from "@/components/PageHeader";
import { AssetsExplorer } from "@/components/asset/AssetsExplorer";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Every real-world project raised, executing, or distributing yield on Gally."
        crumbs={[{ label: "Explore", href: "/" }, { label: "Assets" }]}
      />
      <AssetsExplorer initialCategory={category} />
    </div>
  );
}

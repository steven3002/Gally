import Link from "next/link";
import { redirect } from "next/navigation";
import { data } from "@/lib/data";
import { Card, Empty } from "@/components/ui/primitives";
import { Compass, Search } from "@/components/ui/icons";

/**
 * Universal object resolver (FE-M2). Detects an id's kind and redirects to its
 * canonical typed page; unknown ids render a graceful "not indexed" state — the
 * explorer equivalent of "object not found".
 */
export default async function ObjectResolverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ref = await data.resolveObject(decodeURIComponent(id));
  if (ref) redirect(ref.route);

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card className="p-8">
        <Empty
          icon={<Search className="h-8 w-8" />}
          title="Object not indexed"
          hint={`Nothing resolves for “${id}”. It may not be a Gally object, or it isn’t in the indexed set yet.`}
        />
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            <Compass className="h-4 w-4" /> Back to Explore
          </Link>
        </div>
      </Card>
    </div>
  );
}

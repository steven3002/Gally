import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs/DocsNav";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { docNavLinks, DOCS_SEARCH } from "@/lib/docs";

export default function DocsLayout({ children }: { children: ReactNode }) {
  const groups = docNavLinks();
  return (
    <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
      <DocsNav groups={groups} />
      <div className="min-w-0">{children}</div>
      {/* Offline, client-side smart search over the whole set ("/" or the sidebar button). */}
      <DocsSearch index={DOCS_SEARCH} />
    </div>
  );
}

import type { ReactNode } from "react";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { DOCS_SEARCH } from "@/lib/docs";

// The left nav lives in the AppShell sidebar on /docs (one sidebar). This layout
// just renders the article (full width) and mounts the offline smart search.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DocsSearch index={DOCS_SEARCH} />
    </>
  );
}

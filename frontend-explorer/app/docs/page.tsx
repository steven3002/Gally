import type { Metadata } from "next";
import { pageByRoute } from "@/lib/docs";
import { DocsArticle } from "@/components/docs/DocsArticle";

export const dynamic = "force-static";

const page = pageByRoute("/docs")!;

export const metadata: Metadata = {
  title: `${page.title} — Gally Docs`,
  description: page.summary,
};

export default function DocsHomePage() {
  return <DocsArticle page={page} />;
}

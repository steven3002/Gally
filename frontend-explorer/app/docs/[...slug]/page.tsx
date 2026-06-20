import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS_PAGES, pageBySlug } from "@/lib/docs";
import { DocsArticle } from "@/components/docs/DocsArticle";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS_PAGES.filter((p) => p.slug).map((p) => ({ slug: p.slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = pageBySlug(slug);
  if (!page) return { title: "Docs — Gally" };
  return { title: `${page.title} — Gally Docs`, description: page.summary };
}

export default async function DocsSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const page = pageBySlug(slug);
  if (!page) notFound();
  return <DocsArticle page={page} />;
}

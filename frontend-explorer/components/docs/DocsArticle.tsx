import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { OnThisPage } from "./OnThisPage";
import { prevNext, type DocPage } from "@/lib/docs";
import { cn } from "@/lib/format";
import { ArrowRight } from "@/components/ui/icons";

function PrevNextLink({ page, dir }: { page: DocPage; dir: "prev" | "next" }) {
  return (
    <Link
      href={page.route}
      className={cn(
        "group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong",
        dir === "next" && "sm:col-start-2 sm:text-right",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-2">
        {dir === "prev" ? "Previous" : "Next"}
      </div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground",
          dir === "next" && "sm:justify-end",
        )}
      >
        {dir === "prev" && (
          <ArrowRight className="h-4 w-4 rotate-180 text-muted-2 transition-colors group-hover:text-primary" />
        )}
        {page.title}
        {dir === "next" && (
          <ArrowRight className="h-4 w-4 text-muted-2 transition-colors group-hover:text-primary" />
        )}
      </div>
    </Link>
  );
}

export function DocsArticle({ page }: { page: DocPage }) {
  const { prev, next } = prevNext(page);
  const crumbs =
    page.route === "/docs"
      ? [{ label: "Docs" }]
      : [{ label: "Docs", href: "/docs" }, { label: page.part }];

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_184px] xl:gap-10">
      <article className="min-w-0">
        <PageHeader crumbs={crumbs} title={page.title} subtitle={page.summary} />
        <div className="doc-prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        <nav className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
          {prev ? <PrevNextLink page={prev} dir="prev" /> : <span className="hidden sm:block" />}
          {next ? <PrevNextLink page={next} dir="next" /> : <span className="hidden sm:block" />}
        </nav>
      </article>
      <OnThisPage headings={page.headings} />
    </div>
  );
}

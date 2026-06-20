import Link from "next/link";
import { OnThisPage } from "./OnThisPage";
import { prevNext, type DocPage } from "@/lib/docs";
import { cn } from "@/lib/format";
import { ArrowRight, ChevronRight } from "@/components/ui/icons";

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

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_184px] xl:gap-10">
      <article className="min-w-0">
        {/* Title block — sized above the in-content h2/h3 so hierarchy reads clearly */}
        <header className="mb-8">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            {page.route !== "/docs" && (
              <>
                <ChevronRight className="h-3 w-3 text-muted-2" />
                <span className="text-muted-2">{page.part}</span>
              </>
            )}
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-foreground lg:text-[2.6rem] lg:leading-[1.1]">
            {page.title}
          </h1>
          {page.summary && (
            <p className="mt-3 text-base leading-relaxed text-muted lg:text-lg">{page.summary}</p>
          )}
        </header>

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

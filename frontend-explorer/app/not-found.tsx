import Link from "next/link";
import { Compass } from "@/components/ui/icons";

/** Friendly global 404 (FE-M7) for `notFound()` calls + unknown routes. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted-2">
        <Compass className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Not found</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          This object, address, or page isn&apos;t indexed. Check the identifier, or head back to
          explore the protocol.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-strong"
      >
        Back to explore
      </Link>
    </div>
  );
}

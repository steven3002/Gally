import { PageHeader } from "@/components/PageHeader";
import { ActivityFeed } from "@/components/events/ActivityFeed";
import { Pill } from "@/components/ui/bits";

export default function ActivityPage() {
  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Every protocol event, reconstructed from the on-chain stream."
        crumbs={[{ label: "Explore", href: "/" }, { label: "Activity" }]}
        actions={<Pill tone="positive" dot>Live stream</Pill>}
      />
      <ActivityFeed />
    </div>
  );
}

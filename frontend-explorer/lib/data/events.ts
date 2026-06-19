// FE-M8a — Indexer event_type string → `lib/types.ts` EventType + EventFeed.
//
// The indexer emits the on-chain struct names ("CapitalContributedEvent"); the
// domain uses the logical name without the `Event` suffix ("CapitalContributed").
// The feed map mirrors `lib/mock/activity.ts` `FEED_OF` (§18.3 catalog) 1:1.

import type { EventFeed, EventType } from "@/lib/types";

export const FEED_OF: Record<EventType, EventFeed> = {
  AssetCreated: "lifecycle",
  AssetVouched: "lifecycle",
  AssetStateChanged: "lifecycle",
  AssetCancelled: "lifecycle",
  MilestoneProofSubmitted: "lifecycle",
  MilestoneApproved: "lifecycle",
  TrancheReleased: "lifecycle",
  AssetOperational: "lifecycle",
  EntityDefaulted: "lifecycle",
  AssetClosed: "lifecycle",
  CapitalContributed: "position",
  ContributionRefunded: "position",
  SharesClaimed: "position",
  SharesWrapped: "position",
  SharesUnwrapped: "position",
  ShareRedeemed: "position",
  YieldClaimed: "position",
  RaiseFinalized: "revenue",
  RaiseAborted: "revenue",
  RevenueDeposited: "revenue",
  RolloverSwept: "revenue",
  CompensationSwept: "revenue",
  ValidatorRegistered: "validator",
  StakeAdded: "validator",
  StakeWithdrawn: "validator",
  ValidatorStatusChanged: "validator",
  DisputeOpened: "dispute",
  JurorVoted: "dispute",
  DisputeResolved: "dispute",
  ProtocolInitialized: "governance",
  ProtocolParamChanged: "governance",
  ProtocolTreasuryChanged: "governance",
  EmergencyStopTriggered: "governance",
  ProtocolResumed: "governance",
};

const KNOWN = new Set(Object.keys(FEED_OF));

/** Strip the on-chain `Event` suffix → the domain EventType (validated). */
export function eventTypeOf(wire: string): EventType {
  const name = wire.endsWith("Event") ? wire.slice(0, -"Event".length) : wire;
  return (KNOWN.has(name) ? name : "AssetStateChanged") as EventType;
}

export function eventFeedOf(type: EventType): EventFeed {
  return FEED_OF[type] ?? "lifecycle";
}

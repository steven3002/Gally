import type { EventFeed, EventType, ProtocolEvent } from "../types";
import { DAY, HOUR, NOW, usd, shortAddr } from "../format";
import { assets, disputes, validators, DEMO_WALLET } from "./data";
import { seeded } from "./series";

const FEED_OF: Record<EventType, EventFeed> = {
  AssetCreated: "lifecycle",
  AssetVouched: "lifecycle",
  AssetStateChanged: "lifecycle",
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
  YieldClaimed: "position",
  ShareRedeemed: "position",
  RaiseFinalized: "revenue",
  RaiseAborted: "revenue",
  RevenueDeposited: "revenue",
  RolloverSwept: "revenue",
  CompensationSwept: "revenue",
  ValidatorRegistered: "validator",
  StakeAdded: "validator",
  DisputeOpened: "dispute",
  JurorVoted: "dispute",
  DisputeResolved: "dispute",
};

const rnd = seeded(31337);

function digest(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 44; i++) s += hex[Math.floor(rnd() * 16)];
  return s;
}

function addr(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 64; i++) s += hex[Math.floor(rnd() * 16)];
  return s;
}

let seq = 0;
function ev(e: Omit<ProtocolEvent, "id" | "feed" | "txDigest">): ProtocolEvent {
  return { id: `ev${seq++}`, feed: FEED_OF[e.type], txDigest: digest(), ...e };
}

const events: ProtocolEvent[] = [];

// Protocol genesis
events.push(
  ev({
    type: "ValidatorRegistered",
    tsMs: NOW - 540 * DAY,
    actor: validators[0].address,
    actorRole: "validator",
    amount: 4_200_000,
    assetName: validators[0].name,
    summary: `${validators[0].name} registered a validator pool`,
    meta: `Staked ${usd(4_200_000)}`,
  }),
);

// Per-asset lifecycle + economic events (newest pushed last; sorted at end)
for (const a of assets) {
  const v = validators.find((x) => x.poolId === a.validatorPoolId);
  const vName = v?.name ?? "validator";

  events.push(
    ev({
      type: "AssetCreated",
      tsMs: a.createdAtMs,
      assetId: a.id,
      assetName: a.name,
      actor: a.entity,
      actorRole: "entity",
      summary: `${a.entityName} listed ${a.name}`,
      meta: `Goal ${usd(a.fundingGoal)} · ${a.tranches.length} tranches`,
    }),
  );

  if (a.state !== "PENDING_VOUCH" && a.state !== "CANCELLED") {
    events.push(
      ev({
        type: "AssetVouched",
        tsMs: a.createdAtMs + 2 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: v?.address,
        actorRole: "validator",
        summary: `${vName} vouched legal docs for ${a.name}`,
        meta: `Locked ${usd(Math.round((a.fundingGoal * 2000) / 10000))} coverage`,
      }),
    );
  }

  // contributions — a few sampled, ending near the raise
  const contribCount = a.state === "PENDING_VOUCH" ? 0 : a.raised > 0 ? 3 : 0;
  for (let i = 0; i < contribCount; i++) {
    const frac = (i + 1) / (contribCount + 1);
    events.push(
      ev({
        type: "CapitalContributed",
        tsMs: a.createdAtMs + (4 + i * 4) * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: i === 1 ? DEMO_WALLET : addr(),
        actorRole: "investor",
        amount: Math.round((a.raised * (0.18 + rnd() * 0.12))),
        summary: `Capital contributed to ${a.name}`,
        meta: `Raised ${usd(Math.round(a.raised * frac))} of ${usd(a.fundingGoal)}`,
      }),
    );
  }

  if (["FUNDED", "EXECUTING", "OPERATIONAL", "CLOSED", "COMPENSATING"].includes(a.state)) {
    events.push(
      ev({
        type: "RaiseFinalized",
        tsMs: a.fundingDeadlineMs,
        assetId: a.id,
        assetName: a.name,
        actorRole: "investor",
        summary: `Raise finalized for ${a.name}`,
        meta: `${a.fundingGoal.toLocaleString()} shares minted · accumulator armed`,
      }),
    );
  }

  // tranche releases
  for (const t of a.tranches.filter((t) => t.released)) {
    events.push(
      ev({
        type: "TrancheReleased",
        tsMs: t.deadlineMs - 3 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: v?.address,
        actorRole: "validator",
        amount: t.amount,
        summary: `Tranche ${t.index + 1} released — ${a.name}`,
        meta: t.description,
      }),
    );
  }

  if (a.state === "OPERATIONAL" || a.state === "CLOSED") {
    events.push(
      ev({
        type: "AssetOperational",
        tsMs: a.tranches[a.tranches.length - 1].deadlineMs,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} is now operational`,
        meta: "Revenue distribution active",
      }),
    );
    // revenue deposits (a few) + a yield claim by the demo wallet
    const depCount = 4;
    for (let i = 0; i < depCount; i++) {
      const gross = Math.round((a.accumulator!.lifetimeInvestorRevenue / depCount) * (0.8 + rnd() * 0.4));
      events.push(
        ev({
          type: "RevenueDeposited",
          tsMs: NOW - (depCount - i) * 18 * DAY,
          assetId: a.id,
          assetName: a.name,
          actor: a.entity,
          actorRole: "entity",
          amount: gross,
          summary: `Revenue deposited — ${a.name}`,
          meta: `Investor portion ${usd(Math.round(gross * (a.revenueSplitBps / 10000)))}`,
        }),
      );
    }
    events.push(
      ev({
        type: "YieldClaimed",
        tsMs: NOW - 6 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: DEMO_WALLET,
        actorRole: "investor",
        amount: Math.round(a.accumulator!.rewardPool * 0.04),
        summary: `Yield claimed from ${a.name}`,
        meta: "Lazy-index payout",
      }),
    );
  }

  if (a.accumulator && a.accumulator.totalWrappedShares > 0) {
    events.push(
      ev({
        type: "SharesWrapped",
        tsMs: NOW - 14 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: addr(),
        actorRole: "investor",
        amount: Math.round(a.accumulator.totalWrappedShares * 0.2),
        summary: `Shares wrapped to ${a.accumulator.tokenSymbol}`,
        meta: `${(a.accumulator.totalWrappedShares).toLocaleString()} circulating`,
      }),
    );
  }

  if (a.state === "COMPENSATING") {
    events.push(
      ev({
        type: "EntityDefaulted",
        tsMs: NOW - 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        actorRole: "entity",
        summary: `${a.entityName} defaulted on ${a.name}`,
        meta: `Collateral + residual escrow seized`,
      }),
    );
  }

  if (a.state === "FAILED") {
    events.push(
      ev({
        type: "RaiseAborted",
        tsMs: a.fundingDeadlineMs + 1 * HOUR,
        assetId: a.id,
        assetName: a.name,
        summary: `Raise aborted — ${a.name}`,
        meta: `${usd(a.raised)} raised of ${usd(a.fundingGoal)} goal · refunds open`,
      }),
    );
    events.push(
      ev({
        type: "ContributionRefunded",
        tsMs: a.fundingDeadlineMs + 5 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: addr(),
        actorRole: "investor",
        amount: Math.round(a.raised * 0.12),
        summary: `Contribution refunded — ${a.name}`,
        meta: "Receipt burned, principal returned",
      }),
    );
  }

  if (a.state === "CLOSED") {
    events.push(
      ev({
        type: "AssetClosed",
        tsMs: NOW - 30 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} closed`,
        meta: "Term return target met · settlement complete",
      }),
    );
  }
}

// Dispute events
for (const d of disputes) {
  events.push(
    ev({
      type: "DisputeOpened",
      tsMs: d.openedAtMs,
      assetId: d.assetId,
      assetName: d.assetName,
      actor: d.challenger,
      actorRole: "challenger",
      amount: d.bond,
      summary: `Dispute opened against ${d.targetValidatorName}`,
      meta: `Asset: ${d.assetName} · bond ${usd(d.bond)}`,
    }),
  );
  if (d.status === "OPEN") {
    for (let i = 0; i < d.votesGuilty + d.votesInnocent; i++) {
      events.push(
        ev({
          type: "JurorVoted",
          tsMs: d.openedAtMs + (i + 1) * 7 * HOUR,
          assetId: d.assetId,
          assetName: d.assetName,
          actorRole: "validator",
          summary: `Juror voted ${i < d.votesGuilty ? "guilty" : "innocent"}`,
          meta: `Dispute on ${d.assetName}`,
        }),
      );
    }
  } else {
    events.push(
      ev({
        type: "DisputeResolved",
        tsMs: d.votingDeadlineMs + 1 * HOUR,
        assetId: d.assetId,
        assetName: d.assetName,
        actorRole: "challenger",
        amount: d.slashed,
        summary: `Dispute ${d.status === "UPHELD" ? "upheld" : "rejected"} — ${d.targetValidatorName}`,
        meta:
          d.status === "UPHELD"
            ? `Slashed ${usd(d.slashed ?? 0)} · bounty ${usd(d.bounty ?? 0)}`
            : `Challenger bond forfeited`,
      }),
    );
  }
}

// Portfolio actions by the demo wallet (extra, to enrich the portfolio feed)
events.push(
  ev({
    type: "SharesClaimed",
    tsMs: NOW - 200 * DAY,
    assetId: "asset01",
    assetName: "Lagos Coastal Residences",
    actor: DEMO_WALLET,
    actorRole: "investor",
    amount: 24_000,
    summary: "Shares claimed — Lagos Coastal Residences",
    meta: "Receipt converted to GallyShare deed",
  }),
);
events.push(
  ev({
    type: "SharesWrapped",
    tsMs: NOW - 40 * DAY,
    assetId: "asset01",
    assetName: "Lagos Coastal Residences",
    actor: DEMO_WALLET,
    actorRole: "investor",
    amount: 6_000,
    summary: "Wrapped 6,000 shares to gLCR",
    meta: "Composable token for DEX liquidity",
  }),
);

events.sort((a, b) => b.tsMs - a.tsMs);

export const allEvents = events;

export const eventsForAsset = (assetId: string) =>
  events.filter((e) => e.assetId === assetId);

export const eventsForActor = (address: string) =>
  events.filter((e) => e.actor === address);

export const eventsByFeed = (feed: EventFeed) =>
  events.filter((e) => e.feed === feed);

export const recentEvents = (n: number) => events.slice(0, n);

export const portfolioActivity = eventsForActor(DEMO_WALLET);

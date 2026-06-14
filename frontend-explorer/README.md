# Gally Capital Explorer (Frontend)

The public **observer / explorer** UI for the Gally Capital Protocol — a read-only window onto
real-world-asset raises, validator attestations, tranche releases, yield distribution and disputes.

> **Status: design-locked, mock-data only.** This build runs entirely on a baked-in mock dataset —
> **no live backend / indexer / RPC is wired in.** It exists to lock in the UI and information
> architecture before the [Backend Indexer](../Backend%20Indexer) is connected. Every shape in
> `lib/` mirrors the protocol spec so the swap to live data is mechanical.

## Run it

```bash
pnpm install   # already installed in this repo
pnpm dev       # http://localhost:3000
pnpm build && pnpm start
```

Stack: **Next.js 16 (App Router) · React 19 · Tailwind v4**. Zero UI-library dependencies — all
icons and charts are hand-rolled inline SVG, so it builds offline.

## Pages

| Route | Purpose |
|---|---|
| `/` | **Explore** dashboard — TVL hero, KPI strip, trending assets, sectors, top-assets table, watchlist, live activity |
| `/assets` | Asset directory with search, sector/status filters, sort, grid/table views |
| `/assets/[id]` | **Asset detail** — lifecycle stepper + timeline, raise-progress / yield-index / wrap charts, tranche engine, validator card, accumulator, activity, disputes |
| `/validators` · `/validators/[id]` | Validator registry + per-pool track record (stake, utilization, vouches, disputes) |
| `/disputes` | Dispute feed with live jury vote bars + resolution history |
| `/portfolio` | Demo-wallet positions, allocation donut, claimable yield, contribution receipts, activity |
| `/activity` | Global event stream, filterable by feed (lifecycle / positions / revenue / validator / dispute) |

## How it maps to the protocol

The data layer is a faithful projection of `milestone/gally core/protocol_flow.md`:

- **`lib/types.ts`** — object inventory (§3): `Asset`, `Accumulator`, `Validator`, `Dispute`,
  `Position`, plus the `EventType` union (§18 catalog).
- **`lib/mock/data.ts`** — 10 assets across every category & lifecycle state, 5 validators,
  3 disputes, a demo portfolio, and `ProtocolConfig` (§3.1) values.
- **`lib/mock/activity.ts`** — a deterministic event stream; the dashboard/asset/portfolio feeds and
  the time-series charts are reconstructed from it exactly as the §18.4 indexer query patterns
  prescribe (raise progress, index/APY history, wrap ratio, validator track record, state history).

All timestamps are computed against a fixed `NOW` (`lib/format.ts`) and all series use a seeded PRNG
(`lib/mock/series.ts`) so server and client render identically (no hydration drift).

## Wiring real data later

Replace the modules under `lib/mock/` with fetchers against the Backend Indexer's REST/WebSocket API.
The component tree consumes typed `lib/types.ts` shapes only, so nothing in `app/` or `components/`
needs to change.

Light/dark theme toggles in the top bar; the watchlist persists in `localStorage`.

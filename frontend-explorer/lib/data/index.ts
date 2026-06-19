// FE-M8a — Data-source selector (the public entry point).
//
//   import { data } from "@/lib/data";
//   const assets = await data.listAssets();
//
// `NEXT_PUBLIC_DATA_SOURCE=live` picks the BI-M8 indexer; anything else (default)
// keeps the mock selectors, so the build runs offline and the e2e suite is unchanged.

import { mockSource } from "./mock";
import { liveSource } from "./live";
import type { DataSource, SourceKind } from "./source";

export const DATA_SOURCE: SourceKind = process.env.NEXT_PUBLIC_DATA_SOURCE === "live" ? "live" : "mock";
export const isLive = DATA_SOURCE === "live";

export const data: DataSource = isLive ? liveSource : mockSource;

export type { DataSource, SourceKind, HoldersResult, GovernanceResult, AddressResult, HealthResult, ProtocolConfigDTO } from "./source";
export { INDEXER_URL } from "./client";

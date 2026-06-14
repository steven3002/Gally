import type {
  Accumulator,
  Asset,
  AssetState,
  Category,
  Dispute,
  Position,
  ProtocolEvent,
  Tranche,
  Validator,
} from "../types";
import { DAY, NOW } from "../format";
import { accrualSeries, rampSeries, spark, walkSeries } from "./series";

/* --------------------------------------------------------------------------
   Validators (ValidatorPool + track record, §3.3 / §18 validator registry)
-------------------------------------------------------------------------- */

export const validators: Validator[] = [
  {
    poolId: "0xval0meridian00000000000000000000000000000000000000000000000000a1",
    address: "0x9f23a7c4e1b8d6052f3a9c7e1d40b8a6c2e5f9013a7b4c6d8e0f2a4b6c8d0e2f4",
    name: "Meridian Attestation",
    status: "ACTIVE",
    stake: 4_200_000,
    locked: 1_488_000,
    activeVouches: 4,
    registeredAtMs: NOW - 540 * DAY,
    assetsVouched: 23,
    milestonesApproved: 71,
    disputesAgainst: 2,
    disputesUpheld: 0,
    reputation: 96,
    stakeSpark: walkSeries(3.4e6, 4.2e6, 26, NOW, 14 * DAY, 11).map((p) => p.v),
  },
  {
    poolId: "0xval1sahara000000000000000000000000000000000000000000000000000b2",
    address: "0x7c1e9a04b6d2f8350a1c7e9b4d60f2a8c4e6091b3d5f7a9c1e3b5d7f9a1c3e5b7",
    name: "Sahara Legal Validators",
    status: "ACTIVE",
    stake: 2_650_000,
    locked: 980_000,
    activeVouches: 3,
    registeredAtMs: NOW - 410 * DAY,
    assetsVouched: 16,
    milestonesApproved: 44,
    disputesAgainst: 1,
    disputesUpheld: 0,
    reputation: 91,
    stakeSpark: walkSeries(2.1e6, 2.7e6, 26, NOW, 14 * DAY, 22).map((p) => p.v),
  },
  {
    poolId: "0xval2trustbridge000000000000000000000000000000000000000000000c3",
    address: "0x5a0d8e93c7b1f4260e9a3c5b7d1f0a82c6e408193b5d7f9a0c2e4b6d8f0a2c4e6",
    name: "TrustBridge Africa",
    status: "FROZEN",
    stake: 1_900_000,
    locked: 300_000,
    activeVouches: 2,
    registeredAtMs: NOW - 300 * DAY,
    assetsVouched: 11,
    milestonesApproved: 27,
    disputesAgainst: 3,
    disputesUpheld: 0,
    reputation: 68,
    stakeSpark: walkSeries(1.7e6, 2.0e6, 26, NOW, 14 * DAY, 33).map((p) => p.v),
  },
  {
    poolId: "0xval3continental0000000000000000000000000000000000000000000000d4",
    address: "0x3e7b0c5a9d1f8640b2c4e6a8091d3f5b7c9e1a3d5f7092b4d6f8a0c2e4b6d8f0a",
    name: "Continental Surety",
    status: "ACTIVE",
    stake: 1_350_000,
    locked: 192_000,
    activeVouches: 1,
    registeredAtMs: NOW - 220 * DAY,
    assetsVouched: 8,
    milestonesApproved: 19,
    disputesAgainst: 0,
    disputesUpheld: 0,
    reputation: 88,
    stakeSpark: walkSeries(1.1e6, 1.36e6, 26, NOW, 14 * DAY, 44).map((p) => p.v),
  },
  {
    poolId: "0xval4apex00000000000000000000000000000000000000000000000000000e5",
    address: "0x1c5908e7b3d1f6420a8c0e2b4d6f8190a3c5e709b1d3f5a7092c4e6b8d0f2a4c6",
    name: "Apex Verification",
    status: "SLASHED",
    stake: 240_000,
    locked: 0,
    activeVouches: 0,
    registeredAtMs: NOW - 480 * DAY,
    assetsVouched: 9,
    milestonesApproved: 14,
    disputesAgainst: 4,
    disputesUpheld: 1,
    reputation: 31,
    stakeSpark: walkSeries(0.6e6, 1.1e6, 18, NOW - 80 * DAY, 14 * DAY, 55)
      .map((p) => p.v)
      .concat([300_000, 240_000, 240_000]),
  },
];

const valByPool = Object.fromEntries(validators.map((v) => [v.poolId, v]));

/* --------------------------------------------------------------------------
   Asset builder
-------------------------------------------------------------------------- */

interface AssetSeed {
  id: string;
  name: string;
  ticker: string;
  entity: string;
  entityName: string;
  category: Category;
  state: AssetState;
  blurb: string;
  location: string;
  fundingGoal: number;
  raised: number;
  fundingDeadlineMs: number;
  createdAtMs: number;
  tranches: Tranche[];
  entityCollateral: number;
  revenueSplitBps: number;
  isTermFinancing?: boolean;
  returnTarget?: number;
  disputed?: boolean;
  validatorPoolId: string;
  contributors: number;
  holders: number;
  // accumulator (operational/closed)
  acc?: {
    apy: number;
    cumulativeIndex: number;
    lifetimeInvestorRevenue: number;
    wrappedShares: number;
    rewardPool: number;
    rolloverReserve: number;
    compensationPool?: number;
    wrappingFrozen?: boolean;
    tokenSymbol: string;
  };
  seed: number;
}

function build(s: AssetSeed): Asset {
  const operational = !!s.acc;
  const raiseEnd = Math.min(s.fundingDeadlineMs, NOW);

  const raiseSeries = rampSeries(
    s.raised,
    16,
    raiseEnd,
    Math.max(2 * DAY, (raiseEnd - s.createdAtMs) / 15),
    s.seed,
  );

  let accumulator: Accumulator | undefined;
  let indexSeries = [] as Asset["indexSeries"];
  let wrapSeries = [] as Asset["wrapSeries"];

  if (s.acc) {
    accumulator = {
      id: s.id.replace("asset", "acc"),
      tokenSymbol: s.acc.tokenSymbol,
      cumulativeIndex: s.acc.cumulativeIndex,
      totalMintedShares: s.fundingGoal,
      totalWrappedShares: s.acc.wrappedShares,
      rewardPool: s.acc.rewardPool,
      rolloverReserve: s.acc.rolloverReserve,
      compensationPool: s.acc.compensationPool ?? 0,
      wrappingFrozen: s.acc.wrappingFrozen ?? false,
      lifetimeInvestorRevenue: s.acc.lifetimeInvestorRevenue,
      apy: s.acc.apy,
    };
    indexSeries = accrualSeries(s.acc.cumulativeIndex, 18, NOW, 5 * DAY, s.seed + 1);
    wrapSeries = walkSeries(
      Math.round(s.acc.wrappedShares * 0.55),
      Math.round(s.acc.wrappedShares * 1.25),
      18,
      NOW,
      5 * DAY,
      s.seed + 2,
    );
  }

  const sparkSource =
    operational && indexSeries.length ? indexSeries : raiseSeries;

  return {
    id: s.id,
    name: s.name,
    ticker: s.ticker,
    entity: s.entity,
    entityName: s.entityName,
    category: s.category,
    state: s.state,
    blurb: s.blurb,
    location: s.location,
    fundingGoal: s.fundingGoal,
    raised: s.raised,
    fundingDeadlineMs: s.fundingDeadlineMs,
    createdAtMs: s.createdAtMs,
    tranches: s.tranches,
    entityCollateral: s.entityCollateral,
    revenueSplitBps: s.revenueSplitBps,
    accumulator,
    isTermFinancing: s.isTermFinancing ?? false,
    returnTarget: s.returnTarget ?? 0,
    disputed: s.disputed ?? false,
    validatorPoolId: s.validatorPoolId,
    raiseSeries,
    indexSeries,
    wrapSeries,
    spark: spark(sparkSource, 22),
    contributors: s.contributors,
    holders: s.holders,
  };
}

function tranche(
  index: number,
  amount: number,
  description: string,
  deadlineMs: number,
  released: boolean,
  approvedBy?: string,
): Tranche {
  return {
    index,
    amount,
    description,
    deadlineMs,
    released,
    approvedBy,
    proofBlobId: released || approvedBy ? `blob_${index}x${(amount % 9973).toString(16)}` : undefined,
    proofSha256: released || approvedBy ? `0x${(amount * 7919).toString(16).padStart(8, "0")}…` : undefined,
  };
}

const MERIDIAN = validators[0].poolId;
const SAHARA = validators[1].poolId;
const TRUSTBRIDGE = validators[2].poolId;
const CONTINENTAL = validators[3].poolId;
const APEX = validators[4].poolId;

/* --------------------------------------------------------------------------
   Assets
-------------------------------------------------------------------------- */

export const assets: Asset[] = [
  build({
    id: "asset01",
    name: "Lagos Coastal Residences",
    ticker: "LCR",
    entity: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    entityName: "Eko Atlantic Developments",
    category: "Housing",
    state: "OPERATIONAL",
    blurb:
      "120-unit mid-rise residential block on the Lekki corridor, generating rental yield distributed to deed holders.",
    location: "Lagos, Nigeria",
    fundingGoal: 2_400_000,
    raised: 2_400_000,
    fundingDeadlineMs: NOW - 210 * DAY,
    createdAtMs: NOW - 250 * DAY,
    tranches: [
      tranche(0, 720_000, "Land acquisition & permits", NOW - 195 * DAY, true, MERIDIAN),
      tranche(1, 960_000, "Structural construction", NOW - 120 * DAY, true, MERIDIAN),
      tranche(2, 720_000, "Fit-out & handover", NOW - 40 * DAY, true, MERIDIAN),
    ],
    entityCollateral: 240_000,
    revenueSplitBps: 7000,
    validatorPoolId: MERIDIAN,
    contributors: 612,
    holders: 548,
    seed: 101,
    acc: {
      apy: 14.2,
      cumulativeIndex: 0.1832,
      lifetimeInvestorRevenue: 439_680,
      wrappedShares: 410_000,
      rewardPool: 86_400,
      rolloverReserve: 0,
      tokenSymbol: "gLCR",
    },
  }),
  build({
    id: "asset02",
    name: "Kano Solar Microgrid",
    ticker: "KSM",
    entity: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
    entityName: "Sahel Power Cooperative",
    category: "Energy",
    state: "OPERATIONAL",
    blurb:
      "4.5MW solar microgrid supplying 9 rural communities under 15-year PPA contracts; revenue is metered offtake.",
    location: "Kano, Nigeria",
    fundingGoal: 1_800_000,
    raised: 1_800_000,
    fundingDeadlineMs: NOW - 160 * DAY,
    createdAtMs: NOW - 200 * DAY,
    tranches: [
      tranche(0, 540_000, "Panel & inverter procurement", NOW - 150 * DAY, true, SAHARA),
      tranche(1, 720_000, "Grid build-out", NOW - 90 * DAY, true, SAHARA),
      tranche(2, 540_000, "Commissioning & metering", NOW - 30 * DAY, true, SAHARA),
    ],
    entityCollateral: 180_000,
    revenueSplitBps: 6500,
    validatorPoolId: SAHARA,
    contributors: 433,
    holders: 401,
    seed: 202,
    acc: {
      apy: 11.4,
      cumulativeIndex: 0.1041,
      lifetimeInvestorRevenue: 187_380,
      wrappedShares: 240_000,
      rewardPool: 41_200,
      rolloverReserve: 3_100,
      tokenSymbol: "gKSM",
    },
  }),
  build({
    id: "asset03",
    name: "Accra Rice Mill Expansion",
    ticker: "ARM",
    entity: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
    entityName: "Greater Accra Agro Mills",
    category: "Machinery",
    state: "EXECUTING",
    blurb:
      "Doubling milling capacity with two automated parboiling lines; tranche-gated equipment installation.",
    location: "Accra, Ghana",
    fundingGoal: 950_000,
    raised: 950_000,
    fundingDeadlineMs: NOW - 70 * DAY,
    createdAtMs: NOW - 110 * DAY,
    tranches: [
      tranche(0, 380_000, "Line 1 procurement & install", NOW - 50 * DAY, true, MERIDIAN),
      tranche(1, 380_000, "Line 2 procurement & install", NOW + 12 * DAY, false, MERIDIAN),
      tranche(2, 190_000, "Calibration & ramp to capacity", NOW + 55 * DAY, false),
    ],
    entityCollateral: 95_000,
    revenueSplitBps: 6000,
    validatorPoolId: MERIDIAN,
    contributors: 287,
    holders: 287,
    seed: 303,
  }),
  build({
    id: "asset04",
    name: "Sahel Cotton Trade Facility",
    ticker: "SCT",
    entity: "0xd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3",
    entityName: "TransSahel Commodities",
    category: "Trade Finance",
    state: "FUNDING",
    blurb:
      "Revolving working-capital facility financing cotton export shipments; fixed-term return target on principal.",
    location: "Bamako, Mali",
    fundingGoal: 1_200_000,
    raised: 760_000,
    fundingDeadlineMs: NOW + 9 * DAY,
    createdAtMs: NOW - 18 * DAY,
    tranches: [
      tranche(0, 720_000, "Shipment 1 — pre-export finance", NOW + 30 * DAY, false),
      tranche(1, 480_000, "Shipment 2 — pre-export finance", NOW + 75 * DAY, false),
    ],
    entityCollateral: 144_000,
    revenueSplitBps: 8000,
    isTermFinancing: true,
    returnTarget: 1_320_000,
    validatorPoolId: SAHARA,
    contributors: 198,
    holders: 0,
    seed: 404,
  }),
  build({
    id: "asset05",
    name: "Nairobi Cold-Chain Logistics",
    ticker: "NCC",
    entity: "0xe5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    entityName: "EastAfrica FreshLink",
    category: "Infrastructure",
    state: "FUNDING",
    blurb:
      "Refrigerated warehouse + last-mile fleet serving horticulture exporters; recurring storage & haulage fees.",
    location: "Nairobi, Kenya",
    fundingGoal: 3_000_000,
    raised: 2_100_000,
    fundingDeadlineMs: NOW + 21 * DAY,
    createdAtMs: NOW - 26 * DAY,
    tranches: [
      tranche(0, 1_200_000, "Warehouse construction", NOW + 60 * DAY, false),
      tranche(1, 1_000_000, "Refrigeration plant", NOW + 110 * DAY, false),
      tranche(2, 800_000, "Fleet acquisition", NOW + 150 * DAY, false),
    ],
    entityCollateral: 300_000,
    revenueSplitBps: 6800,
    validatorPoolId: CONTINENTAL,
    contributors: 421,
    holders: 0,
    seed: 505,
  }),
  build({
    id: "asset06",
    name: "Volta Cocoa Cooperative",
    ticker: "VCC",
    entity: "0xf60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5",
    entityName: "Volta Region Farmers Union",
    category: "Agriculture",
    state: "OPERATIONAL",
    blurb:
      "Aggregation & fermentation facility lifting smallholder cocoa to export grade; revenue from premium offtake.",
    location: "Ho, Ghana",
    fundingGoal: 640_000,
    raised: 640_000,
    fundingDeadlineMs: NOW - 300 * DAY,
    createdAtMs: NOW - 340 * DAY,
    tranches: [
      tranche(0, 256_000, "Warehouse & fermentation beds", NOW - 280 * DAY, true, SAHARA),
      tranche(1, 256_000, "Drying & grading equipment", NOW - 220 * DAY, true, SAHARA),
      tranche(2, 128_000, "Certification & working capital", NOW - 160 * DAY, true, SAHARA),
    ],
    entityCollateral: 64_000,
    revenueSplitBps: 7200,
    validatorPoolId: SAHARA,
    contributors: 176,
    holders: 162,
    seed: 606,
    acc: {
      apy: 9.3,
      cumulativeIndex: 0.2487,
      lifetimeInvestorRevenue: 159_168,
      wrappedShares: 96_000,
      rewardPool: 18_400,
      rolloverReserve: 1_900,
      tokenSymbol: "gVCC",
    },
  }),
  build({
    id: "asset07",
    name: "Abuja Affordable Housing II",
    ticker: "AAH",
    entity: "0x0718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6",
    entityName: "FCT Habitat Partners",
    category: "Housing",
    state: "PENDING_VOUCH",
    blurb:
      "Phase II of a 400-unit affordable-housing scheme; awaiting validator legal vouch before the raise opens.",
    location: "Abuja, Nigeria",
    fundingGoal: 5_000_000,
    raised: 0,
    fundingDeadlineMs: NOW + 60 * DAY,
    createdAtMs: NOW - 5 * DAY,
    tranches: [
      tranche(0, 1_500_000, "Site works & foundations", NOW + 90 * DAY, false),
      tranche(1, 2_000_000, "Superstructure", NOW + 160 * DAY, false),
      tranche(2, 1_500_000, "Finishing & handover", NOW + 240 * DAY, false),
    ],
    entityCollateral: 500_000,
    revenueSplitBps: 7000,
    validatorPoolId: MERIDIAN,
    contributors: 0,
    holders: 0,
    seed: 707,
  }),
  build({
    id: "asset08",
    name: "Mombasa Port Equipment",
    ticker: "MPE",
    entity: "0x18293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607",
    entityName: "Coastal Handling Ltd",
    category: "Machinery",
    state: "COMPENSATING",
    blurb:
      "Reach-stackers and yard cranes for a private container terminal. Entity missed a tranche deadline; in compensation.",
    location: "Mombasa, Kenya",
    fundingGoal: 1_500_000,
    raised: 1_500_000,
    fundingDeadlineMs: NOW - 150 * DAY,
    createdAtMs: NOW - 190 * DAY,
    tranches: [
      tranche(0, 600_000, "Reach-stacker procurement", NOW - 130 * DAY, true, TRUSTBRIDGE),
      tranche(1, 600_000, "Yard crane procurement", NOW - 60 * DAY, false, TRUSTBRIDGE),
      tranche(2, 300_000, "Commissioning", NOW - 10 * DAY, false),
    ],
    entityCollateral: 150_000,
    revenueSplitBps: 6500,
    disputed: true,
    validatorPoolId: TRUSTBRIDGE,
    contributors: 354,
    holders: 354,
    seed: 808,
    acc: {
      apy: 0,
      cumulativeIndex: 0.0,
      lifetimeInvestorRevenue: 0,
      wrappedShares: 120_000,
      rewardPool: 0,
      rolloverReserve: 0,
      compensationPool: 690_000,
      wrappingFrozen: true,
      tokenSymbol: "gMPE",
    },
  }),
  build({
    id: "asset09",
    name: "Dakar FinTech Working Capital",
    ticker: "DFW",
    entity: "0x293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
    entityName: "Teranga Lending Co",
    category: "Trade Finance",
    state: "CLOSED",
    blurb:
      "Completed 12-month receivables facility for SME merchant lending. Term return target met; principal + yield settled.",
    location: "Dakar, Senegal",
    fundingGoal: 880_000,
    raised: 880_000,
    fundingDeadlineMs: NOW - 420 * DAY,
    createdAtMs: NOW - 450 * DAY,
    tranches: [
      tranche(0, 880_000, "Single-draw working capital", NOW - 400 * DAY, true, CONTINENTAL),
    ],
    entityCollateral: 132_000,
    revenueSplitBps: 8500,
    isTermFinancing: true,
    returnTarget: 968_000,
    validatorPoolId: CONTINENTAL,
    contributors: 211,
    holders: 19,
    seed: 909,
    acc: {
      apy: 10.0,
      cumulativeIndex: 0.11,
      lifetimeInvestorRevenue: 96_800,
      wrappedShares: 0,
      rewardPool: 0,
      rolloverReserve: 240,
      tokenSymbol: "gDFW",
    },
  }),
  build({
    id: "asset10",
    name: "Jos Tin Processing",
    ticker: "JTP",
    entity: "0x3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829",
    entityName: "Plateau Minerals Ltd",
    category: "Machinery",
    state: "FAILED",
    blurb:
      "Tin ore processing upgrade. Raise did not reach goal before the deadline; all contributions fully refundable.",
    location: "Jos, Nigeria",
    fundingGoal: 1_100_000,
    raised: 430_000,
    fundingDeadlineMs: NOW - 12 * DAY,
    createdAtMs: NOW - 52 * DAY,
    tranches: [
      tranche(0, 660_000, "Crusher & smelter upgrade", NOW + 30 * DAY, false),
      tranche(1, 440_000, "Effluent treatment", NOW + 80 * DAY, false),
    ],
    entityCollateral: 110_000,
    revenueSplitBps: 6000,
    validatorPoolId: APEX,
    contributors: 96,
    holders: 0,
    seed: 1010,
  }),
];

export const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));
export const validatorByPool = valByPool;

export function validatorForAsset(a: Asset): Validator | undefined {
  return valByPool[a.validatorPoolId];
}

/* --------------------------------------------------------------------------
   Disputes (§3.10 / §18 dispute feed)
-------------------------------------------------------------------------- */

export const disputes: Dispute[] = [
  {
    id: "0xdisp01a9c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9",
    assetId: "asset08",
    assetName: "Mombasa Port Equipment",
    targetPoolId: TRUSTBRIDGE,
    targetValidatorName: "TrustBridge Africa",
    challenger: "0xc4a1e7b9d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7",
    bond: 25_000,
    status: "OPEN",
    votesGuilty: 5,
    votesInnocent: 2,
    quorum: 9,
    votingDeadlineMs: NOW + 2 * DAY + 6 * 3_600_000,
    openedAtMs: NOW - 3 * DAY,
    reason:
      "Vouched legal title for the yard-crane tranche does not match the registry filing; collateral coverage disputed.",
  },
  {
    id: "0xdisp02b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9",
    assetId: "asset10",
    assetName: "Jos Tin Processing",
    targetPoolId: APEX,
    targetValidatorName: "Apex Verification",
    challenger: "0xe9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1",
    bond: 25_000,
    status: "UPHELD",
    votesGuilty: 11,
    votesInnocent: 1,
    quorum: 9,
    votingDeadlineMs: NOW - 70 * DAY,
    openedAtMs: NOW - 78 * DAY,
    reason: "Forged environmental permit attached to the vouched legal docs.",
    slashed: 220_000,
    bounty: 22_000,
  },
  {
    id: "0xdisp03c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1",
    assetId: "asset06",
    assetName: "Volta Cocoa Cooperative",
    targetPoolId: SAHARA,
    targetValidatorName: "Sahara Legal Validators",
    challenger: "0xa7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9",
    bond: 25_000,
    status: "REJECTED",
    votesGuilty: 2,
    votesInnocent: 10,
    quorum: 9,
    votingDeadlineMs: NOW - 120 * DAY,
    openedAtMs: NOW - 128 * DAY,
    reason: "Alleged overstatement of cocoa offtake contracts; jury found documentation valid.",
    slashed: 0,
    bounty: 0,
  },
];

export const disputeById = Object.fromEntries(disputes.map((d) => [d.id, d]));
export const disputesForAsset = (assetId: string) =>
  disputes.filter((d) => d.assetId === assetId);
export const disputesForPool = (poolId: string) =>
  disputes.filter((d) => d.targetPoolId === poolId);

/* --------------------------------------------------------------------------
   Demo portfolio (the connected wallet)
-------------------------------------------------------------------------- */

export const DEMO_WALLET =
  "0xde1207a4b6c8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0";

// Holdings = operational deed positions only. FUNDING-phase contributions are
// soulbound ContributionReceipts (see `portfolioReceipts`), not deeds — they are
// not listed here, so nothing is double-counted.
export const portfolio: Position[] = [
  {
    assetId: "asset01",
    assetName: "Lagos Coastal Residences",
    ticker: "LCR",
    tokenSymbol: "gLCR",
    category: "Housing",
    state: "OPERATIONAL",
    deeds: 18_000, // GallyShare deeds — earning
    wrapped: 6_000, // gLCR coins — no yield until unwrapped
    costBasis: 24_000,
    yieldEarned: 3_158,
    yieldClaimable: 412, // accrues on the 18,000 deeds only
    apy: 14.2,
    spark: assetById["asset01"].spark,
  },
  {
    assetId: "asset02",
    assetName: "Kano Solar Microgrid",
    ticker: "KSM",
    tokenSymbol: "gKSM",
    category: "Energy",
    state: "OPERATIONAL",
    deeds: 12_500,
    wrapped: 0,
    costBasis: 12_500,
    yieldEarned: 1_301,
    yieldClaimable: 188,
    apy: 11.4,
    spark: assetById["asset02"].spark,
  },
  {
    assetId: "asset06",
    assetName: "Volta Cocoa Cooperative",
    ticker: "VCC",
    tokenSymbol: "gVCC",
    category: "Agriculture",
    state: "OPERATIONAL",
    deeds: 8_000, // earning
    wrapped: 2_000, // gVCC coins — no yield until unwrapped
    costBasis: 10_000,
    yieldEarned: 1_989,
    yieldClaimable: 96, // accrues on the 8,000 deeds only
    apy: 9.3,
    spark: assetById["asset06"].spark,
  },
];

export const portfolioReceipts = [
  {
    assetId: "asset04",
    assetName: "Sahel Cotton Trade Facility",
    amount: 15_000,
    state: "FUNDING" as AssetState,
  },
];

/* --------------------------------------------------------------------------
   Protocol config + aggregate stats (§3.1 ProtocolConfig + derived)
-------------------------------------------------------------------------- */

export const protocolConfig = {
  configId: "0xc0n719a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9",
  admin: "0xad0017a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9",
  treasury: "0x7a5417a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9",
  version: 1,
  paused: false,
  protocolFeeBps: 100,
  minValidatorStake: 250_000,
  vouchCoverageBps: 2000,
  challengerBond: 25_000,
  juryQuorum: 9,
  juryThresholdBps: 6667,
  juryMinStake: 250_000,
  challengerBountyBps: 1000,
  disputeWindowMs: 5 * DAY,
  compensationGraceMs: 7 * DAY,
  minWrapDurationMs: 1 * DAY,
  network: "Sui Testnet",
  packageId: "0x9a11ce7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5",
};

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

const operationalAssets = assets.filter(
  (a) => a.state === "OPERATIONAL" || a.state === "CLOSED",
);
const fundingAssets = assets.filter((a) => a.state === "FUNDING");

export const protocolStats = {
  tvl: sum(assets.map((a) => (a.accumulator ? a.accumulator.rewardPool : 0) + a.raised)),
  totalRaised: sum(assets.map((a) => a.raised)),
  totalYieldDistributed: sum(
    assets.map((a) => a.accumulator?.lifetimeInvestorRevenue ?? 0),
  ),
  activeAssets: assets.filter(
    (a) => !["CLOSED", "FAILED", "CANCELLED"].includes(a.state),
  ).length,
  totalAssets: assets.length,
  validators: validators.filter((v) => v.status !== "SLASHED").length,
  totalValidatorStake: sum(validators.map((v) => v.stake)),
  avgApy:
    operationalAssets.length > 0
      ? sum(operationalAssets.map((a) => a.accumulator?.apy ?? 0)) /
        operationalAssets.filter((a) => (a.accumulator?.apy ?? 0) > 0).length
      : 0,
  openDisputes: disputes.filter((d) => d.status === "OPEN").length,
  resolvedDisputes: disputes.filter((d) => d.status !== "OPEN").length,
  inFunding: fundingAssets.length,
  fundingGoalOpen: sum(fundingAssets.map((a) => a.fundingGoal)),
  fundingRaisedOpen: sum(fundingAssets.map((a) => a.raised)),
  contributors: sum(assets.map((a) => a.contributors)),
  // TVL trend for the hero card
  tvlSpark: walkSeries(7.2e6, 9.6e6, 30, NOW, 7 * DAY, 999)
    .map((p, i, arr) => Math.round(p.v * (0.86 + (i / arr.length) * 0.18)))
    .map((v) => v),
};

export const categories: Category[] = [
  "Housing",
  "Energy",
  "Trade Finance",
  "Agriculture",
  "Machinery",
  "Infrastructure",
];

export function categoryStats() {
  return categories.map((c) => {
    const list = assets.filter((a) => a.category === c);
    return {
      category: c,
      count: list.length,
      raised: sum(list.map((a) => a.raised)),
      avgApy:
        sum(list.map((a) => a.accumulator?.apy ?? 0)) /
          Math.max(1, list.filter((a) => (a.accumulator?.apy ?? 0) > 0).length) || 0,
    };
  });
}

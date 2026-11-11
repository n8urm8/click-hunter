import { readBalanceValue } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ELEMENT_VALUES, type ElementKind } from "./itemTypes";

const BOSS_NAME_ADJECTIVES = [
  "Ashen",
  "Bleak",
  "Cinder",
  "Dread",
  "Ember",
  "Feral",
  "Gloom",
  "Grim",
  "Hollow",
  "Iron",
  "Obsidian",
  "Ravenous",
  "Scarlet",
  "Shattered",
  "Storm",
  "Withered",
] as const;

const BOSS_NAME_TITLES = [
  "Basilisk",
  "Behemoth",
  "Colossus",
  "Devourer",
  "Drake",
  "Executioner",
  "Harbinger",
  "Leviathan",
  "Overlord",
  "Revenant",
  "Tyrant",
  "Warden",
  "Warlock",
  "Wyrm",
  "Ashcaller",
  "Bonebinder",
] as const;

const DEFAULT_BOSS_STAT_MULTIPLIER = 3;
const DEFAULT_TIER_SCALE_MULTIPLIER = 2;
export const DEFAULT_BOSS_REWARD_MULTIPLIER = 3;

type DatabaseCtx = MutationCtx | QueryCtx;

function generateBossName(tier: number) {
  const index = tier - 1;
  const adjective = BOSS_NAME_ADJECTIVES[index % BOSS_NAME_ADJECTIVES.length];
  const title =
    BOSS_NAME_TITLES[
      Math.floor(index / BOSS_NAME_ADJECTIVES.length) %
        BOSS_NAME_TITLES.length
    ];

  return `${adjective} ${title} of Tier ${tier}`;
}

function readBossStatMultiplier(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1
    ? value
    : DEFAULT_BOSS_STAT_MULTIPLIER;
}

function readTierScaleMultiplier(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : DEFAULT_TIER_SCALE_MULTIPLIER;
}

export async function getTierScaleMultiplier(ctx: DatabaseCtx) {
  return readTierScaleMultiplier(await readBalanceValue(ctx, "tierScaleMultiplier"));
}

export function getTierScale(tier: number, tierMultiplier: number) {
  return Math.pow(tierMultiplier, tier - 1);
}

/**
 * Element dealt by a tier's boss. Same cycle as augmentation imbues, so
 * tier-N armor infusion wards tier-N boss hits.
 */
export function bossElementForTier(tier: number): ElementKind {
  return ELEMENT_VALUES[((tier - 1) % ELEMENT_VALUES.length + ELEMENT_VALUES.length) % ELEMENT_VALUES.length];
}

export function scaleBossStat(value: number, multiplier: number) {
  return Math.max(1, Math.round(value * multiplier));
}

/**
 * A tier's boss with its stats scaled to the tier and its element set, or
 * null when no boss exists for the tier yet. Bosses created with
 * tier-scaled stats are returned as stored.
 */
export async function readScaledBoss(ctx: DatabaseCtx, tier: number) {
  const boss = await ctx.db
    .query("bosses")
    .withIndex("by_tier", (q) => q.eq("tier", tier))
    .first();
  if (!boss) return null;
  const mult = boss.statsTierScaled
    ? 1
    : getTierScale(tier, await getTierScaleMultiplier(ctx));
  return {
    ...boss,
    element: bossElementForTier(tier),
    str: scaleBossStat(boss.str, mult),
    dex: scaleBossStat(boss.dex, mult),
    int: scaleBossStat(boss.int, mult),
    luk: scaleBossStat(boss.luk, mult),
    con: scaleBossStat(boss.con, mult),
  };
}

/**
 * Create the shared boss record for a tier when it is first needed.
 */
export async function ensureBossForTier(ctx: MutationCtx, tier: number) {
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Boss tier must be a positive integer");
  }

  const existing = await ctx.db
    .query("bosses")
    .withIndex("by_tier", (q) => q.eq("tier", tier))
    .first();
  if (existing) return existing;

  const strongestMonster = await ctx.db
    .query("monsters")
    .withIndex("by_strength")
    .order("desc")
    .first();
  if (!strongestMonster) {
    throw new Error("Cannot create a boss before regular monsters are seeded");
  }

  const bossMultiplierRow = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "bossStatMultiplier"))
    .first();
  const statMultiplier = readBossStatMultiplier(bossMultiplierRow?.value);
  const tierMultiplier = await getTierScaleMultiplier(ctx);
  const tierScale = getTierScale(tier, tierMultiplier);
  const now = Date.now();
  if (!bossMultiplierRow) {
    await ctx.db.insert("gameBalance", {
      key: "bossStatMultiplier",
      value: DEFAULT_BOSS_STAT_MULTIPLIER,
      description:
        "Boss stat multiplier over the strongest regular monster before tier scaling",
      lastUpdated: now,
    });
  }
  const multiplyStat = (value: number) =>
    scaleBossStat(value, statMultiplier * tierScale);

  const bossId = `boss_tier_${tier}`;
  const bossRecord = {
    bossId,
    tier,
    name: generateBossName(tier),
    str: multiplyStat(strongestMonster.str),
    dex: multiplyStat(strongestMonster.dex),
    int: multiplyStat(strongestMonster.int),
    luk: multiplyStat(strongestMonster.luk),
    con: multiplyStat(strongestMonster.con),
    statsTierScaled: true,
    statsTierMultiplier: tierMultiplier,
    rewardMultiplier: DEFAULT_BOSS_REWARD_MULTIPLIER,
    createdAt: now,
  };

  const bossDocumentId = await ctx.db.insert("bosses", bossRecord);
  return await ctx.db.get(bossDocumentId);
}

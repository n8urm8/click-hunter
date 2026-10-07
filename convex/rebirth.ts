import { readBalanceValue } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

export const REBIRTH_STAT_KEYS = ["str", "dex", "int", "luk", "con"] as const;
export type RebirthStatKey = (typeof REBIRTH_STAT_KEYS)[number];

// Validated fallback defaults for missing or malformed configuration.
export const REBIRTH_STAT_LEVEL_REQUIREMENT_FALLBACK = 99;
export const REBIRTH_STAT_BONUS_PERCENT_FALLBACK = 0.05;
export const REBIRTH_SKILL_BONUS_PERCENT_FALLBACK = 0.05;
// Each skill level multiplies that skill's action speed by
// 1 + this * (level - 1): at 0.01, level 99 runs ~2x faster.
export const SKILL_LEVEL_SPEED_BONUS_PER_LEVEL_FALLBACK = 0.01;

export type RebirthStatBonuses = Record<RebirthStatKey, number>;

const ZERO_BONUSES: RebirthStatBonuses = {
  str: 0,
  dex: 0,
  int: 0,
  luk: 0,
  con: 0,
};

function readBonusCount(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : 0;
}

/**
 * Stat value required in at least one stat to rebirth.
 * Seeded balance `rebirthStatLevelRequirement`, editable in the admin panel.
 */
export async function readRebirthStatRequirement(
  ctx: DatabaseCtx
): Promise<number> {
  const value = await readBalanceValue(ctx, "rebirthStatLevelRequirement");
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : REBIRTH_STAT_LEVEL_REQUIREMENT_FALLBACK;
}

/**
 * Permanent bonus fraction earned per rebirth for each stat that met the
 * requirement (0.05 = +5%). Seeded balance `rebirthStatBonusPercent`,
 * editable in the admin panel.
 */
export async function readRebirthStatBonusPercent(
  ctx: DatabaseCtx
): Promise<number> {
  const value = await readBalanceValue(ctx, "rebirthStatBonusPercent");
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : REBIRTH_STAT_BONUS_PERCENT_FALLBACK;
}

/**
 * Permanent bonus fraction earned per rebirth for each skill that met the
 * requirement (0.05 = +5% action speed). Seeded balance
 * `rebirthSkillBonusPercent`, editable in the admin panel.
 */
export async function readRebirthSkillBonusPercent(
  ctx: DatabaseCtx
): Promise<number> {
  const value = await readBalanceValue(ctx, "rebirthSkillBonusPercent");
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : REBIRTH_SKILL_BONUS_PERCENT_FALLBACK;
}

/**
 * Per-level action speed bonus for skills. Seeded balance
 * `skillLevelSpeedBonusPerLevel`, editable in the admin panel.
 */
export async function readSkillLevelSpeedBonusPerLevel(
  ctx: DatabaseCtx
): Promise<number> {
  const value = await readBalanceValue(
    ctx,
    "skillLevelSpeedBonusPerLevel"
  );
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : SKILL_LEVEL_SPEED_BONUS_PER_LEVEL_FALLBACK;
}

/**
 * Validated per-skill rebirth bonus counts, keyed by skillId.
 * Missing or malformed entries read as zero.
 */
export function getRebirthSkillBonuses(
  player: Doc<"players">
): Record<string, number> {
  const stored = player.rebirthSkillBonuses;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const bonuses: Record<string, number> = {};
  for (const [skillId, count] of Object.entries(stored)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      bonuses[skillId] = count;
    }
  }
  return bonuses;
}

/**
 * Validated per-stat rebirth bonus counts. Missing or malformed entries
 * read as zero, so pre-redesign players work without a data migration.
 */
export function getRebirthStatBonuses(
  player: Doc<"players">
): RebirthStatBonuses {
  const stored = player.rebirthStatBonuses;
  if (!stored) return { ...ZERO_BONUSES };
  return {
    str: readBonusCount(stored.str),
    dex: readBonusCount(stored.dex),
    int: readBonusCount(stored.int),
    luk: readBonusCount(stored.luk),
    con: readBonusCount(stored.con),
  };
}

/**
 * Stats currently at or above the rebirth requirement. Base player values
 * already include both progression paths (combat XP levels and shop
 * upgrades), so both count toward eligibility and bonuses.
 */
export function qualifyingRebirthStats(
  player: Doc<"players">,
  requirement: number
): RebirthStatKey[] {
  return REBIRTH_STAT_KEYS.filter((stat) => player[stat] >= requirement);
}

/**
 * Additive prestige multiplier: each earned bonus adds another
 * `bonusPercent` to the stat (2 bonuses at 5% = 1.10x).
 */
export function rebirthStatMultiplier(
  bonusCount: number,
  bonusPercent: number
): number {
  return 1 + bonusPercent * Math.max(0, bonusCount);
}

/**
 * Action speed multiplier for one skill: levels make tasks complete faster
 * and each banked rebirth bonus stacks additively on top.
 * Level 1 with no bonuses runs at exactly 1x.
 */
export function skillSpeedMultiplier(
  level: number,
  bankedCount: number,
  levelBonusPerLevel: number,
  rebirthBonusPercent: number
): number {
  const safeLevel =
    Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  return (
    (1 + levelBonusPerLevel * Math.max(0, safeLevel - 1)) *
    (1 + rebirthBonusPercent * Math.max(0, bankedCount))
  );
}

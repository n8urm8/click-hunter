import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readBalanceValue } from "./balance";
import {
  getSkillXpRequiredForLevel,
  readSkillXpBase,
  SKILL_XP_BALANCE_DEFAULT,
} from "./skillProgression";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Wisdom system - 6th combat stat that governs ability slots and power.
 * Uses the same XP curve as skills (skillXpPerLevel balance).
 */

// Balance keys for wisdom configuration
export const WISDOM_BALANCE_KEYS = {
  xpPerAbilityUse: "wisdomXpPerAbilityUse",
  powerBonusPerLevel: "wisdomPowerBonusPerLevel",
  baseSlots: "wisdomBaseSlots",
  levelsPerSlot: "wisdomLevelsPerSlot",
  maxSlots: "wisdomMaxSlots",
} as const;

// Fallback defaults for missing/malformed balance config
export const WISDOM_DEFAULTS = {
  xpPerAbilityUse: 10,
  powerBonusPerLevel: 0.005, // 0.5% per level
  baseSlots: 1,
  levelsPerSlot: 33,
  maxSlots: 4,
} as const;

function readNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : fallback;
}

/**
 * Read all wisdom balance values in a single batch.
 */
export async function readWisdomBalance(ctx: DatabaseCtx) {
  const map = await ctx.db.query("gameBalance").collect();
  const get = (key: string) =>
    map.find((row) => row.key === key)?.value ?? WISDOM_DEFAULTS[key as keyof typeof WISDOM_DEFAULTS];

  return {
    xpPerAbilityUse: readNonNegativeNumber(get(WISDOM_BALANCE_KEYS.xpPerAbilityUse), WISDOM_DEFAULTS.xpPerAbilityUse),
    powerBonusPerLevel: readNonNegativeNumber(get(WISDOM_BALANCE_KEYS.powerBonusPerLevel), WISDOM_DEFAULTS.powerBonusPerLevel),
    baseSlots: readPositiveInteger(get(WISDOM_BALANCE_KEYS.baseSlots), WISDOM_DEFAULTS.baseSlots),
    levelsPerSlot: readPositiveInteger(get(WISDOM_BALANCE_KEYS.levelsPerSlot), WISDOM_DEFAULTS.levelsPerSlot),
    maxSlots: readPositiveInteger(get(WISDOM_BALANCE_KEYS.maxSlots), WISDOM_DEFAULTS.maxSlots),
  };
}

/**
 * Calculate wisdom level from total wisdom XP using the skill XP curve.
 */
export function calculateWisdomLevel(wisdomXp: number, xpBase: number): number {
  if (!Number.isFinite(wisdomXp) || wisdomXp < 0) return 1;
  let level = 1;
  let remainingXp = wisdomXp;
  let required = getSkillXpRequiredForLevel(level, xpBase);

  while (remainingXp >= required) {
    remainingXp -= required;
    level += 1;
    required = getSkillXpRequiredForLevel(level, xpBase);
    if (!Number.isSafeInteger(required)) break;
  }
  return level;
}

/**
 * Get current wisdom level for a player.
 */
export async function getPlayerWisdomLevel(ctx: DatabaseCtx, playerId: PlayerId): Promise<number> {
  const [player, xpBaseValue] = await Promise.all([
    ctx.db.get(playerId),
    readBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key),
  ]);
  if (!player) throw new Error("Player not found");
  const xpBase = readSkillXpBase(xpBaseValue);
  const wisdomXp = player.statXp?.wis ?? 0;
  return calculateWisdomLevel(wisdomXp, xpBase);
}

/**
 * Get wisdom level and current XP progress for a player.
 */
export async function getPlayerWisdomProgress(ctx: DatabaseCtx, playerId: PlayerId): Promise<{
  level: number;
  currentXp: number;
  xpToNext: number;
  xpBase: number;
}> {
  const [player, xpBaseValue] = await Promise.all([
    ctx.db.get(playerId),
    readBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key),
  ]);
  if (!player) throw new Error("Player not found");
  const xpBase = readSkillXpBase(xpBaseValue);
  const wisdomXp = player.statXp?.wis ?? 0;
  const level = calculateWisdomLevel(wisdomXp, xpBase);
  const required = getSkillXpRequiredForLevel(level, xpBase);
  const currentXp = wisdomXp - (level > 1 ? getTotalXpForLevel(level - 1, xpBase) : 0);
  const xpToNext = required;
  return { level, currentXp, xpToNext, xpBase };
}

/**
 * Calculate total XP required to reach a given level (sum of all previous level requirements).
 */
function getTotalXpForLevel(targetLevel: number, xpBase: number): number {
  let total = 0;
  for (let level = 1; level < targetLevel; level++) {
    total += getSkillXpRequiredForLevel(level, xpBase);
  }
  return total;
}

/**
 * Calculate maximum equipped ability slots based on wisdom level.
 */
export function getMaxEquippedAbilities(wisdomLevel: number, balance: Awaited<ReturnType<typeof readWisdomBalance>>): number {
  const { baseSlots, levelsPerSlot, maxSlots } = balance;
  const slots = baseSlots + Math.floor(Math.max(0, wisdomLevel - 1) / levelsPerSlot);
  return Math.min(slots, maxSlots);
}

/**
 * Calculate ability power bonus from wisdom level.
 * Returns multiplier (e.g., 1.5 = +50% power).
 */
export function getWisdomPowerMultiplier(wisdomLevel: number, balance: Awaited<ReturnType<typeof readWisdomBalance>>): number {
  const { powerBonusPerLevel } = balance;
  return 1 + powerBonusPerLevel * Math.max(0, wisdomLevel - 1);
}

/**
 * Get max equipped ability slots for a player.
 */
export async function getPlayerMaxEquippedAbilities(ctx: DatabaseCtx, playerId: PlayerId): Promise<number> {
  const [wisdomLevel, balance] = await Promise.all([
    getPlayerWisdomLevel(ctx, playerId),
    readWisdomBalance(ctx),
  ]);
  return getMaxEquippedAbilities(wisdomLevel, balance);
}

/**
 * Award wisdom XP to a player (called when using an ability in combat).
 */
export async function awardWisdomXp(
  ctx: MutationCtx,
  playerId: PlayerId,
  baseXp: number,
  abilityLevel: number = 1
): Promise<void> {
  if (!Number.isFinite(baseXp) || baseXp <= 0) return;

  const balance = await readWisdomBalance(ctx);
  const player = await ctx.db.get(playerId);
  if (!player) throw new Error("Player not found");

  // Wisdom XP scales with ability level and wisdom bonus
  const wisdomLevel = calculateWisdomLevel(player.statXp?.wis ?? 0, readSkillXpBase(await readBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key)));
  const wisdomBonus = getWisdomPowerMultiplier(wisdomLevel, balance) - 1; // just the bonus portion
  const xpGain = Math.floor(baseXp * abilityLevel * (1 + wisdomBonus));

  const currentWisXp = player.statXp?.wis ?? 0;
  const newWisXp = currentWisXp + xpGain;

  await ctx.db.patch(playerId, {
    statXp: {
      str: player.statXp?.str ?? 0,
      dex: player.statXp?.dex ?? 0,
      int: player.statXp?.int ?? 0,
      luk: player.statXp?.luk ?? 0,
      con: player.statXp?.con ?? 0,
      wis: newWisXp,
    },
    lastUpdated: Date.now(),
  });
}

/**
 * Get the effective wisdom value for a player: base level (unchanged by
 * rebirth) scaled by banked rebirth bonuses. Level breakpoints and XP gain
 * always use the base level; this is only for effectiveness (ability power).
 */
export async function getEffectiveWisdom(ctx: DatabaseCtx, playerId: PlayerId): Promise<number> {
  const player = await ctx.db.get(playerId);
  if (!player) throw new Error("Player not found");
  const base = player.wis ?? 1;
  const bonusCount =
    typeof player.rebirthStatBonuses?.wis === "number" &&
    Number.isFinite(player.rebirthStatBonuses.wis) &&
    player.rebirthStatBonuses.wis > 0
      ? player.rebirthStatBonuses.wis
      : 0;
  if (bonusCount <= 0) return base;
  const bonusPercent = await readBalanceValue(ctx, "rebirthStatBonusPercent");
  const percent =
    typeof bonusPercent === "number" && Number.isFinite(bonusPercent) && bonusPercent >= 0
      ? bonusPercent
      : 0.05;
  return base * (1 + percent * bonusCount);
}
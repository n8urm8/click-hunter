import { v, type Infer } from "convex/values";
import { readBalanceMap } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const TASK_SYNC_BALANCE_DEFAULTS = [
  {
    key: "taskSettlementIntervalMs",
    value: 30_000,
    description: "Maximum delay between skill reward batches and online task settlements (milliseconds)",
  },
  {
    key: "taskPresenceIntervalMs",
    value: 10_000,
    description: "Online-only task presence interval, capped at two thirds of the heartbeat grace window (milliseconds)",
  },
] as const;

export function isTaskSyncInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 1_000 && value <= 300_000;
}

export const battleAttackTimingValidator = v.object({
  playerIntervalMs: v.number(),
  monsterIntervalMs: v.number(),
  playerDamagePerHit: v.number(),
  monsterDamagePerHit: v.number(),
});

export const battleEncounterValidator = v.object({
  won: v.boolean(),
  monsterTier: v.number(),
  monsterType: v.string(),
  monsterName: v.string(),
  monsterMaxHealth: v.number(),
  playerMaxHealth: v.number(),
  playerStartingHp: v.optional(v.number()),
  playerEndingHp: v.optional(v.number()),
  conRegenPerSecond: v.optional(v.number()),
  monsterDamagePerSecond: v.number(),
  playerDamagePerSecond: v.number(),
  playerAttackSpeed: v.optional(v.number()),
  attackTiming: v.optional(battleAttackTimingValidator),
  goldEarned: v.optional(v.number()),
  experienceEarned: v.optional(v.number()),
  durationMs: v.number(),
});

export function projectBattleHealth(
  result: Infer<typeof battleEncounterValidator>,
  elapsedMs: number
) {
  const elapsed = Math.min(Math.max(0, elapsedMs), result.durationMs);
  const startHp =
    typeof result.playerStartingHp === "number" &&
    Number.isFinite(result.playerStartingHp)
      ? result.playerStartingHp
      : result.playerMaxHealth;
  const timing = result.attackTiming;
  const monsterDamage = timing
    ? Math.floor(elapsed / timing.playerIntervalMs) * timing.playerDamagePerHit
    : result.playerDamagePerSecond * elapsed / 1_000;
  const playerDamage = timing
    ? Math.floor(elapsed / timing.monsterIntervalMs) * timing.monsterDamagePerHit
    : result.monsterDamagePerSecond * elapsed / 1_000;
  return {
    currentMonsterHealth: timing && elapsed === result.durationMs && result.won ? 0 : Math.max(0, Math.ceil(
      result.monsterMaxHealth - monsterDamage
    )),
    currentMonsterMaxHealth: result.monsterMaxHealth,
    currentPlayerHealth: timing && elapsed === result.durationMs && !result.won ? 0 : Math.max(0, Math.ceil(
      startHp - playerDamage
    )),
    currentPlayerMaxHealth: result.playerMaxHealth,
  };
}

export async function readTaskSyncSettings(
  ctx: QueryCtx | MutationCtx,
  heartbeatGraceMs: number
) {
  const values = await readBalanceMap(
    ctx,
    TASK_SYNC_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const parsed = TASK_SYNC_BALANCE_DEFAULTS.map((entry) => {
    const value = values.get(entry.key);
    return isTaskSyncInterval(value) ? value : entry.value;
  });
  return {
    settlementIntervalMs: parsed[0],
    presenceIntervalMs: Math.max(1, Math.min(parsed[1], Math.floor(heartbeatGraceMs * 2 / 3))),
  };
}

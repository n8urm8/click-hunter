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
  {
    key: "skillTaskMaxSettlementGapMs",
    value: 300_000,
    description:
      "Longest a skill task may run before its rate is re-resolved, because skill levels speed up their own tasks (milliseconds); completion and booster/event boundaries always settle sooner",
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
  // Total in-fight healing per second (CON regen + heal-over-time boosts)
  // snapshotted when the encounter is rolled. Healing ticks continuously
  // alongside discrete monster hits, so it can run on a different schedule
  // than damage; the projection below applies it the same way.
  regenPerSecond: v.optional(v.number()),
  monsterDamagePerSecond: v.number(),
  playerDamagePerSecond: v.number(),
  playerAttackSpeed: v.optional(v.number()),
  attackTiming: v.optional(battleAttackTimingValidator),
  abilityCasts: v.optional(
    v.array(
      v.object({
        abilityId: v.string(),
        level: v.number(),
        casts: v.number(),
      })
    )
  ),
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
  // Healing accrues continuously while damage lands in discrete hits, so the
  // bar can climb between hits when regen outpaces the monster (same model as
  // boss fights). Encounters rolled before healing was split out carry no
  // regenPerSecond and keep the legacy net-damage projection.
  const regen =
    typeof result.regenPerSecond === "number" &&
    Number.isFinite(result.regenPerSecond)
      ? Math.max(0, result.regenPerSecond)
      : null;
  const incomingPlayerDamage = timing
    ? Math.floor(elapsed / timing.monsterIntervalMs) * timing.monsterDamagePerHit
    : result.monsterDamagePerSecond * elapsed / 1_000;
  const playerHealth =
    regen === null
      ? startHp - incomingPlayerDamage
      : Math.min(
        result.playerMaxHealth,
        startHp - incomingPlayerDamage + (regen * elapsed) / 1_000
      );
  return {
    currentMonsterHealth: timing && elapsed === result.durationMs && result.won ? 0 : Math.max(0, Math.ceil(
      result.monsterMaxHealth - monsterDamage
    )),
    currentMonsterMaxHealth: result.monsterMaxHealth,
    currentPlayerHealth: timing && elapsed === result.durationMs && !result.won ? 0 : Math.max(0, Math.ceil(
      playerHealth
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
    skillSettlementGapMs: parsed[2],
  };
}

import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  abilitySpecValidator,
  calculateFinalCooldown,
  canUseAbilityWithWeapon,
  getCombatAbilities,
  resolveAbilitySpec,
  specFromAbility,
} from "./abilities";
import type { AbilityTargetStats } from "./abilities";
import {
  awardWisdomXp,
  getEffectiveWisdom,
  getWisdomPowerMultiplier,
  readWisdomBalance,
} from "./wisdom";
import { readRebirthAbilityBonuses } from "./rebirth";
type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Shared, encounter-agnostic ability combat core.
 *
 * Every encounter (auto-battle, boss, arena, ranked, guild raid) resolves
 * abilities through the functions here so damage/heal/buff math and cooldown
 * scheduling cannot drift between them. What legitimately differs per
 * encounter is the surrounding orchestration: auto-battle interleaves
 * abilities with player and monster auto-attacks on a millisecond timeline,
 * bosses advance the same timeline on each strike/poll, and the async PvP /
 * raid encounters cast once per discrete round. A cooldown is therefore
 * expressed in timeline units ("ms" or "rounds") rather than a fixed one.
 */

export const abilityRuntimeValidator = v.object({
  spec: abilitySpecValidator,
  level: v.number(),
  // Cooldown in timeline units: milliseconds for the real-time encounters,
  // whole rounds for the async round-based ones.
  cooldown: v.number(),
  // Earliest timeline unit at which this ability may cast again.
  nextAt: v.number(),
  casts: v.number(),
  // Banked rebirth power for this ability. Absent on states frozen before it
  // applied, which read as 1.
  powerMultiplier: v.optional(v.number()),
});

export type AbilityRuntimeState = Infer<typeof abilityRuntimeValidator>;

export const abilityBuffValidator = v.object({
  kind: v.union(v.literal("damage"), v.literal("defense")),
  value: v.number(),
  percent: v.boolean(),
  // Timeline unit at which the buff expires (exclusive).
  until: v.number(),
});

export type AbilityBuffState = Infer<typeof abilityBuffValidator>;

export const abilityCombatStateValidator = v.object({
  runtimes: v.array(abilityRuntimeValidator),
  buffs: v.array(abilityBuffValidator),
  wisdomMultiplier: v.number(),
  weaponType: v.optional(v.string()),
  weaponElement: v.optional(v.string()),
});

export type AbilityCombatState = Infer<typeof abilityCombatStateValidator>;

export type AbilityCooldownUnit =
  | { unit: "ms" }
  | { unit: "rounds"; roundIntervalMs: number };

/**
 * Normalise a weapon (whose optional fields may be `null` in stored docs) to
 * the shape ability specs consume, dropping null/undefined fields so the
 * frozen/serialised form stays clean.
 */
export function abilityWeaponFrom(
  weapon:
    | { weaponType?: string | null; element?: string | null }
    | null
    | undefined
): { weaponType?: string; element?: string } | null {
  if (!weapon) return null;
  return {
    ...(weapon.weaponType == null ? {} : { weaponType: weapon.weaponType }),
    ...(weapon.element == null ? {} : { element: weapon.element }),
  };
}

/**
 * Freeze a player's usable equipped abilities into a serialisable combat
 * state. Weapon-type gating and the rebirth power and cooldown bonuses are
 * applied here so the frozen state matches what actually fought.
 *
 * Ally heals are always kept: the raid routes them to the most-injured
 * member, every other encounter lands them on the caster.
 */
export async function buildAbilityCombatState(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  weapon: { weaponType?: string; element?: string } | null,
  cooldownUnit: AbilityCooldownUnit
): Promise<AbilityCombatState> {
  const [entries, wisdomLevel, balance, player] = await Promise.all([
    getCombatAbilities(ctx, playerId),
    getEffectiveWisdom(ctx, playerId),
    readWisdomBalance(ctx),
    ctx.db.get(playerId),
  ]);
  const wisdomMultiplier = getWisdomPowerMultiplier(wisdomLevel, balance);
  const rebirthBonus = player
    ? await readRebirthAbilityBonuses(ctx, player)
    : null;

  const runtimes: AbilityRuntimeState[] = [];
  for (const entry of entries) {
    const ability = entry.ability;
    if (!canUseAbilityWithWeapon(ability, weapon?.weaponType)) continue;
    if (ability.type === "utility") continue;

    const bonus = rebirthBonus?.(ability.abilityId);
    const finalMs = calculateFinalCooldown(
      entry.cooldownMs,
      1,
      bonus?.cooldownReduction ?? 0
    );
    const cooldown =
      cooldownUnit.unit === "ms"
        ? Math.max(100, Math.round(finalMs))
        : Math.max(1, Math.ceil(finalMs / cooldownUnit.roundIntervalMs));

    runtimes.push({
      spec: specFromAbility(ability),
      level: entry.level,
      cooldown,
      nextAt: 0,
      casts: 0,
      ...(bonus && bonus.powerMultiplier !== 1
        ? { powerMultiplier: bonus.powerMultiplier }
        : {}),
    });
  }

  return {
    runtimes,
    buffs: [],
    wisdomMultiplier,
    ...(weapon?.weaponType === undefined
      ? {}
      : { weaponType: weapon.weaponType }),
    ...(weapon?.element === undefined ? {} : { weaponElement: weapon.element }),
  };
}

/** True when the frozen state contains at least one castable ability. */
export function hasCastableAbilities(
  state: AbilityCombatState | undefined
): boolean {
  return (state?.runtimes.length ?? 0) > 0;
}

/**
 * Apply damage buffs to a raw damage value. Buffs of one kind don't stack: the
 * strongest active one applies, so an older weak buff can't mask a newer
 * strong one and a re-cast can't double up.
 */
export function damageWithBuffs(
  base: number,
  buffs: AbilityBuffState[],
  at: number
): number {
  let best = base;
  for (const buff of buffs) {
    if (buff.kind !== "damage" || buff.until <= at) continue;
    const buffed = buff.percent
      ? base * (1 + buff.value / 100)
      : base + buff.value;
    if (buffed > best) best = buffed;
  }
  return best;
}

/** Apply defense buffs to incoming damage. The strongest active one applies. */
export function mitigateWithBuffs(
  base: number,
  buffs: AbilityBuffState[],
  at: number
): number {
  let best = base;
  for (const buff of buffs) {
    if (buff.kind !== "defense" || buff.until <= at) continue;
    const mitigated = buff.percent
      ? base * Math.max(0, 1 - buff.value / 100)
      : Math.max(0, base - buff.value);
    if (mitigated < best) best = mitigated;
  }
  return best;
}

export interface AbilityCastInput {
  state: AbilityCombatState;
  /** Timeline unit (ms or round) at which the cast window opens. */
  at: number;
  /** Timeline unit to retry a gated heal at (e.g. next swing/round). */
  retryAt: number;
  playerHp: number;
  playerMaxHp: number;
  enemyHp: number;
  enemyStats: AbilityTargetStats;
  weapon: { weaponType?: string; element?: string } | null;
  /**
   * Milliseconds per timeline unit. 1 for the ms encounters; the round
   * interval for round-based encounters so a buff duration expressed in ms is
   * stored in whole rounds. Defaults to 1.
   */
  durationUnitMs?: number;
  /**
   * Multiplier applied to outgoing ability damage (e.g. raid tough-skin
   * reduction). Defaults to 1.
   */
  enemyDamageMultiplier?: number;
  /**
   * Optional ally-heal sink. When provided, `target: "ally"` heals route here
   * (the raid heals the most-injured member) and the return value is the HP
   * actually restored. When omitted, ally heals land on the caster (1v1).
   */
  allyHeal?: (amount: number) => number;
}

export interface AbilityCastOutcome {
  playerHp: number;
  enemyHp: number;
  damageDealt: number;
  healing: number;
  casts: number;
}

/**
 * Cast every due ability once, then advance its cooldown. Called at each
 * timeline tick so heal gating sees the live HP and damage lands before the
 * enemy's swing on the same tick.
 */
export function castDueAbilities(input: AbilityCastInput): AbilityCastOutcome {
  const { state, at, retryAt, enemyStats, weapon, allyHeal } = input;
  const durationUnitMs = input.durationUnitMs ?? 1;
  const enemyDamageMultiplier = input.enemyDamageMultiplier ?? 1;
  let playerHp = input.playerHp;
  let enemyHp = input.enemyHp;
  let damageDealt = 0;
  let healing = 0;
  let casts = 0;

  // Drop expired buffs in place (never reassign, callers may hold the array
  // reference) so long fights that repeatedly re-cast a buff stay bounded.
  for (let i = state.buffs.length - 1; i >= 0; i -= 1) {
    if (state.buffs[i].until <= at) state.buffs.splice(i, 1);
  }

  for (const runtime of state.runtimes) {
    if (runtime.nextAt > at || enemyHp <= 0) continue;
    const spec = runtime.spec;
    // Wisdom and banked rebirth power both scale the ability's base power.
    const power = state.wisdomMultiplier * (runtime.powerMultiplier ?? 1);

    if (spec.type === "utility") {
      runtime.nextAt = at + runtime.cooldown;
      continue;
    }

    if (spec.type === "heal") {
      const result = resolveAbilitySpec({
        ability: spec,
        abilityLevel: runtime.level,
        wisdomMultiplier: power,
        weapon,
      });
      // A heal's power is a percentage of max HP, so it stays useful as HP grows.
      const healAmount = Math.round(
        (input.playerMaxHp * Math.min(100, result.value)) / 100
      );
      if (spec.target === "ally" && allyHeal) {
        const restored = Math.max(0, allyHeal(healAmount));
        healing += restored;
        runtime.casts += 1;
        runtime.nextAt = at + runtime.cooldown;
        casts += 1;
        continue;
      }
      const missingHp = input.playerMaxHp - playerHp;
      if (missingHp < healAmount) {
        // Never waste a heal: retry on the next swing/round cadence.
        runtime.nextAt = retryAt;
        continue;
      }
      playerHp = Math.min(input.playerMaxHp, playerHp + healAmount);
      healing += healAmount;
      runtime.casts += 1;
      runtime.nextAt = at + runtime.cooldown;
      casts += 1;
      continue;
    }

    if (spec.type === "buff_offense" || spec.type === "buff_defense") {
      const result = resolveAbilitySpec({
        ability: spec,
        abilityLevel: runtime.level,
        wisdomMultiplier: power,
        weapon,
      });
      state.buffs.push({
        kind: result.buffKind ?? "damage",
        value: result.value,
        percent: result.buffPercent,
        until:
          at +
          Math.max(1, Math.ceil(result.buffDurationMs / durationUnitMs)),
      });
      runtime.casts += 1;
      runtime.nextAt = at + runtime.cooldown;
      casts += 1;
      continue;
    }

    // Attack and any unknown damage-dealing type.
    const result = resolveAbilitySpec({
      ability: spec,
      abilityLevel: runtime.level,
      wisdomMultiplier: power,
      weapon,
      targetStats: enemyStats,
    });
    const dealt = Math.max(
      0,
      Math.floor(result.value * enemyDamageMultiplier)
    );
    enemyHp = Math.max(0, enemyHp - dealt);
    damageDealt += dealt;
    runtime.casts += 1;
    runtime.nextAt = at + runtime.cooldown;
    casts += 1;
  }

  return { playerHp, enemyHp, damageDealt, healing, casts };
}

/** Compact cast tally for wisdom XP settlement and logs. */
export function abilityCastsLog(
  state: AbilityCombatState
): Array<{ abilityId: string; level: number; casts: number }> {
  return state.runtimes
    .filter((runtime) => runtime.casts > 0)
    .map((runtime) => ({
      abilityId: runtime.spec.abilityId,
      level: runtime.level,
      casts: runtime.casts,
    }));
}

/** Next ability event time, or `null` when no ability is pending. */
export function nextAbilityAt(state: AbilityCombatState): number | null {
  let next: number | null = null;
  for (const runtime of state.runtimes) {
    if (!Number.isFinite(runtime.nextAt)) continue;
    if (next === null || runtime.nextAt < next) next = runtime.nextAt;
  }
  return next;
}

/**
 * Award wisdom XP for abilities used in a settled fight, including each
 * ability's banked rebirth wisdom-XP bonus. Callers must gate this on the
 * settlement not being a duplicate (settlementKey dedupe), so re-delivered
 * settlements cannot double-award.
 */
export async function awardAbilityWisdomXp(
  ctx: MutationCtx,
  playerId: PlayerId,
  casts: Array<{ abilityId: string; level: number; casts: number }>
): Promise<void> {
  const used = casts.filter((cast) => cast.casts > 0);
  if (used.length === 0) return;
  const [{ xpPerAbilityUse }, player] = await Promise.all([
    readWisdomBalance(ctx),
    ctx.db.get(playerId),
  ]);
  const rebirthBonus = player
    ? await readRebirthAbilityBonuses(ctx, player)
    : null;
  for (const cast of used) {
    const multiplier = rebirthBonus?.(cast.abilityId).wisdomXpMultiplier ?? 1;
    await awardWisdomXp(
      ctx,
      playerId,
      cast.casts * xpPerAbilityUse * multiplier,
      cast.level
    );
  }
}

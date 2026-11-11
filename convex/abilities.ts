import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { getPlayerMaxEquippedAbilities } from "./wisdom";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Core abilities system: definitions, learning, equipping, combat resolution.
 */

// Ability type constants (match schema validators)
export const ABILITY_TYPES = [
  "attack",
  "heal",
  "buff_offense",
  "buff_defense",
  "utility",
] as const;

export const ABILITY_TARGETS = ["self", "enemy", "ally"] as const;

export const ABILITY_WEAPON_TYPES = [
  "sword",
  "dagger",
  "mace",
  "bow",
  "staff",
  "any",
] as const;

export const ELEMENT_OPPOSITES: Record<string, string | null> = {
  fire: "water",
  water: "fire",
  wind: "earth",
  earth: "wind",
  light: "dark",
  dark: "light",
  arcane: null,
};

/**
 * Get an ability definition by ID.
 */
export async function getAbilityDefinition(
  ctx: DatabaseCtx,
  abilityId: string
): Promise<Doc<"abilities"> | null> {
  return await ctx.db
    .query("abilities")
    .withIndex("by_abilityId", (q) => q.eq("abilityId", abilityId))
    .first();
}

/**
 * Get all enabled ability definitions.
 */
export async function getAllAbilities(ctx: DatabaseCtx): Promise<Doc<"abilities">[]> {
  return await ctx.db
    .query("abilities")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .collect();
}

/**
 * Get a player's learned ability.
 */
export async function getPlayerAbility(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  abilityId: string
): Promise<Doc<"playerAbilities"> | null> {
  return await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId_and_abilityId", (q) =>
      q.eq("playerId", playerId).eq("abilityId", abilityId)
    )
    .first();
}

/**
 * Get all learned abilities for a player.
 */
export async function getPlayerAbilities(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Doc<"playerAbilities">[]> {
  return await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
}

/**
 * Get a player's equipped abilities.
 */
export async function getPlayerEquippedAbilities(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Doc<"playerEquippedAbilities">[]> {
  return await ctx.db
    .query("playerEquippedAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
}

/**
 * Get equipped ability in a specific slot.
 */
export async function getEquippedAbilityInSlot(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  slot: number
): Promise<Doc<"playerEquippedAbilities"> | null> {
  return await ctx.db
    .query("playerEquippedAbilities")
    .withIndex("by_playerId_and_slot", (q) =>
      q.eq("playerId", playerId).eq("slot", slot)
    )
    .first();
}

/**
 * Equip an ability in a slot.
 * Validates: slot within max slots, ability learned, not already equipped.
 */
export async function equipAbility(
  ctx: MutationCtx,
  playerId: PlayerId,
  abilityId: string,
  slot: number
): Promise<void> {
  const player = await requirePlayer(ctx, playerId);

  // Validate slot. The upper bound is the wisdom-driven slot count, which is
  // itself capped by the `wisdomMaxSlots` balance value.
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new Error("Invalid ability slot");
  }

  // Check max slots based on wisdom
  const maxSlots = await getPlayerMaxEquippedAbilities(ctx, playerId);
  if (slot >= maxSlots) {
    throw new Error(`Slot ${slot} not unlocked (max slots: ${maxSlots})`);
  }

  // Check ability is learned
  const playerAbility = await getPlayerAbility(ctx, playerId, abilityId);
  if (!playerAbility) {
    throw new Error("Ability not learned");
  }

  // Check not already equipped in another slot
  const equipped = await getPlayerEquippedAbilities(ctx, playerId);
  if (equipped.some((e) => e.abilityId === abilityId && e.slot !== slot)) {
    throw new Error("Ability already equipped in another slot");
  }

  // Check slot not occupied by different ability
  const currentInSlot = await getEquippedAbilityInSlot(ctx, playerId, slot);
  if (currentInSlot && currentInSlot.abilityId !== abilityId) {
    throw new Error(`Slot ${slot} already occupied`);
  }

  const now = Date.now();
  if (currentInSlot) {
    await ctx.db.patch(currentInSlot._id, {
      abilityId,
      equippedAt: now,
    });
  } else {
    await ctx.db.insert("playerEquippedAbilities", {
      playerId,
      slot,
      abilityId,
      equippedAt: now,
    });
  }
}

/**
 * Unequip an ability from a slot.
 */
export async function unequipAbility(
  ctx: MutationCtx,
  playerId: PlayerId,
  slot: number
): Promise<void> {
  const equipped = await getEquippedAbilityInSlot(ctx, playerId, slot);
  if (equipped) {
    await ctx.db.delete(equipped._id);
  }
}

/**
 * Unequip all abilities for a player (used on rebirth).
 */
export async function unequipAllAbilities(
  ctx: MutationCtx,
  playerId: PlayerId
): Promise<void> {
  const equipped = await getPlayerEquippedAbilities(ctx, playerId);
  for (const e of equipped) {
    await ctx.db.delete(e._id);
  }
}

/**
 * Learn an ability for a player at level 1 if they do not already know it.
 * Used by the starter kit so casters begin with one spell instead of nothing.
 */
export async function learnAbility(
  ctx: MutationCtx,
  playerId: PlayerId,
  abilityId: string
): Promise<Doc<"playerAbilities">> {
  const existing = await getPlayerAbility(ctx, playerId, abilityId);
  if (existing) return existing;

  const ability = await getAbilityDefinition(ctx, abilityId);
  if (!ability || !ability.enabled) {
    throw new Error(`Ability ${abilityId} is not available`);
  }

  const now = Date.now();
  const id = await ctx.db.insert("playerAbilities", {
    playerId,
    abilityId,
    level: 1,
    experience: 0,
    totalExperience: 0,
    learnedAt: now,
    updatedAt: now,
  });
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Failed to learn ability");
  return row;
}

/** Structural subset of an ability needed to compute power. */
export type AbilityPowerSource = Pick<
  Doc<"abilities">,
  "basePower" | "powerScalingPerLevel"
>;

/**
 * Calculate ability power at a given level with wisdom bonus.
 */
export function calculateAbilityPower(
  ability: AbilityPowerSource,
  abilityLevel: number,
  wisdomMultiplier: number
): number {
  const basePower = ability.basePower;
  const scaling = ability.powerScalingPerLevel;
  const levelMultiplier = Math.pow(1 + scaling, Math.max(0, abilityLevel - 1));
  return basePower * levelMultiplier * wisdomMultiplier;
}

/**
 * Frozen, serialisable subset of an ability definition used by every
 * encounter's combat snapshot. `abilitySpecValidator` is the matching
 * validator, reused by `abilityCombat.ts` and the schema.
 */
export const abilitySpecValidator = v.object({
  abilityId: v.string(),
  name: v.string(),
  type: v.union(
    v.literal("attack"),
    v.literal("heal"),
    v.literal("buff_offense"),
    v.literal("buff_defense"),
    v.literal("utility")
  ),
  target: v.union(v.literal("self"), v.literal("enemy"), v.literal("ally")),
  weaponType: v.union(
    v.literal("sword"),
    v.literal("dagger"),
    v.literal("mace"),
    v.literal("bow"),
    v.literal("staff"),
    v.literal("any")
  ),
  element: v.optional(v.string()),
  basePower: v.number(),
  powerScalingPerLevel: v.number(),
  buffStat: v.optional(v.string()),
  buffDurationMs: v.optional(v.number()),
  buffIsPercent: v.optional(v.boolean()),
});

export type AbilitySpec = Infer<typeof abilitySpecValidator>;

/** Narrow a full ability definition down to the combat-relevant fields. */
export function specFromAbility(ability: Doc<"abilities">): AbilitySpec {
  return {
    abilityId: ability.abilityId,
    name: ability.name,
    type: ability.type,
    target: ability.target,
    weaponType: ability.weaponType,
    ...(ability.element === undefined ? {} : { element: ability.element }),
    basePower: ability.basePower,
    powerScalingPerLevel: ability.powerScalingPerLevel,
    ...(ability.buffStat === undefined ? {} : { buffStat: ability.buffStat }),
    ...(ability.buffDurationMs === undefined
      ? {}
      : { buffDurationMs: ability.buffDurationMs }),
    ...(ability.buffIsPercent === undefined
      ? {}
      : { buffIsPercent: ability.buffIsPercent }),
  };
}

export interface AbilityTargetStats {
  defense: number;
  magicalDefense: number;
}

/**
 * Pure effect resolution for one ability cast. Single source of truth for
 * ability damage/heal/buff numbers across every encounter;
 * `resolveAbilityEffect` below is the async wrapper legacy callers use.
 */
export function resolveAbilitySpec(input: {
  ability: AbilitySpec;
  abilityLevel: number;
  wisdomMultiplier: number;
  weapon: { weaponType?: string; element?: string } | null;
  targetStats?: AbilityTargetStats;
}): AbilityCastResult {
  const { ability, abilityLevel, wisdomMultiplier, weapon, targetStats } = input;
  const power = calculateAbilityPower(ability, abilityLevel, wisdomMultiplier);

  let elementalMultiplier = 1.0;
  if (ability.weaponType === "staff" && ability.element) {
    elementalMultiplier = calculateStaffElementalMultiplier(
      ability.element,
      weapon?.element ?? null
    );
  }
  const finalPower = power * elementalMultiplier;

  switch (ability.type) {
    case "attack": {
      let damage = finalPower;
      if (targetStats) {
        const isMagical =
          ability.element !== undefined && ability.element !== "physical";
        const defense = isMagical
          ? targetStats.magicalDefense
          : targetStats.defense;
        damage = Math.max(1, finalPower - defense * 0.5);
      }
      return {
        type: "damage",
        value: Math.round(damage),
        element: ability.element,
        buffPercent: ability.buffIsPercent ?? true,
        buffDurationMs: ability.buffDurationMs ?? 20_000,
        description: `${ability.name} deals ${Math.round(damage)} ${
          ability.element ?? "physical"
        } damage`,
      };
    }

    case "heal": {
      const healAmount = Math.round(finalPower);
      return {
        type: "heal",
        value: healAmount,
        buffPercent: false,
        buffDurationMs: 0,
        description: `${ability.name} restores ${healAmount}% of max HP`,
      };
    }

    case "buff_offense":
    case "buff_defense": {
      return {
        type: "buff",
        value: finalPower,
        buffKind: ability.type === "buff_offense" ? "damage" : "defense",
        buffPercent: ability.buffIsPercent ?? true,
        buffDurationMs: ability.buffDurationMs ?? 20_000,
        description: `${ability.name} grants +${finalPower}% ${
          ability.buffStat ??
          (ability.type === "buff_offense" ? "damage" : "defense")
        }`,
      };
    }

    default: {
      return {
        type: "damage",
        value: Math.round(finalPower),
        buffPercent: false,
        buffDurationMs: 0,
        description: `${ability.name} activates`,
      };
    }
  }
}

/**
 * Calculate staff elemental multiplier for an ability.
 * Returns 1.25 for matching element, 0.85 for opposite, 1.0 for neutral.
 */
export function calculateStaffElementalMultiplier(
  abilityElement: string | undefined,
  staffElement: string | null | undefined
): number {
  if (!abilityElement || !staffElement) return 1.0;
  if (staffElement === abilityElement) return 1.25;
  if (ELEMENT_OPPOSITES[abilityElement] === staffElement) return 0.85;
  return 1.0;
}

/**
 * Check if an ability can be used by a player with their current weapon.
 */
export function canUseAbilityWithWeapon(
  ability: Doc<"abilities">,
  weaponType: string | null | undefined
): boolean {
  if (ability.weaponType === "any") return true;
  if (!weaponType) return false;
  return ability.weaponType === weaponType;
}

/**
 * Get cooldown for an ability at a given level.
 * Future: could reduce cooldown with DEX or ability level.
 */
export function getAbilityCooldown(
  ability: Doc<"abilities">,
  _abilityLevel: number = 1
): number {
  return ability.cooldownMs;
}

/**
 * TODO (activation requirements): gate auto-casts on fight state before
 * resolving the effect. Callers (auto-battle loop, boss fights) must check
 * this when an ability comes off cooldown — resolveAbilityEffect assumes
 * the cast was already approved. Full spec: docs/abilities-design.md §4.5.
 */
export function meetsActivationRequirements(
  ability: Doc<"abilities">,
  state: {
    playerHp: number;
    playerMaxHp: number;
    enemyHp?: number;
    enemyMaxHp?: number;
    buffActive?: boolean;
  }
): boolean {
  // TODO: heal abilities must not fire above their HP threshold (e.g. only
  // cast Healing Touch while HP is below activationHpBelowPercent). Without
  // this, auto-battle wastes heals at full HP and starves wisdom XP value.
  // TODO: execute-style attacks (Executioner's Strike) only below the
  // enemy-HP threshold; AoE/multi-hit prefers 2+ targets when supported.
  // TODO: buffs only (re)cast when their effect is not already active;
  // defense buffs additionally gate on low player HP.
  // TODO: clamp heal value to missing HP in resolveAbilityEffect so logs
  // and overheal-conditional triggers stay truthful.
  void ability;
  void state;
  return true;
}

/**
 * Resolve an ability effect during combat.
 * Returns the effect result (damage, heal, buff, etc.) and wisdom XP granted.
 */
export interface AbilityCombatResult {
  type: "damage" | "heal" | "buff" | "debuff";
  value: number; // damage amount, heal amount, buff magnitude
  element?: string;
  buffType?: string;
  buffKind?: "damage" | "defense";
  buffPercent?: boolean;
  buffDurationMs?: number;
  wisdomXp: number;
  description: string;
}

/** Effect-only result (no wisdom XP); used by the shared combat core. */
export interface AbilityCastResult {
  type: "damage" | "heal" | "buff";
  value: number;
  element?: string;
  buffKind?: "damage" | "defense";
  buffPercent: boolean;
  buffDurationMs: number;
  description: string;
}

export async function resolveAbilityEffect(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  ability: Doc<"abilities">,
  abilityLevel: number,
  wisdomLevel: number,
  wisdomMultiplier: number,
  target: "self" | "enemy",
  equippedWeapon: { weaponType?: string; element?: string } | null,
  monster?: { element?: string; defense: number; magicalDefense: number },
  isBoss?: boolean,
  wisdomXpPerUse: number = 10
): Promise<AbilityCombatResult> {
  void ctx;
  void playerId;
  void wisdomLevel;
  void target;
  void isBoss;

  const baseWisdomXp =
    Number.isFinite(wisdomXpPerUse) && wisdomXpPerUse >= 0
      ? wisdomXpPerUse
      : 10;

  const resolved = resolveAbilitySpec({
    ability: specFromAbility(ability),
    abilityLevel,
    wisdomMultiplier,
    weapon: equippedWeapon,
    ...(monster === undefined
      ? {}
      : {
          targetStats: {
            defense: monster.defense,
            magicalDefense: monster.magicalDefense,
          },
        }),
  });

  return {
    type: resolved.type,
    value: resolved.value,
    ...(resolved.element === undefined ? {} : { element: resolved.element }),
    ...(resolved.buffKind === undefined
      ? { buffType: ability.buffStat ?? "damage" }
      : { buffKind: resolved.buffKind, buffType: ability.buffStat ?? resolved.buffKind }),
    buffPercent: resolved.buffPercent,
    buffDurationMs: resolved.buffDurationMs,
    wisdomXp: baseWisdomXp * abilityLevel,
    description: resolved.description,
  };
}

/**
 * Get all equipped abilities ready for combat (with definitions and levels).
 */
export async function getCombatAbilities(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Array<{
  slot: number;
  ability: Doc<"abilities">;
  level: number;
  cooldownMs: number;
}>> {
  const equipped = await getPlayerEquippedAbilities(ctx, playerId);
  const rows = await Promise.all(
    equipped.map((eq) =>
      Promise.all([
        getAbilityDefinition(ctx, eq.abilityId),
        getPlayerAbility(ctx, playerId, eq.abilityId),
      ])
    )
  );

  const results = [];
  for (let index = 0; index < equipped.length; index += 1) {
    const [ability, playerAbility] = rows[index];
    if (!ability || !ability.enabled || !playerAbility) continue;
    results.push({
      slot: equipped[index].slot,
      ability,
      level: playerAbility.level,
      cooldownMs: getAbilityCooldown(ability, playerAbility.level),
    });
  }
  return results;
}

/**
 * Reset all player ability levels to 1 (used on rebirth).
 */
export async function resetAllPlayerAbilities(
  ctx: MutationCtx,
  playerId: PlayerId
): Promise<void> {
  const abilities = await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();

  const now = Date.now();
  for (const ability of abilities) {
    await ctx.db.patch(ability._id, {
      level: 1,
      experience: 0,
      totalExperience: 0,
      updatedAt: now,
    });
  }
}

/**
 * Get max ability level for a player (for rebirth eligibility).
 */
export async function getMaxPlayerAbilityLevel(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<number> {
  const abilities = await getPlayerAbilities(ctx, playerId);
  if (abilities.length === 0) return 1;
  return Math.max(...abilities.map((a) => a.level));
}

/**
 * Check if player has any ability at or above a level (for rebirth).
 */
export async function hasAbilityAtLevel(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  level: number
): Promise<string[]> {
  const abilities = await getPlayerAbilities(ctx, playerId);
  return abilities
    .filter((a) => a.level >= level)
    .map((a) => a.abilityId);
}

/**
 * Calculate final ability cooldown with all reductions.
 */
export function calculateFinalCooldown(
  baseCooldownMs: number,
  hasteMultiplier: number,
  cooldownReduction: number
): number {
  return Math.max(100, baseCooldownMs * hasteMultiplier * (1 - cooldownReduction));
}
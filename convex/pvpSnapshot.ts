import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { calculateCharacterLevel } from "./characterLevel";
import { readPlayerCombatProfile } from "./combat";
import { rollAttackHit, type HitRoll } from "./hitRoll";
import type { PvpEquipmentBundle } from "./pvpLoadout";
import type { AbilityCombatState } from "./abilityCombat";
import { swingsInRound, type RoundFighter } from "./roundCombat";

/**
 * The frozen fighter model the PvP encounters fight with. The arena lobby and
 * the ranked bout both snapshot a player into a `FighterSnapshot` and swing at
 * each other with it, so the model and its swing rule live here rather than
 * in one of the two encounters.
 */
export type FighterSnapshot = {
  maxHp: number;
  /** Damage per swing. */
  attack: number;
  /**
   * Attacks per second. Absent on snapshots taken before speed counted in
   * round fights, whose `attack` is already a once-a-round swing.
   */
  attackSpeed?: number;
  defense: number;
  magicalDefense: number;
  critChance: number;
  critDamageMultiplier: number;
  damageType: string;
  weaponElement?: string;
  ward: number;
  level: number;
  handicap: number;
};

/** Freeze a player's combat profile into the fighter model PvP fights use. */
export async function snapshotFighter(
  ctx: MutationCtx,
  player: Doc<"players">,
  now: number,
  opponentWeaponElement: string | undefined,
  pvpEquipment: PvpEquipmentBundle
): Promise<FighterSnapshot> {
  const profile = await readPlayerCombatProfile(ctx, player, {
    now,
    source: { kind: "resolved", equipment: pvpEquipment },
  });
  const wardMap = profile.ward as Record<string, number>;
  const weaponElement = profile.weapon?.element ?? undefined;
  return {
    maxHp: Math.max(1, Math.ceil(profile.combatStats.health)),
    attack: Math.max(1, profile.combatStats.attack),
    attackSpeed: profile.combatStats.attackSpeed,
    defense: Math.max(0, profile.combatStats.defense),
    magicalDefense: Math.max(0, profile.combatStats.magicalDefense),
    critChance: Math.min(100, Math.max(0, profile.combatStats.critChance)),
    critDamageMultiplier: Math.max(1, profile.combatStats.critDamageMultiplier),
    damageType: profile.combatStats.damageType,
    ...(weaponElement ? { weaponElement } : {}),
    ward:
      opponentWeaponElement !== undefined
        ? Math.max(0, wardMap[opponentWeaponElement] ?? 0)
        : 0,
    level: await calculateCharacterLevel(ctx, player),
    // Reserved hook for future stat/equipment balancing. Always 1 until a
    // balancing pass lands; applied as a damage-dealt multiplier per round.
    handicap: 1,
  };
}

/**
 * One PvP swing. A magical attacker is mitigated by magical defense, a
 * physical one by defense; the defender's elemental ward always applies on
 * top of both.
 */
export function rollHit(
  attacker: FighterSnapshot,
  defender: FighterSnapshot
): HitRoll {
  const mitigation =
    (attacker.damageType === "magical"
      ? defender.magicalDefense
      : defender.defense) + defender.ward;
  return rollAttackHit({
    attack: attacker.attack,
    critChance: attacker.critChance,
    critMultiplier: attacker.critDamageMultiplier,
    multiplier: attacker.handicap,
    mitigation,
  });
}

/**
 * One corner of a PvP duel as a round-exchange fighter. The arena lobby and
 * the ranked bout both fight this way: the fighter swings at its opponent as
 * often as its attack speed allows, and every hit it takes lands as a whole
 * number of at least one.
 */
export function duelFighter(args: {
  id: string;
  self: FighterSnapshot;
  opponent: FighterSnapshot;
  hp: number;
  roundIntervalMs: number;
  abilityState?: AbilityCombatState;
}): RoundFighter {
  const { self, opponent, roundIntervalMs } = args;
  return {
    id: args.id,
    hp: args.hp,
    maxHp: self.maxHp,
    alive: args.hp > 0,
    defense: self.defense,
    magicalDefense: self.magicalDefense,
    ...(args.abilityState ? { abilityState: args.abilityState } : {}),
    planSwing: (opponents, round) => {
      const swings = swingsInRound(round, self.attackSpeed, roundIntervalMs);
      return Array.from({ length: swings }, () => {
        const raw = rollHit(self, opponent);
        return { target: opponents[0], damage: raw.damage, isCrit: raw.isCrit };
      });
    },
    reduceIncoming: (damage) => Math.max(1, Math.round(damage)),
  };
}

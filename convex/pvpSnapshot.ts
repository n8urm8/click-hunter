import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { calculateCharacterLevel } from "./characterLevel";
import { readPlayerCombatProfile } from "./combat";
import { rollAttackHit, type HitRoll } from "./hitRoll";
import type { PvpEquipmentBundle } from "./pvpLoadout";

/**
 * The frozen fighter model the PvP encounters fight with. The arena lobby and
 * the ranked bout both snapshot a player into a `FighterSnapshot` and swing at
 * each other with it, so the model and its swing rule live here rather than
 * in one of the two encounters.
 */
export type FighterSnapshot = {
  maxHp: number;
  attack: number;
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

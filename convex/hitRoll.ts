/**
 * Every attack in the game rolls here.
 *
 * Two roll shapes exist. A **variance band** is used by every player,
 * fighter, and dragon swing: a crit check, a ±10% band, and the attack scaled
 * by the crit multiplier. A **flat range** is used by monsters: the attack
 * plus a random slice of itself, up to half.
 *
 * What an encounter does with the result stays with the encounter — which
 * defense model applies, what the damage floors at. That is the seam: the
 * roll produces raw damage, the encounter reduces it.
 */

/** One attack roll: raw damage before any buff, mitigation, or reduction. */
export interface HitRoll {
  damage: number;
  isCrit: boolean;
}

/**
 * A variance-band attack roll: a crit check, a ±10% band, and the attack
 * scaled by the crit multiplier.
 */
export function rollAttackHit(input: {
  attack: number;
  critChance: number;
  critMultiplier: number;
  /** Extra multiplier on the attack before mitigation (the arena handicap). */
  multiplier?: number;
  /** Flat mitigation subtracted from the roll (defense, ward). */
  mitigation?: number;
  /** Damage floor. Defaults to 1. */
  minimum?: number;
}): HitRoll {
  const isCrit = Math.random() * 100 < input.critChance;
  const variance = 0.9 + Math.random() * 0.2;
  const scaled =
    input.attack *
    (isCrit ? input.critMultiplier : 1) *
    variance *
    (input.multiplier ?? 1);
  return {
    damage: Math.max(
      input.minimum ?? 1,
      Math.ceil(scaled - (input.mitigation ?? 0))
    ),
    isCrit,
  };
}

/**
 * A flat-range attack roll: the attack plus a random slice of itself (up to
 * half). Monsters and dragons hit for a chunk of their power rather than a
 * percentage of it.
 */
export function rollPowerHit(input: {
  power: number;
  /** Flat mitigation subtracted from the roll (ward). */
  mitigation?: number;
  /** Damage floor. Defaults to 1. */
  minimum?: number;
}): number {
  const base = Math.max(1, Math.ceil(input.power));
  return Math.max(
    input.minimum ?? 1,
    base + Math.floor(Math.random() * (base / 2)) - (input.mitigation ?? 0)
  );
}

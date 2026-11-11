/**
 * Derived combat numbers for anything the player fights that is built from
 * str/dex/con/int stats: regular monsters, bosses and raid dragons. One place
 * owns these formulas so the encounters can't drift apart.
 */
export type MonsterCoreStats = {
  str: number;
  dex: number;
  con: number;
  int: number;
};

/** Hit points before any encounter-specific power multiplier. */
export function monsterBaseHealth(stats: MonsterCoreStats): number {
  return stats.con * 10 + stats.int * 2;
}

/** Physical attack per swing, at least 1. */
export function monsterPhysicalAttack(stats: MonsterCoreStats): number {
  return Math.max(1, stats.str * 1.2 + stats.dex * 0.5);
}

/** Boss swings per second: faster with DEX, never below 0.5. */
export function bossAttackSpeed(stats: Pick<MonsterCoreStats, "dex">): number {
  return Math.max(0.5, (stats.dex - 10) * 0.1 + 1.0);
}

/**
 * Flat defense a regular monster gets from its tier: `perTier` for each tier,
 * so every enemy has some. It blunts physical attacks, and magic too when the
 * monster's INT-based magical defense is lower.
 */
export function monsterTierDefense(tier: number, perTier: number): number {
  return Math.max(0, tier * perTier);
}

/**
 * Defense of a boss or raid dragon: a regular monster's tier defense times
 * `bossMultiplier`. It blunts both physical and magical hits.
 */
export function bossTierDefense(
  tier: number,
  perTier: number,
  bossMultiplier: number
): number {
  return monsterTierDefense(tier, perTier) * Math.max(0, bossMultiplier);
}

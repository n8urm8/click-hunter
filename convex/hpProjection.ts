/**
 * Current HP for the hunt bar, projected from the stored value. Pure and free of
 * server imports, so the client (`app/hooks/usePlayer.ts`) and the tests share it.
 * Max HP and regen rates come from `combat.getHpStatus`; the stored HP and the
 * fight state come from `combat.getHpLive`.
 */

export type HpStats = { maxHp: number; conRegenPerSecond: number };

export type HpLive = {
  storedHp: number | null;
  storedAt: number | null;
  inCombat: boolean;
};

/**
 * Current HP at `now` (server-synced ms). Without a stored value, HP is full,
 * as on the server. In a fight the stored value holds. Out of combat, HP regens
 * from the stored instant at the CON rate, capped at max.
 */
export function projectCurrentHp(stats: HpStats, live: HpLive, now: number): number {
  if (live.storedHp === null || live.storedAt === null) return stats.maxHp;
  const stored = Math.min(stats.maxHp, Math.max(0, live.storedHp));
  if (live.inCombat || stored >= stats.maxHp) {
    return Math.ceil(stored);
  }
  const elapsedSeconds = Math.max(0, now - live.storedAt) / 1_000;
  return Math.min(
    stats.maxHp,
    Math.ceil(stored + stats.conRegenPerSecond * elapsedSeconds)
  );
}

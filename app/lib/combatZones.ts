/**
 * Client mirror of `convex/zones.ts`.
 *
 * Splits a tier's monster pool into easy / medium / hard thirds by ascending
 * `strength` (ties broken by `type`). Keep the partitioning rule identical to
 * the server implementation or zone membership will disagree between the
 * zone picker UI and actual fight selection.
 */

export const COMBAT_ZONE_VALUES = ["easy", "medium", "hard"] as const;

export type CombatZone = (typeof COMBAT_ZONE_VALUES)[number];

/**
 * Fallback regular-monster power when the `monsterPowerMultiplier` balance
 * entry is missing or malformed. Must match DEFAULT_MONSTER_POWER_MULTIPLIER
 * in convex/combat.ts (server auto-battle fallback).
 */
export const DEFAULT_MONSTER_POWER_MULTIPLIER = 1;

export function isCombatZone(value: unknown): value is CombatZone {
  return value === "easy" || value === "medium" || value === "hard";
}

export const COMBAT_ZONE_LABELS: Record<CombatZone, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

interface ZoneMonster {
  strength: number;
  type: string;
}

export function zoneForSortedIndex(index: number, total: number): CombatZone {
  if (total <= 0) return "easy";
  const position = Math.min(Math.max(0, index), total - 1);
  const zoneIndex = Math.min(2, Math.floor((3 * position) / total));
  return COMBAT_ZONE_VALUES[zoneIndex];
}

/** Partition a monster pool into per-zone lists, easiest zone first. */
export function groupMonstersByZone<T extends ZoneMonster>(
  monsters: T[]
): Record<CombatZone, T[]> {
  const sorted = [...monsters].sort(
    (left, right) =>
      left.strength - right.strength || left.type.localeCompare(right.type)
  );
  const groups: Record<CombatZone, T[]> = { easy: [], medium: [], hard: [] };
  sorted.forEach((monster, index) => {
    groups[zoneForSortedIndex(index, sorted.length)].push(monster);
  });
  return groups;
}

/** Filter a monster pool down to one zone (easiest-first thirds). */
export function monstersInZone<T extends ZoneMonster>(
  monsters: T[],
  zone: CombatZone
): T[] {
  return groupMonstersByZone(monsters)[zone];
}

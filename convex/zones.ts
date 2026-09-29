import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/**
 * Combat zones split each tier's monster pool into thirds by difficulty.
 *
 * Monsters are sorted by `strength` ascending (ties broken by `type` for
 * determinism) and dealt into easy / medium / hard by index, so every zone
 * holds roughly a third of the pool from easiest to hardest. With the
 * default 9-monster roster that is exactly 3 / 3 / 3.
 *
 * Zones are a pure selection filter: tier scaling, rewards, loot, and tier
 * progression are unchanged. Harder monsters already pay more via their own
 * goldDrop / experienceReward, so no zone reward multiplier is needed.
 *
 * NOTE: `app/lib/combatZones.ts` mirrors this split for the client. Keep the
 * two in sync if the partitioning rule ever changes.
 */

export const ZONE_VALUES = ["easy", "medium", "hard"] as const;

export type CombatZone = (typeof ZONE_VALUES)[number];

export const combatZoneValidator = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard")
);

export function isCombatZone(value: unknown): value is CombatZone {
  return value === "easy" || value === "medium" || value === "hard";
}

export const COMBAT_ZONE_LABELS: Record<CombatZone, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** Sort key shared by server and client so zone membership is identical. */
export function compareMonstersByDifficulty(
  left: { strength: number; type: string },
  right: { strength: number; type: string }
): number {
  return left.strength - right.strength || left.type.localeCompare(right.type);
}

/**
 * Return the zone for the `index`-th monster (0-based) of a `total`-sized
 * pool sorted easiest-first. Distributes remainders toward easier zones.
 */
export function zoneForSortedIndex(index: number, total: number): CombatZone {
  if (total <= 0) return "easy";
  const position = Math.min(Math.max(0, index), total - 1);
  const zoneIndex = Math.min(2, Math.floor((3 * position) / total));
  return ZONE_VALUES[zoneIndex];
}

/** Filter a monster pool down to one zone (easiest-first thirds). */
export function monstersInZone<T extends Doc<"monsters">>(
  monsters: T[],
  zone: CombatZone
): T[] {
  const sorted = [...monsters].sort(compareMonstersByDifficulty);
  return sorted.filter(
    (_, index) => zoneForSortedIndex(index, sorted.length) === zone
  );
}

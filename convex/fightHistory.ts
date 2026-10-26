import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { CombatZone } from "./zones";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Fight history is the record that a fight settled. Every settlement writes
 * one row, and that row's `settlementKey` is the dedupe key which keeps a
 * re-delivered settlement from paying twice.
 *
 * This module owns both halves of that contract: it derives the key
 * (`fightHistoryKey`) and it writes the row (`recordFightHistory`). Callers
 * no longer hand-build key strings or insert history rows themselves, which
 * is what let the raid settlement drift into its own format.
 *
 * Keys are always player-prefixed (`${playerId}:${scope}:${ref}`) so a caller
 * can never claim another player's key and force their later settlement to
 * return as a duplicate with no rewards.
 */
export function fightHistoryKey(
  playerId: PlayerId | string,
  scope: string,
  ref: string
): string {
  return `${playerId}:${scope}:${ref}`;
}

/** True when a settlement key belongs to the player it settles for. */
export function isPlayerSettlementKey(
  playerId: PlayerId | string,
  settlementKey: string
): boolean {
  return settlementKey.startsWith(`${playerId}:`);
}

export interface FightHistoryEntry {
  playerId: PlayerId;
  settlementKey: string;
  monsterTier: number;
  monsterType: string;
  won: boolean;
  isBoss?: boolean;
  monsterZone?: CombatZone;
  goldEarned: number;
  experienceEarned: number;
  timestamp?: number;
}

/**
 * Write the fight-history row for a settled fight.
 *
 * The key must belong to the player; a caller that builds the key with
 * `fightHistoryKey` always satisfies that. Duplicate detection is the
 * caller's job — `settleCombatFight` checks first so a repeat settlement
 * returns the original rewards instead of writing a second row.
 */
export async function recordFightHistory(
  ctx: MutationCtx,
  entry: FightHistoryEntry
): Promise<void> {
  if (!entry.settlementKey.trim()) {
    throw new Error("Fight settlement key is required");
  }
  if (!isPlayerSettlementKey(entry.playerId, entry.settlementKey)) {
    throw new Error("Fight settlement key must belong to the player");
  }
  await ctx.db.insert("fightHistory", {
    playerId: entry.playerId,
    settlementKey: entry.settlementKey,
    monsterTier: entry.monsterTier,
    monsterType: entry.monsterType,
    won: entry.won,
    ...(entry.isBoss === undefined ? {} : { isBoss: entry.isBoss }),
    ...(entry.monsterZone === undefined
      ? {}
      : { monsterZone: entry.monsterZone }),
    goldEarned: entry.goldEarned,
    experienceEarned: entry.experienceEarned,
    timestamp: entry.timestamp ?? Date.now(),
  });
}

/** Find a previously settled fight by its settlement key. */
export async function findFightHistory(
  ctx: DatabaseCtx,
  settlementKey: string
) {
  return await ctx.db
    .query("fightHistory")
    .withIndex("by_settlementKey", (q) =>
      q.eq("settlementKey", settlementKey)
    )
    .first();
}

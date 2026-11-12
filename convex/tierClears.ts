import { monsterNameForTier, monstersForTier } from "./biomes";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Which monster types a player has defeated on each tier. A boss on a tier
 * needs every monster in the roster beaten there first, so the boss gate reads
 * one `playerTierClears` row plus that tier's biome roster.
 *
 * Helpers only: this module registers no Convex functions, so client code that
 * imports gameplay modules stays clean.
 */

const MONSTER_CATALOG_LIMIT = 500;

/** Record wins over monster types on a tier. Writes only when a new type appears. */
export async function recordMonsterClears(
  ctx: MutationCtx,
  playerId: Id<"players">,
  tier: number,
  monsterTypes: string[]
): Promise<void> {
  const incoming = [...new Set(monsterTypes)];
  if (incoming.length === 0) return;
  const row = await ctx.db
    .query("playerTierClears")
    .withIndex("by_playerId_and_tier", (q) =>
      q.eq("playerId", playerId).eq("tier", tier)
    )
    .first();
  const now = Date.now();
  if (!row) {
    await ctx.db.insert("playerTierClears", {
      playerId,
      tier,
      monsterTypes: incoming,
      updatedAt: now,
    });
    return;
  }
  const known = new Set(row.monsterTypes);
  const added = incoming.filter((type) => !known.has(type));
  if (added.length === 0) return;
  await ctx.db.patch(row._id, {
    monsterTypes: [...row.monsterTypes, ...added],
    updatedAt: now,
  });
}

export type TierClearStatus = {
  /** Monsters in the roster. */
  total: number;
  /** Monsters the player has defeated on this tier. */
  defeated: number;
  /** Display names of monsters still to defeat, in roster order. */
  missingNames: string[];
};

export async function getTierClearStatus(
  ctx: MutationCtx | QueryCtx,
  playerId: Id<"players">,
  tier: number
): Promise<TierClearStatus> {
  const [row, catalog] = await Promise.all([
    ctx.db
      .query("playerTierClears")
      .withIndex("by_playerId_and_tier", (q) =>
        q.eq("playerId", playerId).eq("tier", tier)
      )
      .first(),
    ctx.db.query("monsters").take(MONSTER_CATALOG_LIMIT),
  ]);
  // Only this tier's roster counts toward its boss.
  const monsters = monstersForTier(catalog, tier);
  const cleared = new Set(row?.monsterTypes ?? []);
  const missing = monsters.filter((monster) => !cleared.has(monster.type));
  return {
    total: monsters.length,
    defeated: monsters.length - missing.length,
    missingNames: missing.map((monster) => monsterNameForTier(monster, tier)),
  };
}

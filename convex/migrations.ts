/**
 * Data migrations — run these once after schema changes.
 * Each migration is idempotent and safe to re-run.
 */

import { internalMutation } from "./_generated/server";

/**
 * Migration: currentTierProgression -> maxTierReached
 *
 * Old schema had currentTierProgression (0,1,2 — position within a tier's 3 monsters).
 * New schema uses maxTierReached (highest tier beaten, for rebirth eligibility).
 *
 * Run: npx convex run migrations:backfillMaxTierReached
 */
export const backfillMaxTierReached = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      if (player.maxTierReached !== undefined) continue; // already migrated

      // Best estimate: player reached their currentTier
      // (conservative — they may have beaten higher tiers but we have no record)
      const maxTierReached = player.currentTier ?? 1;

      await ctx.db.patch(player._id, { maxTierReached });
      updated++;
    }

    return { updated, total: players.length };
  },
});

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

/**
 * Migration: assign the temporary admin role used by the development panel.
 *
 * All current accounts are intentionally promoted while the game still uses
 * anonymous IDs. Replace this with an authenticated role migration later.
 *
 * Run: npx convex run migrations:backfillAdminRoles
 */
export const backfillAdminRoles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      if (player.role === "admin") continue;

      await ctx.db.patch(player._id, { role: "admin", lastUpdated: Date.now() });
      updated++;
    }

    return { updated, total: players.length };
  },
});

/**
 * Migration: initialize paid stat-upgrade purchase counts.
 *
 * Existing player-upgrade rows predate the distinction between total quantity
 * and paid purchases, so their quantity is the safest available legacy count.
 * New hidden-spot rewards write purchaseCount: 0 explicitly.
 *
 * Run: npx convex run migrations:backfillStatUpgradePurchaseCounts
 */
export const backfillStatUpgradePurchaseCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const upgrades = await ctx.db.query("upgrades").collect();
    const statUpgradeIds = new Set(
      upgrades
        .filter((upgrade) => upgrade.effectType === "stat-boost")
        .map((upgrade) => upgrade.upgradeId)
    );
    const playerUpgrades = await ctx.db.query("playerUpgrades").collect();
    let updated = 0;

    for (const playerUpgrade of playerUpgrades) {
      if (
        !statUpgradeIds.has(playerUpgrade.upgradeId) ||
        playerUpgrade.purchaseCount !== undefined
      ) {
        continue;
      }

      await ctx.db.patch(playerUpgrade._id, {
        purchaseCount: playerUpgrade.quantity,
      });
      updated++;
    }

    return { updated, total: playerUpgrades.length };
  },
});

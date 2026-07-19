import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get all upgrades owned by a player
 */
export const getPlayerUpgrades = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    return await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();
  },
});

/**
 * Check if player owns an upgrade
 */
export const hasUpgrade = query({
  args: {
    playerId: v.id("players"),
    upgradeId: v.string(),
  },
  handler: async (ctx, { playerId, upgradeId }) => {
    const upgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();

    return upgrades.some((u) => u.upgradeId === upgradeId);
  },
});

/**
 * Purchase an upgrade
 */
export const purchaseUpgrade = mutation({
  args: {
    playerId: v.id("players"),
    upgradeId: v.string(),
  },
  handler: async (ctx, { playerId, upgradeId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const upgrade = await ctx.db
      .query("upgrades")
      .withIndex("by_upgradeId", (q) => q.eq("upgradeId", upgradeId))
      .first();
    if (!upgrade) throw new Error("Upgrade not found");

    // Check gold
    if (player.gold < upgrade.cost) {
      throw new Error("Insufficient gold");
    }

    // Check prerequisites
    if (upgrade.minTier && player.currentTier < upgrade.minTier) {
      throw new Error("Not at required tier");
    }

    // Deduct gold
    await ctx.db.patch(playerId, {
      gold: player.gold - upgrade.cost,
      lastUpdated: Date.now(),
    });

    // Check if upgrade already owned
    const existingUpgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();

    const existing = existingUpgrades.find((u) => u.upgradeId === upgradeId);

    if (existing) {
      // Increment quantity
      await ctx.db.patch(existing._id, {
        quantity: existing.quantity + 1,
      });
    } else {
      // Create new upgrade record
      await ctx.db.insert("playerUpgrades", {
        playerId,
        upgradeId,
        quantity: 1,
        purchasedAt: Date.now(),
      });
    }

    // Apply upgrade effect
    await applyUpgradeEffect(ctx, playerId, upgradeId);

    return { success: true, upgradeId };
  },
});

/**
 * Internal: apply upgrade effect to player
 */
async function applyUpgradeEffect(
  ctx: any,
  playerId: string,
  upgradeId: string
) {
  const upgrade = await ctx.db
    .query("upgrades")
    .withIndex("by_upgradeId", (q: any) => q.eq("upgradeId", upgradeId))
    .first();
  if (!upgrade) return;

  const player = await ctx.db.get(playerId);
  if (!player) return;

  const updates: any = {};

  if (upgrade.effectType === "stat-boost" && upgrade.effectStat && upgrade.effectAmount) {
    const currentValue = player[upgrade.effectStat] || 5;
    updates[upgrade.effectStat] = currentValue + upgrade.effectAmount;
  }
  if (upgrade.effectType === "enable-auto-attack") {
    updates.autoAttackEnabled = true;
  }
  if (upgrade.effectType === "enable-auto-start-fight") {
    updates.autoStartFightEnabled = true;
  }

  if (Object.keys(updates).length > 0) {
    updates.lastUpdated = Date.now();
    await ctx.db.patch(playerId, updates);
  }
}

/**
 * Record a fight in history and aggregate
 */
export const recordFight = mutation({
  args: {
    playerId: v.id("players"),
    monsterTier: v.number(),
    monsterType: v.string(),
    won: v.boolean(),
    goldEarned: v.number(),
    experienceEarned: v.number(),
  },
  handler: async (ctx, { playerId, monsterTier, monsterType, won, goldEarned, experienceEarned }) => {
    const now = Date.now();

    // Insert fight history record
    await ctx.db.insert("fightHistory", {
      playerId,
      monsterTier,
      monsterType,
      won,
      goldEarned,
      experienceEarned,
      timestamp: now,
    });

    // If won, update player stats
    if (won) {
      const player = await ctx.db.get(playerId);
      if (!player) throw new Error("Player not found");

      // Update gold and experience
      await ctx.db.patch(playerId, {
        gold: player.gold + goldEarned,
        totalExperience: player.totalExperience + experienceEarned,
        lastUpdated: now,
      });
    }

    return { recorded: true };
  },
});

/**
 * Claim reward from hidden spot
 */
export const claimHiddenSpotReward = mutation({
  args: {
    playerId: v.id("players"),
    upgradeId: v.string(),
    spotId: v.string(),
  },
  handler: async (ctx, { playerId, upgradeId, spotId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const upgrade = await ctx.db
      .query("upgrades")
      .withIndex("by_upgradeId", (q) => q.eq("upgradeId", upgradeId))
      .first();
    if (!upgrade) throw new Error("Upgrade not found");

    // Check if this spot was already claimed
    const playerUpgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();

    const claimed = playerUpgrades.find(
      (u) => u.upgradeId === upgradeId && u.quantity && u.quantity > 0
    );

    if (claimed) {
      throw new Error("Spot already claimed");
    }

    // Record the claim
    await ctx.db.insert("playerUpgrades", {
      playerId,
      upgradeId,
      quantity: 1,
      purchasedAt: Date.now(),
      // Mark this as a hidden spot claim (meta field for tracking)
      // quantity: 1 indicates it's a hidden spot reward
    });

    // Apply the upgrade effect directly
    await applyUpgradeEffect(ctx, playerId, upgradeId);

    return { success: true, upgrade };
  },
});

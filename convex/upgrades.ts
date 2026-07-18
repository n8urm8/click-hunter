import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { UPGRADES } from "../app/lib/gameConfig";

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

    const upgrade = UPGRADES[upgradeId];
    if (!upgrade) throw new Error("Upgrade not found");

    // Check gold
    if (player.gold < upgrade.cost) {
      throw new Error("Insufficient gold");
    }

    // Check prerequisites
    if (upgrade.prerequisites?.minTier && player.currentTier < upgrade.prerequisites.minTier) {
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

    return { success: true, upgrade };
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
  const upgrade = UPGRADES[upgradeId] as any;
  if (!upgrade) return;

  const player = await ctx.db.get(playerId);
  if (!player) return;

  const updates: any = {};

  // Apply stat bonuses if present
  if (upgrade.statBonus) {
    if (upgrade.statBonus.str) updates.str = (player.str || 5) + upgrade.statBonus.str;
    if (upgrade.statBonus.dex) updates.dex = (player.dex || 5) + upgrade.statBonus.dex;
    if (upgrade.statBonus.int) updates.int = (player.int || 5) + upgrade.statBonus.int;
    if (upgrade.statBonus.luk) updates.luk = (player.luk || 5) + upgrade.statBonus.luk;
    if (upgrade.statBonus.con) updates.con = (player.con || 5) + upgrade.statBonus.con;
  }

  // Enable auto features if present
  if (upgrade.enableAutoAttack) {
    updates.autoAttackEnabled = true;
  }
  if (upgrade.enableAutoStartFight) {
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

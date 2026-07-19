import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

/**
 * Unlock an achievement for a player
 */
export const unlockAchievement = mutation({
  args: {
    playerId: v.id("players"),
    achievementId: v.string(),
  },
  async handler(ctx, args) {
    const { playerId, achievementId } = args;

    // Check if already unlocked
    const existing = await ctx.db
      .query("playerAchievements")
      .withIndex("by_playerId_achievementId")
      .filter((q) =>
        q.and(
          q.eq(q.field("playerId"), playerId),
          q.eq(q.field("achievementId"), achievementId)
        )
      )
      .first();

    if (existing) return existing; // Already unlocked

    // Unlock the achievement
    const unlockedAt = Date.now();
    const docId = await ctx.db.insert("playerAchievements", {
      playerId,
      achievementId,
      unlockedAt,
    });

    return await ctx.db.get(docId);
  },
});

/**
 * Get all achievements for a player
 */
export const getPlayerAchievements = query({
  args: { playerId: v.id("players") },
  async handler(ctx, args) {
    const unlockedAchievements = await ctx.db
      .query("playerAchievements")
      .withIndex("by_playerId")
      .filter((q) => q.eq(q.field("playerId"), args.playerId))
      .collect();

    const allAchievements = await ctx.db.query("achievements").collect();

    return {
      unlocked: unlockedAchievements.map((ua) => ua.achievementId),
      all: allAchievements,
      progress: {
        count: unlockedAchievements.length,
        total: allAchievements.length,
      },
    };
  },
});

/**
 * Check conditions and auto-unlock achievements
 */
export const checkAchievementConditions = mutation({
  args: {
    playerId: v.id("players"),
    maxTierReached: v.number(),
    totalExperience: v.number(),
    rebirthCount: v.number(),
    currentStats: v.object({
      str: v.number(),
      dex: v.number(),
      int: v.number(),
      luk: v.number(),
      con: v.number(),
    }),
  },
  async handler(ctx, args) {
    const conditions: { achievementId: string; unlocked: boolean }[] = [];

    // first-kill: if totalXP > 0
    conditions.push({
      achievementId: "first-kill",
      unlocked: args.totalExperience > 0,
    });

    // tier-5, tier-10, tier-20
    conditions.push({ achievementId: "tier-5", unlocked: args.maxTierReached >= 5 });
    conditions.push({ achievementId: "tier-10", unlocked: args.maxTierReached >= 10 });
    conditions.push({ achievementId: "tier-20", unlocked: args.maxTierReached >= 20 });

    // first-rebirth: if rebirthCount > 0
    conditions.push({
      achievementId: "first-rebirth",
      unlocked: args.rebirthCount > 0,
    });

    // totalXP:10000
    conditions.push({
      achievementId: "tier-100-xp",
      unlocked: args.totalExperience >= 10000,
    });

    // Unlock any that should be unlocked
    const unlockedIds = [];
    for (const condition of conditions) {
      if (condition.unlocked) {
        // Check if already unlocked
        const existing = await ctx.db
          .query("playerAchievements")
          .withIndex("by_playerId_achievementId")
          .filter((q) =>
            q.and(
              q.eq(q.field("playerId"), args.playerId),
              q.eq(q.field("achievementId"), condition.achievementId)
            )
          )
          .first();

        if (!existing) {
          await ctx.db.insert("playerAchievements", {
            playerId: args.playerId,
            achievementId: condition.achievementId,
            unlockedAt: Date.now(),
          });
          unlockedIds.push(condition.achievementId);
        }
      }
    }

    return { unlocked: unlockedIds };
  },
});

import { mutation, query } from "./_generated/server";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { v } from "convex/values";

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
    await requirePlayer(ctx, playerId);

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
    await requirePlayerRead(ctx, args.playerId);
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
    const player = await requirePlayer(ctx, args.playerId);
    // Server row wins over client claims: achievements are cosmetic, but
    // there is no reason to let callers self-assert their own stats.
    const { maxTierReached, totalExperience, rebirthCount } = {
      maxTierReached: player.maxTierReached ?? player.currentTier,
      totalExperience: player.totalExperience,
      rebirthCount: player.rebirthCount,
    };
    const conditions: { achievementId: string; unlocked: boolean }[] = [];

    // first-kill: if totalXP > 0
    conditions.push({
      achievementId: "first-kill",
      unlocked: totalExperience > 0,
    });

    // tier-5, tier-10, tier-20
    conditions.push({ achievementId: "tier-5", unlocked: maxTierReached >= 5 });
    conditions.push({ achievementId: "tier-10", unlocked: maxTierReached >= 10 });
    conditions.push({ achievementId: "tier-20", unlocked: maxTierReached >= 20 });

    // first-rebirth: if rebirthCount > 0
    conditions.push({
      achievementId: "first-rebirth",
      unlocked: rebirthCount > 0,
    });

    // totalXP:10000
    conditions.push({
      achievementId: "tier-100-xp",
      unlocked: totalExperience >= 10000,
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

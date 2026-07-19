import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Upsert player on leaderboards when stats change
export const updateLeaderboards = mutation({
  args: {
    playerId: v.id("players"),
    playerName: v.string(),
    totalExperience: v.number(),
    maxTierReached: v.number(),
    rebirthCount: v.number(),
  },
  async handler(ctx, args) {
    const { playerId, playerName, totalExperience, maxTierReached, rebirthCount } = args;

    // Update experience leaderboard
    const expEntry = await ctx.db
      .query("leaderboardByExperience")
      .withIndex("by_totalExperience")
      .filter((q) => q.eq(q.field("playerId"), playerId))
      .first();

    if (expEntry) {
      await ctx.db.patch(expEntry._id, {
        totalExperience,
        playerName,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("leaderboardByExperience", {
        playerId,
        playerName,
        totalExperience,
        lastUpdated: Date.now(),
      });
    }

    // Update tier leaderboard
    const tierEntry = await ctx.db
      .query("leaderboardByTier")
      .withIndex("by_maxTierReached")
      .filter((q) => q.eq(q.field("playerId"), playerId))
      .first();

    if (tierEntry) {
      await ctx.db.patch(tierEntry._id, {
        maxTierReached,
        playerName,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("leaderboardByTier", {
        playerId,
        playerName,
        maxTierReached,
        lastUpdated: Date.now(),
      });
    }

    // Update rebirth leaderboard
    const rebirthEntry = await ctx.db
      .query("leaderboardByRebirth")
      .withIndex("by_rebirthCount")
      .filter((q) => q.eq(q.field("playerId"), playerId))
      .first();

    if (rebirthEntry) {
      await ctx.db.patch(rebirthEntry._id, {
        rebirthCount,
        playerName,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("leaderboardByRebirth", {
        playerId,
        playerName,
        rebirthCount,
        lastUpdated: Date.now(),
      });
    }
  },
});

// Query top N by experience
export const getTopByExperience = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByExperience")
      .withIndex("by_totalExperience")
      .order("desc")
      .take(args.limit);
  },
});

// Query top N by tier
export const getTopByTier = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByTier")
      .withIndex("by_maxTierReached")
      .order("desc")
      .take(args.limit);
  },
});

// Query top N by rebirth
export const getTopByRebirth = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByRebirth")
      .withIndex("by_rebirthCount")
      .order("desc")
      .take(args.limit);
  },
});

// Get player's rank on each leaderboard
export const getPlayerRanks = query({
  args: { playerId: v.id("players") },
  async handler(ctx, args) {
    const expByPlayer = await ctx.db
      .query("leaderboardByExperience")
      .filter((q) => q.eq(q.field("playerId"), args.playerId))
      .first();

    const tierByPlayer = await ctx.db
      .query("leaderboardByTier")
      .filter((q) => q.eq(q.field("playerId"), args.playerId))
      .first();

    const rebirthByPlayer = await ctx.db
      .query("leaderboardByRebirth")
      .filter((q) => q.eq(q.field("playerId"), args.playerId))
      .first();

    let expRank = null;
    let tierRank = null;
    let rebirthRank = null;

    if (expByPlayer) {
      const higherExp = await ctx.db
        .query("leaderboardByExperience")
        .filter((q) => q.gt(q.field("totalExperience"), expByPlayer.totalExperience))
        .collect();
      expRank = higherExp.length + 1;
    }

    if (tierByPlayer) {
      const higherTier = await ctx.db
        .query("leaderboardByTier")
        .filter((q) => q.gt(q.field("maxTierReached"), tierByPlayer.maxTierReached))
        .collect();
      tierRank = higherTier.length + 1;
    }

    if (rebirthByPlayer) {
      const higherRebirth = await ctx.db
        .query("leaderboardByRebirth")
        .filter((q) => q.gt(q.field("rebirthCount"), rebirthByPlayer.rebirthCount))
        .collect();
      rebirthRank = higherRebirth.length + 1;
    }

    return { expRank, tierRank, rebirthRank };
  },
});

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  STARTING_STATS,
  REBIRTH_TIER_PROGRESSION,
  type StatType,
} from "../app/lib/gameConfig";

/**
 * Get or create a player
 */
export const getOrCreatePlayer = mutation({
  args: {
    anonymousId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { anonymousId, name }) => {
    // Check if player already exists
    const existing = await ctx.db
      .query("players")
      .withIndex("by_anonymousId", (q) => q.eq("anonymousId", anonymousId))
      .first();

    if (existing) {
      return existing;
    }

    // Create new player with starting stats
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      anonymousId,
      name,
      str: STARTING_STATS.str,
      dex: STARTING_STATS.dex,
      int: STARTING_STATS.int,
      luk: STARTING_STATS.luk,
      con: STARTING_STATS.con,
      gold: 0,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: REBIRTH_TIER_PROGRESSION[0],
      currentTier: 1,
      currentTierProgression: 0,
      autoAttackEnabled: false,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });

    return await ctx.db.get(playerId);
  },
});

/**
 * Get player by anonymous ID
 */
export const getPlayerByAnonymousId = query({
  args: {
    anonymousId: v.string(),
  },
  handler: async (ctx, { anonymousId }) => {
    return await ctx.db
      .query("players")
      .withIndex("by_anonymousId", (q) => q.eq("anonymousId", anonymousId))
      .first();
  },
});

/**
 * Get player by ID
 */
export const getPlayerById = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    return await ctx.db.get(playerId);
  },
});

/**
 * Update gold
 */
export const updateGold = mutation({
  args: {
    playerId: v.id("players"),
    delta: v.number(),
  },
  handler: async (ctx, { playerId, delta }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const newGold = Math.max(0, player.gold + delta);
    await ctx.db.patch(playerId, {
      gold: newGold,
      lastUpdated: Date.now(),
    });

    return newGold;
  },
});

/**
 * Add experience
 */
export const addExperience = mutation({
  args: {
    playerId: v.id("players"),
    amount: v.number(),
  },
  handler: async (ctx, { playerId, amount }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const newExperience = player.totalExperience + amount;
    await ctx.db.patch(playerId, {
      totalExperience: newExperience,
      lastUpdated: Date.now(),
    });

    return newExperience;
  },
});

/**
 * Increase a stat
 */
export const increaseStat = mutation({
  args: {
    playerId: v.id("players"),
    stat: v.union(
      v.literal("str"),
      v.literal("dex"),
      v.literal("int"),
      v.literal("luk"),
      v.literal("con")
    ),
    delta: v.number(),
  },
  handler: async (ctx, { playerId, stat, delta }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const statKey = stat as keyof typeof player;
    const currentValue = player[statKey] as number;
    const newValue = Math.max(1, currentValue + delta);

    const updateData: any = {
      lastUpdated: Date.now(),
    };
    updateData[stat] = newValue;

    await ctx.db.patch(playerId, updateData);

    return newValue;
  },
});

/**
 * Advance tier progression (move to next monster in tier or advance tier)
 */
export const advanceTierProgression = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    let newTier = player.currentTier;
    let newProgression = player.currentTierProgression + 1;

    // If we've beaten all 3 monsters in this tier, move to next tier
    if (newProgression >= 3) {
      newProgression = 0;
      newTier += 1;
    }

    await ctx.db.patch(playerId, {
      currentTier: newTier,
      currentTierProgression: newProgression,
      lastUpdated: Date.now(),
    });

    return { tier: newTier, progression: newProgression };
  },
});

/**
 * Check if player can rebirth
 */
export const canRebirth = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) return false;

    return player.currentTier >= player.rebirthTierThreshold;
  },
});

/**
 * Rebirth - reset player to tier 1, increase threshold, increment rebirth count
 */
export const rebirth = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    // Check if eligible for rebirth
    if (player.currentTier < player.rebirthTierThreshold) {
      throw new Error("Not eligible for rebirth yet");
    }

    // Get multiplier for next run: (rebirthCount + 1) * 0.1 + 1
    // Rebirth 0→1: 1.1x, Rebirth 1→2: 1.2x, etc.
    const nextRebirthCount = player.rebirthCount + 1;
    const multiplier = 1 + nextRebirthCount * 0.1;

    // Calculate next threshold index
    const thresholdIndex = Math.min(
      nextRebirthCount,
      REBIRTH_TIER_PROGRESSION.length - 1
    );
    const nextThreshold = REBIRTH_TIER_PROGRESSION[thresholdIndex];

    // Apply multiplier to base stats
    const newStr = Math.floor(STARTING_STATS.str * multiplier);
    const newDex = Math.floor(STARTING_STATS.dex * multiplier);
    const newInt = Math.floor(STARTING_STATS.int * multiplier);
    const newLuk = Math.floor(STARTING_STATS.luk * multiplier);
    const newCon = Math.floor(STARTING_STATS.con * multiplier);

    await ctx.db.patch(playerId, {
      str: newStr,
      dex: newDex,
      int: newInt,
      luk: newLuk,
      con: newCon,
      gold: 0,
      totalExperience: 0,
      rebirthCount: nextRebirthCount,
      rebirthTierThreshold: nextThreshold,
      currentTier: 1,
      currentTierProgression: 0,
      lastUpdated: Date.now(),
    });

    return {
      rebirthCount: nextRebirthCount,
      newThreshold: nextThreshold,
      multiplier,
    };
  },
});

/**
 * Set auto attack state
 */
export const setAutoAttack = mutation({
  args: {
    playerId: v.id("players"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { playerId, enabled }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    await ctx.db.patch(playerId, {
      autoAttackEnabled: enabled,
      lastUpdated: Date.now(),
    });
  },
});

/**
 * Set auto start fight state
 */
export const setAutoStartFight = mutation({
  args: {
    playerId: v.id("players"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { playerId, enabled }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    await ctx.db.patch(playerId, {
      autoStartFightEnabled: enabled,
      lastUpdated: Date.now(),
    });
  },
});

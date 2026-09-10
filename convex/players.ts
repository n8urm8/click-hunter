import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api, components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Default balance constants — must match gameBalance seeds in seed.ts
const STARTING_STATS = { str: 5, dex: 5, int: 5, luk: 5, con: 5 };
const REBIRTH_TIER_PROGRESSION = [5, 10, 15, 21, 28, 36, 45] as const;
const MIN_ATTACK_SPEED = 0.5;
const rateLimiter = new RateLimiter(components.rateLimiter, {});

type PlayerStat = "str" | "dex" | "int" | "luk" | "con";

function getPlayerStat(value: string | undefined): PlayerStat | null {
  switch (value) {
    case "str":
    case "dex":
    case "int":
    case "luk":
    case "con":
      return value;
    default:
      return null;
  }
}

function readStartingStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return STARTING_STATS;
  }

  const candidate = value as Record<string, unknown>;
  const stats = { ...STARTING_STATS };
  for (const stat of Object.keys(stats) as Array<keyof typeof stats>) {
    const statValue = candidate[stat];
    if (typeof statValue === "number" && Number.isFinite(statValue) && statValue >= 1) {
      stats[stat] = statValue;
    }
  }
  return stats;
}

function readRebirthThresholds(value: unknown) {
  if (!Array.isArray(value)) {
    return REBIRTH_TIER_PROGRESSION;
  }

  const thresholds = value.filter(
    (threshold): threshold is number =>
      typeof threshold === "number" &&
      Number.isInteger(threshold) &&
      Number.isFinite(threshold) &&
      threshold >= 1
  );
  return thresholds.length > 0 ? thresholds : REBIRTH_TIER_PROGRESSION;
}

async function getBalanceValue(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value;
}

async function resetPaidStatUpgrades(
  ctx: MutationCtx,
  playerId: Id<"players">
) {
  const [upgradeDefinitions, playerUpgrades] = await Promise.all([
    ctx.db.query("upgrades").collect(),
    ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect(),
  ]);
  const statUpgradesById = new Map(
    upgradeDefinitions
      .filter((upgrade) => upgrade.effectType === "stat-boost")
      .map((upgrade) => [upgrade.upgradeId, upgrade] as const)
  );
  const permanentStatBonuses: Record<PlayerStat, number> = {
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    con: 0,
  };

  for (const playerUpgrade of playerUpgrades) {
    const statUpgrade = statUpgradesById.get(playerUpgrade.upgradeId);
    if (!statUpgrade) continue;

    // Keep free hidden-spot rewards, but reset all paid progress for the next run.
    const recordedPaidCount =
      playerUpgrade.purchaseCount ?? playerUpgrade.quantity;
    const paidPurchaseCount =
      Number.isSafeInteger(recordedPaidCount) && recordedPaidCount >= 0
        ? Math.min(recordedPaidCount, playerUpgrade.quantity)
        : playerUpgrade.quantity;
    const freeQuantity = Math.max(
      0,
      playerUpgrade.quantity - paidPurchaseCount
    );

    if (freeQuantity === 0) {
      await ctx.db.delete(playerUpgrade._id);
    } else {
      const stat = getPlayerStat(statUpgrade.effectStat);
      if (stat && typeof statUpgrade.effectAmount === "number") {
        permanentStatBonuses[stat] += statUpgrade.effectAmount * freeQuantity;
      }

      await ctx.db.patch(playerUpgrade._id, {
        quantity: freeQuantity,
        purchaseCount: 0,
      });
    }
  }

  return permanentStatBonuses;
}

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

    const [startingStatsValue, rebirthThresholdsValue] = await Promise.all([
      getBalanceValue(ctx, "startingStats"),
      getBalanceValue(ctx, "rebirthThresholds"),
    ]);
    const startingStats = readStartingStats(startingStatsValue);
    const rebirthThresholds = readRebirthThresholds(rebirthThresholdsValue);

    // Create new player with live balance values
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      anonymousId,
      name,
      role: "admin",
      str: startingStats.str,
      dex: startingStats.dex,
      int: startingStats.int,
      luk: startingStats.luk,
      con: startingStats.con,
      gold: 0,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: rebirthThresholds[0],
      currentTier: 1,
      maxTierReached: 1,
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
 * Atomically accept an attack when the player's server-side cooldown has elapsed.
 */
export const attemptAttack = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const attackSpeed = Math.max(MIN_ATTACK_SPEED, (player.dex - 10) * 0.1 + 1.0);
    const cooldownMs = Math.ceil(1000 / attackSpeed);
    const status = await rateLimiter.limit(ctx, "manualAttack", {
      key: playerId,
      config: {
        kind: "token bucket",
        rate: 1,
        period: cooldownMs,
        capacity: 1,
      },
    });

    return {
      allowed: status.ok,
      cooldownMs,
      retryAfterMs: status.ok ? cooldownMs : status.retryAfter,
    };
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

    // Note: leaderboards updated asynchronously via scheduled function
    // For now, just update directly for consistency
    await ctx.db.patch(playerId, { lastUpdated: Date.now() });

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
 * Advance tier (update maxTierReached if player beats higher tier)
 */
export const advanceTierProgression = mutation({
  args: {
    playerId: v.id("players"),
    tierJustBeaten: v.number(),
  },
  handler: async (ctx, { playerId, tierJustBeaten }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    // Update maxTierReached if player beat a higher tier
    const newMaxTier = Math.max(player.maxTierReached || 1, tierJustBeaten);

    await ctx.db.patch(playerId, {
      maxTierReached: newMaxTier,
      lastUpdated: Date.now(),
    });

    // Note: Leaderboards could be updated here, but keeping simple for now

    return { maxTier: newMaxTier };
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

    return (player.maxTierReached || 1) >= player.rebirthTierThreshold;
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
    if ((player.maxTierReached || 1) < player.rebirthTierThreshold) {
      throw new Error("Not eligible for rebirth yet");
    }

    // Get multiplier for next run: (rebirthCount + 1) * 0.1 + 1
    // Rebirth 0→1: 1.1x, Rebirth 1→2: 1.2x, etc.
    const nextRebirthCount = player.rebirthCount + 1;
    const multiplier = 1 + nextRebirthCount * 0.1;

    const rebirthThresholds = readRebirthThresholds(
      await getBalanceValue(ctx, "rebirthThresholds")
    );
    const startingStats = readStartingStats(
      await getBalanceValue(ctx, "startingStats")
    );

    // Calculate next threshold index
    const thresholdIndex = Math.min(
      nextRebirthCount,
      rebirthThresholds.length - 1
    );
    const nextThreshold = rebirthThresholds[thresholdIndex];

    // Only stat-boost rows reset here; automation purchases and their toggles persist.
    const permanentStatBonuses = await resetPaidStatUpgrades(ctx, playerId);

    // Hidden-spot bonuses are permanent flat bonuses applied after rebirth scaling.
    const newStr = Math.floor(startingStats.str * multiplier) + permanentStatBonuses.str;
    const newDex = Math.floor(startingStats.dex * multiplier) + permanentStatBonuses.dex;
    const newInt = Math.floor(startingStats.int * multiplier) + permanentStatBonuses.int;
    const newLuk = Math.floor(startingStats.luk * multiplier) + permanentStatBonuses.luk;
    const newCon = Math.floor(startingStats.con * multiplier) + permanentStatBonuses.con;

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
      maxTierReached: 1,
      lastUpdated: Date.now(),
    });

    // Note: Leaderboards could be updated here, but keeping simple for now

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
    if (enabled) {
      const upgrades = await ctx.db
        .query("playerUpgrades")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .collect();
      if (!upgrades.some((upgrade) => upgrade.upgradeId === "auto_attack" && upgrade.quantity > 0)) {
        throw new Error("Purchase Automated Striking first");
      }
    }

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
    if (enabled) {
      const upgrades = await ctx.db
        .query("playerUpgrades")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .collect();
      if (!upgrades.some((upgrade) => upgrade.upgradeId === "auto_start_fight" && upgrade.quantity > 0)) {
        throw new Error("Purchase Battle Automation first");
      }
    }

    await ctx.db.patch(playerId, {
      autoStartFightEnabled: enabled,
      lastUpdated: Date.now(),
    });
  },
});

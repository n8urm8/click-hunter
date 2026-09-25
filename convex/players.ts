import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api, components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureBossForTier } from "./bossData";
import {
  getEquippedStatBonuses,
  getEquippedWeapon,
  getEquippedArmorTotals,
  computeAttackSpeed,
  readCombatBalance,
  grantItemToInventory,
} from "./items";
import { STARTER_KITS } from "./forestCraftingSeed";

// Default balance constants — must match gameBalance seeds in seed.ts
const STARTING_STATS = { str: 1, dex: 1, int: 1, luk: 1, con: 1 };
const REBIRTH_TIER_PROGRESSION = [5, 10, 15, 21, 28, 36, 45] as const;
const rateLimiter = new RateLimiter(components.rateLimiter, {});

type DatabaseCtx = QueryCtx | MutationCtx;

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

async function withEquipmentStats(
  ctx: DatabaseCtx,
  player: Doc<"players">
) {
  const bonuses = await getEquippedStatBonuses(ctx, player._id);
  return {
    ...player,
    equipmentStatBonuses: bonuses,
  };
}

async function resetAllStatUpgrades(
  ctx: MutationCtx,
  playerId: Id<"players">
) {
  // Full wipe: every stat-boost upgrade row (paid and free hidden-spot
  // rewards) is deleted. Rebirth returns all stats to base.
  const [upgradeDefinitions, playerUpgrades] = await Promise.all([
    ctx.db.query("upgrades").collect(),
    ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect(),
  ]);
  const statUpgradeIds = new Set(
    upgradeDefinitions
      .filter((upgrade) => upgrade.effectType === "stat-boost")
      .map((upgrade) => upgrade.upgradeId)
  );

  for (const playerUpgrade of playerUpgrades) {
    if (statUpgradeIds.has(playerUpgrade.upgradeId)) {
      await ctx.db.delete(playerUpgrade._id);
    }
  }
}

const starterWeaponValidator = v.union(
  v.literal("sword"),
  v.literal("dagger"),
  v.literal("mace"),
  v.literal("bow"),
  v.literal("staff")
);

async function grantStarterKit(
  ctx: MutationCtx,
  playerId: Id<"players">,
  starterKey: string,
  autoEquip: boolean
) {
  const kit = STARTER_KITS[starterKey];
  if (!kit) throw new Error("Unknown starter kit");
  const now = Date.now();
  for (const [stableId, slot] of [
    [kit.weapon, "mainHand"],
    [kit.chest, "chest"],
  ] as const) {
    const item = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", stableId))
      .first();
    if (!item) throw new Error(`Starter item ${stableId} is not seeded`);
    let owned = await ctx.db
      .query("playerItems")
      .withIndex("by_playerId_and_itemId", (q) =>
        q.eq("playerId", playerId).eq("itemId", item._id)
      )
      .first();
    if (!owned) {
      await grantItemToInventory(ctx, {
        playerId,
        itemId: item._id,
        quantity: 1,
        overflowSource: {
          sourceType: "crafting",
          sourceId: stableId,
          settlementKey: `${playerId}:starter`,
        },
      });
      owned = await ctx.db
        .query("playerItems")
        .withIndex("by_playerId_and_itemId", (q) =>
          q.eq("playerId", playerId).eq("itemId", item._id)
        )
        .first();
    }
    if (owned && autoEquip) {
      await ctx.db.patch(owned._id, {
        equippedSlot: slot,
        updatedAt: now,
      });
    }
  }
}

/**
 * Get or create a player
 */
export const getOrCreatePlayer = mutation({
  args: {
    anonymousId: v.string(),
    name: v.string(),
    starterId: v.optional(starterWeaponValidator),
  },
  handler: async (ctx, { anonymousId, name, starterId }) => {
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
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0 },
      ...(starterId === undefined ? {} : { starterWeapon: starterId }),
      ...(starterId === undefined ? { pendingStarterPick: true } : {}),
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

    if (starterId !== undefined) {
      await grantStarterKit(ctx, playerId, starterId, true);
    }

    return await ctx.db.get(playerId);
  },
});

/**
 * Choose a starter kit after rebirth (re-pick each run).
 */
export const chooseStarter = mutation({
  args: {
    playerId: v.id("players"),
    starterId: starterWeaponValidator,
  },
  handler: async (ctx, { playerId, starterId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    if (!player.pendingStarterPick) {
      throw new Error("No starter kit is pending");
    }
    await grantStarterKit(ctx, playerId, starterId, false);
    await ctx.db.patch(playerId, {
      starterWeapon: starterId,
      pendingStarterPick: undefined,
      lastUpdated: Date.now(),
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
    const player = await ctx.db
      .query("players")
      .withIndex("by_anonymousId", (q) => q.eq("anonymousId", anonymousId))
      .first();
    return player ? await withEquipmentStats(ctx, player) : null;
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
    const player = await ctx.db.get(playerId);
    return player ? await withEquipmentStats(ctx, player) : null;
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

    const bonuses = await getEquippedStatBonuses(ctx, playerId);
    const [weapon, armor, balance] = await Promise.all([
      getEquippedWeapon(ctx, playerId),
      getEquippedArmorTotals(ctx, playerId),
      readCombatBalance(ctx),
    ]);
    const attackSpeed = computeAttackSpeed(
      weapon?.attackSpeed ?? 1,
      player.dex + bonuses.dex,
      armor.speedPenalty,
      balance
    );
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
    await ensureBossForTier(ctx, newMaxTier);

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

    const nextRebirthCount = player.rebirthCount + 1;

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

    // Full wipe: all stats return to base (earned and paid alike).
    // Permanent prestige power lives only in rebirth unlocks.
    await resetAllStatUpgrades(ctx, playerId);

    await ctx.db.patch(playerId, {
      str: startingStats.str,
      dex: startingStats.dex,
      int: startingStats.int,
      luk: startingStats.luk,
      con: startingStats.con,
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0 },
      pendingStarterPick: true,
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

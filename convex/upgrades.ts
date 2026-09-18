import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  calculatePlayerLevel,
} from "./bossData";
import { settleRegularFight } from "./combat";
import { settleCombatFight } from "./loot";

const ONE_TIME_AUTOMATION_EFFECTS = new Set([
  "enable-auto-attack",
  "enable-auto-start-fight",
]);
const DEFAULT_STAT_UPGRADE_COST_MULTIPLIER = 2;
const DEFAULT_STAT_UPGRADE_LEVEL_REQUIREMENTS = [
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377,
];

type DatabaseCtx = QueryCtx | MutationCtx;

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value;
}

function readStatUpgradeCostMultiplier(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1
    ? value
    : DEFAULT_STAT_UPGRADE_COST_MULTIPLIER;
}

function readStatUpgradeLevelRequirements(value: unknown) {
  if (!Array.isArray(value)) {
    return DEFAULT_STAT_UPGRADE_LEVEL_REQUIREMENTS;
  }

  const requirements = value.filter(
    (requirement): requirement is number =>
      Number.isSafeInteger(requirement) && requirement >= 1
  );

  return requirements.length >= 2
    ? requirements
    : DEFAULT_STAT_UPGRADE_LEVEL_REQUIREMENTS;
}

function getStatUpgradeLevelRequirement(
  requirements: number[],
  level: number
) {
  if (level <= requirements.length) {
    return requirements[level - 1];
  }

  let previous = requirements[requirements.length - 2];
  let current = requirements[requirements.length - 1];
  for (let currentLevel = requirements.length + 1; currentLevel <= level; currentLevel++) {
    const next = Math.min(Number.MAX_SAFE_INTEGER, previous + current);
    previous = current;
    current = next;
  }

  return current;
}

function calculateStatUpgradeCost(
  baseCost: number,
  purchaseCount: number,
  costMultiplier: number
) {
  const cost = baseCost * Math.pow(costMultiplier, purchaseCount);
  if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER) {
    throw new Error("Stat upgrade cost exceeds the supported limit");
  }

  return Math.max(0, Math.ceil(cost));
}

async function getStatUpgradeRules(ctx: DatabaseCtx) {
  const [costMultiplierValue, levelRequirementsValue] = await Promise.all([
    getBalanceValue(ctx, "statUpgradeCostMultiplier"),
    getBalanceValue(ctx, "statUpgradeLevelRequirements"),
  ]);

  return {
    costMultiplier: readStatUpgradeCostMultiplier(costMultiplierValue),
    levelRequirements: readStatUpgradeLevelRequirements(levelRequirementsValue),
  };
}

function getPurchaseCount(
  upgrade: { effectType: string },
  existing: { quantity: number; purchaseCount?: number } | undefined
) {
  if (upgrade.effectType !== "stat-boost") {
    return 0;
  }

  const purchaseCount = existing?.purchaseCount ?? existing?.quantity ?? 0;
  return Number.isSafeInteger(purchaseCount) && purchaseCount >= 0
    ? purchaseCount
    : 0;
}

function getUpgradePurchaseDetails(
  upgrade: {
    effectType: string;
    cost: number;
    minLevel?: number;
  },
  existing: { quantity: number; purchaseCount?: number } | undefined,
  rules: {
    costMultiplier: number;
    levelRequirements: number[];
  }
) {
  const isStatUpgrade = upgrade.effectType === "stat-boost";
  const purchaseCount = getPurchaseCount(upgrade, existing);
  const purchaseLevel = isStatUpgrade ? purchaseCount + 1 : null;
  const dynamicRequiredLevel = isStatUpgrade
    ? getStatUpgradeLevelRequirement(
        rules.levelRequirements,
        purchaseCount + 1
      )
    : null;
  const requiredLevel =
    dynamicRequiredLevel === null
      ? upgrade.minLevel ?? null
      : Math.max(upgrade.minLevel ?? 1, dynamicRequiredLevel);
  const purchaseCost = isStatUpgrade
    ? calculateStatUpgradeCost(
        upgrade.cost,
        purchaseCount,
        rules.costMultiplier
      )
    : upgrade.cost;

  return {
    ownedQuantity: existing?.quantity ?? 0,
    purchaseCount,
    purchaseLevel,
    purchaseCost,
    requiredLevel,
  };
}

async function ownsUpgrade(
  ctx: MutationCtx,
  playerId: Id<"players">,
  upgradeId: string
) {
  const upgrades = await ctx.db
    .query("playerUpgrades")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();

  return upgrades.some(
    (upgrade) => upgrade.upgradeId === upgradeId && upgrade.quantity > 0
  );
}

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
 * Get upgrades with player-specific next-purchase details for the shop.
 */
export const getShopUpgrades = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const [upgrades, ownedUpgrades, rules] = await Promise.all([
      ctx.db.query("upgrades").collect(),
      ctx.db
        .query("playerUpgrades")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .collect(),
      getStatUpgradeRules(ctx),
    ]);
    const ownedByUpgradeId = new Map(
      ownedUpgrades.map((ownedUpgrade) => [
        ownedUpgrade.upgradeId,
        ownedUpgrade,
      ])
    );

    return upgrades.map((upgrade) => ({
      ...upgrade,
      ...getUpgradePurchaseDetails(
        upgrade,
        ownedByUpgradeId.get(upgrade.upgradeId),
        rules
      ),
    }));
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

    // Check prerequisites
    const reachedTier = player.maxTierReached ?? player.currentTier;
    if (upgrade.minTier && reachedTier < upgrade.minTier) {
      throw new Error("Not at required tier");
    }
    const playerLevel = calculatePlayerLevel(player);

    const existingUpgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();
    const existing = existingUpgrades.find(
      (owned) => owned.upgradeId === upgradeId
    );

    if (existing && ONE_TIME_AUTOMATION_EFFECTS.has(upgrade.effectType)) {
      throw new Error("Upgrade already owned");
    }

    const rules = await getStatUpgradeRules(ctx);
    const purchaseDetails = getUpgradePurchaseDetails(
      upgrade,
      existing,
      rules
    );
    if (
      purchaseDetails.requiredLevel !== null &&
      playerLevel < purchaseDetails.requiredLevel
    ) {
      if (purchaseDetails.purchaseLevel === null) {
        throw new Error(`Requires level ${purchaseDetails.requiredLevel}`);
      }
      throw new Error(
        `Requires character level ${purchaseDetails.requiredLevel} for stat upgrade level ${purchaseDetails.purchaseLevel}`
      );
    }

    // Check gold
    if (player.gold < purchaseDetails.purchaseCost) {
      throw new Error("Insufficient gold");
    }

    // Deduct gold
    await ctx.db.patch(playerId, {
      gold: player.gold - purchaseDetails.purchaseCost,
      lastUpdated: Date.now(),
    });

    const now = Date.now();
    if (existing) {
      // Increment quantity
      const updates: {
        quantity: number;
        purchaseCount?: number;
      } = {
        quantity: existing.quantity + 1,
      };
      if (upgrade.effectType === "stat-boost") {
        updates.purchaseCount = purchaseDetails.purchaseCount + 1;
      }
      await ctx.db.patch(existing._id, {
        ...updates,
      });
    } else {
      // Create new upgrade record
      await ctx.db.insert("playerUpgrades", {
        playerId,
        upgradeId,
        quantity: 1,
        ...(upgrade.effectType === "stat-boost"
          ? { purchaseCount: 1 }
          : {}),
        purchasedAt: now,
      });
    }

    // Apply upgrade effect
    await applyUpgradeEffect(ctx, playerId, upgradeId);

    return {
      success: true,
      upgradeId,
      purchaseLevel: purchaseDetails.purchaseLevel,
      cost: purchaseDetails.purchaseCost,
    };
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
    isBoss: v.boolean(),
    won: v.boolean(),
    goldEarned: v.optional(v.number()),
    experienceEarned: v.optional(v.number()),
    settlementKey: v.optional(v.string()),
  },
  handler: async (ctx, {
    playerId,
    monsterTier,
    monsterType,
    isBoss,
    won,
    settlementKey,
  }) => {
    const key =
      settlementKey?.trim() ||
      `${playerId}:${isBoss ? "boss" : "monster"}:${monsterType}:${monsterTier}:${Date.now()}`;
    if (!isBoss) {
      return await settleRegularFight(ctx, {
        playerId,
        monsterTier,
        monsterType,
        won,
        settlementKey: key,
      });
    }

    const boss = await ctx.db
      .query("bosses")
      .withIndex("by_bossId", (q) => q.eq("bossId", monsterType))
      .first();
    if (!boss || boss.tier !== monsterTier) {
      throw new Error("Boss not found for this tier");
    }

    return await settleCombatFight(ctx, {
      playerId,
      settlementKey: key,
      sourceType: "boss",
      sourceId: monsterType,
      tier: monsterTier,
      won,
    });
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
      ...(upgrade.effectType === "stat-boost" ? { purchaseCount: 0 } : {}),
      purchasedAt: Date.now(),
    });

    // Apply the upgrade effect directly
    await applyUpgradeEffect(ctx, playerId, upgradeId);

    return { success: true, upgrade };
  },
});

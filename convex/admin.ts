import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./adminAuth";

const STAT_KEYS = new Set(["str", "dex", "int", "luk", "con"]);

function requiredText(value: string, field: string, maxLength = 500) {
  const text = value.trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  if (text.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  }
  return text;
}

function numberAtLeast(value: number, field: string, minimum: number) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a finite number >= ${minimum}`);
  }
  return value;
}

function integerAtLeast(value: number, field: string, minimum: number) {
  numberAtLeast(value, field, minimum);
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  return value;
}

function optionalNumber(
  value: number | null,
  field: string,
  minimum: number
) {
  return value === null
    ? undefined
    : numberAtLeast(value, field, minimum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConvexValue(value: unknown, field = "value", depth = 0): void {
  if (depth > 10) {
    throw new Error(`${field} is nested too deeply`);
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > 10_000) {
      throw new Error(`${field} contains an oversized string`);
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${field} must not contain NaN or Infinity`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 8192) {
      throw new Error(`${field} contains too many items`);
    }
    value.forEach((item, index) =>
      assertConvexValue(item, `${field}[${index}]`, depth + 1)
    );
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 1024) {
      throw new Error(`${field} contains too many properties`);
    }
    for (const [key, nestedValue] of entries) {
      if (!key || key.startsWith("_")) {
        throw new Error(`${field} contains an invalid property name`);
      }
      assertConvexValue(nestedValue, `${field}.${key}`, depth + 1);
    }
    return;
  }

  throw new Error(`${field} must be a Convex-compatible value`);
}

/**
 * Read all live configuration for the admin editor.
 */
export const getConfig = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);

    const [
      gameBalance,
      upgrades,
      monsters,
      hiddenSpots,
      achievements,
      rebirthRewards,
      gameEvents,
    ] = await Promise.all([
      ctx.db.query("gameBalance").collect(),
      ctx.db.query("upgrades").collect(),
      ctx.db.query("monsters").collect(),
      ctx.db.query("hiddenSpots").collect(),
      ctx.db.query("achievements").collect(),
      ctx.db.query("rebirthRewards").collect(),
      ctx.db.query("gameEvents").collect(),
    ]);

    return {
      gameBalance,
      upgrades,
      monsters,
      hiddenSpots,
      achievements,
      rebirthRewards,
      gameEvents,
    };
  },
});

export const updateGameBalance = mutation({
  args: {
    playerId: v.id("players"),
    balanceId: v.id("gameBalance"),
    value: v.any(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    assertConvexValue(args.value);

    const balance = await ctx.db.get(args.balanceId);
    if (!balance) {
      throw new Error("Balance entry not found");
    }

    await ctx.db.patch(balance._id, {
      value: args.value,
      description: requiredText(args.description, "Description"),
      lastUpdated: Date.now(),
    });

    return await ctx.db.get(balance._id);
  },
});

export const updateUpgrade = mutation({
  args: {
    playerId: v.id("players"),
    upgradeId: v.id("upgrades"),
    name: v.string(),
    category: v.string(),
    cost: v.number(),
    description: v.string(),
    effectType: v.string(),
    effectStat: v.union(v.string(), v.null()),
    effectAmount: v.union(v.number(), v.null()),
    minTier: v.union(v.number(), v.null()),
    minLevel: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const upgrade = await ctx.db.get(args.upgradeId);
    if (!upgrade) {
      throw new Error("Upgrade not found");
    }

    const effectStat =
      args.effectStat === null
        ? undefined
        : requiredText(args.effectStat, "Effect stat", 50);
    if (effectStat && !STAT_KEYS.has(effectStat)) {
      throw new Error("Effect stat must be STR, DEX, INT, LUK, or CON");
    }

    const effectAmount = optionalNumber(args.effectAmount, "Effect amount", 0);
    const minTier = args.minTier === null
      ? undefined
      : integerAtLeast(args.minTier, "Minimum tier", 1);
    const minLevel = args.minLevel === null
      ? undefined
      : integerAtLeast(args.minLevel, "Minimum level", 1);

    await ctx.db.replace(upgrade._id, {
      upgradeId: upgrade.upgradeId,
      name: requiredText(args.name, "Name"),
      category: requiredText(args.category, "Category", 100),
      cost: numberAtLeast(args.cost, "Cost", 0),
      description: requiredText(args.description, "Description"),
      effectType: requiredText(args.effectType, "Effect type", 100),
      ...(effectStat === undefined ? {} : { effectStat }),
      ...(effectAmount === undefined ? {} : { effectAmount }),
      ...(minTier === undefined ? {} : { minTier }),
      ...(minLevel === undefined ? {} : { minLevel }),
      createdAt: upgrade.createdAt,
    });

    return await ctx.db.get(upgrade._id);
  },
});

export const updateMonster = mutation({
  args: {
    playerId: v.id("players"),
    monsterId: v.id("monsters"),
    name: v.string(),
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    goldDrop: v.number(),
    experienceReward: v.number(),
    baseMsPerAttack: v.number(),
    strength: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const monster = await ctx.db.get(args.monsterId);
    if (!monster) {
      throw new Error("Monster not found");
    }

    await ctx.db.patch(monster._id, {
      name: requiredText(args.name, "Name"),
      str: numberAtLeast(args.str, "STR", 0),
      dex: numberAtLeast(args.dex, "DEX", 0),
      int: numberAtLeast(args.int, "INT", 0),
      luk: numberAtLeast(args.luk, "LUK", 0),
      con: numberAtLeast(args.con, "CON", 0),
      goldDrop: numberAtLeast(args.goldDrop, "Gold drop", 0),
      experienceReward: numberAtLeast(
        args.experienceReward,
        "Experience reward",
        0
      ),
      baseMsPerAttack: numberAtLeast(
        args.baseMsPerAttack,
        "Base milliseconds per attack",
        1
      ),
      strength: numberAtLeast(args.strength, "Difficulty weight", 0),
    });

    return await ctx.db.get(monster._id);
  },
});

export const updateHiddenSpot = mutation({
  args: {
    playerId: v.id("players"),
    spotId: v.id("hiddenSpots"),
    x: v.number(),
    y: v.number(),
    rewardUpgradeId: v.string(),
    radius: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const spot = await ctx.db.get(args.spotId);
    if (!spot) {
      throw new Error("Hidden spot not found");
    }

    const x = numberAtLeast(args.x, "X position", 0);
    const y = numberAtLeast(args.y, "Y position", 0);
    if (x > 100 || y > 100) {
      throw new Error("X and Y positions must be between 0 and 100");
    }
    const rewardUpgradeId = requiredText(
      args.rewardUpgradeId,
      "Reward upgrade ID",
      100
    );
    const rewardUpgrade = await ctx.db
      .query("upgrades")
      .withIndex("by_upgradeId", (q) => q.eq("upgradeId", rewardUpgradeId))
      .first();
    if (!rewardUpgrade) {
      throw new Error("Reward upgrade not found");
    }

    await ctx.db.patch(spot._id, {
      x,
      y,
      rewardUpgradeId,
      radius: numberAtLeast(args.radius, "Radius", 1),
    });

    return await ctx.db.get(spot._id);
  },
});

export const updateAchievement = mutation({
  args: {
    playerId: v.id("players"),
    achievementId: v.id("achievements"),
    name: v.string(),
    description: v.string(),
    icon: v.union(v.string(), v.null()),
    condition: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const achievement = await ctx.db.get(args.achievementId);
    if (!achievement) {
      throw new Error("Achievement not found");
    }

    const icon =
      args.icon === null ? undefined : requiredText(args.icon, "Icon", 50);
    await ctx.db.replace(achievement._id, {
      achievementId: achievement.achievementId,
      name: requiredText(args.name, "Name"),
      description: requiredText(args.description, "Description"),
      ...(icon === undefined ? {} : { icon }),
      condition: requiredText(args.condition, "Condition", 200),
      createdAt: achievement.createdAt,
    });

    return await ctx.db.get(achievement._id);
  },
});

export const updateRebirthReward = mutation({
  args: {
    playerId: v.id("players"),
    rewardId: v.id("rebirthRewards"),
    name: v.string(),
    description: v.string(),
    effectType: v.string(),
    effectValue: v.union(v.number(), v.null()),
    effectData: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const reward = await ctx.db.get(args.rewardId);
    if (!reward) {
      throw new Error("Rebirth reward not found");
    }

    assertConvexValue(args.effectData, "Effect data");
    const effectValue = optionalNumber(args.effectValue, "Effect value", 0);
    await ctx.db.replace(reward._id, {
      rebirthLevel: reward.rebirthLevel,
      name: requiredText(args.name, "Name"),
      description: requiredText(args.description, "Description"),
      effectType: requiredText(args.effectType, "Effect type", 100),
      ...(effectValue === undefined ? {} : { effectValue }),
      effectData: args.effectData,
      createdAt: reward.createdAt,
    });

    return await ctx.db.get(reward._id);
  },
});

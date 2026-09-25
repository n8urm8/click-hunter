import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./adminAuth";
import {
  DEFAULT_ITEM_RARITY_LEVEL,
  EQUIPMENT_SLOT_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  SKILL_BONUS_SCOPE_VALUES,
  SKILL_TASK_EFFECT_TYPES,
  type ItemEffectStat,
  type SkillBonusScope,
} from "./itemTypes";
import {
  equipmentSlotValidator,
  itemCategoryValidator,
  normalizeItemDefinition,
} from "./items";
import { validateRecipeChain } from "./recipeValidation";

const STAT_KEYS = new Set(["str", "dex", "int", "luk", "con"]);
const craftingConfigKindValidator = v.union(
  v.literal("skill"),
  v.literal("skill-tier"),
  v.literal("gathering"),
  v.literal("recipe"),
  v.literal("augmentation"),
  v.literal("loot-table"),
  v.literal("loot-entry"),
  v.literal("loot-source")
);
const skillCategoryValidator = v.union(
  v.literal("gathering"),
  v.literal("crafting")
);
const lootSourceTypeValidator = v.union(
  v.literal("monster"),
  v.literal("boss")
);
const lootPurposeValidator = v.union(
  v.literal("augmentation"),
  v.literal("boss-catalyst")
);
const itemEffectStatValidator = v.union(
  ...ITEM_EFFECT_STAT_VALUES.map((value) => v.literal(value))
);
const skillBonusScopeValidator = v.union(
  ...SKILL_BONUS_SCOPE_VALUES.map((value) => v.literal(value))
);
const recipeItemInputValidator = v.object({
  itemId: v.string(),
  quantity: v.number(),
});
const recipeStageValidator = v.union(
  v.literal("refinement"),
  v.literal("product"),
  v.literal("consumable")
);
const damageStatValidator = v.union(
  v.literal("str"),
  v.literal("dex"),
  v.literal("int")
);
const damageTypeValidator = v.union(
  v.literal("physical"),
  v.literal("magical")
);
const buffVariantValidator = v.union(
  v.literal("base"),
  v.literal("advanced")
);

function isSkillTaskEffectType(value: string) {
  return SKILL_TASK_EFFECT_TYPES.some((effectType) => effectType === value);
}

function normalizeItemEffectScope(
  effectType: string | undefined,
  effectAmount: number | undefined,
  effectDurationMs: number | undefined,
  effectScope: SkillBonusScope | undefined
) {
  if (effectType !== undefined && isSkillTaskEffectType(effectType)) {
    if (
      effectAmount === undefined ||
      effectAmount <= 0 ||
      effectDurationMs === undefined
    ) {
      throw new Error(
        "Skill boost items require a positive multiplier and duration"
      );
    }
    return effectScope ?? "all";
  }
  if (effectScope !== undefined) {
    throw new Error("Only skill boost items can define an effect scope");
  }
  return undefined;
}

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

function requiredColor(value: string) {
  const color = requiredText(value, "Color", 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error("Color must be a six-digit CSS hex value such as #9ca3af");
  }
  return color.toLowerCase();
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

async function getDefaultItemRarityLevel(ctx: MutationCtx) {
  const rarity = await ctx.db
    .query("itemRarities")
    .withIndex("by_level")
    .order("asc")
    .first();
  return rarity?.level ?? DEFAULT_ITEM_RARITY_LEVEL;
}

async function requireItemRarity(ctx: MutationCtx, level: number) {
  const rarityLevel = integerAtLeast(level, "Rarity level", 1);
  const rarity = await ctx.db
    .query("itemRarities")
    .withIndex("by_level", (q) => q.eq("level", rarityLevel))
    .first();
  if (!rarity) {
    throw new Error(`Rarity level ${rarityLevel} does not exist`);
  }
  return rarityLevel;
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

function optionalItemText(
  value: string | null | undefined,
  field: string,
  maxLength = 500
) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requiredText(value, field, maxLength);
}

function optionalItemInteger(
  value: number | null | undefined,
  field: string,
  minimum = 0
) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return integerAtLeast(value, field, minimum);
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

function recordValue(value: unknown, field: string) {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return value;
}

function stringValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  maxLength = 500
) {
  if (typeof record[key] !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return requiredText(record[key], field, maxLength);
}

function optionalStringValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  maxLength = 500
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }
  return requiredText(value, field, maxLength);
}

function booleanValue(
  record: Record<string, unknown>,
  key: string,
  field: string
) {
  if (typeof record[key] !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return record[key];
}

function numberValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  minimum = 0
) {
  if (typeof record[key] !== "number") {
    throw new Error(`${field} must be a number`);
  }
  return numberAtLeast(record[key], field, minimum);
}

function integerValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  minimum = 0
) {
  return integerAtLeast(numberValue(record, key, field, minimum), field, minimum);
}

function optionalIntegerValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  minimum = 0
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${field} must be an integer or null`);
  }
  return integerAtLeast(value, field, minimum);
}

function nullableStringValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
  maxLength = 500
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }
  return requiredText(value, field, maxLength);
}

function itemEffectStatValue(
  record: Record<string, unknown>,
  key: string,
  field: string
): ItemEffectStat | undefined {
  const value = nullableStringValue(record, key, field, 20);
  if (value === undefined) return undefined;
  if (!ITEM_EFFECT_STAT_VALUES.includes(value as ItemEffectStat)) {
    throw new Error(`${field} must be STR, DEX, INT, LUK, or CON`);
  }
  return value as ItemEffectStat;
}

function equipmentSlotsValue(
  record: Record<string, unknown>,
  key: string
) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error("Allowed equipment slots must be an array");
  }
  const slots = Array.from(new Set(value));
  for (const slot of slots) {
    if (
      typeof slot !== "string" ||
      !EQUIPMENT_SLOT_VALUES.includes(slot as (typeof EQUIPMENT_SLOT_VALUES)[number])
    ) {
      throw new Error(`Unsupported equipment slot: ${String(slot)}`);
    }
  }
  return slots as (typeof EQUIPMENT_SLOT_VALUES)[number][];
}

async function itemIdValue(
  ctx: MutationCtx,
  record: Record<string, unknown>,
  key: string,
  field: string,
  allowNull: true
): Promise<Id<"items"> | undefined>;
async function itemIdValue(
  ctx: MutationCtx,
  record: Record<string, unknown>,
  key: string,
  field: string,
  allowNull?: false
): Promise<Id<"items">>;
async function itemIdValue(
  ctx: MutationCtx,
  record: Record<string, unknown>,
  key: string,
  field: string,
  allowNull = false
) : Promise<Id<"items"> | undefined> {
  const value = record[key];
  if (allowNull && (value === undefined || value === null || value === "")) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be an item ID${allowNull ? " or null" : ""}`);
  }
  const itemId = requiredText(value, field, 100);
  const item = await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
    .first();
  if (!item) {
    throw new Error(`${field} references an unknown item`);
  }
  return item._id;
}

async function recipeItemRows(
  ctx: MutationCtx,
  value: unknown,
  field: string
) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  const rows: Array<{ itemId: string; quantity: number; itemRef: Id<"items"> }> = [];
  for (const [index, entry] of value.entries()) {
    const row = recordValue(entry, `${field}[${index}]`);
    const itemId = stringValue(row, "itemId", `${field}[${index}].itemId`, 100);
    const item = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
      .first();
    if (!item) {
      throw new Error(`${field}[${index}] references an unknown item`);
    }
    rows.push({
      itemId,
      quantity: integerValue(row, "quantity", `${field}[${index}].quantity`, 1),
      itemRef: item._id,
    });
  }
  if (new Set(rows.map((row) => row.itemId)).size !== rows.length) {
    throw new Error(`${field} cannot contain duplicate items`);
  }
  return rows;
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
      itemRarities,
      items,
      monsters,
      bosses,
      hiddenSpots,
      achievements,
      rebirthRewards,
      gameEvents,
      taskDefinitions,
      skillDefinitions,
      skillTierDefinitions,
      gatheringActivities,
      recipes,
      recipeIngredients,
      recipeOutputs,
      augmentationDefinitions,
      lootTables,
      lootTableEntries,
      lootSources,
    ] = await Promise.all([
      ctx.db.query("gameBalance").collect(),
      ctx.db.query("upgrades").collect(),
      ctx.db.query("itemRarities").collect(),
      ctx.db.query("items").collect(),
      ctx.db.query("monsters").collect(),
      ctx.db.query("bosses").collect(),
      ctx.db.query("hiddenSpots").collect(),
      ctx.db.query("achievements").collect(),
      ctx.db.query("rebirthRewards").collect(),
      ctx.db.query("gameEvents").collect(),
      ctx.db.query("taskDefinitions").collect(),
      ctx.db.query("skillDefinitions").collect(),
      ctx.db.query("skillTierDefinitions").collect(),
      ctx.db.query("gatheringActivities").collect(),
      ctx.db.query("recipes").collect(),
      ctx.db.query("recipeIngredients").collect(),
      ctx.db.query("recipeOutputs").collect(),
      ctx.db.query("augmentationDefinitions").collect(),
      ctx.db.query("lootTables").collect(),
      ctx.db.query("lootTableEntries").collect(),
      ctx.db.query("lootSources").collect(),
    ]);

    return {
      gameBalance,
      upgrades,
      itemRarities,
      items,
      monsters,
      bosses,
      hiddenSpots,
      achievements,
      rebirthRewards,
      gameEvents,
      taskDefinitions,
      skillDefinitions,
      skillTierDefinitions,
      gatheringActivities,
      recipes,
      recipeIngredients,
      recipeOutputs,
      augmentationDefinitions,
      lootTables,
      lootTableEntries,
      lootSources,
    };
  },
});

export const getPlayers = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);

    const players = await ctx.db.query("players").collect();
    return players
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.createdAt - right.createdAt
      )
      .map((player) => ({
        _id: player._id,
        name: player.name,
        anonymousId: player.anonymousId,
        str: player.str,
        dex: player.dex,
        int: player.int,
        luk: player.luk,
        con: player.con,
        gold: player.gold,
        totalExperience: player.totalExperience,
        currentTier: player.currentTier,
        maxTierReached: player.maxTierReached ?? player.currentTier,
        rebirthCount: player.rebirthCount,
        rebirthTierThreshold: player.rebirthTierThreshold,
        lastUpdated: player.lastUpdated,
      }));
  },
});

export const updatePlayer = mutation({
  args: {
    adminPlayerId: v.id("players"),
    targetPlayerId: v.id("players"),
    expectedLastUpdated: v.number(),
    name: v.string(),
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    gold: v.number(),
    totalExperience: v.number(),
    currentTier: v.number(),
    maxTierReached: v.number(),
    rebirthCount: v.number(),
    rebirthTierThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminPlayerId);

    const player = await ctx.db.get(args.targetPlayerId);
    if (!player) {
      throw new Error("Player not found");
    }

    if (player.lastUpdated !== args.expectedLastUpdated) {
      throw new Error(
        "Character data changed while you were editing. Reload the character before saving."
      );
    }

    const name = requiredText(args.name, "Name", 100);
    integerAtLeast(args.str, "STR", 1);
    integerAtLeast(args.dex, "DEX", 1);
    integerAtLeast(args.int, "INT", 1);
    integerAtLeast(args.luk, "LUK", 1);
    integerAtLeast(args.con, "CON", 1);
    integerAtLeast(args.gold, "Gold", 0);
    integerAtLeast(args.totalExperience, "Total experience", 0);
    integerAtLeast(args.currentTier, "Current tier", 1);
    integerAtLeast(args.maxTierReached, "Best tier", 1);
    integerAtLeast(args.rebirthCount, "Rebirth count", 0);
    integerAtLeast(
      args.rebirthTierThreshold,
      "Rebirth tier threshold",
      1
    );

    if (args.currentTier > args.maxTierReached) {
      throw new Error("Current tier cannot exceed best tier");
    }

    const lastUpdated = Date.now();
    await ctx.db.patch(player._id, {
      name,
      str: args.str,
      dex: args.dex,
      int: args.int,
      luk: args.luk,
      con: args.con,
      gold: args.gold,
      totalExperience: args.totalExperience,
      currentTier: args.currentTier,
      maxTierReached: args.maxTierReached,
      rebirthCount: args.rebirthCount,
      rebirthTierThreshold: args.rebirthTierThreshold,
      lastUpdated,
    });

    return { playerId: player._id, lastUpdated };
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

function normalizeTaskDefinition(args: {
  name: string;
  category: string;
  description: string;
  durationMs: number | null;
  canProgressOffline: boolean;
  requiresOnline: boolean;
  enabled: boolean;
  prerequisites: unknown;
  rewards: unknown;
}) {
  const name = requiredText(args.name, "Name");
  const category = requiredText(args.category, "Category", 100);
  const description = requiredText(args.description, "Description");
  const durationMs =
    args.durationMs === null
      ? undefined
      : integerAtLeast(args.durationMs, "Duration", 1);

  if (category !== "battle" && durationMs === undefined) {
    throw new Error("Non-battle task definitions require a duration");
  }
  if (args.canProgressOffline && args.requiresOnline) {
    throw new Error("A task cannot require online play and progress offline");
  }
  assertConvexValue(args.prerequisites, "Prerequisites");
  assertConvexValue(args.rewards, "Rewards");

  return {
    name,
    category,
    description,
    ...(durationMs === undefined ? {} : { durationMs }),
    canProgressOffline: args.canProgressOffline,
    requiresOnline: args.requiresOnline,
    enabled: args.enabled,
    ...(args.prerequisites === null
      ? {}
      : { prerequisites: args.prerequisites }),
    ...(args.rewards === null ? {} : { rewards: args.rewards }),
  };
}

export const createTaskDefinition = mutation({
  args: {
    playerId: v.id("players"),
    taskId: v.string(),
    name: v.string(),
    category: v.string(),
    description: v.string(),
    durationMs: v.union(v.number(), v.null()),
    canProgressOffline: v.boolean(),
    requiresOnline: v.boolean(),
    enabled: v.boolean(),
    prerequisites: v.any(),
    rewards: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const taskId = requiredText(args.taskId, "Task ID", 100);
    const existing = await ctx.db
      .query("taskDefinitions")
      .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
      .first();
    if (existing) {
      throw new Error("A task with that ID already exists");
    }

    const now = Date.now();
    const definitionId = await ctx.db.insert("taskDefinitions", {
      taskId,
      ...normalizeTaskDefinition(args),
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(definitionId);
  },
});

export const updateTaskDefinition = mutation({
  args: {
    playerId: v.id("players"),
    taskDefinitionId: v.id("taskDefinitions"),
    name: v.string(),
    category: v.string(),
    description: v.string(),
    durationMs: v.union(v.number(), v.null()),
    canProgressOffline: v.boolean(),
    requiresOnline: v.boolean(),
    enabled: v.boolean(),
    prerequisites: v.any(),
    rewards: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.taskDefinitionId);
    if (!existing) {
      throw new Error("Task definition not found");
    }

    await ctx.db.replace(existing._id, {
      taskId: existing.taskId,
      ...normalizeTaskDefinition(args),
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
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

export const createItemRarity = mutation({
  args: {
    playerId: v.id("players"),
    level: v.number(),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);

    const level = integerAtLeast(args.level, "Rarity level", 1);
    const name = requiredText(args.name, "Name", 100);
    const color = requiredColor(args.color);
    const existing = await ctx.db
      .query("itemRarities")
      .withIndex("by_level", (q) => q.eq("level", level))
      .first();
    if (existing) {
      throw new Error(`Rarity level ${level} already exists`);
    }

    const now = Date.now();
    const rarityId = await ctx.db.insert("itemRarities", {
      level,
      name,
      color,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(rarityId);
  },
});

export const updateItemRarity = mutation({
  args: {
    playerId: v.id("players"),
    rarityId: v.id("itemRarities"),
    level: v.number(),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);

    const rarity = await ctx.db.get(args.rarityId);
    if (!rarity) {
      throw new Error("Item rarity not found");
    }

    const level = integerAtLeast(args.level, "Rarity level", 1);
    const name = requiredText(args.name, "Name", 100);
    const color = requiredColor(args.color);
    const duplicate = await ctx.db
      .query("itemRarities")
      .withIndex("by_level", (q) => q.eq("level", level))
      .first();
    if (duplicate && duplicate._id !== rarity._id) {
      throw new Error(`Rarity level ${level} already exists`);
    }

    const now = Date.now();
    if (level !== rarity.level) {
      const items =
        rarity.level === DEFAULT_ITEM_RARITY_LEVEL
          ? (await ctx.db.query("items").collect()).filter(
              (item) =>
                item.rarityLevel === undefined ||
                item.rarityLevel === rarity.level
            )
          : await ctx.db
              .query("items")
              .withIndex("by_rarityLevel", (q) =>
                q.eq("rarityLevel", rarity.level)
              )
              .collect();
      for (const item of items) {
        await ctx.db.patch(item._id, {
          rarityLevel: level,
          updatedAt: now,
        });
      }
    }

    await ctx.db.replace(rarity._id, {
      level,
      name,
      color,
      createdAt: rarity.createdAt,
      updatedAt: now,
    });
    return await ctx.db.get(rarity._id);
  },
});

export const createItem = mutation({
  args: {
    playerId: v.id("players"),
    itemId: v.string(),
    name: v.string(),
    category: itemCategoryValidator,
    description: v.string(),
    stackable: v.boolean(),
    maxStackSize: v.number(),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    rarityLevel: v.optional(v.number()),
    itemFamily: v.optional(v.union(v.string(), v.null())),
    craftingSkillId: v.optional(v.union(v.string(), v.null())),
    craftingTier: v.optional(v.union(v.number(), v.null())),
    effectType: v.optional(v.union(v.string(), v.null())),
    effectStat: v.optional(v.union(itemEffectStatValidator, v.null())),
    effectAmount: v.optional(v.union(v.number(), v.null())),
    effectDurationMs: v.optional(v.union(v.number(), v.null())),
    effectScope: v.optional(v.union(skillBonusScopeValidator, v.null())),
    augmentSlots: v.optional(v.union(v.number(), v.null())),
    baseDamage: v.optional(v.union(v.number(), v.null())),
    attackSpeed: v.optional(v.union(v.number(), v.null())),
    damageStat: v.optional(v.union(damageStatValidator, v.null())),
    damageType: v.optional(v.union(damageTypeValidator, v.null())),
    baseDefense: v.optional(v.union(v.number(), v.null())),
    speedPenalty: v.optional(v.union(v.number(), v.null())),
    buffVariant: v.optional(v.union(buffVariantValidator, v.null())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const rarityLevel = await requireItemRarity(
      ctx,
      args.rarityLevel ?? (await getDefaultItemRarityLevel(ctx))
    );
    const itemFamily = optionalItemText(args.itemFamily, "Item family", 100);
    const craftingSkillId = optionalItemText(
      args.craftingSkillId,
      "Crafting skill ID",
      100
    );
    const craftingTier = optionalItemInteger(
      args.craftingTier,
      "Crafting tier",
      1
    );
    const effectType = optionalItemText(args.effectType, "Effect type", 100);
    const effectAmount =
      args.effectAmount === undefined || args.effectAmount === null
        ? undefined
        : numberAtLeast(args.effectAmount, "Effect amount", 0);
    const effectDurationMs = optionalItemInteger(
      args.effectDurationMs,
      "Effect duration",
      1
    );
    const effectScope =
      args.effectScope === undefined || args.effectScope === null
        ? undefined
        : args.effectScope;
    const normalizedEffectScope = normalizeItemEffectScope(
      effectType,
      effectAmount,
      effectDurationMs,
      effectScope
    );
    const augmentSlots = optionalItemInteger(
      args.augmentSlots,
      "Augmentation slots",
      0
    );
    const baseDamage =
      args.baseDamage === undefined || args.baseDamage === null
        ? undefined
        : numberAtLeast(args.baseDamage, "Base damage", 0);
    const attackSpeed =
      args.attackSpeed === undefined || args.attackSpeed === null
        ? undefined
        : numberAtLeast(args.attackSpeed, "Attack speed", 0);
    const damageStat =
      args.damageStat === undefined || args.damageStat === null
        ? undefined
        : args.damageStat;
    const damageType =
      args.damageType === undefined || args.damageType === null
        ? undefined
        : args.damageType;
    const baseDefense =
      args.baseDefense === undefined || args.baseDefense === null
        ? undefined
        : numberAtLeast(args.baseDefense, "Base defense", 0);
    const speedPenalty =
      args.speedPenalty === undefined || args.speedPenalty === null
        ? undefined
        : numberAtLeast(args.speedPenalty, "Speed penalty", 0);
    const buffVariant =
      args.buffVariant === undefined || args.buffVariant === null
        ? undefined
        : args.buffVariant;
    const definition = normalizeItemDefinition({
      itemId: args.itemId,
      name: args.name,
      category: args.category,
      description: args.description,
      stackable: args.stackable,
      maxStackSize: args.maxStackSize,
      allowedEquipmentSlots: args.allowedEquipmentSlots,
      rarityLevel,
      ...(itemFamily === undefined ? {} : { itemFamily }),
      ...(craftingSkillId === undefined ? {} : { craftingSkillId }),
      ...(craftingTier === undefined ? {} : { craftingTier }),
      ...(effectType === undefined ? {} : { effectType }),
      ...(args.effectStat === undefined || args.effectStat === null
        ? {}
        : { effectStat: args.effectStat }),
      ...(effectAmount === undefined ? {} : { effectAmount }),
      ...(effectDurationMs === undefined ? {} : { effectDurationMs }),
      ...(normalizedEffectScope === undefined
        ? {}
        : { effectScope: normalizedEffectScope }),
      ...(augmentSlots === undefined ? {} : { augmentSlots }),
      ...(baseDamage === undefined ? {} : { baseDamage }),
      ...(attackSpeed === undefined ? {} : { attackSpeed }),
      ...(damageStat === undefined ? {} : { damageStat }),
      ...(damageType === undefined ? {} : { damageType }),
      ...(baseDefense === undefined ? {} : { baseDefense }),
      ...(speedPenalty === undefined ? {} : { speedPenalty }),
      ...(buffVariant === undefined ? {} : { buffVariant }),
    });
    const existing = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", definition.itemId))
      .first();
    if (existing) {
      throw new Error("An item with that ID already exists");
    }

    const now = Date.now();
    const itemId = await ctx.db.insert("items", {
      ...definition,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(itemId);
  },
});

export const updateItem = mutation({
  args: {
    playerId: v.id("players"),
    itemId: v.id("items"),
    name: v.string(),
    category: itemCategoryValidator,
    description: v.string(),
    stackable: v.boolean(),
    maxStackSize: v.number(),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    rarityLevel: v.optional(v.number()),
    itemFamily: v.optional(v.union(v.string(), v.null())),
    craftingSkillId: v.optional(v.union(v.string(), v.null())),
    craftingTier: v.optional(v.union(v.number(), v.null())),
    effectType: v.optional(v.union(v.string(), v.null())),
    effectStat: v.optional(v.union(itemEffectStatValidator, v.null())),
    effectAmount: v.optional(v.union(v.number(), v.null())),
    effectDurationMs: v.optional(v.union(v.number(), v.null())),
    effectScope: v.optional(v.union(skillBonusScopeValidator, v.null())),
    augmentSlots: v.optional(v.union(v.number(), v.null())),
    baseDamage: v.optional(v.union(v.number(), v.null())),
    attackSpeed: v.optional(v.union(v.number(), v.null())),
    damageStat: v.optional(v.union(damageStatValidator, v.null())),
    damageType: v.optional(v.union(damageTypeValidator, v.null())),
    baseDefense: v.optional(v.union(v.number(), v.null())),
    speedPenalty: v.optional(v.union(v.number(), v.null())),
    buffVariant: v.optional(v.union(buffVariantValidator, v.null())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.itemId);
    if (!existing) {
      throw new Error("Item not found");
    }

    const itemFamily =
      args.itemFamily === undefined
        ? existing.itemFamily
        : optionalItemText(args.itemFamily, "Item family", 100);
    const craftingSkillId =
      args.craftingSkillId === undefined
        ? existing.craftingSkillId
        : optionalItemText(
            args.craftingSkillId,
            "Crafting skill ID",
            100
          );
    const craftingTier =
      args.craftingTier === undefined
        ? existing.craftingTier
        : optionalItemInteger(args.craftingTier, "Crafting tier", 1);
    const effectType =
      args.effectType === undefined
        ? existing.effectType
        : optionalItemText(args.effectType, "Effect type", 100);
    const effectStat =
      args.effectStat === undefined ? existing.effectStat : args.effectStat;
    const effectAmount =
      args.effectAmount === undefined
        ? existing.effectAmount
        : args.effectAmount === null
          ? undefined
          : numberAtLeast(args.effectAmount, "Effect amount", 0);
    const effectDurationMs =
      args.effectDurationMs === undefined
        ? existing.effectDurationMs
        : optionalItemInteger(args.effectDurationMs, "Effect duration", 1);
    const effectScope =
      args.effectScope === undefined
        ? existing.effectScope
        : args.effectScope === null
          ? undefined
          : args.effectScope;
    const normalizedEffectScope = normalizeItemEffectScope(
      effectType,
      effectAmount,
      effectDurationMs,
      effectScope
    );
    const augmentSlots =
      args.augmentSlots === undefined
        ? existing.augmentSlots
        : optionalItemInteger(args.augmentSlots, "Augmentation slots", 0);

    const baseDamage =
      args.baseDamage === undefined
        ? existing.baseDamage
        : args.baseDamage === null
          ? undefined
          : numberAtLeast(args.baseDamage, "Base damage", 0);
    const attackSpeed =
      args.attackSpeed === undefined
        ? existing.attackSpeed
        : args.attackSpeed === null
          ? undefined
          : numberAtLeast(args.attackSpeed, "Attack speed", 0);
    const damageStat =
      args.damageStat === undefined ? existing.damageStat : args.damageStat;
    const damageType =
      args.damageType === undefined ? existing.damageType : args.damageType;
    const baseDefense =
      args.baseDefense === undefined
        ? existing.baseDefense
        : args.baseDefense === null
          ? undefined
          : numberAtLeast(args.baseDefense, "Base defense", 0);
    const speedPenalty =
      args.speedPenalty === undefined
        ? existing.speedPenalty
        : args.speedPenalty === null
          ? undefined
          : numberAtLeast(args.speedPenalty, "Speed penalty", 0);
    const buffVariant =
      args.buffVariant === undefined ? existing.buffVariant : args.buffVariant;

    const definition = normalizeItemDefinition({
      itemId: existing.itemId,
      name: args.name,
      category: args.category,
      description: args.description,
      stackable: args.stackable,
      maxStackSize: args.maxStackSize,
      allowedEquipmentSlots: args.allowedEquipmentSlots,
      rarityLevel: await requireItemRarity(
        ctx,
        args.rarityLevel ??
          existing.rarityLevel ??
          (await getDefaultItemRarityLevel(ctx))
      ),
      ...(itemFamily === undefined ? {} : { itemFamily }),
      ...(craftingSkillId === undefined ? {} : { craftingSkillId }),
      ...(craftingTier === undefined ? {} : { craftingTier }),
      ...(effectType === undefined ? {} : { effectType }),
      ...(effectStat === undefined || effectStat === null
        ? {}
        : { effectStat }),
      ...(effectAmount === undefined ? {} : { effectAmount }),
      ...(effectDurationMs === undefined ? {} : { effectDurationMs }),
      ...(normalizedEffectScope === undefined
        ? {}
        : { effectScope: normalizedEffectScope }),
      ...(augmentSlots === undefined ? {} : { augmentSlots }),
      ...(baseDamage === undefined ? {} : { baseDamage }),
      ...(attackSpeed === undefined ? {} : { attackSpeed }),
      ...(damageStat === undefined || damageStat === null
        ? {}
        : { damageStat }),
      ...(damageType === undefined || damageType === null
        ? {}
        : { damageType }),
      ...(baseDefense === undefined ? {} : { baseDefense }),
      ...(speedPenalty === undefined ? {} : { speedPenalty }),
      ...(buffVariant === undefined || buffVariant === null
        ? {}
        : { buffVariant }),
    });

    await ctx.db.replace(existing._id, {
      ...definition,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
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

export const updateBoss = mutation({
  args: {
    playerId: v.id("players"),
    bossId: v.id("bosses"),
    name: v.string(),
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    rewardMultiplier: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const boss = await ctx.db.get(args.bossId);
    if (!boss) {
      throw new Error("Boss not found");
    }

    const name = requiredText(args.name, "Name");
    const duplicate = await ctx.db
      .query("bosses")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (duplicate && duplicate._id !== boss._id) {
      throw new Error("Boss names must be unique");
    }

    await ctx.db.patch(boss._id, {
      name,
      str: numberAtLeast(args.str, "STR", 0),
      dex: numberAtLeast(args.dex, "DEX", 0),
      int: numberAtLeast(args.int, "INT", 0),
      luk: numberAtLeast(args.luk, "LUK", 0),
      con: numberAtLeast(args.con, "CON", 0),
      rewardMultiplier: numberAtLeast(
        args.rewardMultiplier,
        "Reward multiplier",
        0
      ),
    });

    return await ctx.db.get(boss._id);
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

async function requireSkill(ctx: MutationCtx, skillId: string) {
  const skill = await ctx.db
    .query("skillDefinitions")
    .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
    .first();
  if (!skill) {
    throw new Error(`Skill ${skillId} does not exist`);
  }
  return skill;
}

async function requireSkillTier(
  ctx: MutationCtx,
  skillId: string,
  tier: number
) {
  const tierDefinition = await ctx.db
    .query("skillTierDefinitions")
    .withIndex("by_skillId_and_tier", (q) =>
      q.eq("skillId", skillId).eq("tier", tier)
    )
    .first();
  if (!tierDefinition) {
    throw new Error(`Skill tier ${skillId}/${tier} does not exist`);
  }
  return tierDefinition;
}

async function replaceRecipeRows(
  ctx: MutationCtx,
  recipeId: string,
  ingredients: Array<{ itemRef: Id<"items">; quantity: number }>,
  outputs: Array<{ itemRef: Id<"items">; quantity: number }>
) {
  const [oldIngredients, oldOutputs] = await Promise.all([
    ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect(),
    ctx.db
      .query("recipeOutputs")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect(),
  ]);
  for (const row of oldIngredients) await ctx.db.delete(row._id);
  for (const row of oldOutputs) await ctx.db.delete(row._id);
  for (const ingredient of ingredients) {
    await ctx.db.insert("recipeIngredients", {
      recipeId,
      itemId: ingredient.itemRef,
      quantity: ingredient.quantity,
    });
  }
  for (const output of outputs) {
    await ctx.db.insert("recipeOutputs", {
      recipeId,
      itemId: output.itemRef,
      quantity: output.quantity,
    });
  }
}

async function requireLootTable(ctx: MutationCtx, lootTableId: string) {
  const table = await ctx.db
    .query("lootTables")
    .withIndex("by_lootTableId", (q) => q.eq("lootTableId", lootTableId))
    .first();
  if (!table) {
    throw new Error(`Loot table ${lootTableId} does not exist`);
  }
  return table;
}

function optionalTextArg(
  value: string | null | undefined,
  field: string,
  maxLength = 500
) {
  if (value === undefined || value === null || value.trim() === "") {
    return undefined;
  }
  return requiredText(value, field, maxLength);
}

async function resolveItemId(ctx: MutationCtx, itemId: string, field: string) {
  const stableItemId = requiredText(itemId, field, 100);
  const item = await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", stableItemId))
    .first();
  if (!item) {
    throw new Error(`${field} references an unknown item`);
  }
  return item._id;
}

async function maybeResolveItemId(
  ctx: MutationCtx,
  itemId: string | null | undefined,
  field: string
) {
  if (itemId === undefined || itemId === null || itemId.trim() === "") {
    return undefined;
  }
  return await resolveItemId(ctx, itemId, field);
}

async function recipeItemRowsFromArgs(
  ctx: MutationCtx,
  entries: Array<{ itemId: string; quantity: number }>,
  field: string
) {
  if (entries.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  const rows: Array<{ itemId: string; quantity: number; itemRef: Id<"items"> }> =
    [];
  for (const [index, entry] of entries.entries()) {
    const itemId = requiredText(entry.itemId, `${field}[${index}].itemId`, 100);
    const itemRef = await resolveItemId(
      ctx,
      itemId,
      `${field}[${index}].itemId`
    );
    rows.push({
      itemId,
      quantity: integerAtLeast(
        entry.quantity,
        `${field}[${index}].quantity`,
        1
      ),
      itemRef,
    });
  }
  if (new Set(rows.map((row) => row.itemId)).size !== rows.length) {
    throw new Error(`${field} cannot contain duplicate items`);
  }
  return rows;
}

async function validateSkillReference(
  ctx: MutationCtx,
  skillId: string,
  tier?: number
) {
  await requireSkill(ctx, skillId);
  if (tier !== undefined) {
    await requireSkillTier(ctx, skillId, tier);
  }
}

export const createSkillDefinition = mutation({
  args: {
    playerId: v.id("players"),
    skillId: v.string(),
    name: v.string(),
    category: skillCategoryValidator,
    pairedSkillId: v.union(v.string(), v.null()),
    description: v.string(),
    enabled: v.boolean(),
    maxLevel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const existing = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
      .first();
    if (existing) {
      throw new Error("A skill with that ID already exists");
    }
    const pairedSkillId = optionalTextArg(
      args.pairedSkillId,
      "Paired skill ID",
      100
    );
    if (pairedSkillId === skillId) {
      throw new Error("A skill cannot be paired with itself");
    }
    if (pairedSkillId !== undefined) {
      await requireSkill(ctx, pairedSkillId);
    }

    const now = Date.now();
    const id = await ctx.db.insert("skillDefinitions", {
      skillId,
      name: requiredText(args.name, "Name", 200),
      category: args.category,
      ...(pairedSkillId === undefined ? {} : { pairedSkillId }),
      description: requiredText(args.description, "Description", 1000),
      enabled: args.enabled,
      ...(args.maxLevel === undefined
        ? {}
        : { maxLevel: integerAtLeast(args.maxLevel, "Maximum level", 1) }),
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateSkillDefinition = mutation({
  args: {
    playerId: v.id("players"),
    skillDefinitionId: v.id("skillDefinitions"),
    name: v.string(),
    category: skillCategoryValidator,
    pairedSkillId: v.union(v.string(), v.null()),
    description: v.string(),
    enabled: v.boolean(),
    maxLevel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.skillDefinitionId);
    if (!existing) {
      throw new Error("Skill definition not found");
    }
    const pairedSkillId = optionalTextArg(
      args.pairedSkillId,
      "Paired skill ID",
      100
    );
    if (pairedSkillId === existing.skillId) {
      throw new Error("A skill cannot be paired with itself");
    }
    if (pairedSkillId !== undefined) {
      await requireSkill(ctx, pairedSkillId);
    }

    await ctx.db.replace(existing._id, {
      skillId: existing.skillId,
      name: requiredText(args.name, "Name", 200),
      category: args.category,
      ...(pairedSkillId === undefined ? {} : { pairedSkillId }),
      description: requiredText(args.description, "Description", 1000),
      enabled: args.enabled,
      ...(args.maxLevel === undefined
        ? {}
        : { maxLevel: integerAtLeast(args.maxLevel, "Maximum level", 1) }),
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createSkillTierDefinition = mutation({
  args: {
    playerId: v.id("players"),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    requiredLevel: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await requireSkill(ctx, skillId);
    const existing = await ctx.db
      .query("skillTierDefinitions")
      .withIndex("by_skillId_and_tier", (q) =>
        q.eq("skillId", skillId).eq("tier", tier)
      )
      .first();
    if (existing) {
      throw new Error("A tier with that skill ID and tier already exists");
    }

    const now = Date.now();
    const id = await ctx.db.insert("skillTierDefinitions", {
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      requiredLevel: integerAtLeast(args.requiredLevel, "Required level", 1),
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateSkillTierDefinition = mutation({
  args: {
    playerId: v.id("players"),
    skillTierDefinitionId: v.id("skillTierDefinitions"),
    name: v.string(),
    description: v.string(),
    requiredLevel: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.skillTierDefinitionId);
    if (!existing) {
      throw new Error("Skill tier definition not found");
    }
    await ctx.db.replace(existing._id, {
      skillId: existing.skillId,
      tier: existing.tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      requiredLevel: integerAtLeast(args.requiredLevel, "Required level", 1),
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createGatheringActivity = mutation({
  args: {
    playerId: v.id("players"),
    activityId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    outputItemId: v.string(),
    minYield: v.number(),
    maxYield: v.number(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const activityId = requiredText(args.activityId, "Activity ID", 100);
    const existing = await ctx.db
      .query("gatheringActivities")
      .withIndex("by_activityId", (q) => q.eq("activityId", activityId))
      .first();
    if (existing) {
      throw new Error("A gathering activity with that ID already exists");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const minYield = integerAtLeast(args.minYield, "Minimum yield", 1);
    const maxYield = integerAtLeast(args.maxYield, "Maximum yield", minYield);
    const durationMs =
      args.durationMs === undefined
        ? undefined
        : integerAtLeast(args.durationMs, "Duration", 1);
    const experienceReward = integerAtLeast(
      args.experienceReward,
      "Experience reward",
      1
    );
    const now = Date.now();
    const id = await ctx.db.insert("gatheringActivities", {
      activityId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      outputItemId: await resolveItemId(ctx, args.outputItemId, "Output item ID"),
      minYield,
      maxYield,
      ...(durationMs === undefined ? {} : { durationMs }),
      experienceReward,
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateGatheringActivity = mutation({
  args: {
    playerId: v.id("players"),
    gatheringActivityId: v.id("gatheringActivities"),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    outputItemId: v.string(),
    minYield: v.number(),
    maxYield: v.number(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.gatheringActivityId);
    if (!existing) {
      throw new Error("Gathering activity not found");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const minYield = integerAtLeast(args.minYield, "Minimum yield", 1);
    const maxYield = integerAtLeast(args.maxYield, "Maximum yield", minYield);
    const durationMs =
      args.durationMs === undefined
        ? existing.durationMs
        : integerAtLeast(args.durationMs, "Duration", 1);
    await ctx.db.replace(existing._id, {
      activityId: existing.activityId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      outputItemId: await resolveItemId(ctx, args.outputItemId, "Output item ID"),
      minYield,
      maxYield,
      ...(durationMs === undefined ? {} : { durationMs }),
      experienceReward: integerAtLeast(
        args.experienceReward,
        "Experience reward",
        1
      ),
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createRecipe = mutation({
  args: {
    playerId: v.id("players"),
    recipeId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    outputFamily: v.union(v.string(), v.null()),
    stage: v.optional(recipeStageValidator),
    requiresMonsterDrop: v.optional(v.boolean()),
    enabled: v.boolean(),
    ingredients: v.array(recipeItemInputValidator),
    outputs: v.array(recipeItemInputValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const recipeId = requiredText(args.recipeId, "Recipe ID", 100);
    const existing = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .first();
    if (existing) {
      throw new Error("A recipe with that ID already exists");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const ingredients = await recipeItemRowsFromArgs(
      ctx,
      args.ingredients,
      "Ingredients"
    );
    const outputs = await recipeItemRowsFromArgs(ctx, args.outputs, "Outputs");
    const outputFamily = optionalTextArg(args.outputFamily, "Output family", 100);
    const durationMs =
      args.durationMs === undefined
        ? undefined
        : integerAtLeast(args.durationMs, "Duration", 1);
    const experienceReward = integerAtLeast(
      args.experienceReward,
      "Experience reward",
      1
    );
    const now = Date.now();
    const id = await ctx.db.insert("recipes", {
      recipeId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      ...(durationMs === undefined ? {} : { durationMs }),
      experienceReward,
      ...(outputFamily === undefined ? {} : { outputFamily }),
      ...(args.stage === undefined ? {} : { stage: args.stage }),
      ...(args.requiresMonsterDrop === undefined
        ? {}
        : { requiresMonsterDrop: args.requiresMonsterDrop }),
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    await replaceRecipeRows(ctx, recipeId, ingredients, outputs);
    await validateRecipeChain(ctx, recipeId);
    return await ctx.db.get(id);
  },
});

export const updateRecipe = mutation({
  args: {
    playerId: v.id("players"),
    recipeDefinitionId: v.id("recipes"),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    outputFamily: v.union(v.string(), v.null()),
    stage: v.optional(recipeStageValidator),
    requiresMonsterDrop: v.optional(v.boolean()),
    enabled: v.boolean(),
    ingredients: v.array(recipeItemInputValidator),
    outputs: v.array(recipeItemInputValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.recipeDefinitionId);
    if (!existing) {
      throw new Error("Recipe not found");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const ingredients = await recipeItemRowsFromArgs(
      ctx,
      args.ingredients,
      "Ingredients"
    );
    const outputs = await recipeItemRowsFromArgs(ctx, args.outputs, "Outputs");
    const outputFamily = optionalTextArg(args.outputFamily, "Output family", 100);
    const stage = args.stage === undefined ? existing.stage : args.stage;
    const requiresMonsterDrop =
      args.requiresMonsterDrop === undefined
        ? existing.requiresMonsterDrop
        : args.requiresMonsterDrop;
    const durationMs =
      args.durationMs === undefined
        ? existing.durationMs
        : integerAtLeast(args.durationMs, "Duration", 1);
    await ctx.db.replace(existing._id, {
      recipeId: existing.recipeId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      ...(durationMs === undefined ? {} : { durationMs }),
      experienceReward: integerAtLeast(
        args.experienceReward,
        "Experience reward",
        1
      ),
      ...(outputFamily === undefined ? {} : { outputFamily }),
      ...(stage === undefined ? {} : { stage }),
      ...(requiresMonsterDrop === undefined ? {} : { requiresMonsterDrop }),
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    await replaceRecipeRows(ctx, existing.recipeId, ingredients, outputs);
    await validateRecipeChain(ctx, existing.recipeId);
    return await ctx.db.get(existing._id);
  },
});

export const createAugmentationDefinition = mutation({
  args: {
    playerId: v.id("players"),
    augmentationId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    baseItemFamily: v.union(v.string(), v.null()),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    requiredMaterialItemId: v.string(),
    requiredMaterialQuantity: v.number(),
    bossCatalystItemId: v.union(v.string(), v.null()),
    bossCatalystQuantity: v.union(v.number(), v.null()),
    effectType: v.string(),
    effectStat: v.union(itemEffectStatValidator, v.null()),
    effectAmount: v.number(),
    experienceReward: v.optional(v.number()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const augmentationId = requiredText(
      args.augmentationId,
      "Augmentation ID",
      100
    );
    const existing = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) =>
        q.eq("augmentationId", augmentationId)
      )
      .first();
    if (existing) {
      throw new Error("An augmentation with that ID already exists");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const baseItemFamily = optionalTextArg(
      args.baseItemFamily,
      "Base item family",
      100
    );
    const bossCatalystItemId = await maybeResolveItemId(
      ctx,
      args.bossCatalystItemId,
      "Boss catalyst item ID"
    );
    const bossCatalystQuantity =
      args.bossCatalystQuantity === null
        ? undefined
        : integerAtLeast(args.bossCatalystQuantity, "Boss catalyst quantity", 1);
    if (
      (bossCatalystItemId === undefined) !==
      (bossCatalystQuantity === undefined)
    ) {
      throw new Error("Boss catalyst item and quantity must be set together");
    }
    if (args.effectType === "stat-bonus" && args.effectStat === null) {
      throw new Error("Stat-bonus effects require an effect stat");
    }

    const now = Date.now();
    const id = await ctx.db.insert("augmentationDefinitions", {
      augmentationId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      ...(baseItemFamily === undefined ? {} : { baseItemFamily }),
      allowedEquipmentSlots: args.allowedEquipmentSlots,
      requiredMaterialItemId: await resolveItemId(
        ctx,
        args.requiredMaterialItemId,
        "Required material item ID"
      ),
      requiredMaterialQuantity: integerAtLeast(
        args.requiredMaterialQuantity,
        "Required material quantity",
        1
      ),
      ...(bossCatalystItemId === undefined ? {} : { bossCatalystItemId }),
      ...(bossCatalystQuantity === undefined ? {} : { bossCatalystQuantity }),
      effectType: requiredText(args.effectType, "Effect type", 100),
      ...(args.effectStat === null ? {} : { effectStat: args.effectStat }),
      effectAmount: numberAtLeast(args.effectAmount, "Effect amount", 0),
      experienceReward:
        args.experienceReward === undefined
          ? 50 * tier
          : integerAtLeast(args.experienceReward, "Base experience reward", 1),
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateAugmentationDefinition = mutation({
  args: {
    playerId: v.id("players"),
    augmentationDefinitionId: v.id("augmentationDefinitions"),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    baseItemFamily: v.union(v.string(), v.null()),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    requiredMaterialItemId: v.string(),
    requiredMaterialQuantity: v.number(),
    bossCatalystItemId: v.union(v.string(), v.null()),
    bossCatalystQuantity: v.union(v.number(), v.null()),
    effectType: v.string(),
    effectStat: v.union(itemEffectStatValidator, v.null()),
    effectAmount: v.number(),
    experienceReward: v.optional(v.number()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.augmentationDefinitionId);
    if (!existing) {
      throw new Error("Augmentation definition not found");
    }
    const skillId = requiredText(args.skillId, "Skill ID", 100);
    const tier = integerAtLeast(args.tier, "Tier", 1);
    await validateSkillReference(ctx, skillId, tier);
    const baseItemFamily = optionalTextArg(
      args.baseItemFamily,
      "Base item family",
      100
    );
    const bossCatalystItemId = await maybeResolveItemId(
      ctx,
      args.bossCatalystItemId,
      "Boss catalyst item ID"
    );
    const bossCatalystQuantity =
      args.bossCatalystQuantity === null
        ? undefined
        : integerAtLeast(args.bossCatalystQuantity, "Boss catalyst quantity", 1);
    if (
      (bossCatalystItemId === undefined) !==
      (bossCatalystQuantity === undefined)
    ) {
      throw new Error("Boss catalyst item and quantity must be set together");
    }
    const effectType = requiredText(args.effectType, "Effect type", 100);
    if (effectType === "stat-bonus" && args.effectStat === null) {
      throw new Error("Stat-bonus effects require an effect stat");
    }

    await ctx.db.replace(existing._id, {
      augmentationId: existing.augmentationId,
      skillId,
      tier,
      name: requiredText(args.name, "Name", 200),
      description: requiredText(args.description, "Description", 1000),
      ...(baseItemFamily === undefined ? {} : { baseItemFamily }),
      allowedEquipmentSlots: args.allowedEquipmentSlots,
      requiredMaterialItemId: await resolveItemId(
        ctx,
        args.requiredMaterialItemId,
        "Required material item ID"
      ),
      requiredMaterialQuantity: integerAtLeast(
        args.requiredMaterialQuantity,
        "Required material quantity",
        1
      ),
      ...(bossCatalystItemId === undefined ? {} : { bossCatalystItemId }),
      ...(bossCatalystQuantity === undefined ? {} : { bossCatalystQuantity }),
      effectType,
      ...(args.effectStat === null ? {} : { effectStat: args.effectStat }),
      effectAmount: numberAtLeast(args.effectAmount, "Effect amount", 0),
      experienceReward:
        args.experienceReward === undefined
          ? existing.experienceReward ?? 50 * tier
          : integerAtLeast(args.experienceReward, "Base experience reward", 1),
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createLootTable = mutation({
  args: {
    playerId: v.id("players"),
    lootTableId: v.string(),
    name: v.string(),
    sourceType: lootSourceTypeValidator,
    tier: v.union(v.number(), v.null()),
    rollCount: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const lootTableId = requiredText(args.lootTableId, "Loot table ID", 100);
    const existing = await ctx.db
      .query("lootTables")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", lootTableId))
      .first();
    if (existing) {
      throw new Error("A loot table with that ID already exists");
    }
    const tier =
      args.tier === null ? undefined : integerAtLeast(args.tier, "Tier", 1);
    if (args.sourceType === "boss" && tier === undefined) {
      throw new Error("Boss loot tables require a tier");
    }
    const now = Date.now();
    const id = await ctx.db.insert("lootTables", {
      lootTableId,
      name: requiredText(args.name, "Name", 200),
      sourceType: args.sourceType,
      ...(tier === undefined ? {} : { tier }),
      rollCount: integerAtLeast(args.rollCount, "Roll count", 1),
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateLootTable = mutation({
  args: {
    playerId: v.id("players"),
    lootTableDefinitionId: v.id("lootTables"),
    name: v.string(),
    sourceType: lootSourceTypeValidator,
    tier: v.union(v.number(), v.null()),
    rollCount: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.lootTableDefinitionId);
    if (!existing) {
      throw new Error("Loot table not found");
    }
    const tier =
      args.tier === null ? undefined : integerAtLeast(args.tier, "Tier", 1);
    if (args.sourceType === "boss" && tier === undefined) {
      throw new Error("Boss loot tables require a tier");
    }
    await ctx.db.replace(existing._id, {
      lootTableId: existing.lootTableId,
      name: requiredText(args.name, "Name", 200),
      sourceType: args.sourceType,
      ...(tier === undefined ? {} : { tier }),
      rollCount: integerAtLeast(args.rollCount, "Roll count", 1),
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createLootTableEntry = mutation({
  args: {
    playerId: v.id("players"),
    lootTableId: v.string(),
    itemId: v.string(),
    weight: v.number(),
    dropChance: v.number(),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    guaranteed: v.boolean(),
    purpose: lootPurposeValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const lootTableId = requiredText(args.lootTableId, "Loot table ID", 100);
    await requireLootTable(ctx, lootTableId);
    const itemId = await resolveItemId(ctx, args.itemId, "Item ID");
    const existing = await ctx.db
      .query("lootTableEntries")
      .withIndex("by_lootTableId_and_itemId", (q) =>
        q.eq("lootTableId", lootTableId).eq("itemId", itemId)
      )
      .first();
    if (existing) {
      throw new Error("That loot table already contains this item");
    }
    const dropChance = numberAtLeast(args.dropChance, "Drop chance", 0);
    if (dropChance > 1) {
      throw new Error("Drop chance must be between 0 and 1");
    }
    const minQuantity = integerAtLeast(args.minQuantity, "Minimum quantity", 1);
    const maxQuantity = integerAtLeast(
      args.maxQuantity,
      "Maximum quantity",
      minQuantity
    );
    const now = Date.now();
    const id = await ctx.db.insert("lootTableEntries", {
      lootTableId,
      itemId,
      weight: numberAtLeast(args.weight, "Weight", 0),
      dropChance,
      minQuantity,
      maxQuantity,
      guaranteed: args.guaranteed,
      purpose: args.purpose,
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateLootTableEntry = mutation({
  args: {
    playerId: v.id("players"),
    lootTableEntryId: v.id("lootTableEntries"),
    weight: v.number(),
    dropChance: v.number(),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    guaranteed: v.boolean(),
    purpose: lootPurposeValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.lootTableEntryId);
    if (!existing) {
      throw new Error("Loot table entry not found");
    }
    await requireLootTable(ctx, existing.lootTableId);
    const item = await ctx.db.get(existing.itemId);
    if (!item) {
      throw new Error("Loot table entry references a missing item");
    }
    const dropChance = numberAtLeast(args.dropChance, "Drop chance", 0);
    if (dropChance > 1) {
      throw new Error("Drop chance must be between 0 and 1");
    }
    const minQuantity = integerAtLeast(args.minQuantity, "Minimum quantity", 1);
    const maxQuantity = integerAtLeast(
      args.maxQuantity,
      "Maximum quantity",
      minQuantity
    );
    await ctx.db.replace(existing._id, {
      lootTableId: existing.lootTableId,
      itemId: existing.itemId,
      weight: numberAtLeast(args.weight, "Weight", 0),
      dropChance,
      minQuantity,
      maxQuantity,
      guaranteed: args.guaranteed,
      purpose: args.purpose,
      enabled: args.enabled,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

export const createLootSource = mutation({
  args: {
    playerId: v.id("players"),
    sourceType: lootSourceTypeValidator,
    sourceId: v.string(),
    tier: v.union(v.number(), v.null()),
    lootTableId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const sourceId = requiredText(args.sourceId, "Source ID", 100);
    const tier =
      args.tier === null ? undefined : integerAtLeast(args.tier, "Tier", 1);
    const existing = (
      await ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId", (q) =>
          q.eq("sourceType", args.sourceType).eq("sourceId", sourceId)
        )
        .collect()
    ).find((row) => row.tier === tier);
    if (existing) {
      throw new Error("A loot source with those identifiers already exists");
    }
    const lootTableId = requiredText(args.lootTableId, "Loot table ID", 100);
    await requireLootTable(ctx, lootTableId);
    const now = Date.now();
    const id = await ctx.db.insert("lootSources", {
      sourceType: args.sourceType,
      sourceId,
      ...(tier === undefined ? {} : { tier }),
      lootTableId,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const updateLootSource = mutation({
  args: {
    playerId: v.id("players"),
    lootSourceId: v.id("lootSources"),
    lootTableId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const existing = await ctx.db.get(args.lootSourceId);
    if (!existing) {
      throw new Error("Loot source not found");
    }
    const lootTableId = requiredText(args.lootTableId, "Loot table ID", 100);
    await requireLootTable(ctx, lootTableId);
    await ctx.db.replace(existing._id, {
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      ...(existing.tier === undefined ? {} : { tier: existing.tier }),
      lootTableId,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(existing._id);
  },
});

/**
 * Update the forest skill/crafting records through the same admin surface as
 * the rest of the live configuration. Stable IDs are immutable; references
 * are resolved server-side before any rows are replaced.
 */
export const saveCraftingConfig = mutation({
  args: {
    playerId: v.id("players"),
    kind: craftingConfigKindValidator,
    key: v.string(),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.playerId);
    const value = recordValue(args.value, "Configuration");
    assertConvexValue(value, "Configuration");
    const now = Date.now();

    if (args.kind === "skill") {
      const skillId = requiredText(args.key, "Skill ID", 100);
      const existing = await ctx.db
        .query("skillDefinitions")
        .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
        .first();
      if (!existing) throw new Error("Skill definition not found");
      if (stringValue(value, "skillId", "Skill ID", 100) !== skillId) {
        throw new Error("Skill ID cannot be changed");
      }
      const category = stringValue(value, "category", "Category", 30);
      if (category !== "gathering" && category !== "crafting") {
        throw new Error("Category must be gathering or crafting");
      }
      const pairedSkillId = optionalStringValue(
        value,
        "pairedSkillId",
        "Paired skill ID",
        100
      );
      if (pairedSkillId) await requireSkill(ctx, pairedSkillId);
      await ctx.db.replace(existing._id, {
        skillId,
        name: stringValue(value, "name", "Name", 200),
        category,
        ...(pairedSkillId === undefined ? {} : { pairedSkillId }),
        description: stringValue(value, "description", "Description", 1000),
        enabled: booleanValue(value, "enabled", "Enabled"),
        ...(value.maxLevel === undefined || value.maxLevel === null
          ? {}
          : {
              maxLevel: integerValue(
                value,
                "maxLevel",
                "Maximum level",
                1
              ),
            }),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "skill-tier") {
      const [skillId, tierText] = args.key.split(":");
      const tier = Number(tierText);
      if (!skillId || !Number.isSafeInteger(tier) || tier < 1) {
        throw new Error("Skill tier key must use skillId:tier");
      }
      const existing = await requireSkillTier(ctx, skillId, tier);
      if (stringValue(value, "skillId", "Skill ID", 100) !== skillId) {
        throw new Error("Skill ID cannot be changed");
      }
      if (integerValue(value, "tier", "Tier", 1) !== tier) {
        throw new Error("Tier cannot be changed");
      }
      await ctx.db.replace(existing._id, {
        skillId,
        tier,
        name: stringValue(value, "name", "Name", 200),
        description: stringValue(value, "description", "Description", 1000),
        requiredLevel: integerValue(
          value,
          "requiredLevel",
          "Required level",
          1
        ),
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "gathering") {
      const activityId = requiredText(args.key, "Activity ID", 100);
      const existing = await ctx.db
        .query("gatheringActivities")
        .withIndex("by_activityId", (q) => q.eq("activityId", activityId))
        .first();
      if (!existing) throw new Error("Gathering activity not found");
      if (
        stringValue(value, "activityId", "Activity ID", 100) !== activityId
      ) {
        throw new Error("Activity ID cannot be changed");
      }
      const skillId = stringValue(value, "skillId", "Skill ID", 100);
      const tier = integerValue(value, "tier", "Tier", 1);
      await requireSkill(ctx, skillId);
      await requireSkillTier(ctx, skillId, tier);
      const minYield = integerValue(value, "minYield", "Minimum yield", 1);
      const maxYield = integerValue(value, "maxYield", "Maximum yield", minYield);
      if (maxYield < minYield) {
        throw new Error("Maximum yield must be at least the minimum yield");
      }
      const outputItemId = await itemIdValue(
        ctx,
        value,
        "outputItemId",
        "Output item ID"
      );
      const durationMs =
        value.durationMs === undefined
          ? existing.durationMs
          : integerValue(value, "durationMs", "Duration", 1);
      await ctx.db.replace(existing._id, {
        activityId,
        skillId,
        tier,
        name: stringValue(value, "name", "Name", 200),
        description: stringValue(value, "description", "Description", 1000),
        outputItemId,
        minYield,
        maxYield,
        ...(durationMs === undefined ? {} : { durationMs }),
        experienceReward: integerValue(
          value,
          "experienceReward",
          "Experience reward",
          1
        ),
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "recipe") {
      const recipeId = requiredText(args.key, "Recipe ID", 100);
      const existing = await ctx.db
        .query("recipes")
        .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
        .first();
      if (!existing) throw new Error("Recipe not found");
      if (stringValue(value, "recipeId", "Recipe ID", 100) !== recipeId) {
        throw new Error("Recipe ID cannot be changed");
      }
      const skillId = stringValue(value, "skillId", "Skill ID", 100);
      const tier = integerValue(value, "tier", "Tier", 1);
      await requireSkill(ctx, skillId);
      await requireSkillTier(ctx, skillId, tier);
      const ingredients = await recipeItemRows(
        ctx,
        value.ingredients,
        "Ingredients"
      );
      const outputs = await recipeItemRows(ctx, value.outputs, "Outputs");
      const outputFamily = optionalStringValue(
        value,
        "outputFamily",
        "Output family",
        100
      );
      const stageText = optionalStringValue(value, "stage", "Stage", 30);
      const stage =
        stageText === undefined
          ? existing.stage
          : stageText === "refinement" ||
              stageText === "product" ||
              stageText === "consumable"
            ? stageText
            : (() => {
                throw new Error(
                  "Stage must be refinement, product, or consumable"
                );
              })();
      const requiresMonsterDrop =
        value.requiresMonsterDrop === undefined
          ? existing.requiresMonsterDrop
          : booleanValue(value, "requiresMonsterDrop", "Requires monster drop");
      const durationMs =
        value.durationMs === undefined
          ? existing.durationMs
          : integerValue(value, "durationMs", "Duration", 1);
      await ctx.db.replace(existing._id, {
        recipeId,
        skillId,
        tier,
        name: stringValue(value, "name", "Name", 200),
        description: stringValue(value, "description", "Description", 1000),
        ...(durationMs === undefined ? {} : { durationMs }),
        experienceReward: integerValue(
          value,
          "experienceReward",
          "Experience reward",
          1
        ),
        ...(outputFamily === undefined ? {} : { outputFamily }),
        ...(stage === undefined ? {} : { stage }),
        ...(requiresMonsterDrop === undefined
          ? {}
          : { requiresMonsterDrop }),
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      await replaceRecipeRows(ctx, recipeId, ingredients, outputs);
      await validateRecipeChain(ctx, recipeId);
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "augmentation") {
      const augmentationId = requiredText(args.key, "Augmentation ID", 100);
      const existing = await ctx.db
        .query("augmentationDefinitions")
        .withIndex("by_augmentationId", (q) =>
          q.eq("augmentationId", augmentationId)
        )
        .first();
      if (!existing) throw new Error("Augmentation definition not found");
      if (
        stringValue(value, "augmentationId", "Augmentation ID", 100) !==
        augmentationId
      ) {
        throw new Error("Augmentation ID cannot be changed");
      }
      const skillId = stringValue(value, "skillId", "Skill ID", 100);
      const tier = integerValue(value, "tier", "Tier", 1);
      await requireSkill(ctx, skillId);
      await requireSkillTier(ctx, skillId, tier);
      const bossCatalystItemId = await itemIdValue(
        ctx,
        value,
        "bossCatalystItemId",
        "Boss catalyst item ID",
        true
      );
      const bossCatalystQuantity = optionalIntegerValue(
        value,
        "bossCatalystQuantity",
        "Boss catalyst quantity",
        1
      );
      if (
        bossCatalystItemId === undefined &&
        bossCatalystQuantity !== undefined
      ) {
        throw new Error("Boss catalyst quantity requires a catalyst item");
      }
      const effectStat = itemEffectStatValue(
        value,
        "effectStat",
        "Effect stat"
      );
      const effectType = stringValue(value, "effectType", "Effect type", 100);
      if (effectType === "stat-bonus" && effectStat === undefined) {
        throw new Error("Stat-bonus effects require an effect stat");
      }
      const experienceReward =
        value.experienceReward === undefined
          ? existing.experienceReward ?? 50 * tier
          : integerValue(
              value,
              "experienceReward",
              "Base experience reward",
              1
            );
      await ctx.db.replace(existing._id, {
        augmentationId,
        skillId,
        tier,
        name: stringValue(value, "name", "Name", 200),
        description: stringValue(value, "description", "Description", 1000),
        ...(nullableStringValue(
          value,
          "baseItemFamily",
          "Base item family",
          100
        ) === undefined
          ? {}
          : {
              baseItemFamily: nullableStringValue(
                value,
                "baseItemFamily",
                "Base item family",
                100
              ),
            }),
        allowedEquipmentSlots: equipmentSlotsValue(
          value,
          "allowedEquipmentSlots"
        ),
        requiredMaterialItemId: await itemIdValue(
          ctx,
          value,
          "requiredMaterialItemId",
          "Required material item ID"
        ),
        requiredMaterialQuantity: integerValue(
          value,
          "requiredMaterialQuantity",
          "Required material quantity",
          1
        ),
        ...(bossCatalystItemId === undefined
          ? {}
          : { bossCatalystItemId }),
        ...(bossCatalystQuantity === undefined
          ? {}
          : { bossCatalystQuantity }),
        effectType,
        ...(effectStat === undefined ? {} : { effectStat }),
        effectAmount: numberValue(value, "effectAmount", "Effect amount", 0),
        experienceReward,
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "loot-table") {
      const lootTableId = requiredText(args.key, "Loot table ID", 100);
      const existing = await ctx.db
        .query("lootTables")
        .withIndex("by_lootTableId", (q) => q.eq("lootTableId", lootTableId))
        .first();
      if (!existing) throw new Error("Loot table not found");
      if (
        stringValue(value, "lootTableId", "Loot table ID", 100) !== lootTableId
      ) {
        throw new Error("Loot table ID cannot be changed");
      }
      const sourceType = stringValue(
        value,
        "sourceType",
        "Source type",
        20
      );
      if (sourceType !== "monster" && sourceType !== "boss") {
        throw new Error("Source type must be monster or boss");
      }
      const tier = optionalIntegerValue(value, "tier", "Tier", 1);
      if (sourceType === "boss" && tier === undefined) {
        throw new Error("Boss loot tables require a tier");
      }
      await ctx.db.replace(existing._id, {
        lootTableId,
        name: stringValue(value, "name", "Name", 200),
        sourceType,
        ...(tier === undefined ? {} : { tier }),
        rollCount: integerValue(value, "rollCount", "Roll count", 1),
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    if (args.kind === "loot-entry") {
      const separator = args.key.lastIndexOf(":");
      if (separator <= 0 || separator === args.key.length - 1) {
        throw new Error("Loot entry key must use lootTableId:itemId");
      }
      const lootTableId = args.key.slice(0, separator);
      const itemId = args.key.slice(separator + 1);
      const table = await ctx.db
        .query("lootTables")
        .withIndex("by_lootTableId", (q) => q.eq("lootTableId", lootTableId))
        .first();
      if (!table) throw new Error("Loot table not found");
      if (stringValue(value, "lootTableId", "Loot table ID", 100) !== lootTableId) {
        throw new Error("Loot table ID cannot be changed");
      }
      if (stringValue(value, "itemId", "Item ID", 100) !== itemId) {
        throw new Error("Loot entry item ID cannot be changed");
      }
      const item = await ctx.db
        .query("items")
        .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
        .first();
      if (!item) throw new Error("Loot entry item not found");
      const existing = await ctx.db
        .query("lootTableEntries")
        .withIndex("by_lootTableId_and_itemId", (q) =>
          q.eq("lootTableId", lootTableId).eq("itemId", item._id)
        )
        .first();
      if (!existing) throw new Error("Loot table entry not found");
      const dropChance = numberValue(value, "dropChance", "Drop chance", 0);
      if (dropChance > 1) throw new Error("Drop chance must be between 0 and 1");
      const minQuantity = integerValue(
        value,
        "minQuantity",
        "Minimum quantity",
        1
      );
      const maxQuantity = integerValue(
        value,
        "maxQuantity",
        "Maximum quantity",
        minQuantity
      );
      if (maxQuantity < minQuantity) {
        throw new Error("Maximum quantity must be at least the minimum quantity");
      }
      const purpose = stringValue(value, "purpose", "Purpose", 30);
      if (purpose !== "augmentation" && purpose !== "boss-catalyst") {
        throw new Error("Purpose must be augmentation or boss-catalyst");
      }
      await ctx.db.replace(existing._id, {
        lootTableId,
        itemId: item._id,
        weight: numberValue(value, "weight", "Weight", 0),
        dropChance,
        minQuantity,
        maxQuantity,
        guaranteed: booleanValue(value, "guaranteed", "Guaranteed"),
        purpose,
        enabled: booleanValue(value, "enabled", "Enabled"),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    const separator = args.key.indexOf("|");
    if (separator <= 0) {
      throw new Error("Loot source key must use sourceType|sourceId|tier");
    }
    const sourceType = args.key.slice(0, separator);
    const remainder = args.key.slice(separator + 1);
    const tierSeparator = remainder.lastIndexOf("|");
    const sourceId =
      tierSeparator < 0 ? remainder : remainder.slice(0, tierSeparator);
    const tierText = tierSeparator < 0 ? "" : remainder.slice(tierSeparator + 1);
    const tier =
      tierText === "" ? undefined : integerAtLeast(Number(tierText), "Tier", 1);
    if (sourceType !== "monster" && sourceType !== "boss") {
      throw new Error("Source type must be monster or boss");
    }
    const existing = (
      await ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId", (q) =>
          q.eq("sourceType", sourceType).eq("sourceId", sourceId)
        )
        .collect()
    ).find((row) => row.tier === tier);
    if (!existing) throw new Error("Loot source not found");
    if (
      stringValue(value, "sourceType", "Source type", 20) !== sourceType ||
      stringValue(value, "sourceId", "Source ID", 100) !== sourceId ||
      optionalIntegerValue(value, "tier", "Tier", 1) !== tier
    ) {
      throw new Error("Loot source identifiers cannot be changed");
    }
    const lootTableId = stringValue(
      value,
      "lootTableId",
      "Loot table ID",
      100
    );
    const lootTable = await ctx.db
      .query("lootTables")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", lootTableId))
      .first();
    if (!lootTable) throw new Error("Loot source references an unknown table");
    await ctx.db.replace(existing._id, {
      sourceType,
      sourceId,
      ...(tier === undefined ? {} : { tier }),
      lootTableId,
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    return await ctx.db.get(existing._id);
  },
});

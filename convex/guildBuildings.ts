import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayerOwner } from "./playerAuth";
import { consumeItems } from "./items";
import { grantItemToGuildStash } from "./guildStash";
import { settleTasksBeforeInteraction } from "./taskSettlement";

/**
 * Guild buildings: permanent guild upgrades paid for with raid drops (dragon
 * scales, which only raid kills put in the guild stash) and crafted goods
 * that members donate to the stash. Every member gets the bonuses.
 *
 * Stat buildings raise one combat stat by a percent; utility buildings raise
 * gold, XP, or member slots. Levels never decay.
 */

type DatabaseCtx = QueryCtx | MutationCtx;

export type GuildStatKey = "str" | "dex" | "int" | "luk" | "con" | "agi";
export type GuildBuildingEffect =
  | { kind: "stat"; stat: GuildStatKey; percentPerLevel: number }
  | { kind: "gold"; percentPerLevel: number }
  | { kind: "xp"; percentPerLevel: number }
  | { kind: "members"; slotsPerLevel: number };

export type GuildBuildingDef = {
  buildingId: string;
  name: string;
  description: string;
  effect: GuildBuildingEffect;
  /** Crafted good members donate, by material tier 1–8. */
  donationLine: readonly string[];
};

export const GUILD_BUILDING_MAX_LEVEL = 10;

export const DRAGON_SCALE_ITEM_IDS = {
  main: "dragon-scale",
  blighted: "blighted-dragon-scale",
  rift: "rift-dragon-scale",
} as const;

const INGOTS = [
  "moonstone-ingot", "ambersteel-ingot", "root-iron-ingot", "emberstone-ingot",
  "stormsilver-ingot", "voidquartz-ingot", "nightsteel-ingot", "starforged-ingot",
] as const;
const LUMBER = [
  "moonwood-lumber", "living-bark-lumber", "thornvine-lumber", "emberwood-lumber",
  "tidewood-lumber", "voidwood-lumber", "dreadwood-lumber", "worldheart-lumber",
] as const;
const EXTRACTS = [
  "starlight-extract", "dreamcap-extract", "elderroot-extract", "ember-extract",
  "tide-extract", "void-extract", "nightmare-extract", "starforged-extract",
] as const;
const ESSENCES = [
  "moonlit-essence", "glimmering-essence", "whispering-essence", "ember-essence",
  "tide-essence", "void-essence", "nightmare-essence", "starforged-essence",
] as const;
const POWDERS = [
  "silverdew-powder", "sunveil-powder", "astral-powder", "ember-powder",
  "tide-powder", "void-powder", "nightmare-powder", "starforged-powder",
] as const;
const leather = (line: string) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((tier) => `${line}-leather-t${tier}`);

export const GUILD_BUILDINGS: readonly GuildBuildingDef[] = [
  { buildingId: "war-hall", name: "War Hall", description: "Drill yards and weapon racks.", effect: { kind: "stat", stat: "str", percentPerLevel: 2 }, donationLine: INGOTS },
  { buildingId: "archery-range", name: "Archery Range", description: "Targets down a long green.", effect: { kind: "stat", stat: "dex", percentPerLevel: 2 }, donationLine: LUMBER },
  { buildingId: "arcane-library", name: "Arcane Library", description: "Shelves of humming tomes.", effect: { kind: "stat", stat: "int", percentPerLevel: 2 }, donationLine: EXTRACTS },
  { buildingId: "fortune-shrine", name: "Fortune Shrine", description: "Offerings for a lucky strike.", effect: { kind: "stat", stat: "luk", percentPerLevel: 2 }, donationLine: ESSENCES },
  { buildingId: "bastion", name: "Bastion", description: "Thick walls and thicker hides.", effect: { kind: "stat", stat: "con", percentPerLevel: 2 }, donationLine: leather("brawler") },
  { buildingId: "training-grounds", name: "Training Grounds", description: "Obstacle runs through the trees.", effect: { kind: "stat", stat: "agi", percentPerLevel: 2 }, donationLine: leather("ranger") },
  { buildingId: "treasury", name: "Treasury", description: "Counting houses and sharp ledgers.", effect: { kind: "gold", percentPerLevel: 3 }, donationLine: leather("mystic") },
  { buildingId: "academy", name: "Academy", description: "Veterans teach what they learned.", effect: { kind: "xp", percentPerLevel: 3 }, donationLine: POWDERS },
  { buildingId: "barracks", name: "Barracks", description: "Bunks for more recruits.", effect: { kind: "members", slotsPerLevel: 2 }, donationLine: INGOTS },
];

export function guildBuildingDef(buildingId: string): GuildBuildingDef | null {
  return GUILD_BUILDINGS.find((def) => def.buildingId === buildingId) ?? null;
}

/**
 * Materials to raise a building to `level` (1–10):
 * - Dragon Scales 10 × level; from level 6, Blighted scales 5 × (level − 5);
 *   levels 9–10 also take Rift scales 3 × (level − 8).
 * - The building's donated good at tier min(level, 8), 20 × level.
 */
export function guildBuildingLevelCost(
  def: GuildBuildingDef,
  level: number
): Array<{ itemId: string; quantity: number }> {
  if (!Number.isSafeInteger(level) || level < 1 || level > GUILD_BUILDING_MAX_LEVEL) {
    throw new Error("Building level out of range");
  }
  return [
    { itemId: DRAGON_SCALE_ITEM_IDS.main, quantity: 10 * level },
    ...(level >= 6 ? [{ itemId: DRAGON_SCALE_ITEM_IDS.blighted, quantity: 5 * (level - 5) }] : []),
    ...(level >= 9 ? [{ itemId: DRAGON_SCALE_ITEM_IDS.rift, quantity: 3 * (level - 8) }] : []),
    { itemId: def.donationLine[Math.min(level, 8) - 1], quantity: 20 * level },
  ];
}

/**
 * Dragon scales a raid kill puts in the stash: per raider in the killing
 * lobby, 2–6 of the tier band's grade, rising through the band.
 */
export function raidScaleDrop(tier: number, raiders: number) {
  const grade = tier >= 17 ? "rift" : tier >= 9 ? "blighted" : "main";
  const bandStart = grade === "rift" ? 17 : grade === "blighted" ? 9 : 1;
  const perRaider = 2 + Math.floor((tier - bandStart + 1) / 2);
  return {
    itemId: DRAGON_SCALE_ITEM_IDS[grade],
    quantity: Math.max(1, raiders) * perRaider,
  };
}

export type GuildBuildingBonuses = {
  stats: Record<GuildStatKey, number>;
  goldPercent: number;
  xpPercent: number;
  memberSlots: number;
};

export function emptyBuildingBonuses(): GuildBuildingBonuses {
  return {
    stats: { str: 0, dex: 0, int: 0, luk: 0, con: 0, agi: 0 },
    goldPercent: 0,
    xpPercent: 0,
    memberSlots: 0,
  };
}

export function bonusesFromLevels(
  levels: Array<{ buildingId: string; level: number }>
): GuildBuildingBonuses {
  const bonuses = emptyBuildingBonuses();
  for (const row of levels) {
    const def = guildBuildingDef(row.buildingId);
    if (!def) continue;
    const level = Math.max(0, Math.min(GUILD_BUILDING_MAX_LEVEL, row.level));
    const effect = def.effect;
    if (effect.kind === "stat") bonuses.stats[effect.stat] += effect.percentPerLevel * level;
    else if (effect.kind === "gold") bonuses.goldPercent += effect.percentPerLevel * level;
    else if (effect.kind === "xp") bonuses.xpPercent += effect.percentPerLevel * level;
    else bonuses.memberSlots += effect.slotsPerLevel * level;
  }
  return bonuses;
}

export async function readGuildBuildingBonuses(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">
): Promise<GuildBuildingBonuses> {
  const rows = await ctx.db
    .query("guildBuildings")
    .withIndex("by_guildId", (q) => q.eq("guildId", guildId))
    .take(GUILD_BUILDINGS.length * 2);
  return bonusesFromLevels(rows);
}

async function itemBySlug(ctx: DatabaseCtx, slug: string) {
  return await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", slug))
    .first();
}

async function stashRows(ctx: DatabaseCtx, guildId: Id<"guilds">, itemId: Id<"items">) {
  return await ctx.db
    .query("guildStashItems")
    .withIndex("by_guildId_and_itemId", (q) => q.eq("guildId", guildId).eq("itemId", itemId))
    .take(500);
}

async function inventoryQuantity(ctx: DatabaseCtx, playerId: Id<"players">, itemId: Id<"items">) {
  const rows = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_itemId", (q) => q.eq("playerId", playerId).eq("itemId", itemId))
    .take(500);
  return rows
    .filter((row) => row.equippedSlot === undefined)
    .reduce((sum, row) => sum + row.quantity, 0);
}

async function membershipFor(ctx: DatabaseCtx, playerId: Id<"players">) {
  return await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
}

async function buildingRow(ctx: DatabaseCtx, guildId: Id<"guilds">, buildingId: string) {
  return await ctx.db
    .query("guildBuildings")
    .withIndex("by_guildId_and_buildingId", (q) =>
      q.eq("guildId", guildId).eq("buildingId", buildingId)
    )
    .first();
}

function effectLabel(effect: GuildBuildingEffect, level: number) {
  switch (effect.kind) {
    case "stat":
      return `+${effect.percentPerLevel * level}% ${effect.stat.toUpperCase()}`;
    case "gold":
      return `+${effect.percentPerLevel * level}% gold`;
    case "xp":
      return `+${effect.percentPerLevel * level}% XP`;
    case "members":
      return `+${effect.slotsPerLevel * level} member slots`;
  }
}

/** Every building with its level, bonus, and next-level cost vs the stash. */
export const getGuildBuildings = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const membership = await membershipFor(ctx, playerId);
    if (!membership) return null;
    const rows = await ctx.db
      .query("guildBuildings")
      .withIndex("by_guildId", (q) => q.eq("guildId", membership.guildId))
      .take(GUILD_BUILDINGS.length * 2);
    const levelOf = (buildingId: string) =>
      rows.find((row) => row.buildingId === buildingId)?.level ?? 0;
    const canUpgrade = membership.role === "master" || membership.role === "officer";

    const buildings = [];
    for (const def of GUILD_BUILDINGS) {
      const level = levelOf(def.buildingId);
      const next = level < GUILD_BUILDING_MAX_LEVEL ? level + 1 : null;
      const cost = [];
      if (next !== null) {
        for (const entry of guildBuildingLevelCost(def, next)) {
          const item = await itemBySlug(ctx, entry.itemId);
          const inStash = item
            ? (await stashRows(ctx, membership.guildId, item._id)).reduce((sum, row) => sum + row.quantity, 0)
            : 0;
          const inInventory = item ? await inventoryQuantity(ctx, playerId, item._id) : 0;
          cost.push({
            itemSlug: entry.itemId,
            itemName: item?.name ?? entry.itemId,
            needed: entry.quantity,
            inStash,
            inInventory,
            // Raid scales only come from raids; members can't donate them.
            donatable: !Object.values(DRAGON_SCALE_ITEM_IDS).includes(entry.itemId as never),
          });
        }
      }
      buildings.push({
        buildingId: def.buildingId,
        name: def.name,
        description: def.description,
        level,
        maxLevel: GUILD_BUILDING_MAX_LEVEL,
        bonus: level > 0 ? effectLabel(def.effect, level) : null,
        nextBonus: next !== null ? effectLabel(def.effect, next) : null,
        cost,
        affordable: cost.length > 0 && cost.every((row) => row.inStash >= row.needed),
      });
    }
    return { buildings, canUpgrade, bonuses: bonusesFromLevels(rows) };
  },
});

/**
 * Donate a building material from your inventory to the guild stash. Any
 * member can donate; only goods some building takes are accepted.
 */
export const donateBuildingMaterial = mutation({
  args: {
    playerId: v.id("players"),
    itemSlug: v.string(),
    quantity: v.number(),
  },
  handler: async (ctx, { playerId, itemSlug, quantity }) => {
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Donation quantity must be a positive integer");
    }
    const accepted = GUILD_BUILDINGS.some((def) => def.donationLine.includes(itemSlug));
    if (!accepted) throw new Error("No guild building uses that item");
    const membership = await membershipFor(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const item = await itemBySlug(ctx, itemSlug);
    if (!item) throw new Error("Item not found");
    await consumeItems(ctx, playerId, [{ itemId: item._id, quantity }]);
    await grantItemToGuildStash(ctx, { guildId: membership.guildId, itemId: item._id, quantity });
    return { donated: quantity };
  },
});

/** Officers spend stash materials to raise a building one level. */
export const upgradeGuildBuilding = mutation({
  args: { playerId: v.id("players"), buildingId: v.string() },
  handler: async (ctx, { playerId, buildingId }) => {
    await requirePlayerOwner(ctx, playerId);
    const def = guildBuildingDef(buildingId);
    if (!def) throw new Error("Unknown guild building");
    const membership = await membershipFor(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const existing = await buildingRow(ctx, membership.guildId, buildingId);
    const level = existing?.level ?? 0;
    if (level >= GUILD_BUILDING_MAX_LEVEL) throw new Error(`${def.name} is already at max level`);

    const cost = guildBuildingLevelCost(def, level + 1);
    // Check everything before spending anything.
    const plan: Array<{ rows: Doc<"guildStashItems">[]; quantity: number }> = [];
    for (const entry of cost) {
      const item = await itemBySlug(ctx, entry.itemId);
      const rows = item ? await stashRows(ctx, membership.guildId, item._id) : [];
      const have = rows.reduce((sum, row) => sum + row.quantity, 0);
      if (have < entry.quantity) {
        throw new Error(`Not enough ${item?.name ?? entry.itemId} in the stash (${have}/${entry.quantity})`);
      }
      plan.push({ rows, quantity: entry.quantity });
    }
    const now = Date.now();
    for (const { rows, quantity } of plan) {
      let remaining = quantity;
      for (const row of rows) {
        if (remaining === 0) break;
        const taken = Math.min(row.quantity, remaining);
        remaining -= taken;
        if (taken === row.quantity) await ctx.db.delete(row._id);
        else await ctx.db.patch(row._id, { quantity: row.quantity - taken, updatedAt: now });
      }
    }
    if (existing) {
      await ctx.db.patch(existing._id, { level: level + 1, updatedAt: now, updatedBy: playerId });
    } else {
      await ctx.db.insert("guildBuildings", {
        guildId: membership.guildId,
        buildingId,
        level: 1,
        updatedAt: now,
        updatedBy: playerId,
      });
    }
    return { buildingId, level: level + 1 };
  },
});

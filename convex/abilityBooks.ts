import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeItems, grantItemToInventory } from "./items";
import { v } from "convex/values";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Ability book consumption and XP granting.
 * Books are regular items with category "abilityBook" that grant ability XP when consumed.
 */

export const ABILITY_BOOK_EFFECT_TYPE = "ability_book";

interface AbilityBookMetadata {
  abilityId: string;
  bookTier: number;
}

/**
 * Read ability book metadata from an item definition.
 * The metadata is stored in the item's effectAmount (XP) and we infer abilityId/bookTier from itemId.
 * For more structured data, we could add effectData field to items table.
 */
function parseAbilityBookItemId(itemId: string): AbilityBookMetadata | null {
  // Expected format: "ability_book_{abilityId}_{bookTier}"
  // e.g., "ability_book_fireball_1" -> abilityId: "fireball", bookTier: 1
  const match = itemId.match(/^ability_book_(.+)_(\d+)$/);
  if (!match) return null;
  return {
    abilityId: match[1],
    bookTier: parseInt(match[2], 10),
  };
}

/**
 * Get the XP value for an ability book item.
 * Falls back to balance config if not on the item.
 */
async function getBookXpValue(
  ctx: DatabaseCtx,
  item: Doc<"items">
): Promise<number> {
  if (
    item.effectType === ABILITY_BOOK_EFFECT_TYPE &&
    typeof item.effectAmount === "number" &&
    item.effectAmount > 0
  ) {
    return item.effectAmount;
  }
  // Fallback: compute from book tier
  const meta = parseAbilityBookItemId(item.itemId);
  if (meta) {
    const baseXpRow = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "abilityBookBaseXp"))
      .first();
    const base = typeof baseXpRow?.value === "number" ? baseXpRow.value : 100;
    return base * meta.bookTier;
  }
  return 100;
}

/**
 * Validate that an item is an ability book and get its metadata.
 */
async function validateAbilityBook(
  ctx: DatabaseCtx,
  itemId: Id<"items">
): Promise<{ item: Doc<"items">; metadata: AbilityBookMetadata; xpValue: number } | null> {
  const item = await ctx.db.get(itemId);
  if (!item) return null;
  if (item.category !== "abilityBook") return null;

  const metadata = parseAbilityBookItemId(item.itemId);
  if (!metadata) return null;

  const xpValue = await getBookXpValue(ctx, item);
  return { item, metadata, xpValue };
}

/**
 * Consume an ability book and grant XP to the corresponding player ability.
 * Returns the updated ability level and XP.
 */
export async function consumeAbilityBook(
  ctx: MutationCtx,
  playerId: PlayerId,
  playerItemId: Id<"playerItems">,
  quantity: number = 1
): Promise<{ abilityId: string; xpGranted: number; newLevel: number; newXp: number } | null> {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Invalid quantity");
  }

  // Get the player's inventory item
  const playerItem = await ctx.db.get(playerItemId);
  if (
    !playerItem ||
    playerItem.playerId !== playerId ||
    playerItem.quantity < quantity
  ) {
    throw new Error("Insufficient items");
  }

  // Validate it's an ability book
  const bookData = await validateAbilityBook(ctx, playerItem.itemId);
  if (!bookData) {
    throw new Error("Item is not a valid ability book");
  }

  const { metadata, xpValue } = bookData;
  const totalXp = xpValue * quantity;

  // Ensure player ability row exists
  let playerAbility = await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId_and_abilityId", (q) =>
      q.eq("playerId", playerId).eq("abilityId", metadata.abilityId)
    )
    .first();

  const now = Date.now();
  if (!playerAbility) {
    // First time learning this ability - create at level 1 with 0 XP
    const abilityDef = await ctx.db
      .query("abilities")
      .withIndex("by_abilityId", (q) => q.eq("abilityId", metadata.abilityId))
      .first();

    if (!abilityDef || !abilityDef.enabled) {
      throw new Error("Ability not found or disabled");
    }

    const id = await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: metadata.abilityId,
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    playerAbility = await ctx.db.get(id);
    if (!playerAbility) throw new Error("Failed to create player ability");
  }

  // Check max level
  const abilityDef = await ctx.db
    .query("abilities")
    .withIndex("by_abilityId", (q) => q.eq("abilityId", metadata.abilityId))
    .first();

  if (abilityDef?.maxLevel && playerAbility.level >= abilityDef.maxLevel) {
    throw new Error("Ability is already at maximum level");
  }

  // Consume the book(s)
  await consumeItems(ctx, playerId, [
    { itemId: playerItem.itemId, quantity },
  ]);

  // Apply XP using the same skill XP curve
  const { applySkillExperience } = await import("./skillProgression");
  const xpBaseValue = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "skillXpPerLevel"))
    .first();
  const { readSkillXpBase } = await import("./skillProgression");
  const xpBase = readSkillXpBase(xpBaseValue?.value);

  const { level, experience } = applySkillExperience(
    playerAbility.level,
    playerAbility.experience,
    totalXp,
    abilityDef?.maxLevel,
    xpBase
  );

  const newTotalExperience = playerAbility.totalExperience + totalXp;

  await ctx.db.patch(playerAbility._id, {
    level,
    experience,
    totalExperience: newTotalExperience,
    updatedAt: now,
  });

  return {
    abilityId: metadata.abilityId,
    xpGranted: totalXp,
    newLevel: level,
    newXp: experience,
  };
}

/**
 * Get all ability books in a player's inventory.
 */
export async function getPlayerAbilityBooks(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Array<{
  playerItemId: Id<"playerItems">;
  itemId: string;
  itemName: string;
  quantity: number;
  abilityId: string;
  bookTier: number;
  xpValue: number;
}>> {
  const playerItems = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();

  const results = [];
  for (const pi of playerItems) {
    if (pi.quantity < 1) continue;
    const item = await ctx.db.get(pi.itemId);
    if (!item || item.category !== "abilityBook") continue;

    const metadata = parseAbilityBookItemId(item.itemId);
    if (!metadata) continue;

    const xpValue = await getBookXpValue(ctx, item);
    results.push({
      playerItemId: pi._id,
      itemId: item.itemId,
      itemName: item.name,
      quantity: pi.quantity,
      abilityId: metadata.abilityId,
      bookTier: metadata.bookTier,
      xpValue,
    });
  }
  return results;
}

/**
 * Get the book tier for a given boss tier.
 * Formula: bookTier = ceil(bossTier / 8)
 */
export function getBookTierForBossTier(bossTier: number): number {
  return Math.ceil(bossTier / 8);
}

/**
 * Calculate XP for a book of a given tier.
 */
export async function calculateBookXp(ctx: DatabaseCtx, bookTier: number): Promise<number> {
  const baseXpRow = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "abilityBookBaseXp"))
    .first();
  const base = typeof baseXpRow?.value === "number" ? baseXpRow.value : 100;
  return base * bookTier;
}
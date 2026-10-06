import { mutation, query } from "./_generated/server";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getPassiveBonuses } from "./passiveTree";
import { beltConsumableSlots, getEquippedBeltTier, readLeatherBalance } from "./leatherwork";
import { COMBAT_EFFECT_TYPES, SKILL_TASK_EFFECT_TYPES } from "./itemTypes";
import { MAX_SKILL_MODIFIER_MULTIPLIER } from "./skillBonuses";
import { settleTasksBeforeInteraction } from "./taskSettlement";

export const BASE_CONSUMABLE_SLOTS = 1;
export const MAX_CONSUMABLE_SLOTS = 3;

type DatabaseCtx = QueryCtx | MutationCtx;

export async function getConsumableSlotCount(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<number> {
  // Belt sets total slots (t1 = 1, t4 = 2, t8 = 3 by default balance); worn
  // with no belt (or a t1 belt) everyone keeps the base slot. Retired
  // skilling passives still contribute if present, capped at the max.
  const [beltTier, balance, bonuses] = await Promise.all([
    getEquippedBeltTier(ctx, playerId),
    readLeatherBalance(ctx),
    getPassiveBonuses(ctx, playerId),
  ]);
  const beltSlots =
    beltTier > 0 ? beltConsumableSlots(beltTier, balance) : BASE_CONSUMABLE_SLOTS;
  const passiveExtra = Number.isFinite(bonuses.consumableSlots)
    ? Math.max(0, Math.floor(bonuses.consumableSlots))
    : 0;
  return Math.min(
    MAX_CONSUMABLE_SLOTS,
    Math.max(BASE_CONSUMABLE_SLOTS, beltSlots, BASE_CONSUMABLE_SLOTS + passiveExtra)
  );
}

function isCombatConsumable(effectType: unknown) {
  return (
    typeof effectType === "string" &&
    (COMBAT_EFFECT_TYPES as readonly string[]).includes(effectType)
  );
}

function isSkillConsumable(effectType: unknown) {
  return (
    typeof effectType === "string" &&
    (SKILL_TASK_EFFECT_TYPES as readonly string[]).includes(effectType)
  );
}

export function isConsumableItem(item: Doc<"items">) {
  return (
    item.category === "crafting" &&
    typeof item.effectType === "string" &&
    (isCombatConsumable(item.effectType) ||
      isSkillConsumable(item.effectType)) &&
    typeof item.effectAmount === "number" &&
    Number.isFinite(item.effectAmount) &&
    item.effectAmount > 0 &&
    typeof item.effectDurationMs === "number" &&
    Number.isSafeInteger(item.effectDurationMs) &&
    item.effectDurationMs > 0
  );
}

export type ConsumableTaskContext =
  | { kind: "battle" }
  | { kind: "boss" }
  | { kind: "skill"; skillCategory: "gathering" | "crafting" }
  | { kind: "idle" };

export function isConsumableApplicable(
  item: Doc<"items">,
  context: ConsumableTaskContext
): boolean {
  const effectType = item.effectType;
  if (typeof effectType !== "string") return false;
  if (
    effectType === "heal-over-time" ||
    effectType === "combat-stat-boost" ||
    effectType === "combat-xp-multiplier"
  ) {
    return context.kind === "battle" || context.kind === "boss";
  }
  if (
    effectType === "skill-xp-multiplier" ||
    effectType === "skill-speed-multiplier"
  ) {
    if (context.kind !== "skill") return false;
    const scope = item.effectScope ?? "all";
    if (scope === "all") return true;
    return scope === context.skillCategory;
  }
  return false;
}

async function findOwnedStack(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  itemDefId: Id<"items">
) {
  const rows = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_itemId", (q) =>
      q.eq("playerId", playerId).eq("itemId", itemDefId)
    )
    .take(10);
  return rows.find((row) => row.equippedSlot === undefined && row.quantity > 0) ?? null;
}

async function consumeOneUnit(
  ctx: MutationCtx,
  ownedRow: Doc<"playerItems">
) {
  if (ownedRow.quantity <= 1) {
    await ctx.db.delete(ownedRow._id);
  } else {
    await ctx.db.patch(ownedRow._id, {
      quantity: ownedRow.quantity - 1,
      updatedAt: Date.now(),
    });
  }
}

async function activateCombatConsumable(
  ctx: MutationCtx,
  playerId: Id<"players">,
  item: Doc<"items">,
  now: number
): Promise<boolean> {
  const effectType = item.effectType as string;
  const effectAmount = item.effectAmount as number;
  const durationMs = item.effectDurationMs as number;
  // Skip while the same source is still active; other sources of the same
  // type stack through the existing boost aggregation.
  const existing = (
    await ctx.db
      .query("playerCombatBoosts")
      .withIndex("by_playerId_and_effectType", (q) =>
        q.eq("playerId", playerId).eq("effectType", effectType)
      )
      .collect()
  ).find((row) => row.sourceItemId === item._id && row.expiresAt > now);
  if (existing) return false;
  const owned = await findOwnedStack(ctx, playerId, item._id);
  if (!owned) return false;
  await consumeOneUnit(ctx, owned);
  // Combat-stat boosts key rows by source item so different brews stack.
  const sameSourceExpired = (
    await ctx.db
      .query("playerCombatBoosts")
      .withIndex("by_playerId_and_effectType", (q) =>
        q.eq("playerId", playerId).eq("effectType", effectType)
      )
      .collect()
  ).find((row) => row.sourceItemId === item._id);
  if (sameSourceExpired) {
    await ctx.db.patch(sameSourceExpired._id, {
      effectAmount,
      startedAt: now,
      expiresAt: now + durationMs,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("playerCombatBoosts", {
      playerId,
      effectType,
      ...(item.effectStat === undefined ? {} : { effectStat: item.effectStat }),
      ...(item.buffVariant === undefined ? {} : { variant: item.buffVariant }),
      effectAmount,
      sourceItemId: item._id,
      startedAt: now,
      expiresAt: now + durationMs,
      createdAt: now,
      updatedAt: now,
    });
  }
  return true;
}

async function activateSkillConsumable(
  ctx: MutationCtx,
  playerId: Id<"players">,
  item: Doc<"items">,
  now: number
): Promise<boolean> {
  const effectType = item.effectType as
    | "skill-xp-multiplier"
    | "skill-speed-multiplier";
  const scope = (item.effectScope ?? "all") as "all" | "gathering" | "crafting";
  const effectAmount = item.effectAmount as number;
  const durationMs = item.effectDurationMs as number;
  if (effectAmount > MAX_SKILL_MODIFIER_MULTIPLIER) return false;
  const existing = (
    await ctx.db
      .query("playerSkillBoosts")
      .withIndex("by_playerId_and_effectType_and_effectScope", (q) =>
        q.eq("playerId", playerId).eq("effectType", effectType).eq("effectScope", scope)
      )
      .collect()
  ).find((row) => row.sourceItemId === item._id && row.expiresAt > now);
  if (existing) return false;
  const owned = await findOwnedStack(ctx, playerId, item._id);
  if (!owned) return false;
  await consumeOneUnit(ctx, owned);
  const sameSource = (
    await ctx.db
      .query("playerSkillBoosts")
      .withIndex("by_playerId_and_effectType_and_effectScope", (q) =>
        q.eq("playerId", playerId).eq("effectType", effectType).eq("effectScope", scope)
      )
      .collect()
  ).find((row) => row.sourceItemId === item._id);
  if (sameSource) {
    await ctx.db.patch(sameSource._id, {
      effectAmount,
      startedAt: now,
      expiresAt:
        sameSource.expiresAt > now ? sameSource.expiresAt + durationMs : now + durationMs,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("playerSkillBoosts", {
      playerId,
      effectType,
      effectScope: scope,
      effectAmount,
      sourceItemId: item._id,
      startedAt: now,
      expiresAt: now + durationMs,
      createdAt: now,
      updatedAt: now,
    });
  }
  return true;
}

/**
 * Auto-use equipped consumables whose buff has expired and whose item
 * matches the current task context. Consumes 1 inventory unit per
 * activation. Slots with no stock stay equipped but inactive.
 */
export async function tickEquippedConsumables(
  ctx: MutationCtx,
  playerId: Id<"players">,
  context: ConsumableTaskContext,
  now: number
): Promise<{ activated: string[] }> {
  if (context.kind === "idle") return { activated: [] };
  const slotCount = await getConsumableSlotCount(ctx, playerId);
  const slots = await ctx.db
    .query("playerConsumableSlots")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(MAX_CONSUMABLE_SLOTS + 1);
  const activated: string[] = [];
  for (const slot of slots) {
    if (slot.slotIndex < 0 || slot.slotIndex >= slotCount) continue;
    const item = await ctx.db.get(slot.itemId);
    if (!item || !isConsumableItem(item)) continue;
    if (!isConsumableApplicable(item, context)) continue;
    const effectType = item.effectType as string;
    let didActivate = false;
    if (isCombatConsumable(effectType)) {
      didActivate = await activateCombatConsumable(ctx, playerId, item, now);
    } else if (isSkillConsumable(effectType)) {
      didActivate = await activateSkillConsumable(ctx, playerId, item, now);
    }
    if (didActivate) activated.push(item.itemId);
  }
  return { activated };
}

export const getConsumableSlots = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const slotCount = await getConsumableSlotCount(ctx, playerId);
    const slots = await ctx.db
      .query("playerConsumableSlots")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(MAX_CONSUMABLE_SLOTS + 1);
    const byIndex = new Map(slots.map((slot) => [slot.slotIndex, slot]));
    const result = [];
    for (let index = 0; index < slotCount; index += 1) {
      const slot = byIndex.get(index) ?? null;
      if (!slot) {
        result.push({ slotIndex: index, slotId: null, item: null, stock: 0 });
        continue;
      }
      const item = await ctx.db.get(slot.itemId);
      const owned = item ? await findOwnedStack(ctx, playerId, item._id) : null;
      result.push({
        slotIndex: index,
        slotId: slot._id,
        item,
        stock: owned?.quantity ?? 0,
      });
    }
    return {
      slotCount,
      maxSlots: MAX_CONSUMABLE_SLOTS,
      slots: result,
      locked: Array.from(
        { length: MAX_CONSUMABLE_SLOTS - slotCount },
        (_, i) => slotCount + i
      ),
    };
  },
});

export const setConsumableSlot = mutation({
  args: {
    playerId: v.id("players"),
    slotIndex: v.number(),
    // Null clears the slot.
    itemDefId: v.optional(v.id("items")),
  },
  handler: async (ctx, { playerId, slotIndex, itemDefId }) => {
    await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const slotCount = await getConsumableSlotCount(ctx, playerId);
    if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount) {
      throw new Error(`Consumable slot ${slotIndex} is not unlocked`);
    }
    if (slotIndex >= MAX_CONSUMABLE_SLOTS) {
      throw new Error("Too many consumable slots");
    }
    if (itemDefId === undefined) {
      const existing = await ctx.db
        .query("playerConsumableSlots")
        .withIndex("by_playerId_and_slotIndex", (q) =>
          q.eq("playerId", playerId).eq("slotIndex", slotIndex)
        )
        .first();
      if (existing) await ctx.db.delete(existing._id);
      return { slotIndex, cleared: true as const };
    }
    const item = await ctx.db.get(itemDefId);
    if (!item || !isConsumableItem(item)) {
      throw new Error("That item cannot be equipped as a consumable");
    }
    const owned = await findOwnedStack(ctx, playerId, item._id);
    if (!owned) {
      throw new Error("You do not own that consumable");
    }
    // One item per slot set: prevent the same brew in two slots.
    const siblings = await ctx.db
      .query("playerConsumableSlots")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(MAX_CONSUMABLE_SLOTS + 1);
    for (const sibling of siblings) {
      if (sibling.slotIndex !== slotIndex && sibling.itemId === item._id) {
        throw new Error("That consumable is already equipped in another slot");
      }
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("playerConsumableSlots")
      .withIndex("by_playerId_and_slotIndex", (q) =>
        q.eq("playerId", playerId).eq("slotIndex", slotIndex)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { itemId: item._id, updatedAt: now });
    } else {
      await ctx.db.insert("playerConsumableSlots", {
        playerId,
        slotIndex,
        itemId: item._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { slotIndex, itemId: item.itemId };
  },
});

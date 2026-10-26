import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { grantItemToInventory } from "./items";
import { settleTasksBeforeInteraction } from "./taskSettlement";

/**
 * Grant items to the guild stash with the normal stacking policy and no
 * stash limits: fill existing stacks up to maxStackSize, then spill into new
 * rows (multiple stacks allowed). Non-stackable items get one row per unit.
 */
export async function grantItemToGuildStash(
  ctx: MutationCtx,
  args: { guildId: Id<"guilds">; itemId: Id<"items">; quantity: number }
): Promise<{ added: number }> {
  if (!Number.isSafeInteger(args.quantity) || args.quantity < 1) {
    throw new Error("Item quantity must be a positive integer");
  }
  const item = await ctx.db.get(args.itemId);
  if (!item) throw new Error("Item definition not found");
  const now = Date.now();
  let remaining = args.quantity;

  if (item.stackable) {
    const stacks = await ctx.db
      .query("guildStashItems")
      .withIndex("by_guildId_and_itemId", (q) =>
        q.eq("guildId", args.guildId).eq("itemId", args.itemId)
      )
      .take(500);
    for (const stack of stacks) {
      if (remaining <= 0) break;
      const available = Math.max(0, item.maxStackSize - stack.quantity);
      if (available === 0) continue;
      const added = Math.min(available, remaining);
      await ctx.db.patch(stack._id, {
        quantity: stack.quantity + added,
        updatedAt: now,
      });
      remaining -= added;
    }
    while (remaining > 0) {
      const stackQuantity = Math.min(item.maxStackSize, remaining);
      await ctx.db.insert("guildStashItems", {
        guildId: args.guildId,
        itemId: args.itemId,
        quantity: stackQuantity,
        acquiredAt: now,
        updatedAt: now,
      });
      remaining -= stackQuantity;
    }
  } else {
    for (let i = 0; i < args.quantity; i += 1) {
      await ctx.db.insert("guildStashItems", {
        guildId: args.guildId,
        itemId: args.itemId,
        quantity: 1,
        acquiredAt: now,
        updatedAt: now,
      });
    }
    remaining = 0;
  }
  return { added: args.quantity - remaining };
}

async function requireGuildMember(
  ctx: MutationCtx,
  playerId: Id<"players">
) {
  const membership = await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
  if (!membership) throw new Error("You are not in a guild");
  const guild = await ctx.db.get(membership.guildId);
  if (!guild) throw new Error("Guild not found");
  return { guild, membership };
}

export const getGuildStash = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) return [];
    const rows = await ctx.db
      .query("guildStashItems")
      .withIndex("by_guildId", (q) => q.eq("guildId", membership.guildId))
      .take(500);
    const items = await Promise.all(rows.map((row) => ctx.db.get(row.itemId)));
    return rows.map((row, i) => ({
      ...row,
      itemName: items[i]?.name ?? "Unknown item",
      itemSlug: items[i]?.itemId,
    }));
  },
});

/**
 * Withdraw stash items to personal inventory. Officer+ only (mirrors guild
 * bank withdrawals). Respects inventory capacity via grantItemToInventory;
 * leftover stays in the stash when the inventory is full.
 */
export const withdrawFromGuildStash = mutation({
  args: {
    playerId: v.id("players"),
    stashId: v.id("guildStashItems"),
    quantity: v.number(),
  },
  handler: async (ctx, { playerId, stashId, quantity }) => {
    await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const { membership } = await requireGuildMember(ctx, playerId);
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Withdraw quantity must be a positive integer");
    }
    const row = await ctx.db.get(stashId);
    if (!row || row.guildId !== membership.guildId) {
      throw new Error("Stash item not found");
    }
    const take = Math.min(quantity, row.quantity);
    const result = await grantItemToInventory(ctx, {
      playerId,
      itemId: row.itemId,
      quantity: take,
      rejectIfFull: false,
    });
    if (result.added === 0) throw new Error("Inventory is full");
    if (result.added >= row.quantity) {
      await ctx.db.delete(row._id);
    } else {
      await ctx.db.patch(row._id, {
        quantity: row.quantity - result.added,
        updatedAt: Date.now(),
      });
    }
    return { withdrawn: result.added, pending: result.pending };
  },
});

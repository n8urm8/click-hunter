import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requirePlayer, requirePlayerRead } from "./playerAuth";

/** Bounds the block list per character. Also bounds the read on every chat load. */
export const MAX_BLOCKED_PLAYERS = 200;

/** Ids of the characters this one has blocked. */
export async function readBlockedPlayerIds(
  ctx: QueryCtx | MutationCtx,
  blockerId: Id<"players">
): Promise<Set<Id<"players">>> {
  const rows = await ctx.db
    .query("playerBlocks")
    .withIndex("by_blockerId", (q) => q.eq("blockerId", blockerId))
    .take(MAX_BLOCKED_PLAYERS);
  return new Set(rows.map((row) => row.blockedId));
}

export async function isBlocking(
  ctx: QueryCtx | MutationCtx,
  blockerId: Id<"players">,
  blockedId: Id<"players">
): Promise<boolean> {
  const row = await ctx.db
    .query("playerBlocks")
    .withIndex("by_blockerId_and_blockedId", (q) =>
      q.eq("blockerId", blockerId).eq("blockedId", blockedId)
    )
    .unique();
  return row !== null;
}

export const listBlockedPlayers = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const rows = await ctx.db
      .query("playerBlocks")
      .withIndex("by_blockerId", (q) => q.eq("blockerId", playerId))
      .take(MAX_BLOCKED_PLAYERS);
    return rows
      .map((row) => ({
        playerId: row.blockedId,
        name: row.blockedName,
        blockedAt: row.createdAt,
      }))
      .sort((first, second) => second.blockedAt - first.blockedAt);
  },
});

export const blockPlayer = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requirePlayer(ctx, playerId);
    if (targetPlayerId === playerId) {
      throw new Error("You cannot block your own character.");
    }
    const target = await ctx.db.get(targetPlayerId);
    if (!target) {
      throw new Error("Player not found");
    }
    if (await isBlocking(ctx, playerId, targetPlayerId)) {
      return null;
    }
    const blockedCount = await ctx.db
      .query("playerBlocks")
      .withIndex("by_blockerId", (q) => q.eq("blockerId", playerId))
      .take(MAX_BLOCKED_PLAYERS + 1);
    if (blockedCount.length >= MAX_BLOCKED_PLAYERS) {
      throw new Error(
        `Your block list is full (${MAX_BLOCKED_PLAYERS} players). Unblock someone first.`
      );
    }
    await ctx.db.insert("playerBlocks", {
      blockerId: playerId,
      blockedId: targetPlayerId,
      blockedName: target.name,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const unblockPlayer = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requirePlayer(ctx, playerId);
    const row = await ctx.db
      .query("playerBlocks")
      .withIndex("by_blockerId_and_blockedId", (q) =>
        q.eq("blockerId", playerId).eq("blockedId", targetPlayerId)
      )
      .unique();
    if (row) {
      await ctx.db.delete("playerBlocks", row._id);
    }
    return null;
  },
});

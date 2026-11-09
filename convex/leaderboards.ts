import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayerOwner } from "./playerAuth";
import { v } from "convex/values";

/**
 * Boards are materialized on a schedule rather than read from `players`.
 *
 * `players` changes on every fight settlement, so a board query over it would
 * re-run for every viewer whenever anyone on the board finished a batch. Instead
 * a cron copies the top rows into the board tables and writes only what changed,
 * so viewers re-read at most once per refresh, and only if the board moved.
 */
const BOARD_SIZE = 50;
const MAX_QUERY_LIMIT = 100;
const SIM_PLAYER_SUBJECT_PREFIX = "sim-live:";

type BoardRow = { playerId: Id<"players">; playerName: string; value: number };

function isRankedPlayer(player: Doc<"players">) {
  return !player.authSubject?.startsWith(SIM_PLAYER_SUBJECT_PREFIX);
}

/** Bring one board table in line with `next`, writing only the differences. */
async function syncBoard(
  ctx: MutationCtx,
  existing: Array<{ _id: Id<"leaderboardByExperience"> | Id<"leaderboardByTier"> | Id<"leaderboardByRebirth">; playerId: Id<"players">; playerName: string }>,
  next: BoardRow[],
  valueOf: (row: never) => number,
  write: {
    insert: (row: BoardRow, now: number) => Promise<unknown>;
    patch: (id: never, row: BoardRow, now: number) => Promise<unknown>;
  }
) {
  const now = Date.now();
  const nextByPlayer = new Map(next.map((row) => [row.playerId, row]));
  const seen = new Set<Id<"players">>();
  for (const row of existing) {
    const target = nextByPlayer.get(row.playerId);
    if (!target || seen.has(row.playerId)) {
      await ctx.db.delete(row._id);
      continue;
    }
    seen.add(row.playerId);
    if (valueOf(row as never) !== target.value || row.playerName !== target.playerName) {
      await write.patch(row._id as never, target, now);
    }
  }
  for (const row of next) {
    if (!seen.has(row.playerId)) await write.insert(row, now);
  }
}

export const refreshLeaderboards = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Over-read slightly so simulation characters can't shrink a board.
    const take = BOARD_SIZE + 10;
    const [byExperience, byTier, byRebirth] = await Promise.all([
      ctx.db.query("players").withIndex("by_totalExperience").order("desc").take(take),
      ctx.db.query("players").withIndex("by_maxTierReached").order("desc").take(take),
      ctx.db.query("players").withIndex("by_rebirthCount").order("desc").take(take),
    ]);
    const top = (players: Doc<"players">[], value: (player: Doc<"players">) => number) =>
      players
        .filter(isRankedPlayer)
        .filter((player) => value(player) > 0)
        .slice(0, BOARD_SIZE)
        .map((player) => ({ playerId: player._id, playerName: player.name, value: value(player) }));

    await syncBoard(
      ctx,
      await ctx.db.query("leaderboardByExperience").take(BOARD_SIZE * 2),
      top(byExperience, (player) => player.totalExperience),
      (row: Doc<"leaderboardByExperience">) => row.totalExperience,
      {
        insert: (row, now) =>
          ctx.db.insert("leaderboardByExperience", {
            playerId: row.playerId,
            playerName: row.playerName,
            totalExperience: row.value,
            lastUpdated: now,
          }),
        patch: (id: Id<"leaderboardByExperience">, row, now) =>
          ctx.db.patch(id, { totalExperience: row.value, playerName: row.playerName, lastUpdated: now }),
      }
    );
    await syncBoard(
      ctx,
      await ctx.db.query("leaderboardByTier").take(BOARD_SIZE * 2),
      top(byTier, (player) => player.maxTierReached ?? player.currentTier),
      (row: Doc<"leaderboardByTier">) => row.maxTierReached,
      {
        insert: (row, now) =>
          ctx.db.insert("leaderboardByTier", {
            playerId: row.playerId,
            playerName: row.playerName,
            maxTierReached: row.value,
            lastUpdated: now,
          }),
        patch: (id: Id<"leaderboardByTier">, row, now) =>
          ctx.db.patch(id, { maxTierReached: row.value, playerName: row.playerName, lastUpdated: now }),
      }
    );
    await syncBoard(
      ctx,
      await ctx.db.query("leaderboardByRebirth").take(BOARD_SIZE * 2),
      top(byRebirth, (player) => player.rebirthCount),
      (row: Doc<"leaderboardByRebirth">) => row.rebirthCount,
      {
        insert: (row, now) =>
          ctx.db.insert("leaderboardByRebirth", {
            playerId: row.playerId,
            playerName: row.playerName,
            rebirthCount: row.value,
            lastUpdated: now,
          }),
        patch: (id: Id<"leaderboardByRebirth">, row, now) =>
          ctx.db.patch(id, { rebirthCount: row.value, playerName: row.playerName, lastUpdated: now }),
      }
    );
    return null;
  },
});

function boundedLimit(limit: number) {
  return Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.floor(limit)));
}

// Query top N by experience
export const getTopByExperience = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByExperience")
      .withIndex("by_totalExperience")
      .order("desc")
      .take(boundedLimit(args.limit));
  },
});

// Query top N by tier
export const getTopByTier = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByTier")
      .withIndex("by_maxTierReached")
      .order("desc")
      .take(boundedLimit(args.limit));
  },
});

// Query top N by rebirth
export const getTopByRebirth = query({
  args: { limit: v.number() },
  async handler(ctx, args) {
    return await ctx.db
      .query("leaderboardByRebirth")
      .withIndex("by_rebirthCount")
      .order("desc")
      .take(boundedLimit(args.limit));
  },
});

// A player's rank on each board, or null when outside the top rows it stores.
export const getPlayerRanks = query({
  args: { playerId: v.id("players") },
  async handler(ctx, args) {
    await requirePlayerOwner(ctx, args.playerId);
    const [byExperience, byTier, byRebirth] = await Promise.all([
      ctx.db.query("leaderboardByExperience").withIndex("by_totalExperience").order("desc").take(BOARD_SIZE),
      ctx.db.query("leaderboardByTier").withIndex("by_maxTierReached").order("desc").take(BOARD_SIZE),
      ctx.db.query("leaderboardByRebirth").withIndex("by_rebirthCount").order("desc").take(BOARD_SIZE),
    ]);
    const rankIn = (rows: Array<{ playerId: Id<"players"> }>) => {
      const index = rows.findIndex((row) => row.playerId === args.playerId);
      return index === -1 ? null : index + 1;
    };
    return {
      expRank: rankIn(byExperience),
      tierRank: rankIn(byTier),
      rebirthRank: rankIn(byRebirth),
    };
  },
});

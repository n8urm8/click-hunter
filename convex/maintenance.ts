import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { rebuildBalanceSnapshot } from "./balance";

/**
 * History tables grow with every fight and are only ever read for recent rows,
 * so old rows are deleted in small batches. Dedupe keys stay safe: a settlement
 * only re-delivers within minutes, far inside these windows.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;
const RETENTION_MS = {
  fightHistory: 30 * DAY_MS,
  lootAwards: 14 * DAY_MS,
  taskBattleStats: 14 * DAY_MS,
  taskHistory: 30 * DAY_MS,
} as const;

type PrunableTable = keyof typeof RETENTION_MS;
const PRUNABLE_TABLES = Object.keys(RETENTION_MS) as PrunableTable[];

export const pruneHistory = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let more = false;
    for (const table of PRUNABLE_TABLES) {
      const cutoff = now - RETENTION_MS[table];
      // The default index is creation order, so the oldest rows come first and
      // the range stops at the cutoff instead of scanning kept rows.
      const expired = await ctx.db
        .query(table)
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(BATCH_SIZE);
      for (const row of expired) {
        await ctx.db.delete(row._id);
      }
      if (expired.length === BATCH_SIZE) more = true;
    }
    if (more) {
      await ctx.scheduler.runAfter(1_000, internal.maintenance.pruneHistory, {});
    }
    return null;
  },
});

/**
 * Cron safety net for writers that change rows without rebuilding (seeds,
 * migrations, the dashboard). Costs two documents when nothing changed.
 */
export const refreshBalanceSnapshot = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [snapshot, newestRow] = await Promise.all([
      ctx.db.query("balanceSnapshots").first(),
      ctx.db.query("gameBalance").withIndex("by_lastUpdated").order("desc").first(),
    ]);
    if (!newestRow) return null;
    if (snapshot && newestRow.lastUpdated <= snapshot.sourceUpdatedAt) return null;
    await rebuildBalanceSnapshot(ctx);
    return null;
  },
});

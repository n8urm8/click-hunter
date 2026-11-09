import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * gameBalance reader used by every gameplay path.
 *
 * Reads cost documents and subscribers, so this module avoids them twice over:
 *
 * 1. Each transaction reads a key at most once. A memo keyed on `ctx.db` lives
 *    exactly as long as the transaction, so helpers may freely re-read balance
 *    instead of threading values through their signatures.
 * 2. A caller needing many keys reads one `balanceSnapshots` document instead
 *    of scanning all 138 `gameBalance` rows. `by_lastUpdated` detects a row
 *    written since the snapshot was built, in which case readers fall back to a
 *    scan, so a stale snapshot can cost documents but can never return a stale
 *    value. Row edits refresh the snapshot through the `refreshBalanceSnapshot` cron.
 *
 * The client imports modules that import this one, so it must not register
 * functions: keep those in maintenance.ts.
 *
 * Row writers must set `lastUpdated`, and deleting a row must call
 * `rebuildBalanceSnapshot`, since a deletion leaves no newer row to notice.
 */

type BalanceMemo = {
  points: Map<string, Promise<unknown>>;
  all?: Promise<Map<string, unknown>>;
};

const memos = new WeakMap<object, BalanceMemo>();

function memoFor(ctx: DatabaseCtx): BalanceMemo {
  let memo = memos.get(ctx.db);
  if (!memo) {
    memo = { points: new Map() };
    memos.set(ctx.db, memo);
  }
  return memo;
}

/** Forget this transaction's balance reads after it writes gameBalance. */
export function clearBalanceMemo(ctx: DatabaseCtx): void {
  memos.delete(ctx.db);
}

async function scanBalanceRows(ctx: DatabaseCtx) {
  const rows = await ctx.db.query("gameBalance").collect();
  const values = new Map<string, unknown>();
  let sourceUpdatedAt = 0;
  for (const row of rows) {
    if (!values.has(row.key)) values.set(row.key, row.value);
    sourceUpdatedAt = Math.max(sourceUpdatedAt, row.lastUpdated);
  }
  return { values, sourceUpdatedAt };
}

async function loadAllBalance(ctx: DatabaseCtx): Promise<Map<string, unknown>> {
  const [snapshot, newestRow] = await Promise.all([
    ctx.db.query("balanceSnapshots").first(),
    ctx.db.query("gameBalance").withIndex("by_lastUpdated").order("desc").first(),
  ]);
  if (snapshot && newestRow && newestRow.lastUpdated <= snapshot.sourceUpdatedAt) {
    return new Map(Object.entries(snapshot.values as Record<string, unknown>));
  }
  return (await scanBalanceRows(ctx)).values;
}

function allBalance(ctx: DatabaseCtx): Promise<Map<string, unknown>> {
  const memo = memoFor(ctx);
  memo.all ??= loadAllBalance(ctx);
  return memo.all;
}

export async function readBalanceValue(
  ctx: DatabaseCtx,
  key: string
): Promise<unknown> {
  const memo = memoFor(ctx);
  if (memo.all) return (await memo.all).get(key);
  let point = memo.points.get(key);
  if (!point) {
    point = ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
      .then((row) => row?.value);
    memo.points.set(key, point);
  }
  return await point;
}

/**
 * Read several keys. Under three keys, indexed point reads are smaller than the
 * snapshot; from three up, one snapshot read covers this and every later call
 * in the transaction.
 */
export async function readBalanceMap(
  ctx: DatabaseCtx,
  keys: string[]
): Promise<Map<string, unknown>> {
  const memo = memoFor(ctx);
  const map = new Map<string, unknown>();
  if (keys.length < 3 && !memo.all) {
    const values = await Promise.all(keys.map((key) => readBalanceValue(ctx, key)));
    keys.forEach((key, index) => map.set(key, values[index]));
    return map;
  }
  const all = await allBalance(ctx);
  for (const key of keys) {
    if (all.has(key)) map.set(key, all.get(key));
  }
  return map;
}

/** Rewrite the snapshot from the gameBalance rows. */
export async function rebuildBalanceSnapshot(ctx: MutationCtx): Promise<void> {
  clearBalanceMemo(ctx);
  const { values, sourceUpdatedAt } = await scanBalanceRows(ctx);
  const fields = { values: Object.fromEntries(values), sourceUpdatedAt };
  const existing = await ctx.db.query("balanceSnapshots").first();
  if (existing) {
    await ctx.db.replace(existing._id, fields);
  } else {
    await ctx.db.insert("balanceSnapshots", fields);
  }
}

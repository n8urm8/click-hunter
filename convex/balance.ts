import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * Batched gameBalance reader for hot paths (sync, combat, inventory).
 *
 * N individual `by_key` point reads cost N queries. When a caller needs 3+
 * keys, one `collect()` + in-memory lookup is fewer queries for similar bytes.
 * Single/dual-key callers keep the indexed point read.
 */
export async function readBalanceMap(
  ctx: DatabaseCtx,
  keys: string[]
): Promise<Map<string, unknown>> {
  if (keys.length < 3) {
    const rows = await Promise.all(
      keys.map((key) =>
        ctx.db
          .query("gameBalance")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first()
      )
    );
    const map = new Map<string, unknown>();
    keys.forEach((key, index) => {
      map.set(key, rows[index]?.value);
    });
    return map;
  }
  const rows = await ctx.db.query("gameBalance").collect();
  const wanted = new Set(keys);
  const map = new Map<string, unknown>();
  for (const row of rows) {
    if (wanted.has(row.key) && !map.has(row.key)) {
      map.set(row.key, row.value);
    }
  }
  return map;
}

export async function readBalanceValue(
  ctx: DatabaseCtx,
  key: string
): Promise<unknown> {
  return (
    await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
  )?.value;
}

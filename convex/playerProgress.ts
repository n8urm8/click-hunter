import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

/**
 * Per-batch progress lives in `playerProgress`, one row per character, so the
 * `players` row stays stable across fight settlements. Every character gets a
 * row at creation (or by `migrations:splitPlayerRecord` for older rows).
 */
export async function readPlayerProgressOrNull(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Doc<"playerProgress"> | null> {
  return await ctx.db
    .query("playerProgress")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .unique();
}

export async function readPlayerProgress(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<Doc<"playerProgress">> {
  const progress = await readPlayerProgressOrNull(ctx, playerId);
  if (!progress) {
    throw new Error(
      "Player progress row is missing. Run migrations:splitPlayerRecord."
    );
  }
  return progress;
}

export async function insertPlayerProgress(
  ctx: MutationCtx,
  playerId: PlayerId,
  values: {
    gold: number;
    totalExperience: number;
    statXp?: Doc<"playerProgress">["statXp"];
    updatedAt: number;
  }
): Promise<Id<"playerProgress">> {
  return await ctx.db.insert("playerProgress", { playerId, ...values });
}

export type PlayerProgressPatch = Partial<
  Pick<Doc<"playerProgress">, "gold" | "totalExperience" | "statXp">
>;

/** Patch a loaded progress row and stamp it, so callers can't forget the stamp. */
export async function patchPlayerProgress(
  ctx: MutationCtx,
  progress: Doc<"playerProgress">,
  patch: PlayerProgressPatch
): Promise<void> {
  await ctx.db.patch(progress._id, { ...patch, updatedAt: Date.now() });
}

/**
 * Remove a character's split rows. Call right before deleting its `players`
 * row, so no progress or HP row is left pointing at a missing character.
 */
export async function deletePlayerSplitRows(
  ctx: MutationCtx,
  playerId: PlayerId
): Promise<void> {
  const progress = await readPlayerProgressOrNull(ctx, playerId);
  if (progress) await ctx.db.delete(progress._id);
  const hp = await ctx.db
    .query("playerHp")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .unique();
  if (hp) await ctx.db.delete(hp._id);
}

/** The wallet-and-XP fields a client sees alongside the stable character. */
export function progressFields(progress: Doc<"playerProgress">) {
  return {
    gold: progress.gold,
    totalExperience: progress.totalExperience,
    statXp: progress.statXp,
  };
}

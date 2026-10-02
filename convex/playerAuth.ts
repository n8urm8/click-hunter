import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * Ownership enforcement for character-scoped functions.
 *
 * Every public mutation/query that acts on a player's character must load
 * the row through `requirePlayer`/`requirePlayerRead` instead of trusting
 * the `playerId` argument. The caller's Convex Auth subject must match the
 * row's `authSubject`, which is bound once in `getOrCreatePlayer` (via the
 * `anonymousId` bearer) or stamped at creation.
 *
 * NOTE: rows created before auth have no `authSubject` and are claimed
 * through `getOrCreatePlayer` only — never implicitly here.
 */
export async function requireAuthSubject(ctx: DatabaseCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required. Sign in to play.");
  }
  return identity.subject;
}

export async function requirePlayer(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"players">> {
  const subject = await requireAuthSubject(ctx);
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }
  if (player.authSubject === undefined) {
    throw new Error(
      "Character is not claimed. Create or claim it first."
    );
  }
  if (player.authSubject !== subject) {
    throw new Error(
      "This character belongs to a different signed-in session."
    );
  }
  return player;
}

export async function requirePlayerRead(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"players">> {
  const subject = await requireAuthSubject(ctx);
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }
  if (player.authSubject === undefined) {
    throw new Error(
      "Character is not claimed. Create or claim it first."
    );
  }
  if (player.authSubject !== subject) {
    throw new Error(
      "This character belongs to a different signed-in session."
    );
  }
  return player;
}

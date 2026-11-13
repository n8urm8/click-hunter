import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertAccountNotBanned } from "./accountModeration";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * Ownership enforcement for character-scoped functions.
 *
 * Every public mutation/query that acts on a player's character must load
 * the row through `requirePlayer`/`requirePlayerRead` instead of trusting
 * the `playerId` argument. The caller's `tokenIdentifier` (issuer plus Clerk
 * user id) must match the row's `authSubject`, which is stamped when the
 * character is created.
 *
 * The token identifier is per account, not per session, so the same account
 * reaches its characters from any device.
 */
export async function requireAuthSubject(ctx: DatabaseCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Authentication required. Sign in to play.");
  }
  const subject = identity.tokenIdentifier;
  await assertAccountNotBanned(ctx, subject);
  return subject;
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
  return await requirePlayer(ctx, playerId);
}

/**
 * Ownership check that doesn't read the player row. Prefer this when the caller
 * doesn't use the row: every fight settlement rewrites `players`, so a query
 * reading it re-runs every settlement even if its own data never changed.
 *
 * Characters without a `playerOwners` row (created before that table, until
 * backfillPlayerOwners has run) fall back to the player row.
 */
export async function requirePlayerOwner(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<void> {
  const subject = await requireAuthSubject(ctx);
  const owner = await ctx.db
    .query("playerOwners")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
  if (!owner) {
    await requirePlayer(ctx, playerId);
    return;
  }
  if (owner.authSubject !== subject) {
    throw new Error(
      "This character belongs to a different signed-in session."
    );
  }
}

/** Record who owns a character. Call wherever `authSubject` is set. */
export async function setPlayerOwner(
  ctx: MutationCtx,
  playerId: Id<"players">,
  authSubject: string
): Promise<void> {
  const owner = await ctx.db
    .query("playerOwners")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
  if (owner) {
    if (owner.authSubject !== authSubject) {
      await ctx.db.patch(owner._id, { authSubject });
    }
    return;
  }
  await ctx.db.insert("playerOwners", { playerId, authSubject });
}

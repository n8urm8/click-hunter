import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * Authorize a configuration operation against the persisted player role.
 *
 * The role lives on a character, and the character must belong to the caller's
 * account. Grant admin with admin:setPlayerRole from the CLI.
 */
export async function requireAdmin(
  ctx: DatabaseCtx,
  playerId: Id<"players">
) {
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }

  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Authentication required. Sign in to play.");
  }
  if (player.authSubject === undefined) {
    throw new Error("Character is not claimed. Create or claim it first.");
  }
  if (player.authSubject !== identity.tokenIdentifier) {
    throw new Error(
      "This character belongs to a different signed-in session."
    );
  }

  if (player.role !== "admin") {
    throw new Error("Unauthorized: admin role required");
  }

  return player;
}

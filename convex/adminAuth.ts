import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

/**
 * Authorize a configuration operation against the persisted player role.
 *
 * The app currently uses anonymous IDs, so this is a temporary development
 * boundary rather than a production identity system.
 */
export async function requireAdmin(
  ctx: DatabaseCtx,
  playerId: Id<"players">
) {
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }

  // Bind the admin row to the caller's signed-in session. Role semantics are
  // intentionally unchanged (everyone is admin while testing).
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required. Sign in to play.");
  }
  if (player.authSubject === undefined) {
    throw new Error("Character is not claimed. Create or claim it first.");
  }
  if (player.authSubject !== identity.subject) {
    throw new Error(
      "This character belongs to a different signed-in session."
    );
  }

  if (player.role !== "admin") {
    throw new Error("Unauthorized: admin role required");
  }

  return player;
}

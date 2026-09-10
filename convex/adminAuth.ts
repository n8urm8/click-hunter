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

  if (player.role !== "admin") {
    throw new Error("Unauthorized: admin role required");
  }

  return player;
}

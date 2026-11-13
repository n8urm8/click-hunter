import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Stored as the ban expiry for a ban with no end date. */
export const PERMANENT_BAN_UNTIL = Number.MAX_SAFE_INTEGER;

export type AccountModerationState = {
  mutedUntil: number;
  muteReason?: string;
  bannedUntil: number;
  banReason?: string;
};

export async function readAccountModeration(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Doc<"accountModeration"> | null> {
  return await ctx.db
    .query("accountModeration")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Throws while the account is banned. Runs inside requireAuthSubject, so every
 * character-scoped call is covered. It reads no clock: a ban that has lapsed
 * stays in force until the expireBans cron clears it, at most a few minutes.
 */
export async function assertAccountNotBanned(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<void> {
  const row = await readAccountModeration(ctx, userId);
  if (row === null || row.bannedUntil === 0) return;
  throw new Error(banMessage(row.bannedUntil, row.banReason));
}

export function banMessage(bannedUntil: number, reason: string | undefined): string {
  const when =
    bannedUntil >= PERMANENT_BAN_UNTIL
      ? "permanently"
      : `until ${new Date(bannedUntil).toISOString()}`;
  return `Your account is suspended ${when}.${reason ? ` Reason: ${reason}` : ""}`;
}

/** Replaces the account's moderation state in full. Clearing a field means omitting it. */
export async function writeAccountModeration(
  ctx: MutationCtx,
  userId: string,
  state: AccountModerationState
): Promise<void> {
  const existing = await readAccountModeration(ctx, userId);
  const row = {
    userId,
    mutedUntil: state.mutedUntil,
    bannedUntil: state.bannedUntil,
    updatedAt: Date.now(),
    ...(state.muteReason ? { muteReason: state.muteReason } : {}),
    ...(state.banReason ? { banReason: state.banReason } : {}),
  };
  if (existing) {
    await ctx.db.replace("accountModeration", existing._id, row);
  } else {
    await ctx.db.insert("accountModeration", row);
  }
}

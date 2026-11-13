import { query } from "./_generated/server";
import { readAccountModeration } from "./accountModeration";

/**
 * The signed-in account's mute and ban state. Ban checks don't run here, so a
 * banned account can still read this and see why it is blocked. Timestamps are
 * returned raw and compared by the client, since queries should not read the
 * clock. Sign-in, sign-up and password reset are handled by Clerk on the client.
 */
export const getAccountStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return {
        signedIn: false,
        mutedUntil: 0,
        muteReason: null as string | null,
        bannedUntil: 0,
        banReason: null as string | null,
      };
    }
    const moderation = await readAccountModeration(ctx, identity.tokenIdentifier);
    return {
      signedIn: true,
      mutedUntil: moderation?.mutedUntil ?? 0,
      muteReason: moderation?.muteReason ?? null,
      bannedUntil: moderation?.bannedUntil ?? 0,
      banReason: moderation?.banReason ?? null,
    };
  },
});

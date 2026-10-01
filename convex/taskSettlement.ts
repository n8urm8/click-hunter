import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function settleTasksBeforeInteraction(ctx: MutationCtx, playerId: Id<"players">) {
  await ctx.runMutation(internal.tasks.settleForInteraction, { playerId });
}

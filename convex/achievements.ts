import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePlayerOwner } from "./playerAuth";
import { v } from "convex/values";

export type AchievementStats = {
  maxTierReached: number;
  totalExperience: number;
  rebirthCount: number;
};

/**
 * Achievement conditions, keyed by the seeded achievement rows. Everything is
 * computed from server state, so no client can claim an achievement.
 */
const ACHIEVEMENT_RULES: Array<{
  achievementId: string;
  met: (stats: AchievementStats) => boolean;
}> = [
  { achievementId: "first-kill", met: (stats) => stats.totalExperience > 0 },
  { achievementId: "tier-5", met: (stats) => stats.maxTierReached >= 5 },
  { achievementId: "tier-10", met: (stats) => stats.maxTierReached >= 10 },
  { achievementId: "tier-20", met: (stats) => stats.maxTierReached >= 20 },
  { achievementId: "first-rebirth", met: (stats) => stats.rebirthCount > 0 },
  { achievementId: "tier-100-xp", met: (stats) => stats.totalExperience >= 10_000 },
];

async function unlockAchievement(
  ctx: MutationCtx,
  playerId: Id<"players">,
  achievementId: string
) {
  const existing = await ctx.db
    .query("playerAchievements")
    .withIndex("by_playerId_achievementId", (q) =>
      q.eq("playerId", playerId).eq("achievementId", achievementId)
    )
    .first();
  if (existing) return;
  await ctx.db.insert("playerAchievements", {
    playerId,
    achievementId,
    unlockedAt: Date.now(),
  });
}

/**
 * Unlock achievements whose condition this change just satisfied. Comparing
 * before and after keeps it in memory for the vast majority of settlements,
 * which cross nothing and so touch no rows.
 */
export async function awardCrossedAchievements(
  ctx: MutationCtx,
  playerId: Id<"players">,
  before: AchievementStats,
  after: AchievementStats
): Promise<void> {
  for (const rule of ACHIEVEMENT_RULES) {
    if (rule.met(after) && !rule.met(before)) {
      await unlockAchievement(ctx, playerId, rule.achievementId);
    }
  }
}

/** Unlock everything a player already qualifies for. Used by the backfill. */
export async function awardMetAchievements(
  ctx: MutationCtx,
  playerId: Id<"players">,
  stats: AchievementStats
): Promise<void> {
  for (const rule of ACHIEVEMENT_RULES) {
    if (rule.met(stats)) await unlockAchievement(ctx, playerId, rule.achievementId);
  }
}

/**
 * Get all achievements for a player
 */
export const getPlayerAchievements = query({
  args: { playerId: v.id("players") },
  async handler(ctx, args) {
    await requirePlayerOwner(ctx, args.playerId);
    const [unlockedAchievements, allAchievements] = await Promise.all([
      ctx.db
        .query("playerAchievements")
        .withIndex("by_playerId", (q) => q.eq("playerId", args.playerId))
        .take(200),
      ctx.db.query("achievements").take(200),
    ]);

    return {
      unlocked: unlockedAchievements.map((ua) => ua.achievementId),
      all: allAchievements,
      progress: {
        count: unlockedAchievements.length,
        total: allAchievements.length,
      },
    };
  },
});

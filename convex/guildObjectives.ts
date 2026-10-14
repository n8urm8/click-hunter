import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { addGuildXp } from "./guilds";

type ObjectiveProgress = {
  wins: number;
  gold: number;
  xp: number;
};

function weekStartFor(now: number) {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - day);
  return date.getTime();
}

function defaultObjectives(guildLevel: number) {
  const scale = Math.max(1, guildLevel);
  return [
    {
      objectiveId: "slay_monsters",
      target: 50 * scale,
      progress: 0,
      rewardGold: 1000 * scale,
      rewardXp: 500 * scale,
      claimed: false,
    },
    {
      objectiveId: "earn_gold",
      target: 5000 * scale,
      progress: 0,
      rewardGold: 2000 * scale,
      rewardXp: 500 * scale,
      claimed: false,
    },
    {
      objectiveId: "earn_xp",
      target: 2500 * scale,
      progress: 0,
      rewardGold: 1000 * scale,
      rewardXp: 1000 * scale,
      claimed: false,
    },
  ];
}

export async function ensureWeeklyObjectives(
  ctx: MutationCtx,
  guildId: Id<"guilds">,
  now: number
) {
  const weekStart = weekStartFor(now);
  const existing = await ctx.db
    .query("guildWeeklyObjectives")
    .withIndex("by_guildId_and_weekStart", (q) =>
      q.eq("guildId", guildId).eq("weekStart", weekStart)
    )
    .first();
  if (existing) return existing;
  const guild = await ctx.db.get(guildId);
  if (!guild) throw new Error("Guild not found");
  const id = await ctx.db.insert("guildWeeklyObjectives", {
    guildId,
    weekStart,
    objectives: defaultObjectives(guild.level),
    totalProgress: 0,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Could not create weekly objectives");
  return created;
}

/**
 * Same-transaction progress hook for combat settlements. Wins increment the
 * slay counter by 1; gold/xp accumulate toward their targets.
 */
export async function progressWeeklyObjectives(
  ctx: MutationCtx,
  playerId: Id<"players">,
  delta: ObjectiveProgress
): Promise<void> {
  if (delta.wins <= 0 && delta.gold <= 0 && delta.xp <= 0) return;
  const membership = await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
  if (!membership) return;
  const now = Date.now();
  const row = await ensureWeeklyObjectives(ctx, membership.guildId, now);
  const objectives = row.objectives.map((objective) => {
    if (objective.objectiveId === "slay_monsters" && delta.wins > 0) {
      return { ...objective, progress: objective.progress + delta.wins };
    }
    if (objective.objectiveId === "earn_gold" && delta.gold > 0) {
      return { ...objective, progress: objective.progress + Math.floor(delta.gold) };
    }
    if (objective.objectiveId === "earn_xp" && delta.xp > 0) {
      return { ...objective, progress: objective.progress + Math.floor(delta.xp) };
    }
    return objective;
  });
  const totalProgress = objectives.reduce((sum, o) => sum + Math.min(o.progress, o.target), 0);
  await ctx.db.patch(row._id, { objectives, totalProgress, updatedAt: now });
}

export const getWeeklyObjectives = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) return null;
    const weekStart = weekStartFor(Date.now());
    const row = await ctx.db
      .query("guildWeeklyObjectives")
      .withIndex("by_guildId_and_weekStart", (q) =>
        q.eq("guildId", membership.guildId).eq("weekStart", weekStart)
      )
      .first();
    if (!row) {
      const guild = await ctx.db.get(membership.guildId);
      if (!guild) return null;
      return {
        guildId: membership.guildId,
        weekStart,
        objectives: defaultObjectives(guild.level),
        totalProgress: 0,
        preview: true as const,
      };
    }
    return { ...row, preview: false as const };
  },
});

export const claimObjectiveReward = mutation({
  args: {
    playerId: v.id("players"),
    objectiveId: v.string(),
  },
  handler: async (ctx, { playerId, objectiveId }) => {
    await requirePlayer(ctx, playerId);
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) throw new Error("You are not in a guild");
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const now = Date.now();
    const row = await ensureWeeklyObjectives(ctx, membership.guildId, now);
    const index = row.objectives.findIndex((o) => o.objectiveId === objectiveId);
    if (index === -1) throw new Error("Objective not found");
    const objective = row.objectives[index];
    if (objective.claimed) throw new Error("Reward already claimed");
    if (objective.progress < objective.target) {
      throw new Error("Objective is not complete yet");
    }
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) throw new Error("Guild not found");
    const objectives = row.objectives.map((o, i) =>
      i === index ? { ...o, claimed: true } : o
    );
    await ctx.db.patch(row._id, { objectives, updatedAt: now });
    await ctx.db.patch(guild._id, {
      gold: guild.gold + objective.rewardGold,
      updatedAt: now,
    });
    await addGuildXp(ctx, guild._id, objective.rewardXp);
    return { rewardGold: objective.rewardGold, rewardXp: objective.rewardXp };
  },
});

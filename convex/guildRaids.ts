import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { readPlayerCombatProfile } from "./combat";
import { ensureBossForTier } from "./bossData";
import { readBalanceMap } from "./balance";

type DatabaseCtx = QueryCtx | MutationCtx;

const RAID_FORMATION_FALLBACK_HOURS = 6;
const RAID_DURATION_FALLBACK_HOURS = 24;

async function readRaidConfig(ctx: DatabaseCtx) {
  const map = await readBalanceMap(ctx, [
    "guildRaidFormationHours",
    "guildRaidDurationHours",
  ]);
  const formation = map.get("guildRaidFormationHours");
  const duration = map.get("guildRaidDurationHours");
  return {
    formationHours:
      typeof formation === "number" && Number.isFinite(formation) && formation > 0
        ? formation
        : RAID_FORMATION_FALLBACK_HOURS,
    durationHours:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : RAID_DURATION_FALLBACK_HOURS,
  };
}

async function getMembership(ctx: MutationCtx, playerId: Id<"players">) {
  return await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
}

async function getBonus(ctx: MutationCtx, guild: Doc<"guilds">) {
  const row = await ctx.db
    .query("guildBonuses")
    .withIndex("by_level", (q) => q.eq("level", guild.level))
    .first();
  return { raidSlots: row?.raidSlots ?? 1, maxMembers: row?.maxMembers ?? 50 };
}

async function countActiveRaids(ctx: MutationCtx, guildId: Id<"guilds">) {
  const forming = await ctx.db
    .query("guildRaids")
    .withIndex("by_guildId_and_status", (q) =>
      q.eq("guildId", guildId).eq("status", "forming")
    )
    .take(20);
  const active = await ctx.db
    .query("guildRaids")
    .withIndex("by_guildId_and_status", (q) =>
      q.eq("guildId", guildId).eq("status", "active")
    )
    .take(20);
  return forming.length + active.length;
}

export const startRaid = mutation({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
  },
  handler: async (ctx, { playerId, tier }) => {
    await requirePlayer(ctx, playerId);
    if (!Number.isSafeInteger(tier) || tier < 1) {
      throw new Error("Raid tier must be a positive integer");
    }
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) throw new Error("Guild not found");
    const bonus = await getBonus(ctx, guild);
    if ((await countActiveRaids(ctx, guild._id)) >= bonus.raidSlots) {
      throw new Error("All raid slots are in use");
    }
    const boss = await ensureBossForTier(ctx, tier);
    if (!boss) throw new Error("Boss is not configured for this tier");
    const bossMaxHp = Math.max(1, Math.ceil(boss.con * 10 + boss.int * 2));
    const config = await readRaidConfig(ctx);
    const now = Date.now();
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const raidId = await ctx.db.insert("guildRaids", {
      guildId: guild._id,
      bossId: boss.bossId,
      tier,
      status: "forming",
      participants: [
        { playerId, playerName: player.name, damageDealt: 0 },
      ],
      bossHp: bossMaxHp,
      bossMaxHp,
      rewardGold: 500 * tier * boss.rewardMultiplier,
      rewardXp: 250 * tier * boss.rewardMultiplier,
      expiresAt: now + config.formationHours * 60 * 60 * 1000,
      createdAt: now,
    });
    return await ctx.db.get(raidId);
  },
});

export const joinRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    if (raid.status !== "forming") throw new Error("Raid is no longer forming");
    if (Date.now() > raid.expiresAt) throw new Error("Raid formation expired");
    if (raid.participants.some((p) => p.playerId === playerId)) {
      throw new Error("You already joined this raid");
    }
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    await ctx.db.patch(raidId, {
      participants: [
        ...raid.participants,
        { playerId, playerName: player.name, damageDealt: 0 },
      ],
    });
    return await ctx.db.get(raidId);
  },
});

export const beginRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    if (raid.status !== "forming") throw new Error("Raid is not forming");
    if (raid.participants.length === 0) throw new Error("Raid has no participants");
    const config = await readRaidConfig(ctx);
    const now = Date.now();
    await ctx.db.patch(raidId, {
      status: "active",
      startedAt: now,
      expiresAt: now + config.durationHours * 60 * 60 * 1000,
    });
    return await ctx.db.get(raidId);
  },
});

export const strikeRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    if (raid.status !== "active") throw new Error("Raid is not active");
    const now = Date.now();
    if (now > raid.expiresAt) {
      await ctx.db.patch(raidId, { status: "failed", endedAt: now });
      throw new Error("Raid has expired");
    }
    const index = raid.participants.findIndex((p) => p.playerId === playerId);
    if (index === -1) throw new Error("You are not in this raid");
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const profile = await readPlayerCombatProfile(ctx, player, now);
    const damage = Math.max(1, Math.floor(profile.combatStats.attack));
    const bossHp = Math.max(0, raid.bossHp - damage);
    const participants = raid.participants.map((p, i) =>
      i === index ? { ...p, damageDealt: p.damageDealt + damage } : p
    );
    if (bossHp <= 0) {
      // Victory: split rewards evenly, credit guild bank + guild XP.
      const guild = await ctx.db.get(raid.guildId);
      const perGold = Math.floor(raid.rewardGold / participants.length);
      const perXp = Math.floor(raid.rewardXp / participants.length);
      for (const p of participants) {
        const member = await ctx.db.get(p.playerId);
        if (!member) continue;
        await ctx.db.patch(p.playerId, {
          gold: member.gold + perGold,
          totalExperience: member.totalExperience + perXp,
          lastUpdated: now,
        });
      }
      if (guild) {
        await ctx.db.patch(guild._id, {
          gold: guild.gold + (raid.rewardGold % Math.max(1, participants.length)),
          updatedAt: now,
        });
      }
      await ctx.db.patch(raidId, {
        bossHp: 0,
        participants,
        status: "completed",
        endedAt: now,
      });
      return { damage, bossHp: 0, completed: true, perGold, perXp };
    }
    await ctx.db.patch(raidId, { bossHp, participants });
    return { damage, bossHp, completed: false };
  },
});

export const getGuildRaids = query({
  args: {
    playerId: v.id("players"),
    status: v.optional(
      v.union(
        v.literal("forming"),
        v.literal("active"),
        v.literal("completed"),
        v.literal("failed")
      )
    ),
  },
  handler: async (ctx, { playerId, status }) => {
    await requirePlayerRead(ctx, playerId);
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) return [];
    if (status) {
      return await ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", status)
        )
        .take(50);
    }
    const [forming, active, completed] = await Promise.all([
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "forming")
        )
        .take(20),
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "active")
        )
        .take(20),
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "completed")
        )
        .take(10),
    ]);
    return [...forming, ...active, ...completed];
  },
});

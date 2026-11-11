/**
 * Live-database simulation harness (self-hosted dev).
 *
 * Internal functions callable through the Convex CLI against your own
 * backend — e.g. `npx convex run --env-file docker/.env.selfhosted
 * simLive:spawnGuild '{"name":"Owls","tag":"OWL"}'`. CLI access requires
 * deployment credentials, which is the authorization boundary (there is no
 * user auth identity on CLI calls, so these can never run as a player).
 *
 * Safety:
 * - Every function first requires gameBalance `simLiveEnabled === true`.
 *   Flip it in Admin → General (or the dashboard data view) and flip it back
 *   when done. It seeds as `false`; production stays safe by default.
 * - Spawned rows are tagged (`sim-live-` anonymousIds) and `cleanup`
 *   removes them. Direct edits (`setStats`/`setGold`/`setSkillLevel`) refuse
 *   non-sim players.
 * - Guild flows (`applyAll`/`acceptAll`) run the SAME core functions as the
 *   public mutations (`applyToGuildCore`, `acceptApplicationRow`,
 *   `createGuildCore`), so gates and costs execute for real.
 *
 * See docs/sim-testing.md for prompt recipes and command reference.
 */

import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  deletePlayerSplitRows,
  insertPlayerProgress,
  patchPlayerProgress,
  readPlayerProgress,
} from "./playerProgress";
import {
  acceptApplicationRow,
  applyToGuildCore,
  createGuildCore,
} from "./guilds";
import {
  createRng,
  grantSimItems,
  insertSkillRows,
  randomSimName,
  resolveSpawnStats,
  validateSpawnSpecs,
  type SimItemSpec,
  type SimSkillSpec,
  type SimStats,
} from "./simShared";

type DatabaseCtx = QueryCtx | MutationCtx;

export const SIM_LIVE_ANON_PREFIX = "sim-live-player-";
const SIM_LIVE_SUBJECT_PREFIX = "sim-live:";
const SIM_SCAN_LIMIT = 200;
const SIM_BATCH_LIMIT = 100;

export const SIM_LIVE_BALANCE_DEFAULTS = [
  {
    key: "simLiveEnabled",
    value: false,
    description:
      "Master switch for the live simulation harness (simLive:*). Keep false in production.",
  },
] as const;

async function requireSimLiveEnabled(ctx: DatabaseCtx) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "simLiveEnabled"))
    .first();
  if (row?.value !== true) {
    throw new Error(
      "Live simulation harness is disabled (gameBalance simLiveEnabled is not true)."
    );
  }
}

async function requireSimPlayer(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"players">> {
  const player = await ctx.db.get(playerId);
  if (!player) throw new Error("Player not found");
  if (!player.anonymousId.startsWith(SIM_LIVE_ANON_PREFIX)) {
    throw new Error("Refusing to edit a non-simulated player");
  }
  return player;
}

async function isSimPlayer(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<boolean> {
  const player = await ctx.db.get(playerId);
  return player?.anonymousId.startsWith(SIM_LIVE_ANON_PREFIX) ?? false;
}

const simStatsValidator = v.object({
  str: v.optional(v.number()),
  dex: v.optional(v.number()),
  int: v.optional(v.number()),
  luk: v.optional(v.number()),
  con: v.optional(v.number()),
});

const simSkillValidator = v.object({
  skillId: v.string(),
  level: v.number(),
  category: v.optional(
    v.union(v.literal("gathering"), v.literal("crafting"))
  ),
  name: v.optional(v.string()),
});

const simItemValidator = v.object({
  slug: v.string(),
  quantity: v.optional(v.number()),
  equipSlot: v.optional(v.string()),
});

async function insertSimPlayer(
  ctx: MutationCtx,
  args: {
    name: string;
    level?: number;
    stats?: Partial<SimStats>;
    statXp?: Partial<SimStats>;
    gold?: number;
    totalExperience?: number;
    skills?: SimSkillSpec[];
    items?: SimItemSpec[];
  }
): Promise<Doc<"players">> {
  validateSpawnSpecs(args.stats, args.skills);
  const stats = resolveSpawnStats(args.level, args.stats, args.skills);
  const now = Date.now();
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const id = await ctx.db.insert("players", {
    anonymousId: `${SIM_LIVE_ANON_PREFIX}${tag}`,
    name: args.name,
    authSubject: `${SIM_LIVE_SUBJECT_PREFIX}${tag}`,
    ...stats,
    rebirthCount: 0,
    rebirthTierThreshold: 5,
    currentTier: 1,
    maxTierReached: 1,
    autoAttackEnabled: true,
    autoStartFightEnabled: false,
    createdAt: now,
    lastUpdated: now,
  });
  await insertPlayerProgress(ctx, id, {
    gold: args.gold ?? 0,
    totalExperience: args.totalExperience ?? 0,
    statXp: {
      str: 0,
      dex: 0,
      int: 0,
      luk: 0,
      con: 0,
      ...args.statXp,
    },
    updatedAt: now,
  });
  await insertSkillRows(ctx, id, args.skills ?? []);
  await grantSimItems(ctx, id, args.items ?? []);
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Sim player could not be created");
  return created;
}

export const spawnPlayer = internalMutation({
  args: {
    name: v.optional(v.string()),
    level: v.optional(v.number()),
    stats: v.optional(simStatsValidator),
    statXp: v.optional(simStatsValidator),
    gold: v.optional(v.number()),
    totalExperience: v.optional(v.number()),
    skills: v.optional(v.array(simSkillValidator)),
    items: v.optional(v.array(simItemValidator)),
  },
  handler: async (ctx, args) => {
    await requireSimLiveEnabled(ctx);
    const player = await insertSimPlayer(ctx, {
      name: args.name ?? `Sim-${Date.now() % 100000}`,
      level: args.level,
      stats: args.stats,
      statXp: args.statXp,
      gold: args.gold,
      totalExperience: args.totalExperience,
      skills: args.skills,
      items: args.items,
    });
    return {
      ...player,
      characterLevel: await calculateCharacterLevel(ctx, player),
    };
  },
});

export const spawnPlayers = internalMutation({
  args: {
    count: v.number(),
    namePrefix: v.optional(v.string()),
    level: v.optional(v.number()),
    levelRange: v.optional(
      v.object({ min: v.number(), max: v.number() })
    ),
    stats: v.optional(simStatsValidator),
    skills: v.optional(v.array(simSkillValidator)),
    gold: v.optional(v.number()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSimLiveEnabled(ctx);
    if (
      !Number.isSafeInteger(args.count) ||
      args.count < 1 ||
      args.count > SIM_BATCH_LIMIT
    ) {
      throw new Error(`count must be 1-${SIM_BATCH_LIMIT}`);
    }
    const rng = createRng(args.seed ?? Date.now() % 1_000_000_000);
    const used = new Set<string>();
    const players: Doc<"players">[] = [];
    for (let i = 0; i < args.count; i += 1) {
      const level =
        args.levelRange !== undefined
          ? Math.floor(
              args.levelRange.min +
                rng() * (args.levelRange.max - args.levelRange.min + 1)
            )
          : args.level;
      players.push(
        await insertSimPlayer(ctx, {
          name: args.namePrefix
            ? `${args.namePrefix}-${i + 1}`
            : randomSimName(rng, used),
          level,
          stats: args.stats,
          gold: args.gold,
          skills: args.skills,
        })
      );
    }
    return Promise.all(
      players.map(async (player) => ({
        ...player,
        characterLevel: await calculateCharacterLevel(ctx, player),
      }))
    );
  },
});

export const spawnGuild = internalMutation({
  args: {
    name: v.string(),
    tag: v.string(),
    description: v.optional(v.string()),
    ownerPlayerId: v.optional(v.id("players")),
    ownerLevel: v.optional(v.number()),
    ownerGold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSimLiveEnabled(ctx);
    let ownerId = args.ownerPlayerId;
    if (!ownerId) {
      const owner = await insertSimPlayer(ctx, {
        name: `${args.name}-owner`,
        level: args.ownerLevel ?? 120,
        gold: args.ownerGold ?? 100000,
      });
      ownerId = owner._id;
    }
    return await createGuildCore(ctx, ownerId, {
      name: args.name,
      tag: args.tag,
      description: args.description ?? "",
    });
  },
});

async function unguildedSimPlayers(ctx: MutationCtx) {
  const players = await ctx.db.query("players").take(SIM_SCAN_LIMIT);
  const sims = players.filter((player) =>
    player.anonymousId.startsWith(SIM_LIVE_ANON_PREFIX)
  );
  const unguilded: Doc<"players">[] = [];
  for (const player of sims.slice(0, SIM_BATCH_LIMIT)) {
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .first();
    if (!membership) unguilded.push(player);
  }
  return unguilded;
}

export const applyAll = internalMutation({
  args: {
    guildId: v.id("guilds"),
    playerIds: v.optional(v.array(v.id("players"))),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { guildId, playerIds, message }) => {
    await requireSimLiveEnabled(ctx);
    const targets =
      playerIds !== undefined
        ? (
            await Promise.all(playerIds.map((id) => ctx.db.get(id)))
          ).filter((player): player is Doc<"players"> => player !== null)
        : await unguildedSimPlayers(ctx);
    const results: Array<{
      playerId: Id<"players">;
      name: string;
      ok: boolean;
      applicationId?: Id<"guildApplications">;
      error?: string;
    }> = [];
    for (const applicant of targets) {
      try {
        const application = await applyToGuildCore(ctx, applicant, {
          guildId,
          ...(message ? { message } : {}),
        });
        results.push({
          playerId: applicant._id,
          name: applicant.name,
          ok: true,
          applicationId: application?._id,
        });
      } catch (error) {
        results.push({
          playerId: applicant._id,
          name: applicant.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  },
});

export const acceptAll = internalMutation({
  args: {
    guildId: v.id("guilds"),
    officerPlayerId: v.id("players"),
  },
  handler: async (ctx, { guildId, officerPlayerId }) => {
    await requireSimLiveEnabled(ctx);
    const officership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", officerPlayerId))
      .first();
    if (!officership || officership.guildId !== guildId) {
      throw new Error("Officer is not in that guild");
    }
    if (officership.role !== "master" && officership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const pending = await ctx.db
      .query("guildApplications")
      .withIndex("by_guildId_and_status", (q) =>
        q.eq("guildId", guildId).eq("status", "pending")
      )
      .take(SIM_BATCH_LIMIT);
    const results: Array<{
      applicationId: Id<"guildApplications">;
      ok: boolean;
      error?: string;
    }> = [];
    for (const application of pending) {
      try {
        await acceptApplicationRow(
          ctx,
          application._id,
          officerPlayerId,
          guildId
        );
        results.push({ applicationId: application._id, ok: true });
      } catch (error) {
        results.push({
          applicationId: application._id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  },
});

export const setStats = internalMutation({
  args: {
    playerId: v.id("players"),
    stats: simStatsValidator,
  },
  handler: async (ctx, { playerId, stats }) => {
    await requireSimLiveEnabled(ctx);
    await requireSimPlayer(ctx, playerId);
    validateSpawnSpecs(stats, undefined);
    await ctx.db.patch(playerId, { ...stats, lastUpdated: Date.now() });
    return await ctx.db.get(playerId);
  },
});

export const setGold = internalMutation({
  args: {
    playerId: v.id("players"),
    gold: v.number(),
  },
  handler: async (ctx, { playerId, gold }) => {
    await requireSimLiveEnabled(ctx);
    await requireSimPlayer(ctx, playerId);
    if (!Number.isSafeInteger(gold) || gold < 0) {
      throw new Error("gold must be an integer >= 0");
    }
    await patchPlayerProgress(ctx, await readPlayerProgress(ctx, playerId), { gold });
    return await ctx.db.get(playerId);
  },
});

export const setSkillLevel = internalMutation({
  args: {
    playerId: v.id("players"),
    skill: simSkillValidator,
  },
  handler: async (ctx, { playerId, skill }) => {
    await requireSimLiveEnabled(ctx);
    await requireSimPlayer(ctx, playerId);
    if (!Number.isSafeInteger(skill.level) || skill.level < 1) {
      throw new Error("skill level must be an integer >= 1");
    }
    await insertSkillRows(ctx, playerId, [skill]);
    return await ctx.db.get(playerId);
  },
});

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireSimLiveEnabled(ctx);
    const players = await ctx.db.query("players").take(SIM_SCAN_LIMIT);
    const sims = players.filter((player) =>
      player.anonymousId.startsWith(SIM_LIVE_ANON_PREFIX)
    );
    const simIds = new Set(sims.map((player) => String(player._id)));
    const guilds = await ctx.db.query("guilds").take(50);
    const guildSummaries = await Promise.all(
      guilds.map(async (guild) => {
        const members = await ctx.db
          .query("guildMembers")
          .withIndex("by_guildId", (q) => q.eq("guildId", guild._id))
          .take(200);
        return {
          guildId: guild._id,
          name: guild.name,
          tag: guild.tag,
          level: guild.level,
          memberCount: members.length,
          simOwned: simIds.has(String(guild.ownerId)),
        };
      })
    );
    let pendingApplications = 0;
    for (const guild of guilds) {
      const pending = await ctx.db
        .query("guildApplications")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", guild._id).eq("status", "pending")
        )
        .take(20);
      pendingApplications += pending.length;
    }
    return {
      simPlayerCount: sims.length,
      simPlayerNames: sims.map((player) => player.name),
      guilds: guildSummaries,
      pendingApplications,
    };
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    await requireSimLiveEnabled(ctx);
    const players = await ctx.db.query("players").take(500);
    const sims = players.filter((player) =>
      player.anonymousId.startsWith(SIM_LIVE_ANON_PREFIX)
    );
    let removedMemberships = 0;
    let removedApplications = 0;
    let removedPlayers = 0;
    for (const player of sims) {
      const membership = await ctx.db
        .query("guildMembers")
        .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
        .first();
      if (membership) {
        await ctx.db.delete(membership._id);
        removedMemberships += 1;
      }
      const applications = await ctx.db
        .query("guildApplications")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", player._id).eq("status", "pending")
        )
        .take(20);
      for (const application of applications) {
        await ctx.db.delete(application._id);
        removedApplications += 1;
      }
      await deletePlayerSplitRows(ctx, player._id);
      await ctx.db.delete(player._id);
      removedPlayers += 1;
    }
    // Delete guilds left with no members, or with only sim members (which
    // were just removed above).
    let removedGuilds = 0;
    for (const guild of await ctx.db.query("guilds").take(100)) {
      const members = await ctx.db
        .query("guildMembers")
        .withIndex("by_guildId", (q) => q.eq("guildId", guild._id))
        .take(200);
      let hasRealMembers = false;
      for (const member of members) {
        if (!(await isSimPlayer(ctx, member.playerId))) {
          hasRealMembers = true;
          break;
        }
      }
      if (members.length > 0 && hasRealMembers) continue;
      const pending = await ctx.db
        .query("guildApplications")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", guild._id).eq("status", "pending")
        )
        .take(100);
      for (const application of pending) {
        await ctx.db.delete(application._id);
        removedApplications += 1;
      }
      const objectives = (
        await ctx.db.query("guildWeeklyObjectives").take(50)
      ).filter((row) => row.guildId === guild._id);
      for (const row of objectives) {
        await ctx.db.delete(row._id);
      }
      await ctx.db.delete(guild._id);
      removedGuilds += 1;
    }
    return {
      removedPlayers,
      removedMemberships,
      removedApplications,
      removedGuilds,
    };
  },
});

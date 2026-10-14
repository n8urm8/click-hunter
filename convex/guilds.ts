import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { calculateCharacterLevel } from "./characterLevel";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import { readBalanceMap } from "./balance";

type DatabaseCtx = QueryCtx | MutationCtx;

export type GuildRole = "master" | "officer" | "member" | "recruit";

const ROLE_RANK: Record<GuildRole, number> = {
  recruit: 0,
  member: 1,
  officer: 2,
  master: 3,
};

// ─── Balance configuration ────────────────────────────────────────────────────

export const GUILD_BALANCE_DEFAULTS = [
  { key: "guildCreationCost", value: 50000, description: "Gold required to create a guild" },
  { key: "guildNameMinLength", value: 3, description: "Minimum guild name length" },
  { key: "guildNameMaxLength", value: 24, description: "Maximum guild name length" },
  { key: "guildTagMinLength", value: 2, description: "Minimum guild tag length" },
  { key: "guildTagMaxLength", value: 5, description: "Maximum guild tag length" },
  { key: "guildDescriptionMaxLength", value: 280, description: "Maximum guild description length" },
  { key: "guildApplicationExpiryHours", value: 24, description: "Hours before a guild invite or application expires" },
  { key: "guildLevelXpBase", value: 1000, description: "Guild XP required for level 2; each level scales by guildLevelXpGrowth" },
  { key: "guildLevelXpGrowth", value: 1.5, description: "Growth factor for guild XP required per level" },
  { key: "guildMaxLevel", value: 10, description: "Maximum guild level" },
  { key: "guildActivityXpPercent", value: 1, description: "Bonus guild XP granted alongside member combat/skill XP, as a percent of the XP earned (player keeps the full amount; 0-100)" },
  { key: "guildRaidFormationHours", value: 6, description: "Hours a raid stays in forming before it can be started" },
  { key: "guildRaidDurationHours", value: 24, description: "Hours an active raid lasts before expiring" },
  { key: "guildCreateMinLevel", value: 100, description: "Minimum character level required to found a guild" },
  { key: "guildJoinMinLevel", value: 50, description: "Minimum character level required to join a guild" },
] as const;

const GUILD_BONUS_SEED: Array<{
  level: number;
  goldBonusPercent: number;
  xpBonusPercent: number;
  statBonusPercent: number;
  maxMembers: number;
  raidSlots: number;
}> = [
  { level: 1, goldBonusPercent: 0, xpBonusPercent: 0, statBonusPercent: 0, maxMembers: 10, raidSlots: 1 },
  { level: 2, goldBonusPercent: 2, xpBonusPercent: 2, statBonusPercent: 1, maxMembers: 15, raidSlots: 1 },
  { level: 3, goldBonusPercent: 4, xpBonusPercent: 4, statBonusPercent: 2, maxMembers: 20, raidSlots: 2 },
  { level: 4, goldBonusPercent: 6, xpBonusPercent: 6, statBonusPercent: 3, maxMembers: 25, raidSlots: 2 },
  { level: 5, goldBonusPercent: 8, xpBonusPercent: 8, statBonusPercent: 4, maxMembers: 30, raidSlots: 3 },
  { level: 6, goldBonusPercent: 10, xpBonusPercent: 10, statBonusPercent: 5, maxMembers: 35, raidSlots: 3 },
  { level: 7, goldBonusPercent: 12, xpBonusPercent: 12, statBonusPercent: 6, maxMembers: 40, raidSlots: 4 },
  { level: 8, goldBonusPercent: 14, xpBonusPercent: 14, statBonusPercent: 7, maxMembers: 45, raidSlots: 4 },
  { level: 9, goldBonusPercent: 16, xpBonusPercent: 16, statBonusPercent: 8, maxMembers: 50, raidSlots: 5 },
  { level: 10, goldBonusPercent: 20, xpBonusPercent: 20, statBonusPercent: 10, maxMembers: 50, raidSlots: 5 },
];

export async function populateGuildBonuses(ctx: MutationCtx) {
  const now = Date.now();
  for (const bonus of GUILD_BONUS_SEED) {
    const existing = await ctx.db
      .query("guildBonuses")
      .withIndex("by_level", (q) => q.eq("level", bonus.level))
      .first();
    if (existing) continue;
    await ctx.db.insert("guildBonuses", { ...bonus, createdAt: now });
  }
}

type GuildConfig = {
  creationCost: number;
  nameMin: number;
  nameMax: number;
  tagMin: number;
  tagMax: number;
  descriptionMax: number;
  applicationExpiryMs: number;
  levelXpBase: number;
  levelXpGrowth: number;
  maxLevel: number;
  activityXpPercent: number;
  createMinLevel: number;
  joinMinLevel: number;
};

function readInt(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function readFloat(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

export async function readGuildConfig(ctx: DatabaseCtx): Promise<GuildConfig> {
  const map = await readBalanceMap(
    ctx,
    GUILD_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const get = (key: string) => map.get(key);
  const expiryHours = readInt(get("guildApplicationExpiryHours"), 24, 1, 168);
  return {
    creationCost: readInt(get("guildCreationCost"), 50000, 0, 1_000_000_000),
    nameMin: readInt(get("guildNameMinLength"), 3, 1, 64),
    nameMax: readInt(get("guildNameMaxLength"), 24, 1, 64),
    tagMin: readInt(get("guildTagMinLength"), 2, 1, 10),
    tagMax: readInt(get("guildTagMaxLength"), 5, 1, 10),
    descriptionMax: readInt(get("guildDescriptionMaxLength"), 280, 0, 2000),
    applicationExpiryMs: expiryHours * 60 * 60 * 1000,
    levelXpBase: readInt(get("guildLevelXpBase"), 1000, 1, 1_000_000_000),
    levelXpGrowth: readFloat(get("guildLevelXpGrowth"), 1.5, 1, 10),
    maxLevel: readInt(get("guildMaxLevel"), 10, 1, 100),
    activityXpPercent: readInt(get("guildActivityXpPercent"), 1, 0, 100),
    createMinLevel: readInt(get("guildCreateMinLevel"), 100, 1, 100000),
    joinMinLevel: readInt(get("guildJoinMinLevel"), 50, 1, 100000),
  };
}

export function guildXpForLevel(level: number, base: number, growth: number) {
  if (level < 1) return 0;
  return Math.floor(base * Math.pow(growth, level - 1));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMembership(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"guildMembers"> | null> {
  return await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
}

async function requireMembership(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<{ guild: Doc<"guilds">; membership: Doc<"guildMembers"> }> {
  const membership = await getMembership(ctx, playerId);
  if (!membership) throw new Error("You are not in a guild");
  const guild = await ctx.db.get(membership.guildId);
  if (!guild) throw new Error("Guild not found");
  return { guild, membership };
}

function requireRole(membership: Doc<"guildMembers">, minimum: GuildRole) {
  if (ROLE_RANK[membership.role] < ROLE_RANK[minimum]) {
    throw new Error(`Requires ${minimum} role or higher`);
  }
}

async function getBonusForLevel(ctx: DatabaseCtx, level: number) {
  const row = await ctx.db
    .query("guildBonuses")
    .withIndex("by_level", (q) => q.eq("level", level))
    .first();
  if (row) return row;
  const seed = GUILD_BONUS_SEED.find((entry) => entry.level === level);
  if (seed) return { ...seed, _id: null as never, _creationTime: 0 };
  return { ...GUILD_BONUS_SEED[0], _id: null as never, _creationTime: 0 };
}

export async function getGuildBonusesForPlayer(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<{ goldBonusPercent: number; xpBonusPercent: number; statBonusPercent: number }> {
  const membership = await getMembership(ctx, playerId);
  if (!membership) {
    return { goldBonusPercent: 0, xpBonusPercent: 0, statBonusPercent: 0 };
  }
  const guild = await ctx.db.get(membership.guildId);
  if (!guild) {
    return { goldBonusPercent: 0, xpBonusPercent: 0, statBonusPercent: 0 };
  }
  const bonus = await getBonusForLevel(ctx, guild.level);
  return {
    goldBonusPercent: bonus.goldBonusPercent ?? 0,
    xpBonusPercent: bonus.xpBonusPercent ?? 0,
    statBonusPercent: bonus.statBonusPercent ?? 0,
  };
}

async function countMembers(ctx: DatabaseCtx, guildId: Id<"guilds">) {
  const rows = await ctx.db
    .query("guildMembers")
    .withIndex("by_guildId", (q) => q.eq("guildId", guildId))
    .take(500);
  return rows.length;
}

function normalizeName(value: string) {
  return value.trim();
}

function normalizeTag(value: string) {
  return value.trim().toUpperCase();
}

// ─── Mutations: lifecycle ─────────────────────────────────────────────────────

/**
 * Settle before spending, but only when the player actually has task rows.
 * With no tasks settlement is a vacuous no-op, and skipping it keeps
 * deployment-credential callers (CLI sims, seeds) working — the task queue
 * paths require a signed-in identity.
 */
async function settleIfTasksExist(ctx: MutationCtx, playerId: Id<"players">) {
  const active = await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", playerId).eq("status", "active")
    )
    .first();
  const queued =
    active ??
    (await ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "queued")
      )
      .first());
  if (queued) {
    await settleTasksBeforeInteraction(ctx, playerId);
  }
}

/**
 * Shared create-guild core used by the public mutation (after auth) and the
 * live simulation harness (deployment-credential gated, no auth identity).
 * Takes an already-loaded caller row — no `requirePlayer` inside.
 */
export async function createGuildCore(
  ctx: MutationCtx,
  playerId: Id<"players">,
  args: { name: string; tag: string; description: string }
) {
  const { name, tag, description } = args;
  await settleIfTasksExist(ctx, playerId);
  const config = await readGuildConfig(ctx);

  const cleanName = normalizeName(name);
  const cleanTag = normalizeTag(tag);
  const cleanDescription = description.trim();
  if (
    cleanName.length < config.nameMin ||
    cleanName.length > config.nameMax
  ) {
    throw new Error(
      `Guild name must be ${config.nameMin}-${config.nameMax} characters`
    );
  }
  if (cleanTag.length < config.tagMin || cleanTag.length > config.tagMax) {
    throw new Error(
      `Guild tag must be ${config.tagMin}-${config.tagMax} characters`
    );
  }
  if (!/^[A-Z0-9]+$/.test(cleanTag)) {
    throw new Error("Guild tag must be letters and numbers only");
  }
  if (cleanDescription.length > config.descriptionMax) {
    throw new Error(
      `Guild description must be at most ${config.descriptionMax} characters`
    );
  }

  const existing = await getMembership(ctx, playerId);
  if (existing) throw new Error("You are already in a guild");

  const [nameTaken, tagTaken] = await Promise.all([
    ctx.db.query("guilds").withIndex("by_name", (q) => q.eq("name", cleanName)).first(),
    ctx.db.query("guilds").withIndex("by_tag", (q) => q.eq("tag", cleanTag)).first(),
  ]);
  if (nameTaken) throw new Error("A guild with that name already exists");
  if (tagTaken) throw new Error("A guild with that tag already exists");

  const player = await ctx.db.get(playerId);
  if (!player) throw new Error("Player not found");
  const founderLevel = await calculateCharacterLevel(ctx, player);
  if (founderLevel < config.createMinLevel) {
    throw new Error(
      `Founding a guild requires character level ${config.createMinLevel} (you are ${founderLevel})`
    );
  }
  if (player.gold < config.creationCost) {
    throw new Error(`Creating a guild costs ${config.creationCost} gold`);
  }

  const now = Date.now();
  await ctx.db.patch(playerId, {
    gold: player.gold - config.creationCost,
    lastUpdated: now,
  });
  const guildId = await ctx.db.insert("guilds", {
    name: cleanName,
    tag: cleanTag,
    description: cleanDescription,
    ownerId: playerId,
    gold: 0,
    xp: 0,
    level: 1,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("guildMembers", {
    guildId,
    playerId,
    role: "master",
    joinedAt: now,
    contributionXp: 0,
    contributionGold: config.creationCost,
    lastActiveAt: now,
  });
  return await ctx.db.get(guildId);
}

export const createGuild = mutation({
  args: {
    playerId: v.id("players"),
    name: v.string(),
    tag: v.string(),
    description: v.string(),
  },
  handler: async (ctx, { playerId, name, tag, description }) => {
    await requirePlayer(ctx, playerId);
    return await createGuildCore(ctx, playerId, { name, tag, description });
  },
});

export const disbandGuild = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    if (membership.role !== "master") {
      throw new Error("Only the guild master can disband the guild");
    }
    const members = await ctx.db
      .query("guildMembers")
      .withIndex("by_guildId", (q) => q.eq("guildId", guild._id))
      .take(500);
    for (const member of members) {
      await ctx.db.delete(member._id);
    }
    const applications = await ctx.db
      .query("guildApplications")
      .withIndex("by_guildId_and_status", (q) =>
        q.eq("guildId", guild._id).eq("status", "pending")
      )
      .take(200);
    for (const application of applications) {
      await ctx.db.patch(application._id, { status: "expired" });
    }
    await ctx.db.delete(guild._id);
    return null;
  },
});

export const leaveGuild = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    if (membership.role === "master") {
      const memberCount = await countMembers(ctx, guild._id);
      if (memberCount > 1) {
        throw new Error("Transfer ownership before leaving the guild");
      }
      await ctx.db.delete(membership._id);
      await ctx.db.delete(guild._id);
      return null;
    }
    await ctx.db.delete(membership._id);
    return null;
  },
});

// ─── Mutations: invites & applications ────────────────────────────────────────

export const invitePlayer = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, targetPlayerId, message }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    requireRole(membership, "officer");
    if (playerId === targetPlayerId) {
      throw new Error("You cannot invite yourself");
    }
    const target = await ctx.db.get(targetPlayerId);
    if (!target) throw new Error("Player not found");
    const targetMembership = await getMembership(ctx, targetPlayerId);
    if (targetMembership) throw new Error("That player is already in a guild");

    const config = await readGuildConfig(ctx);
    const bonus = await getBonusForLevel(ctx, guild.level);
    const memberCount = await countMembers(ctx, guild._id);
    if (memberCount >= (bonus.maxMembers ?? 50)) {
      throw new Error("Guild is full");
    }

    const existingInvite = await ctx.db
      .query("guildApplications")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", targetPlayerId).eq("status", "pending")
      )
      .first();
    if (existingInvite) {
      throw new Error("That player already has a pending invite or application");
    }

    const now = Date.now();
    const id = await ctx.db.insert("guildApplications", {
      guildId: guild._id,
      playerId: targetPlayerId,
      type: "invite",
      status: "pending",
      ...(message?.trim() ? { message: message.trim().slice(0, 280) } : {}),
      createdAt: now,
      expiresAt: now + config.applicationExpiryMs,
    });
    return await ctx.db.get(id);
  },
});

export const applyToGuild = mutation({
  args: {
    playerId: v.id("players"),
    guildId: v.id("guilds"),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, guildId, message }) => {
    const applicant = await requirePlayer(ctx, playerId);
    return await applyToGuildCore(ctx, applicant, { guildId, message });
  },
});

/**
 * Shared apply core (auth checked by the caller). Exported for the live
 * simulation harness.
 */
export async function applyToGuildCore(
  ctx: MutationCtx,
  applicant: Doc<"players">,
  args: { guildId: Id<"guilds">; message?: string }
) {
  const { guildId, message } = args;
  const playerId = applicant._id;
  const guild = await ctx.db.get(guildId);
  if (!guild) throw new Error("Guild not found");
  const config = await readGuildConfig(ctx);
  const applicantLevel = await calculateCharacterLevel(ctx, applicant);
  if (applicantLevel < config.joinMinLevel) {
    throw new Error(
      `Joining a guild requires character level ${config.joinMinLevel} (you are ${applicantLevel})`
    );
  }
  const existing = await getMembership(ctx, playerId);
  if (existing) throw new Error("You are already in a guild");

  const pending = await ctx.db
    .query("guildApplications")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", playerId).eq("status", "pending")
    )
    .first();
  if (pending) {
    throw new Error("You already have a pending invite or application");
  }

  const now = Date.now();
  const id = await ctx.db.insert("guildApplications", {
    guildId,
    playerId,
    type: "application",
    status: "pending",
    ...(message?.trim() ? { message: message.trim().slice(0, 280) } : {}),
    createdAt: now,
    expiresAt: now + config.applicationExpiryMs,
  });
  return await ctx.db.get(id);
}

export async function acceptApplicationRow(
  ctx: MutationCtx,
  applicationId: Id<"guildApplications">,
  actorId: Id<"players">,
  actorGuildId: Id<"guilds"> | null
) {
  const application = await ctx.db.get(applicationId);
  if (!application) throw new Error("Application not found");
  if (application.status !== "pending") {
    throw new Error("Application is no longer pending");
  }
  if (Date.now() > application.expiresAt) {
    await ctx.db.patch(application._id, { status: "expired" });
    throw new Error("Application has expired");
  }
  if (actorGuildId !== null && application.guildId !== actorGuildId) {
    throw new Error("Application belongs to a different guild");
  }
  const guild = await ctx.db.get(application.guildId);
  if (!guild) throw new Error("Guild not found");

  const targetMembership = await getMembership(ctx, application.playerId);
  if (targetMembership) throw new Error("Player is already in a guild");

  const joiner = await ctx.db.get(application.playerId);
  if (!joiner) throw new Error("Player not found");
  const joinerLevel = await calculateCharacterLevel(ctx, joiner);
  const joinConfig = await readGuildConfig(ctx);
  if (joinerLevel < joinConfig.joinMinLevel) {
    throw new Error(
      `Joining a guild requires character level ${joinConfig.joinMinLevel}`
    );
  }

  const bonus = await getBonusForLevel(ctx, guild.level);
  const memberCount = await countMembers(ctx, guild._id);
  if (memberCount >= (bonus.maxMembers ?? 50)) {
    throw new Error("Guild is full");
  }

  const now = Date.now();
  await ctx.db.patch(application._id, { status: "accepted" });
  await ctx.db.insert("guildMembers", {
    guildId: guild._id,
    playerId: application.playerId,
    role: "recruit",
    joinedAt: now,
    contributionXp: 0,
    contributionGold: 0,
    lastActiveAt: now,
  });
  // Close any other pending rows for the same player.
  const others = await ctx.db
    .query("guildApplications")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", application.playerId).eq("status", "pending")
    )
    .take(20);
  for (const other of others) {
    if (other._id !== application._id) {
      await ctx.db.patch(other._id, { status: "expired" });
    }
  }
  // Touch actor activity; touch target via membership lastActiveAt.
  void actorId;
  return await ctx.db.get(guild._id);
}

export const acceptInvite = mutation({
  args: {
    playerId: v.id("players"),
    applicationId: v.id("guildApplications"),
  },
  handler: async (ctx, { playerId, applicationId }) => {
    await requirePlayer(ctx, playerId);
    const application = await ctx.db.get(applicationId);
    if (!application) throw new Error("Application not found");
    if (application.playerId !== playerId) {
      throw new Error("That invite is for a different player");
    }
    if (application.type !== "invite") {
      throw new Error("That is not an invite");
    }
    return await acceptApplicationRow(ctx, applicationId, playerId, null);
  },
});

export const acceptApplication = mutation({
  args: {
    playerId: v.id("players"),
    applicationId: v.id("guildApplications"),
  },
  handler: async (ctx, { playerId, applicationId }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    requireRole(membership, "officer");
    const application = await ctx.db.get(applicationId);
    if (!application) throw new Error("Application not found");
    if (application.type !== "application") {
      throw new Error("That is not an application");
    }
    return await acceptApplicationRow(ctx, applicationId, playerId, guild._id);
  },
});

export const declineApplication = mutation({
  args: {
    playerId: v.id("players"),
    applicationId: v.id("guildApplications"),
  },
  handler: async (ctx, { playerId, applicationId }) => {
    await requirePlayer(ctx, playerId);
    const application = await ctx.db.get(applicationId);
    if (!application) throw new Error("Application not found");
    if (application.status !== "pending") {
      throw new Error("Application is no longer pending");
    }
    if (application.playerId === playerId) {
      await ctx.db.patch(application._id, { status: "declined" });
      return null;
    }
    const { guild, membership } = await requireMembership(ctx, playerId);
    requireRole(membership, "officer");
    if (application.guildId !== guild._id) {
      throw new Error("Application belongs to a different guild");
    }
    await ctx.db.patch(application._id, { status: "declined" });
    return null;
  },
});

// ─── Mutations: roles ─────────────────────────────────────────────────────────

export const kickMember = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    requireRole(membership, "officer");
    if (playerId === targetPlayerId) {
      throw new Error("Use leave instead of kicking yourself");
    }
    const target = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", targetPlayerId))
      .first();
    if (!target || target.guildId !== guild._id) {
      throw new Error("That player is not in your guild");
    }
    if (target.role === "master") {
      throw new Error("The guild master cannot be kicked");
    }
    if (membership.role === "officer" && target.role === "officer") {
      throw new Error("Only the master can kick officers");
    }
    await ctx.db.delete(target._id);
    return null;
  },
});

export const promoteMember = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requirePlayer(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    if (membership.role !== "master") {
      throw new Error("Only the guild master can promote members");
    }
    const target = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", targetPlayerId))
      .first();
    if (!target || target.guildId !== guild._id) {
      throw new Error("That player is not in your guild");
    }
    const now = Date.now();
    if (target.role === "recruit") {
      await ctx.db.patch(target._id, { role: "member", lastActiveAt: now });
      return null;
    }
    if (target.role === "member") {
      await ctx.db.patch(target._id, { role: "officer", lastActiveAt: now });
      return null;
    }
    if (target.role === "officer") {
      // Transfer ownership: old master becomes officer.
      await ctx.db.patch(target._id, { role: "master", lastActiveAt: now });
      await ctx.db.patch(membership._id, { role: "officer", lastActiveAt: now });
      await ctx.db.patch(guild._id, { ownerId: targetPlayerId, updatedAt: now });
      return null;
    }
    throw new Error("That player is already the guild master");
  },
});

export const demoteMember = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requirePlayer(ctx, playerId);
    const { membership } = await requireMembership(ctx, playerId);
    if (membership.role !== "master") {
      throw new Error("Only the guild master can demote members");
    }
    const target = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", targetPlayerId))
      .first();
    if (!target || target.guildId !== membership.guildId) {
      throw new Error("That player is not in your guild");
    }
    if (target.role === "master") {
      throw new Error("Transfer ownership instead of demoting the master");
    }
    if (target.role === "officer") {
      await ctx.db.patch(target._id, { role: "member", lastActiveAt: Date.now() });
      return null;
    }
    if (target.role === "member") {
      await ctx.db.patch(target._id, { role: "recruit", lastActiveAt: Date.now() });
      return null;
    }
    throw new Error("Recruits cannot be demoted further");
  },
});

// ─── Mutations: bank & XP ─────────────────────────────────────────────────────

export const depositGold = mutation({
  args: {
    playerId: v.id("players"),
    amount: v.number(),
  },
  handler: async (ctx, { playerId, amount }) => {
    await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new Error("Deposit amount must be a positive whole number");
    }
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    if (player.gold < amount) throw new Error("Insufficient gold");
    const now = Date.now();
    await ctx.db.patch(playerId, { gold: player.gold - amount, lastUpdated: now });
    await ctx.db.patch(guild._id, { gold: guild.gold + amount, updatedAt: now });
    await ctx.db.patch(membership._id, {
      contributionGold: membership.contributionGold + amount,
      lastActiveAt: now,
    });
    return await ctx.db.get(guild._id);
  },
});

export const withdrawGold = mutation({
  args: {
    playerId: v.id("players"),
    amount: v.number(),
  },
  handler: async (ctx, { playerId, amount }) => {
    await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const { guild, membership } = await requireMembership(ctx, playerId);
    requireRole(membership, "officer");
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new Error("Withdraw amount must be a positive whole number");
    }
    if (guild.gold < amount) throw new Error("Guild bank has insufficient gold");
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const now = Date.now();
    await ctx.db.patch(guild._id, { gold: guild.gold - amount, updatedAt: now });
    await ctx.db.patch(playerId, { gold: player.gold + amount, lastUpdated: now });
    return await ctx.db.get(guild._id);
  },
});

export async function addGuildXp(  ctx: MutationCtx,
  guildId: Id<"guilds">,
  amount: number
): Promise<Doc<"guilds"> | null> {
  if (!Number.isFinite(amount) || amount <= 0) return await ctx.db.get(guildId);
  const guild = await ctx.db.get(guildId);
  if (!guild) return null;
  const config = await readGuildConfig(ctx);
  let xp = guild.xp + Math.floor(amount);
  let level = guild.level;
  while (level < config.maxLevel) {
    const needed = guildXpForLevel(level, config.levelXpBase, config.levelXpGrowth);
    if (xp < needed) break;
    xp -= needed;
    level += 1;
  }
  if (level >= config.maxLevel) {
    level = config.maxLevel;
  }
  await ctx.db.patch(guildId, { xp, level, updatedAt: Date.now() });
  return await ctx.db.get(guildId);
}

/**
 * Shared same-transaction accrual for combat/skill settlements. Grants
 * activityXpPercent of earned XP to the member's guild as a bonus — the player's own totals are never reduced. No-op when the player has no guild or XP is zero.
 */
export async function accrueGuildXpFromEarned(
  ctx: MutationCtx,
  playerId: Id<"players">,
  xpEarned: number
): Promise<void> {
  if (!Number.isFinite(xpEarned) || xpEarned <= 0) return;
  const membership = await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
  if (!membership) return;
  const config = await readGuildConfig(ctx);
  if (config.activityXpPercent <= 0) return;
  const guildXp = Math.floor((xpEarned * config.activityXpPercent) / 100);
  if (guildXp <= 0) return;
  await ctx.db.patch(membership._id, {
    contributionXp: membership.contributionXp + guildXp,
    lastActiveAt: Date.now(),
  });
  await addGuildXp(ctx, membership.guildId, guildXp);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getMyGuild = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const membership = await getMembership(ctx, playerId);
    if (!membership) return null;
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) return null;
    const [bonus, memberCount] = await Promise.all([
      getBonusForLevel(ctx, guild.level),
      countMembers(ctx, guild._id),
    ]);
    return { guild, membership, bonus, memberCount };
  },
});

export const getGuildById = query({
  args: {
    playerId: v.id("players"),
    guildId: v.id("guilds"),
  },
  handler: async (ctx, { playerId, guildId }) => {
    await requirePlayerRead(ctx, playerId);
    const guild = await ctx.db.get(guildId);
    if (!guild) return null;
    const [bonus, members] = await Promise.all([
      getBonusForLevel(ctx, guild.level),
      ctx.db.query("guildMembers").withIndex("by_guildId", (q) => q.eq("guildId", guildId)).take(200),
    ]);
    const memberPlayers = await Promise.all(
      members.map((member) => ctx.db.get(member.playerId))
    );
    const roster = members.map((member, index) => ({
      ...member,
      playerName: memberPlayers[index]?.name ?? "Unknown",
    }));
    return { guild, bonus, members: roster, memberCount: members.length };
  },
});

export const getGuildMembers = query({
  args: {
    playerId: v.id("players"),
    guildId: v.id("guilds"),
  },
  handler: async (ctx, { playerId, guildId }) => {
    await requirePlayerRead(ctx, playerId);
    const members = await ctx.db
      .query("guildMembers")
      .withIndex("by_guildId", (q) => q.eq("guildId", guildId))
      .take(200);
    const players = await Promise.all(
      members.map((member) => ctx.db.get(member.playerId))
    );
    return members.map((member, index) => ({
      ...member,
      playerName: players[index]?.name ?? "Unknown",
    }));
  },
});

export const getPendingApplications = query({
  args: {
    playerId: v.id("players"),
    guildId: v.optional(v.id("guilds")),
  },
  handler: async (ctx, { playerId, guildId }) => {
    await requirePlayerRead(ctx, playerId);
    if (guildId) {
      const membership = await getMembership(ctx, playerId);
      if (!membership || membership.guildId !== guildId) {
        throw new Error("You are not in that guild");
      }
      requireRole(membership, "officer");
      const rows = await ctx.db
        .query("guildApplications")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", guildId).eq("status", "pending")
        )
        .take(100);
      const players = await Promise.all(rows.map((row) => ctx.db.get(row.playerId)));
      return rows.map((row, index) => ({
        ...row,
        playerName: players[index]?.name ?? "Unknown",
      }));
    }
    const rows = await ctx.db
      .query("guildApplications")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "pending")
      )
      .take(50);
    const guilds = await Promise.all(rows.map((row) => ctx.db.get(row.guildId)));
    return rows.map((row, index) => ({
      ...row,
      guildName: guilds[index]?.name ?? "Unknown",
      guildTag: guilds[index]?.tag ?? "?",
    }));
  },
});

export const getGuildBonuses = query({
  args: { level: v.optional(v.number()) },
  handler: async (ctx, { level }) => {
    if (level !== undefined) {
      return await getBonusForLevel(ctx, level);
    }
    const rows = await ctx.db.query("guildBonuses").take(100);
    return rows.sort((a, b) => a.level - b.level);
  },
});

/**
 * Public creation/join requirements for the guild UI. No player identity
 * needed — the browse/create pages render before membership exists.
 */
export const getGuildConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await readGuildConfig(ctx);
    return {
      creationCost: config.creationCost,
      createMinLevel: config.createMinLevel,
      joinMinLevel: config.joinMinLevel,
      activityXpPercent: config.activityXpPercent,
    };
  },
});

export const searchGuilds = query({
  args: {
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { search, limit }) => {
    const capped = typeof limit === "number" && Number.isSafeInteger(limit)
      ? Math.min(Math.max(limit, 1), 50)
      : 20;
    const term = search?.trim().toLowerCase() ?? "";
    const guilds = await ctx.db.query("guilds").take(200);
    const filtered = term.length === 0
      ? guilds
      : guilds.filter(
          (guild) =>
            guild.name.toLowerCase().includes(term) ||
            guild.tag.toLowerCase().includes(term)
        );
    filtered.sort((a, b) => b.level - a.level || b.xp - a.xp);
    const visible = filtered.slice(0, capped);
    const counts = await Promise.all(
      visible.map((guild) => countMembers(ctx, guild._id))
    );
    return visible.map((guild, index) => ({
      ...guild,
      memberCount: counts[index],
    }));
  },
});

export const getGuildLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const capped = typeof limit === "number" && Number.isSafeInteger(limit)
      ? Math.min(Math.max(limit, 1), 50)
      : 20;
    const guilds = await ctx.db.query("guilds").take(200);
    guilds.sort((a, b) => b.level - a.level || b.xp - a.xp);
    const visible = guilds.slice(0, capped);
    const counts = await Promise.all(
      visible.map((guild) => countMembers(ctx, guild._id))
    );
    return visible.map((guild, index) => ({
      guildId: guild._id,
      guildName: guild.name,
      guildTag: guild.tag,
      level: guild.level,
      xp: guild.xp,
      memberCount: counts[index],
    }));
  },
});

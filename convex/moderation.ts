import { internalMutation, mutation, query } from "./_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin } from "./adminAuth";
import {
  PERMANENT_BAN_UNTIL,
  readAccountModeration,
  writeAccountModeration,
} from "./accountModeration";

export const MAX_MUTE_MINUTES = 30 * 24 * 60;
export const MAX_BAN_DAYS = 3650;
const MAX_REASON_LENGTH = 500;
const MAX_LOG_ENTRIES = 100;
const EXPIRE_BATCH_SIZE = 500;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const moderationActionValidator = v.union(
  v.object({ kind: v.literal("mute"), minutes: v.number() }),
  // No `days` means a permanent ban.
  v.object({ kind: v.literal("ban"), days: v.optional(v.number()) })
);

export type ModerationAction = Infer<typeof moderationActionValidator>;

function assertWholeNumberInRange(value: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} must be a whole number from 1 to ${max}.`);
  }
}

function validateModerationAction(action: ModerationAction) {
  if (action.kind === "mute") {
    assertWholeNumberInRange(action.minutes, MAX_MUTE_MINUTES, "Mute length (minutes)");
  } else if (action.days !== undefined) {
    assertWholeNumberInRange(action.days, MAX_BAN_DAYS, "Ban length (days)");
  }
}

/**
 * Mutes or bans the account that owns `target`, and logs it. Callers must have
 * already confirmed the actor is an admin. Reports call this too, in the same
 * transaction that resolves them.
 */
export async function applyModerationAction(
  ctx: MutationCtx,
  args: {
    actor: Doc<"players">;
    target: Doc<"players">;
    action: ModerationAction;
    reason: string;
    reportId?: Id<"chatReports">;
  }
): Promise<void> {
  const { actor, target, action, reportId } = args;
  if (target._id === actor._id) {
    throw new Error("You cannot moderate your own character.");
  }
  if (target.role === "admin") {
    throw new Error("Admin characters cannot be muted or banned.");
  }
  const userId = target.authSubject;
  if (userId === undefined) {
    throw new Error("That character has no account to moderate.");
  }
  validateModerationAction(action);
  const reason = args.reason.trim();
  if (reason.length === 0) {
    throw new Error("Add a reason before muting or banning.");
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`Reason cannot be longer than ${MAX_REASON_LENGTH} characters.`);
  }

  const now = Date.now();
  const current = await readAccountModeration(ctx, userId);
  const state = {
    mutedUntil: current?.mutedUntil ?? 0,
    muteReason: current?.muteReason,
    bannedUntil: current?.bannedUntil ?? 0,
    banReason: current?.banReason,
  };

  let until: number;
  if (action.kind === "mute") {
    until = now + action.minutes * MINUTE_MS;
    state.mutedUntil = until;
    state.muteReason = reason;
  } else {
    until = action.days === undefined ? PERMANENT_BAN_UNTIL : now + action.days * DAY_MS;
    state.bannedUntil = until;
    state.banReason = reason;
  }
  await writeAccountModeration(ctx, userId, state);

  await ctx.db.insert("moderationLog", {
    userId,
    targetPlayerId: target._id,
    targetName: target.name,
    action: action.kind,
    reason,
    until,
    ...(reportId === undefined ? {} : { reportId }),
    actorId: actor._id,
    actorName: actor.name,
    createdAt: now,
  });
}

async function liftAccountModeration(
  ctx: MutationCtx,
  args: { actor: Doc<"players">; target: Doc<"players">; kind: "mute" | "ban" }
): Promise<void> {
  const { actor, target, kind } = args;
  const userId = target.authSubject;
  if (userId === undefined) {
    throw new Error("That character has no account to moderate.");
  }
  const current = await readAccountModeration(ctx, userId);
  const active =
    kind === "mute" ? (current?.mutedUntil ?? 0) > 0 : (current?.bannedUntil ?? 0) > 0;
  if (!active) {
    throw new Error(`This account is not currently ${kind === "mute" ? "muted" : "banned"}.`);
  }

  // Clear one restriction and keep the other as it was.
  await writeAccountModeration(
    ctx,
    userId,
    kind === "mute"
      ? {
          mutedUntil: 0,
          bannedUntil: current?.bannedUntil ?? 0,
          banReason: current?.banReason,
        }
      : {
          mutedUntil: current?.mutedUntil ?? 0,
          muteReason: current?.muteReason,
          bannedUntil: 0,
        }
  );

  await ctx.db.insert("moderationLog", {
    userId,
    targetPlayerId: target._id,
    targetName: target.name,
    action: kind === "mute" ? "unmute" : "unban",
    reason: "Lifted by a moderator",
    actorId: actor._id,
    actorName: actor.name,
    createdAt: Date.now(),
  });
}

export const applyModeration = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
    action: moderationActionValidator,
    reason: v.string(),
  },
  handler: async (ctx, { playerId, targetPlayerId, action, reason }) => {
    const actor = await requireAdmin(ctx, playerId);
    const target = await ctx.db.get(targetPlayerId);
    if (!target) {
      throw new Error("Player not found");
    }
    await applyModerationAction(ctx, { actor, target, action, reason });
    return null;
  },
});

export const liftModeration = mutation({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
    kind: v.union(v.literal("mute"), v.literal("ban")),
  },
  handler: async (ctx, { playerId, targetPlayerId, kind }) => {
    const actor = await requireAdmin(ctx, playerId);
    const target = await ctx.db.get(targetPlayerId);
    if (!target) {
      throw new Error("Player not found");
    }
    await liftAccountModeration(ctx, { actor, target, kind });
    return null;
  },
});

/** The current mute and ban on the account behind a character, for admins. */
export const getPlayerModeration = query({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requireAdmin(ctx, playerId);
    const target = await ctx.db.get(targetPlayerId);
    if (!target) {
      throw new Error("Player not found");
    }
    const row =
      target.authSubject === undefined
        ? null
        : await readAccountModeration(ctx, target.authSubject);
    return {
      mutedUntil: row?.mutedUntil ?? 0,
      muteReason: row?.muteReason ?? null,
      bannedUntil: row?.bannedUntil ?? 0,
      banReason: row?.banReason ?? null,
    };
  },
});

/** Recent moderator actions, newest first. Pass a character to see only its account. */
export const listModerationLog = query({
  args: {
    playerId: v.id("players"),
    targetPlayerId: v.optional(v.id("players")),
  },
  handler: async (ctx, { playerId, targetPlayerId }) => {
    await requireAdmin(ctx, playerId);
    if (targetPlayerId === undefined) {
      return await ctx.db.query("moderationLog").order("desc").take(MAX_LOG_ENTRIES);
    }
    const target = await ctx.db.get(targetPlayerId);
    if (!target || target.authSubject === undefined) {
      return [];
    }
    const userId = target.authSubject;
    return await ctx.db
      .query("moderationLog")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_LOG_ENTRIES);
  },
});

/**
 * Clears bans whose end has passed. Bans are checked without the clock, so this
 * is what lets an expired ban stop blocking, and it also re-runs the queries
 * that read the account's moderation row. Mutes need no cleanup.
 */
export const expireBans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const lapsed = await ctx.db
      .query("accountModeration")
      .withIndex("by_bannedUntil", (q) => q.gt("bannedUntil", 0).lte("bannedUntil", now))
      .take(EXPIRE_BATCH_SIZE);
    for (const row of lapsed) {
      await ctx.db.patch("accountModeration", row._id, {
        bannedUntil: 0,
        banReason: undefined,
        updatedAt: now,
      });
    }
    return null;
  },
});

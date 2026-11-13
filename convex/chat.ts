import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./adminAuth";
import { requirePlayerRead as requireChannelOwner } from "./playerAuth";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readAccountModeration } from "./accountModeration";
import { isBlocking, readBlockedPlayerIds } from "./playerBlocks";
import { applyModerationAction, moderationActionValidator } from "./moderation";

const rateLimiter = new RateLimiter(components.rateLimiter, {});

const WORLD_CHANNEL_ID = "world";
const MAX_CHAT_MESSAGE_LENGTH = 280;
const MAX_RECENT_MESSAGES = 50;
// Blocked senders are filtered after the read, so fetch extra rows for them.
const BLOCKED_SCAN_MULTIPLIER = 3;
const MAX_PRIVATE_CHATS = 50;
const MAX_PRIVATE_MESSAGES_TO_SCAN = 200;
const CHAT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const CHAT_PRUNE_BATCH_SIZE = 500;

type SupportedChannelType = "world" | "private" | "guild" | "arena";

const ARENA_CHANNEL_ID = "arena";
const LOBBY_CHANNEL_PREFIX = "lobby:";

type PrivateChatSummary = {
  playerId: Id<"players">;
  playerName: string;
  lastMessageAt: number;
  hasUnread: boolean;
};

function getPrivateChannelId(
  firstPlayerId: Id<"players">,
  secondPlayerId: Id<"players">
) {
  return [String(firstPlayerId), String(secondPlayerId)].sort().join(":");
}

async function getPlayerOrThrow(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"players">
) {
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }
  return player;
}

async function resolveChannel(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"players">,
  channelType: string,
  recipientId?: Id<"players">,
  lobbyId?: Id<"arenaLobbies">
) {
  const player = await getPlayerOrThrow(ctx, playerId);

  if (channelType === "arena") {
    if (recipientId) {
      throw new Error("Arena chat cannot have a recipient");
    }
    if (lobbyId === undefined) {
      return {
        player,
        channelType: "arena" as SupportedChannelType,
        channelId: ARENA_CHANNEL_ID,
        recipient: undefined,
      };
    }
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) {
      throw new Error("Arena lobby not found");
    }
    // Lobby chat is occupants-only so private rooms never leak, and the
    // peanut gallery can't heckle from outside.
    const isFighter =
      lobby.fighter1Id === playerId || lobby.fighter2Id === playerId;
    const spectator = isFighter
      ? null
      : await ctx.db
          .query("arenaSpectators")
          .withIndex("by_lobby_and_player", (q) =>
            q.eq("lobbyId", lobbyId).eq("playerId", playerId)
          )
          .first();
    if (!isFighter && !spectator) {
      throw new Error("Only lobby fighters and spectators can use lobby chat");
    }
    return {
      player,
      channelType: "arena" as SupportedChannelType,
      channelId: `${LOBBY_CHANNEL_PREFIX}${lobbyId}`,
      recipient: undefined,
    };
  }

  if (channelType === "world") {
    if (recipientId) {
      throw new Error("World chat cannot have a recipient");
    }
    return {
      player,
      channelType: "world" as SupportedChannelType,
      channelId: WORLD_CHANNEL_ID,
      recipient: undefined,
    };
  }

  if (channelType === "guild") {
    if (recipientId) {
      throw new Error("Guild chat cannot have a recipient");
    }
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) {
      throw new Error("You are not in a guild");
    }
    return {
      player,
      channelType: "guild" as SupportedChannelType,
      channelId: String(membership.guildId),
      recipient: undefined,
    };
  }

  if (channelType !== "private") {
    throw new Error(`Unsupported chat channel: ${channelType}`);
  }

  // NOTE: channelId is derived from the caller-supplied playerId, so the
  // caller is a participant by construction. True impersonation resistance
  // (caller A reading A+B's thread by passing A's id) requires auth
  // identity; until then this only guarantees the pair exists.

  if (!recipientId) {
    throw new Error("A private chat recipient is required");
  }
  if (recipientId === playerId) {
    throw new Error("You cannot start a private chat with yourself");
  }

  const recipient = await ctx.db.get(recipientId);
  if (!recipient) {
    throw new Error("Chat recipient not found");
  }

  return {
    player,
    channelType: "private" as SupportedChannelType,
    channelId: getPrivateChannelId(playerId, recipientId),
    recipient,
  };
}

export const listMessages = query({
  args: {
    playerId: v.id("players"),
    channelType: v.string(),
    recipientId: v.optional(v.id("players")),
    lobbyId: v.optional(v.id("arenaLobbies")),
  },
  handler: async (ctx, args) => {
    const { channelType, channelId } = await resolveChannel(
      ctx,
      args.playerId,
      args.channelType,
      args.recipientId,
      args.lobbyId
    );
    await requireChannelOwner(ctx, args.playerId);

    // Blocked senders are hidden for the blocker only, so the other players
    // in the channel still see everything.
    const blocked = await readBlockedPlayerIds(ctx, args.playerId);
    const scanCount =
      blocked.size === 0
        ? MAX_RECENT_MESSAGES
        : MAX_RECENT_MESSAGES * BLOCKED_SCAN_MULTIPLIER;
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) =>
        q.eq("channelType", channelType).eq("channelId", channelId)
      )
      .order("desc")
      .take(scanCount);

    const visible = messages
      .filter((message) => message.senderId === undefined || !blocked.has(message.senderId))
      .slice(0, MAX_RECENT_MESSAGES);
    return visible.reverse();
  },
});

export const listPrivateChats = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requireChannelOwner(ctx, playerId);
    const [sentMessages, receivedMessages, readReceipts] = await Promise.all([
      ctx.db
        .query("chatMessages")
        .withIndex("by_senderId_createdAt", (q) => q.eq("senderId", playerId))
        .order("desc")
        .take(MAX_PRIVATE_MESSAGES_TO_SCAN),
      ctx.db
        .query("chatMessages")
        .withIndex("by_recipientId_createdAt", (q) =>
          q.eq("recipientId", playerId)
        )
        .order("desc")
        .take(MAX_PRIVATE_MESSAGES_TO_SCAN),
      ctx.db
        .query("chatReadReceipts")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .take(MAX_PRIVATE_CHATS),
    ]);

    const blocked = await readBlockedPlayerIds(ctx, playerId);
    const readAtByChannel = new Map<string, number>();
    for (const receipt of readReceipts) {
      readAtByChannel.set(receipt.channelId, receipt.lastReadAt);
    }

    const chats = new Map<string, PrivateChatSummary>();
    for (const message of [...sentMessages, ...receivedMessages]) {
      if (
        message.channelType !== "private" ||
        !message.senderId ||
        !message.recipientId
      ) {
        continue;
      }

      const isOwnMessage = message.senderId === playerId;
      const otherPlayerId = isOwnMessage
        ? message.recipientId
        : message.senderId;
      if (blocked.has(otherPlayerId)) {
        continue;
      }
      const otherPlayerName = isOwnMessage
        ? message.recipientName ?? "Unknown adventurer"
        : message.senderName;
      const lastReadAt = readAtByChannel.get(message.channelId) ?? 0;
      const existingChat = chats.get(message.channelId);

      if (!existingChat) {
        chats.set(message.channelId, {
          playerId: otherPlayerId,
          playerName: otherPlayerName,
          lastMessageAt: message.createdAt,
          hasUnread:
            !isOwnMessage && message.createdAt > lastReadAt,
        });
        continue;
      }

      if (message.createdAt > existingChat.lastMessageAt) {
        existingChat.lastMessageAt = message.createdAt;
        existingChat.playerName = otherPlayerName;
      }
      if (!isOwnMessage && message.createdAt > lastReadAt) {
        existingChat.hasUnread = true;
      }
    }

    return Array.from(chats.values())
      .sort((first, second) => second.lastMessageAt - first.lastMessageAt)
      .slice(0, MAX_PRIVATE_CHATS);
  },
});

export const markPrivateChatRead = mutation({
  args: {
    playerId: v.id("players"),
    recipientId: v.id("players"),
  },
  handler: async (ctx, args) => {
    const { channelId } = await resolveChannel(
      ctx,
      args.playerId,
      "private",
      args.recipientId
    );
    await requireChannelOwner(ctx, args.playerId);
    const now = Date.now();
    const existingReceipt = await ctx.db
      .query("chatReadReceipts")
      .withIndex("by_playerId_channelId", (q) =>
        q.eq("playerId", args.playerId).eq("channelId", channelId)
      )
      .unique();

    if (existingReceipt) {
      await ctx.db.patch("chatReadReceipts", existingReceipt._id, {
        lastReadAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("chatReadReceipts", {
        playerId: args.playerId,
        channelId,
        lastReadAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

export const sendMessage = mutation({
  args: {
    playerId: v.id("players"),
    channelType: v.string(),
    recipientId: v.optional(v.id("players")),
    lobbyId: v.optional(v.id("arenaLobbies")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const content = args.content.trim();
    if (content.length === 0) {
      throw new Error("Message cannot be empty");
    }
    if (content.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(
        `Message cannot be longer than ${MAX_CHAT_MESSAGE_LENGTH} characters`
      );
    }

    const channel = await resolveChannel(
      ctx,
      args.playerId,
      args.channelType,
      args.recipientId,
      args.lobbyId
    );
    const sender = await requireChannelOwner(ctx, args.playerId);
    if (sender.authSubject !== undefined) {
      const moderation = await readAccountModeration(ctx, sender.authSubject);
      const now = Date.now();
      if (moderation && moderation.mutedUntil > now) {
        throw new Error(
          `You are muted until ${new Date(moderation.mutedUntil).toISOString()}.${
            moderation.muteReason ? ` Reason: ${moderation.muteReason}` : ""
          }`
        );
      }
    }
    if (channel.recipient) {
      if (await isBlocking(ctx, channel.player._id, channel.recipient._id)) {
        throw new Error("You have blocked this player. Unblock them to send messages.");
      }
      // Generic on purpose: the sender must not learn they were blocked.
      if (await isBlocking(ctx, channel.recipient._id, channel.player._id)) {
        throw new Error("This player is not accepting messages from you.");
      }
    }
    const chatStatus = await rateLimiter.limit(ctx, "chatMessage", {
      key: args.playerId,
      config: { kind: "token bucket", rate: 5, period: 10_000, capacity: 5 },
    });
    if (!chatStatus.ok) {
      throw new Error("You are sending messages too fast. Slow down.");
    }
    const now = Date.now();
    const messageId = await ctx.db.insert("chatMessages", {
      channelType: channel.channelType,
      channelId: channel.channelId,
      senderId: channel.player._id,
      senderName: channel.player.name,
      ...(channel.recipient
        ? {
            recipientId: channel.recipient._id,
            recipientName: channel.recipient.name,
          }
        : {}),
      content,
      createdAt: now,
    });

    return await ctx.db.get(messageId);
  },
});


// ─── Reports ──────────────────────────────────────────────────────────────────

const REPORT_CONTEXT_MESSAGES = 10;
const MAX_REPORT_DETAILS_LENGTH = 500;
const MAX_REPORTS_LISTED = 100;

/**
 * Whether a player could see this message. Reports copy messages into a store
 * admins read, so a player must not be able to pull in a channel they aren't in.
 */
async function canSeeMessage(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"players">,
  message: Doc<"chatMessages">
) {
  if (message.channelType === "world") return true;
  if (message.channelType === "private") {
    return message.senderId === playerId || message.recipientId === playerId;
  }
  if (message.channelType === "guild") {
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    return String(membership?.guildId) === message.channelId;
  }
  if (message.channelType === "arena") {
    if (message.channelId === ARENA_CHANNEL_ID) return true;
    const lobbyId = ctx.db.normalizeId(
      "arenaLobbies",
      message.channelId.slice(LOBBY_CHANNEL_PREFIX.length)
    );
    if (!lobbyId) return false;
    const lobby = await ctx.db.get(lobbyId);
    if (lobby?.fighter1Id === playerId || lobby?.fighter2Id === playerId) return true;
    const spectator = await ctx.db
      .query("arenaSpectators")
      .withIndex("by_lobby_and_player", (q) =>
        q.eq("lobbyId", lobbyId).eq("playerId", playerId)
      )
      .first();
    return spectator !== null;
  }
  return false;
}

/**
 * Report the sender of a chat message. Saves a copy of the messages around it, so
 * an admin can read the conversation after the originals are pruned.
 */
export const reportMessage = mutation({
  args: {
    playerId: v.id("players"),
    messageId: v.id("chatMessages"),
    reason: v.union(
      v.literal("harassment"),
      v.literal("spam"),
      v.literal("cheating"),
      v.literal("other")
    ),
    details: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, messageId, reason, details }) => {
    const reporter = await requireChannelOwner(ctx, playerId);
    const message = await ctx.db.get(messageId);
    if (!message || !(await canSeeMessage(ctx, playerId, message))) {
      throw new Error("Message not found");
    }
    if (!message.senderId) {
      throw new Error("That message has no player to report");
    }
    if (message.senderId === playerId) {
      throw new Error("You cannot report yourself");
    }
    const trimmedDetails = details?.trim();
    if (trimmedDetails && trimmedDetails.length > MAX_REPORT_DETAILS_LENGTH) {
      throw new Error(`Details cannot be longer than ${MAX_REPORT_DETAILS_LENGTH} characters`);
    }
    const existing = await ctx.db
      .query("chatReports")
      .withIndex("by_reporterId_and_messageId", (q) =>
        q.eq("reporterId", playerId).eq("messageId", messageId)
      )
      .first();
    if (existing) return { reportId: existing._id, duplicate: true };
    const limit = await rateLimiter.limit(ctx, "chatReport", {
      key: playerId,
      config: { kind: "token bucket", rate: 5, period: 60 * 60 * 1000, capacity: 5 },
    });
    if (!limit.ok) {
      throw new Error("You have sent a lot of reports. Try again later.");
    }

    const [before, after] = await Promise.all([
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) =>
          q
            .eq("channelType", message.channelType)
            .eq("channelId", message.channelId)
            .lt("createdAt", message.createdAt)
        )
        .order("desc")
        .take(REPORT_CONTEXT_MESSAGES),
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) =>
          q
            .eq("channelType", message.channelType)
            .eq("channelId", message.channelId)
            .gte("createdAt", message.createdAt)
        )
        .order("asc")
        .take(REPORT_CONTEXT_MESSAGES + 1),
    ]);
    const context = [...before.reverse(), ...after].map((row) => ({
      messageId: row._id,
      ...(row.senderId === undefined ? {} : { senderId: row.senderId }),
      senderName: row.senderName,
      content: row.content,
      createdAt: row.createdAt,
    }));

    const reportId = await ctx.db.insert("chatReports", {
      reporterId: playerId,
      reporterName: reporter.name,
      reportedPlayerId: message.senderId,
      reportedPlayerName: message.senderName,
      messageId,
      channelType: message.channelType,
      channelId: message.channelId,
      reason,
      ...(trimmedDetails ? { details: trimmedDetails } : {}),
      context,
      status: "open",
      createdAt: Date.now(),
    });
    return { reportId, duplicate: false };
  },
});

export const listReports = query({
  args: {
    playerId: v.id("players"),
    status: v.union(
      v.literal("open"),
      v.literal("actioned"),
      v.literal("dismissed")
    ),
  },
  handler: async (ctx, { playerId, status }) => {
    await requireAdmin(ctx, playerId);
    return await ctx.db
      .query("chatReports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      .order("desc")
      .take(MAX_REPORTS_LISTED);
  },
});

const REPORT_REASON_LABELS: Record<Doc<"chatReports">["reason"], string> = {
  harassment: "Harassment",
  spam: "Spam",
  cheating: "Cheating",
  other: "Other",
};

/**
 * Closes a report. With `action`, the reported player's account is also muted
 * or banned in the same transaction, so the report and the sanction can't
 * disagree. Only an open report can carry an action.
 */
export const resolveReport = mutation({
  args: {
    playerId: v.id("players"),
    reportId: v.id("chatReports"),
    status: v.union(v.literal("actioned"), v.literal("dismissed")),
    action: v.optional(moderationActionValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, reportId, status, action, note }) => {
    const actor = await requireAdmin(ctx, playerId);
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("Report not found");
    if (action !== undefined) {
      if (status !== "actioned") {
        throw new Error("Mark the report actioned to apply a mute or ban.");
      }
      if (report.status !== "open") {
        throw new Error("This report is already resolved.");
      }
      const target = await ctx.db.get(report.reportedPlayerId);
      if (!target) throw new Error("Reported player not found");
      await applyModerationAction(ctx, {
        actor,
        target,
        action,
        reason: note?.trim() || `Reported for ${REPORT_REASON_LABELS[report.reason]}`,
        reportId,
      });
    }
    await ctx.db.patch(reportId, {
      status,
      resolvedBy: playerId,
      resolvedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Delete chat older than the retention window, oldest first. Reports keep their
 * own copies, so they are unaffected.
 */
export const pruneMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CHAT_RETENTION_MS;
    const expired = await ctx.db
      .query("chatMessages")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(CHAT_PRUNE_BATCH_SIZE);
    for (const message of expired) {
      await ctx.db.delete(message._id);
    }
    if (expired.length === CHAT_PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(1_000, internal.chat.pruneMessages, {});
    }
    return null;
  },
});

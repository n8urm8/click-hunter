import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const WORLD_CHANNEL_ID = "world";
const MAX_CHAT_MESSAGE_LENGTH = 280;
const MAX_RECENT_MESSAGES = 50;
const MAX_PRIVATE_CHATS = 50;
const MAX_PRIVATE_MESSAGES_TO_SCAN = 200;

type SupportedChannelType = "world" | "private";

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
  recipientId?: Id<"players">
) {
  const player = await getPlayerOrThrow(ctx, playerId);

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

  if (channelType !== "private") {
    throw new Error(`Unsupported chat channel: ${channelType}`);
  }

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
  },
  handler: async (ctx, args) => {
    const { channelType, channelId } = await resolveChannel(
      ctx,
      args.playerId,
      args.channelType,
      args.recipientId
    );

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) =>
        q.eq("channelType", channelType).eq("channelId", channelId)
      )
      .order("desc")
      .take(MAX_RECENT_MESSAGES);

    return messages.reverse();
  },
});

export const listPrivateChats = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await getPlayerOrThrow(ctx, playerId);
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
      args.recipientId
    );
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

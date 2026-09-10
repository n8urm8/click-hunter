import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const MAX_CHAT_MESSAGE_LENGTH = 280;

export type ChatChannelType = "world" | "private";

export function useChatMessages(
  playerId: Id<"players"> | null | undefined,
  channelType: ChatChannelType,
  recipientId: Id<"players"> | null
) {
  const queryArgs =
    playerId && (channelType === "world" || recipientId)
      ? {
          playerId,
          channelType,
          ...(channelType === "private" && recipientId ? { recipientId } : {}),
        }
      : "skip";

  return useQuery(api.chat.listMessages, queryArgs);
}

export function usePrivateChats(playerId: Id<"players"> | null | undefined) {
  return useQuery(
    api.chat.listPrivateChats,
    playerId ? { playerId } : "skip"
  );
}

export function useMarkPrivateChatRead() {
  return useMutation(api.chat.markPrivateChatRead);
}

export function useSendChatMessage() {
  return useMutation(api.chat.sendMessage);
}

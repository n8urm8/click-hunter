import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

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

  return useQuery({
    ...convexQuery(api.chat.listMessages, queryArgs),
    ...convexQueryCacheOptions,
  });
}

export function usePrivateChats(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.chat.listPrivateChats,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useMarkPrivateChatRead() {
  return useMutation(api.chat.markPrivateChatRead);
}

export function useSendChatMessage() {
  return useMutation(api.chat.sendMessage);
}

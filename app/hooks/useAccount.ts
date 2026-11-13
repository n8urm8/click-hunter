import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useAccountStatus(enabled: boolean = true) {
  return useQuery({
    ...convexQuery(api.accounts.getAccountStatus, enabled ? {} : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useBlockedPlayers(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.playerBlocks.listBlockedPlayers,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useBlockPlayer() {
  return useMutation(api.playerBlocks.blockPlayer);
}

export function useUnblockPlayer() {
  return useMutation(api.playerBlocks.unblockPlayer);
}

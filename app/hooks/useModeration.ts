import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

/** Mute and ban state of the account behind a character (admins only). */
export function usePlayerModeration(
  playerId: Id<"players"> | null | undefined,
  targetPlayerId: Id<"players"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.moderation.getPlayerModeration,
      playerId && targetPlayerId ? { playerId, targetPlayerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useModerationLog(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.moderation.listModerationLog,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useApplyModeration() {
  return useMutation(api.moderation.applyModeration);
}

export function useLiftModeration() {
  return useMutation(api.moderation.liftModeration);
}

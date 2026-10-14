import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useRankedConfig() {
  return useQuery({
    ...convexQuery(api.ranked.getRankedConfig, {}),
    ...convexQueryCacheOptions,
  });
}

export function useRankedStatus(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.ranked.getRankedStatus,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useRankedLeaderboard() {
  return useQuery({
    ...convexQuery(api.ranked.getRankedLeaderboard, { limit: 20 }),
    ...convexQueryCacheOptions,
  });
}

export function useRankedOpponents(
  playerId: Id<"players"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.ranked.findRankedOpponents,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useMyRankedBattles(
  playerId: Id<"players"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.ranked.getMyRankedBattles,
      playerId ? { playerId, limit: 10 } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useLastRankedSeason() {
  return useQuery({
    ...convexQuery(api.ranked.getLastRankedSeason, {}),
    ...convexQueryCacheOptions,
  });
}

export function useJoinRankedLeague() {
  return useMutation(api.ranked.joinRankedLeague);
}

export function useFightRankedBattle() {
  return useMutation(api.ranked.fightRankedBattle);
}

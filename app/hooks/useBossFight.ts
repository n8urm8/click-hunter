import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useBossRequirements(playerId: Id<"players"> | null, tier: number) {
  return useQuery({
    ...convexQuery(
      api.bossFights.getBossRequirements,
      playerId ? { playerId, tier } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useStartBossFight() {
  return useMutation(api.bossFights.startBossFight);
}

export function useStrikeBoss() {
  return useMutation(api.bossFights.strikeBoss);
}

export function useCheckBossFight() {
  return useMutation(api.bossFights.checkBossFight);
}

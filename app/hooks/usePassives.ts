import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convexQueryCacheOptions } from "../lib/queryCache";
import type { Id } from "../../convex/_generated/dataModel";

export function usePassiveTree(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.passiveTree.getTree,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useUnlockPassive() {
  return useMutation(api.passiveTree.unlockNode);
}

export function useSeedDefaultTree() {
  return useMutation(api.passiveTree.seedDefaultTree);
}

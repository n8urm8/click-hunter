import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useSkillPanel(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.skills.getSkillPanel,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useAugmentEquipment() {
  return useMutation(api.skills.augmentEquipment);
}

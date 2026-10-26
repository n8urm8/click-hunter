import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useAbilityPanel(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.abilityUi.getAbilityPanel,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useEquipAbility() {
  return useMutation(api.abilityUi.equipAbility);
}

export function useUnequipAbility() {
  return useMutation(api.abilityUi.unequipAbility);
}

export function useUseAbilityBook() {
  return useMutation(api.abilityUi.useAbilityBook);
}

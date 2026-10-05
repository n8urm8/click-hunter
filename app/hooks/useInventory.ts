import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function usePlayerInventory(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.items.getPlayerInventory,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useEquipItem() {
  return useMutation(api.items.equipItem);
}

export function useUnequipItem() {
  return useMutation(api.items.unequipItem);
}

export function useClaimPendingReward() {
  return useMutation(api.items.claimPendingReward);
}

export function useClaimAllPendingRewards() {
  return useMutation(api.items.claimAllPendingRewards);
}

export function useSkillBoost() {
  return useMutation(api.items.useSkillBoost);
}

export function useCombatBoost() {
  return useMutation(api.items.useCombatBoost);
}

export function useEnchantEquipment() {
  return useMutation(api.infusion.enchantEquipment);
}

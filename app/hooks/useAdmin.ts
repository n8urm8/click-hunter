import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useAdminConfig(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(api.admin.getConfig, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useAdminPlayers(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(api.admin.getPlayers, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useUpdatePlayer() {
  return useMutation(api.admin.updatePlayer);
}

export function useUpdateGameBalance() {
  return useMutation(api.admin.updateGameBalance);
}

export function useCreateTaskDefinition() {
  return useMutation(api.admin.createTaskDefinition);
}

export function useUpdateTaskDefinition() {
  return useMutation(api.admin.updateTaskDefinition);
}

export function useCreateSkillDefinition() {
  return useMutation(api.admin.createSkillDefinition);
}

export function useUpdateSkillDefinition() {
  return useMutation(api.admin.updateSkillDefinition);
}

export function useCreateSkillTierDefinition() {
  return useMutation(api.admin.createSkillTierDefinition);
}

export function useUpdateSkillTierDefinition() {
  return useMutation(api.admin.updateSkillTierDefinition);
}

export function useCreateGatheringActivity() {
  return useMutation(api.admin.createGatheringActivity);
}

export function useUpdateGatheringActivity() {
  return useMutation(api.admin.updateGatheringActivity);
}

export function useCreateRecipe() {
  return useMutation(api.admin.createRecipe);
}

export function useUpdateRecipe() {
  return useMutation(api.admin.updateRecipe);
}

export function useCreateAugmentationDefinition() {
  return useMutation(api.admin.createAugmentationDefinition);
}

export function useUpdateAugmentationDefinition() {
  return useMutation(api.admin.updateAugmentationDefinition);
}

export function useCreateLootTable() {
  return useMutation(api.admin.createLootTable);
}

export function useUpdateLootTable() {
  return useMutation(api.admin.updateLootTable);
}

export function useCreateLootTableEntry() {
  return useMutation(api.admin.createLootTableEntry);
}

export function useUpdateLootTableEntry() {
  return useMutation(api.admin.updateLootTableEntry);
}

export function useCreateLootSource() {
  return useMutation(api.admin.createLootSource);
}

export function useUpdateLootSource() {
  return useMutation(api.admin.updateLootSource);
}

export function useUpdateUpgrade() {
  return useMutation(api.admin.updateUpgrade);
}

export function useCreatePassiveNode() {
  return useMutation(api.admin.createPassiveNode);
}

export function useUpdatePassiveNode() {
  return useMutation(api.admin.updatePassiveNode);
}

export function useCreateItemRarity() {
  return useMutation(api.admin.createItemRarity);
}

export function useUpdateItemRarity() {
  return useMutation(api.admin.updateItemRarity);
}

export function useCreateItem() {
  return useMutation(api.admin.createItem);
}

export function useUpdateItem() {
  return useMutation(api.admin.updateItem);
}

export function useResetForestCrafting() {
  return useMutation(api.seed.resetForestCrafting);
}

export function useUpdateMonster() {
  return useMutation(api.admin.updateMonster);
}

export function useUpdateBoss() {
  return useMutation(api.admin.updateBoss);
}

export function useUpdateHiddenSpot() {
  return useMutation(api.admin.updateHiddenSpot);
}

export function useUpdateAchievement() {
  return useMutation(api.admin.updateAchievement);
}

export function useUpdateRebirthReward() {
  return useMutation(api.admin.updateRebirthReward);
}

export function useSaveEvent() {
  return useMutation(api.events.createEvent);
}

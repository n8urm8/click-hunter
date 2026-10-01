import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConvex, useMutation } from "convex/react";
import type {
  FunctionReference, FunctionReturnType, OptionalRestArgs,
} from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  adminSectionsForTables,
  type AdminConfigSection,
  type AdminConfigTable,
  type AdminSection,
} from "../../convex/adminConfig";

// These keys deliberately bypass ConvexQueryClient's live subscription adapter.
export const adminSnapshotKey = (
  playerId: Id<"players"> | null,
  section?: AdminSection
) => section
  ? ["adminSnapshot", playerId, section] as const
  : ["adminSnapshot", playerId] as const;

const snapshotOptions = {
  staleTime: Infinity,
  gcTime: 5 * 60 * 1_000,
  retry: false,
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useAdminConfig(
  playerId: Id<"players">,
  section: AdminConfigSection,
  enabled: boolean
) {
  const convex = useConvex();
  return useQuery({
    ...snapshotOptions,
    queryKey: adminSnapshotKey(playerId, section),
    queryFn: () => convex.query(api.admin.getConfig, { playerId, section }),
    enabled,
  });
}

export function useAdminPlayers(playerId: Id<"players">, enabled: boolean) {
  const convex = useConvex();
  return useQuery({
    ...snapshotOptions,
    queryKey: adminSnapshotKey(playerId, "players"),
    queryFn: () => convex.query(api.admin.getPlayers, { playerId }),
    enabled,
  });
}

function useAdminMutation<Mutation extends FunctionReference<"mutation">>(
  reference: Mutation,
  sections: readonly AdminSection[]
) {
  const mutate = useMutation(reference);
  const queryClient = useQueryClient();
  return useCallback(async (
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> => {
    const input: { playerId?: Id<"players">; adminPlayerId?: Id<"players"> } = args[0] ?? {};
    const playerId = input.adminPlayerId ?? input.playerId;
    if (!playerId) throw new Error("Admin mutation is missing its player ID");
    const result = await mutate(...args);
    // Disabled, kept-mounted tabs become stale without fetching. Refresh errors
    // stay on the query so a successful save is not reported as a failed write.
    await Promise.all(sections.map((section) =>
      queryClient.invalidateQueries({
        queryKey: adminSnapshotKey(playerId, section),
        refetchType: "active",
      })
    ));
    return result;
  }, [mutate, queryClient, sections]);
}

function useConfigMutation<Mutation extends FunctionReference<"mutation">>(
  reference: Mutation,
  tables: readonly AdminConfigTable[]
) {
  return useAdminMutation(reference, adminSectionsForTables(tables));
}

export function useUpdatePlayer() {
  return useAdminMutation(api.admin.updatePlayer, ["players"]);
}

export function useUpdateGameBalance() {
  return useConfigMutation(api.admin.updateGameBalance, ["gameBalance"]);
}

export function useCreateTaskDefinition() {
  return useConfigMutation(api.admin.createTaskDefinition, ["taskDefinitions"]);
}

export function useUpdateTaskDefinition() {
  return useConfigMutation(api.admin.updateTaskDefinition, ["taskDefinitions"]);
}

export function useCreateSkillDefinition() {
  return useConfigMutation(api.admin.createSkillDefinition, ["skillDefinitions"]);
}

export function useUpdateSkillDefinition() {
  return useConfigMutation(api.admin.updateSkillDefinition, ["skillDefinitions"]);
}

export function useCreateSkillTierDefinition() {
  return useConfigMutation(api.admin.createSkillTierDefinition, ["skillTierDefinitions"]);
}

export function useUpdateSkillTierDefinition() {
  return useConfigMutation(api.admin.updateSkillTierDefinition, ["skillTierDefinitions"]);
}

export function useCreateGatheringActivity() {
  return useConfigMutation(api.admin.createGatheringActivity, ["gatheringActivities"]);
}

export function useUpdateGatheringActivity() {
  return useConfigMutation(api.admin.updateGatheringActivity, ["gatheringActivities"]);
}

export function useCreateRecipe() {
  return useConfigMutation(api.admin.createRecipe, ["recipes", "recipeIngredients", "recipeOutputs"]);
}

export function useUpdateRecipe() {
  return useConfigMutation(api.admin.updateRecipe, ["recipes", "recipeIngredients", "recipeOutputs"]);
}

export function useCreateAugmentationDefinition() {
  return useConfigMutation(api.admin.createAugmentationDefinition, ["augmentationDefinitions"]);
}

export function useUpdateAugmentationDefinition() {
  return useConfigMutation(api.admin.updateAugmentationDefinition, ["augmentationDefinitions"]);
}

export function useCreateLootTable() {
  return useConfigMutation(api.admin.createLootTable, ["lootTables"]);
}

export function useUpdateLootTable() {
  return useConfigMutation(api.admin.updateLootTable, ["lootTables"]);
}

export function useCreateLootTableEntry() {
  return useConfigMutation(api.admin.createLootTableEntry, ["lootTableEntries"]);
}

export function useUpdateLootTableEntry() {
  return useConfigMutation(api.admin.updateLootTableEntry, ["lootTableEntries"]);
}

export function useCreateLootSource() {
  return useConfigMutation(api.admin.createLootSource, ["lootSources"]);
}

export function useUpdateLootSource() {
  return useConfigMutation(api.admin.updateLootSource, ["lootSources"]);
}

export function useUpdateUpgrade() {
  return useConfigMutation(api.admin.updateUpgrade, ["upgrades"]);
}

export function useCreatePassiveNode() {
  return useConfigMutation(api.admin.createPassiveNode, ["passiveNodes"]);
}

export function useUpdatePassiveNode() {
  return useConfigMutation(api.admin.updatePassiveNode, ["passiveNodes"]);
}

export function useSeedAdminPassiveTree() {
  return useConfigMutation(api.passiveTree.seedDefaultTree, ["passiveNodes", "gameBalance"]);
}

export function useCreateItemRarity() {
  return useConfigMutation(api.admin.createItemRarity, ["itemRarities"]);
}

export function useUpdateItemRarity() {
  return useConfigMutation(api.admin.updateItemRarity, ["itemRarities", "items"]);
}

export function useCreateItem() {
  return useConfigMutation(api.admin.createItem, ["items"]);
}

export function useUpdateItem() {
  return useConfigMutation(api.admin.updateItem, ["items"]);
}

export function useResetForestCrafting() {
  return useAdminMutation(api.seed.resetForestCrafting, [
    "players", "monsters", "items", "skills", "tree", "general",
  ]);
}

export function useUpdateMonster() {
  return useConfigMutation(api.admin.updateMonster, ["monsters"]);
}

export function useUpdateBoss() {
  return useConfigMutation(api.admin.updateBoss, ["bosses"]);
}

export function useUpdateHiddenSpot() {
  return useConfigMutation(api.admin.updateHiddenSpot, ["hiddenSpots"]);
}

export function useUpdateAchievement() {
  return useConfigMutation(api.admin.updateAchievement, ["achievements"]);
}

export function useUpdateRebirthReward() {
  return useConfigMutation(api.admin.updateRebirthReward, ["rebirthRewards"]);
}

export function useSaveEvent() {
  return useConfigMutation(api.events.createEvent, ["gameEvents"]);
}

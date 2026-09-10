import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useAdminConfig(playerId: Id<"players"> | null) {
  return useQuery(
    api.admin.getConfig,
    playerId ? { playerId } : "skip"
  );
}

export function useUpdateGameBalance() {
  return useMutation(api.admin.updateGameBalance);
}

export function useUpdateUpgrade() {
  return useMutation(api.admin.updateUpgrade);
}

export function useUpdateMonster() {
  return useMutation(api.admin.updateMonster);
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

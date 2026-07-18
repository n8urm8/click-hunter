import { useQuery, useMutation } from "@tanstack/react-query";
import { useMutation as useConvexMutation, useQuery as useConvexQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { calculateDerivedStats, calculatePlayerLevel, getAllStats } from "../lib/statCalculations";
import type { StatType } from "../lib/gameConfig";

/**
 * Hook to fetch player data with derived stats
 */
export function usePlayer(anonymousId: string | null) {
  const convexQuery = useConvexQuery(
    api.players.getPlayerByAnonymousId,
    anonymousId ? { anonymousId } : "skip"
  );

  // Include derived stats
  if (convexQuery && convexQuery.str !== undefined) {
    const derivedStats = calculateDerivedStats(
      convexQuery.str,
      convexQuery.dex,
      convexQuery.int,
      convexQuery.luk,
      convexQuery.con
    );
    const level = calculatePlayerLevel(
      convexQuery.str,
      convexQuery.dex,
      convexQuery.int,
      convexQuery.luk,
      convexQuery.con
    );

    return {
      ...convexQuery,
      ...derivedStats,
      level,
    };
  }

  return convexQuery;
}

/**
 * Hook for creating/getting player
 */
export function useCreatePlayer() {
  return useConvexMutation(api.players.getOrCreatePlayer);
}

/**
 * Hook for updating gold
 */
export function useUpdateGold() {
  return useConvexMutation(api.players.updateGold);
}

/**
 * Hook for adding experience
 */
export function useAddExperience() {
  return useConvexMutation(api.players.addExperience);
}

/**
 * Hook for increasing a stat
 */
export function useIncreaseStat() {
  return useConvexMutation(api.players.increaseStat);
}

/**
 * Hook for advancing tier progression
 */
export function useAdvanceTierProgression() {
  return useConvexMutation(api.players.advanceTierProgression);
}

/**
 * Hook for checking if can rebirth
 */
export function useCanRebirth(playerId: any) {
  return useConvexQuery(
    api.players.canRebirth,
    playerId ? { playerId } : "skip"
  );
}

/**
 * Hook for rebirth
 */
export function useRebirth() {
  return useConvexMutation(api.players.rebirth);
}

/**
 * Hook for setting auto attack
 */
export function useSetAutoAttack() {
  return useConvexMutation(api.players.setAutoAttack);
}

/**
 * Hook for setting auto start fight
 */
export function useSetAutoStartFight() {
  return useConvexMutation(api.players.setAutoStartFight);
}

/**
 * Hook for getting player upgrades
 */
export function usePlayerUpgrades(playerId: any) {
  return useConvexQuery(
    api.upgrades.getPlayerUpgrades,
    playerId ? { playerId } : "skip"
  );
}

/**
 * Hook for purchasing an upgrade
 */
export function usePurchaseUpgrade() {
  return useConvexMutation(api.upgrades.purchaseUpgrade);
}

/**
 * Hook for checking if player has upgrade
 */
export function useHasUpgrade(playerId: any, upgradeId: string) {
  return useConvexQuery(
    api.upgrades.hasUpgrade,
    playerId ? { playerId, upgradeId } : "skip"
  );
}

/**
 * Hook for recording a fight
 */
export function useRecordFight() {
  return useConvexMutation(api.upgrades.recordFight);
}

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation as useConvexMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convexQueryCacheOptions } from "../lib/queryCache";
import type { DerivedStats } from "../lib/statCalculations";
import type { Doc, Id } from "../../convex/_generated/dataModel";

export type PlayerWithDerivedStats = Doc<"players"> &
  DerivedStats & {
    level: number;
    critDamageMultiplier: number;
    attackSpeedMultiplier: number;
    damageType: "physical" | "magical";
  };

/**
 * Hook to fetch player data with derived stats
 */
export function usePlayer(anonymousId: string | null) {
  const playerQuery = useQuery({
    ...convexQuery(
      api.players.getPlayerByAnonymousId,
      anonymousId ? { anonymousId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });

  const player = playerQuery.data;
  const data: PlayerWithDerivedStats | null | undefined = player
    ? {
        ...player,
        ...player.effectiveStats,
        ...player.combatStats,
        autoAttackEnabled: true,
        level: player.characterLevel,
      }
    : player;

  return {
    ...playerQuery,
    data,
  };
}

/**
 * Hook for creating/getting player
 */
export function useCreatePlayer() {
  return useConvexMutation(api.players.getOrCreatePlayer);
}

/**
 * Hook for enforcing the server-side attack cooldown.
 */
export function useAttemptAttack() {
  return useConvexMutation(api.players.attemptAttack);
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
export function useCanRebirth(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.players.canRebirth,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

/**
 * Hook for rebirth
 */
export function useRebirth() {
  return useConvexMutation(api.players.rebirth);
}

/**
 * Hook for choosing a starter kit after rebirth.
 */
export function useChooseStarter() {
  return useConvexMutation(api.players.chooseStarter);
}

/**
 * Hook for setting auto start fight
 */
export function useSetAutoStartFight() {
  return useConvexMutation(api.players.setAutoStartFight);
}

/**
 * Hook for getting player upgrades (legacy hidden-spot/automation rows;
 * the NPC stat shop is removed — new unlocks live in the passive tree).
 */
export function usePlayerUpgrades(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.upgrades.getPlayerUpgrades,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

/**
 * Hook for checking if player has upgrade
 */
export function useHasUpgrade(
  playerId: Id<"players"> | null,
  upgradeId: string
) {
  return useQuery({
    ...convexQuery(
      api.upgrades.hasUpgrade,
      playerId ? { playerId, upgradeId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

/**
 * Hook for recording a fight
 */
export function useRecordFight() {
  return useConvexMutation(api.upgrades.recordFight);
}

/**
 * Hook for claiming hidden spot reward
 */
export function useClaimHiddenSpotReward() {
  return useConvexMutation(api.upgrades.claimHiddenSpotReward);
}

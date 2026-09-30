import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation as useConvexMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convexQueryCacheOptions } from "../lib/queryCache";
import {
  calculateCombatLevel,
  calculateDerivedStats,
} from "../lib/statCalculations";
import type { Doc, Id } from "../../convex/_generated/dataModel";

export type PlayerWithDerivedStats = Doc<"players"> &
  ReturnType<typeof calculateDerivedStats> & {
    level: number;
  };

type EquipmentStatBonuses = {
  str?: number;
  dex?: number;
  int?: number;
  luk?: number;
  con?: number;
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

  // Include derived stats (equipment + passive web bonuses, all modest/global)
  const player = playerQuery.data;
  let data: Doc<"players"> | PlayerWithDerivedStats | null | undefined = player;
  if (player && player.str !== undefined) {
    const equipmentStatBonuses =
      "equipmentStatBonuses" in player &&
      player.equipmentStatBonuses &&
      typeof player.equipmentStatBonuses === "object"
        ? (player.equipmentStatBonuses as EquipmentStatBonuses)
        : {};
    const passiveBonuses =
      "passiveBonuses" in player &&
      player.passiveBonuses &&
      typeof player.passiveBonuses === "object"
        ? (player.passiveBonuses as {
            stats?: EquipmentStatBonuses;
            damagePercent?: number;
            attackSpeedPercent?: number;
            defensePercent?: number;
            healthPercent?: number;
            critChance?: number;
          })
        : {};
    const passiveStats = passiveBonuses.stats ?? {};
    const effectiveStats = {
      str: player.str + (equipmentStatBonuses.str ?? 0) + (passiveStats.str ?? 0),
      dex: player.dex + (equipmentStatBonuses.dex ?? 0) + (passiveStats.dex ?? 0),
      int: player.int + (equipmentStatBonuses.int ?? 0) + (passiveStats.int ?? 0),
      luk: player.luk + (equipmentStatBonuses.luk ?? 0) + (passiveStats.luk ?? 0),
      con: player.con + (equipmentStatBonuses.con ?? 0) + (passiveStats.con ?? 0),
    };
    const baseDerived = calculateDerivedStats(
      effectiveStats.str,
      effectiveStats.dex,
      effectiveStats.int,
      effectiveStats.luk,
      effectiveStats.con
    );
    const damageMult = 1 + (passiveBonuses.damagePercent ?? 0);
    const speedMult = 1 + (passiveBonuses.attackSpeedPercent ?? 0);
    const defenseMult = 1 + (passiveBonuses.defensePercent ?? 0);
    const healthMult = 1 + (passiveBonuses.healthPercent ?? 0);
    const derivedStats = {
      health: Math.max(1, baseDerived.health * healthMult),
      attack: Math.max(1, baseDerived.attack * damageMult),
      defense: Math.max(0, baseDerived.defense * defenseMult),
      attackSpeed: Math.max(0.5, baseDerived.attackSpeed * speedMult),
      critChance: baseDerived.critChance + (passiveBonuses.critChance ?? 0) * 100,
    };
    // Server-computed character level (combat stats + all skill levels).
    // The fallback covers stale cached payloads from before characterLevel
    // existed, when only the combat portion could be derived client-side.
    const level =
      typeof player.characterLevel === "number"
        ? player.characterLevel
        : calculateCombatLevel(
            player.str,
            player.dex,
            player.int,
            player.luk,
            player.con
          );

    data = {
      ...player,
      ...effectiveStats,
      ...derivedStats,
      level,
    };
  }

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

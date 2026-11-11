import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation as useConvexMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convexQueryCacheOptions } from "../lib/queryCache";
import { useTaskClock } from "./useTaskClock";
import type { DerivedStats } from "../lib/statCalculations";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { projectCurrentHp } from "../../convex/hpProjection";

/** Gold and XP, read from `playerProgress` and merged in by `usePlayer`. */
export type PlayerWallet = Pick<
  Doc<"playerProgress">,
  "gold" | "totalExperience" | "statXp"
>;

export type PlayerWithDerivedStats = Doc<"players"> &
  PlayerWallet &
  DerivedStats & {
    level: number;
    critDamageMultiplier: number;
    attackSpeedMultiplier: number;
    damageType: "physical" | "magical";
    effectiveStats?: {
      str: number;
      dex: number;
      int: number;
      luk: number;
      con: number;
      wis?: number;
      agi?: number;
    };
  };

/**
 * Hook to fetch the caller's character with derived stats. Identity-derived
 * server-side; takes no ID. Pass "skip" behavior via `enabled`.
 *
 * Two queries feed one shape: the stable character (`getCurrentPlayer`) and
 * the wallet (`getPlayerWallet`, gold and XP). Settlements change only the
 * wallet, so the stats query doesn't re-run on every fight.
 */
export function usePlayer(enabled: boolean = true) {
  const playerQuery = useQuery({
    ...convexQuery(api.players.getCurrentPlayer, enabled ? {} : "skip"),
    ...convexQueryCacheOptions,
  });

  const player = playerQuery.data;
  const playerId = player?._id ?? null;
  const walletQuery = useQuery({
    ...convexQuery(
      api.players.getPlayerWallet,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
  const wallet = walletQuery.data;

  // Base stat levels (player.str, player.dex, ...) are the source of truth
  // for levels, breakpoints, and XP. Rebirth bonuses never change them —
  // they only scale `effectiveStats`, which combat math consumes. Do NOT
  // spread effectiveStats over the base fields.
  let data: PlayerWithDerivedStats | null | undefined;
  if (player && wallet) {
    data = {
      ...player,
      ...wallet,
      ...player.combatStats,
      autoAttackEnabled: true,
      level: player.characterLevel,
    };
  } else if (player === null) {
    data = null;
  }

  return {
    ...playerQuery,
    data,
    // The wallet is part of the character, so it counts toward loading and errors.
    isPending: playerQuery.isPending || (playerId !== null && walletQuery.isPending),
    isError: playerQuery.isError || walletQuery.isError,
    error: playerQuery.error ?? walletQuery.error,
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
 * Hook for getting upgrades a player has claimed from hidden spots.
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
 * Hook for the persistent HP bar (CON regen + boost regen included).
 *
 * Two queries feed one shape. `getHpStatus` holds the numbers that only move
 * with stats (max HP, regen rates) and doesn't re-run on fights. `getHpLive`
 * holds the stored HP and whether a fight is running, and it re-runs on each
 * settlement. Out-of-combat regen is projected here from the stored value, on
 * the synced task clock, so the bar moves without a timer-driven query.
 */
export function useHpStatus(playerId: Id<"players"> | null) {
  const statsQuery = useQuery({
    ...convexQuery(
      api.combat.getHpStatus,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
  const liveQuery = useQuery({
    ...convexQuery(
      api.combat.getHpLive,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
  const stats = statsQuery.data;
  const live = liveQuery.data;
  const regenerating = Boolean(
    stats &&
      live &&
      !live.inCombat &&
      live.storedHp !== null &&
      live.storedHp < stats.maxHp
  );
  const clockMs = useTaskClock(regenerating, 1_000);
  const data =
    stats && live
      ? {
          ...stats,
          currentHp: projectCurrentHp(stats, live, clockMs),
          inCombat: live.inCombat,
          asOf: clockMs,
        }
      : undefined;
  return {
    ...statsQuery,
    data,
    isPending: statsQuery.isPending || (playerId !== null && liveQuery.isPending),
    isError: statsQuery.isError || liveQuery.isError,
    error: statsQuery.error ?? liveQuery.error,
  };
}

/**
 * Hook for claiming hidden spot reward
 */
export function useClaimHiddenSpotReward() {
  return useConvexMutation(api.upgrades.claimHiddenSpotReward);
}

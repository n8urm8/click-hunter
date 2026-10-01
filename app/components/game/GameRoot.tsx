import { convexQuery } from "@convex-dev/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "~/lib/queryCache";
import { GameLayout } from "../layout/GameLayout";
import { PlayerGate } from "./PlayerGate";
import { TaskQueueManager } from "./TaskQueueManager";

function PlayerDataPrefetch({
  playerId,
  currentTier,
}: {
  playerId: Id<"players">;
  currentTier: number;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const prefetches: Array<{ label: string; promise: Promise<unknown> }> = [
      {
        label: "passive tree",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.passiveTree.getTree, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "owned upgrades",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.upgrades.getPlayerUpgrades, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "inventory",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.items.getPlayerInventory, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "rebirth eligibility",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.players.canRebirth, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "rebirth thresholds",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getGameBalance, {
            key: "rebirthThresholds",
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "experience leaderboard",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.leaderboards.getTopByExperience, { limit: 10 }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "tier leaderboard",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.leaderboards.getTopByTier, { limit: 10 }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "rebirth leaderboard",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.leaderboards.getTopByRebirth, { limit: 10 }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "monsters",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getAllMonsters, {}),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "game balance",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getAllGameBalance, {}),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "current-tier boss",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getScaledBoss, {
            tier: currentTier,
            playerId,
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "hidden spots",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getHiddenSpots, {}),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "active events",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.events.getActiveMultipliers, {}),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "task queue",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.tasks.getQueue, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "world chat",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.chat.listMessages, {
            playerId,
            channelType: "world",
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "private chats",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.chat.listPrivateChats, { playerId }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "achievements",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.achievements.getPlayerAchievements, {
            playerId,
          }),
          ...convexQueryCacheOptions,
        }),
      },
    ];

    void Promise.allSettled(prefetches.map(({ promise }) => promise)).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to prefetch ${prefetches[index].label}:`,
            result.reason
          );
        }
      });
    });
  }, [currentTier, playerId, queryClient]);

  return null;
}

export function GameRoot() {
  return (
    <PlayerGate>
      {(player) => (
        <>
          <PlayerDataPrefetch
            playerId={player._id}
            currentTier={player.currentTier}
          />
          <TaskQueueManager playerId={player._id} />
          <GameLayout player={player} />
        </>
      )}
    </PlayerGate>
  );
}

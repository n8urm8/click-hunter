import { convexQuery } from "@convex-dev/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Outlet, useOutletContext } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "~/lib/queryCache";
import { GameFrame } from "~/components/layout/GameFrame";
import { EventBanner } from "~/components/events/EventBanner";
import { ChatBox } from "~/components/game/ChatBox";
import { PlayerGate } from "~/components/game/PlayerGate";
import { TaskQueueManager } from "~/components/game/TaskQueueManager";
import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";

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
        label: "rebirth requirement",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getGameBalance, {
            key: "rebirthStatLevelRequirement",
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "rebirth bonus",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getGameBalance, {
            key: "rebirthStatBonusPercent",
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "rebirth skill bonus",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getGameBalance, {
            key: "rebirthSkillBonusPercent",
          }),
          ...convexQueryCacheOptions,
        }),
      },
      {
        label: "skill level speed",
        promise: queryClient.prefetchQuery({
          ...convexQuery(api.seed.getGameBalance, {
            key: "skillLevelSpeedBonusPerLevel",
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

export interface GameOutletContext {
  player: PlayerWithDerivedStats;
}

export function useGamePlayer(): PlayerWithDerivedStats {
  return useOutletContext<GameOutletContext>().player;
}

/**
 * Shared game shell: player gate, prefetching, task queue, navbar frame,
 * persistent event banner + chat, and an <Outlet /> for the active page
 * route (/combat, /skills, /tree, ...).
 */
export default function GameShell() {
  return (
    <PlayerGate>
      {(player) => (
        <>
          <PlayerDataPrefetch
            playerId={player._id}
            currentTier={player.currentTier}
          />
          <TaskQueueManager playerId={player._id} />
          <GameFrame player={player}>
            <EventBanner />
            <Outlet context={{ player } satisfies GameOutletContext} />
            <ChatBox player={player} />
          </GameFrame>
        </>
      )}
    </PlayerGate>
  );
}

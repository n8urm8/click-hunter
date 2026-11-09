import { Outlet, useOutletContext } from "react-router";
import { GameFrame } from "~/components/layout/GameFrame";
import { EventBanner } from "~/components/events/EventBanner";
import { ChatBox } from "~/components/game/ChatBox";
import { PlayerGate } from "~/components/game/PlayerGate";
import { TaskQueueManager } from "~/components/game/TaskQueueManager";
import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";

export interface GameOutletContext {
  player: PlayerWithDerivedStats;
}

export function useGamePlayer(): PlayerWithDerivedStats {
  return useOutletContext<GameOutletContext>().player;
}

/**
 * Shared game shell: player gate, task queue, navbar frame,
 * persistent event banner + chat, and an <Outlet /> for the active page
 * route (/combat, /skills, /tree, ...).
 */
export default function GameShell() {
  return (
    <PlayerGate>
      {(player) => (
        <>
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

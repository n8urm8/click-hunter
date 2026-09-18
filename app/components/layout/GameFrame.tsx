import type { ReactNode } from "react";
import type { ActivePanel } from "~/store/gameStore";
import { Fireflies } from "~/components/ui/fireflies";
import {
  GameNavbar,
  type GameNavbarPlayer,
} from "./GameNavbar";

interface GameFrameProps {
  player: GameNavbarPlayer;
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  children: ReactNode;
}

export function GameFrame({
  player,
  activePanel,
  onPanelChange,
  children,
}: GameFrameProps) {
  return (
    <div className="forest-bg relative min-h-screen">
      <Fireflies count={20} />
      <GameNavbar
        player={player}
        activePanel={activePanel}
        onPanelChange={onPanelChange}
      />

      <main className="relative z-10 mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4 p-3 sm:p-4">
        {children}
      </main>
    </div>
  );
}

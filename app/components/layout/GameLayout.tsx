import { useAtom } from "jotai";
import { activePanelAtom } from "~/store/gameStore";
import { AdminPanel } from "../admin/AdminPanel";
import { EventBanner } from "../events/EventBanner";
import { FightArea } from "../game/FightArea";
import { ChatBox } from "../game/ChatBox";
import { LeaderboardPanel } from "../leaderboard/LeaderboardPanel";
import { RebirthPanel } from "../player/RebirthPanel";
import { ShopScreen } from "../shop/ShopScreen";
import { GameFrame } from "./GameFrame";
import { InventoryPanel } from "../inventory/InventoryPanel";
import { SkillsPanel } from "../skills/SkillsPanel";

interface GameLayoutProps {
  player: any;
}

export function GameLayout({ player }: GameLayoutProps) {
  const [activePanel] = useAtom(activePanelAtom);
  const visiblePanel =
    activePanel === "admin" && player.role !== "admin" ? "combat" : activePanel;

  const renderActivePanel = () => {
    switch (visiblePanel) {
      case "combat":
        return <FightArea player={player} />;
      case "skills":
        return <SkillsPanel playerId={player._id} />;
      case "shop":
        return <ShopScreen player={player} />;
      case "inventory":
        return <InventoryPanel playerId={player._id} />;
      case "rebirth":
        return <RebirthPanel player={player} />;
      case "leaderboard":
        return <LeaderboardPanel />;
      case "admin":
        return <AdminPanel playerId={player._id} />;
      default:
        return <FightArea player={player} />;
    }
  };

  return (
    <GameFrame player={player}>
      <EventBanner />
      {renderActivePanel()}
      <ChatBox player={player} />
    </GameFrame>
  );
}

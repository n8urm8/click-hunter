import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useAtom } from "jotai";
import { activePanelAtom } from "~/store/gameStore";
import { PlayerHeader } from "../player/PlayerHeader";
import { FightArea } from "../game/FightArea";
import { StatsPanel } from "../player/StatsPanel";
import { ShopPanel } from "../shop/ShopPanel";
import { UpgradeList } from "../player/UpgradeList";
import { RebirthPanel } from "../player/RebirthPanel";
import { LeaderboardPanel } from "../leaderboard/LeaderboardPanel";
import { AdminPanel } from "../admin/AdminPanel";
import { EventBanner } from "../events/EventBanner";
import { Fireflies } from "~/components/ui/fireflies";
import { ChatBox } from "../game/ChatBox";

interface GameLayoutProps {
  player: any;
}

export function GameLayout({ player }: GameLayoutProps) {
  const [activePanel, setActivePanel] = useAtom(activePanelAtom);
  const isAdminPanel = activePanel === "admin" && player.role === "admin";
  const visiblePanel =
    activePanel === "admin" && player.role !== "admin" ? "stats" : activePanel;
  const handlePanelChange = (value: string) =>
    setActivePanel(
      value as
        | "stats"
        | "shop"
        | "upgrades"
        | "rebirth"
        | "leaderboard"
        | "admin"
    );

  const panelTabs = (
    <TabsList className="grid !h-auto min-h-10 w-full grid-cols-3 border border-forest-light/30 bg-forest-dark/80 lg:grid-cols-6">
      <TabsTrigger value="stats" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Stats</TabsTrigger>
      <TabsTrigger value="shop" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Shop</TabsTrigger>
      <TabsTrigger value="upgrades" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Owned</TabsTrigger>
      <TabsTrigger value="rebirth" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Rebirth</TabsTrigger>
      <TabsTrigger value="leaderboard" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Board</TabsTrigger>
      {player.role === "admin" && (
        <TabsTrigger value="admin" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Admin</TabsTrigger>
      )}
    </TabsList>
  );

  return (
    <div className="min-h-screen forest-bg relative p-4">
      <Fireflies count={20} />
      {isAdminPanel ? (
        <div className="relative z-10 mx-auto w-full max-w-[1800px]">
          <Tabs value={visiblePanel} onValueChange={handlePanelChange}>
            {panelTabs}
            <TabsContent value="admin" className="mt-6">
              <AdminPanel playerId={player._id} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <EventBanner />
            <PlayerHeader player={player} />
            <FightArea player={player} />
            <ChatBox player={player} />
          </div>

          <div>
            <Tabs value={visiblePanel} onValueChange={handlePanelChange}>
              {panelTabs}

              <TabsContent value="stats" className="mt-4">
                <StatsPanel player={player} />
              </TabsContent>

              <TabsContent value="shop" className="mt-4">
                <ShopPanel player={player} />
              </TabsContent>

              <TabsContent value="upgrades" className="mt-4">
                <UpgradeList playerId={player._id} />
              </TabsContent>

              <TabsContent value="rebirth" className="mt-4">
                <RebirthPanel player={player} />
              </TabsContent>

              <TabsContent value="leaderboard" className="mt-4">
                <LeaderboardPanel />
              </TabsContent>

              {player.role === "admin" && (
                <TabsContent value="admin" className="mt-4">
                  <AdminPanel playerId={player._id} />
                </TabsContent>
              )}
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

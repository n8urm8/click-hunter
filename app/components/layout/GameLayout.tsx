import { Card } from "~/components/ui/card";
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
import { EventBanner } from "../events/EventBanner";
import { Fireflies } from "~/components/ui/fireflies";
import { ThemeToggle } from "~/components/ui/theme-toggle";

interface GameLayoutProps {
  player: any;
}

export function GameLayout({ player }: GameLayoutProps) {
  const [activePanel, setActivePanel] = useAtom(activePanelAtom);

  return (
    <div className="min-h-screen forest-bg relative p-4">
      <Fireflies count={20} />
      {/* <ThemeToggle /> */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 relative z-10">
        {/* Left column: combat area */}
        <div className="lg:col-span-2 space-y-4">
          <EventBanner />
          <PlayerHeader player={player} />
          <FightArea player={player} />
        </div>

        {/* Right column: panels */}
        <div>
          <Tabs
            value={activePanel}
            onValueChange={(val) =>
              setActivePanel(val as "stats" | "shop" | "upgrades" | "rebirth" | "leaderboard")
            }
          >
            <TabsList className="w-full grid grid-cols-5 bg-forest-dark/80 border border-forest-light/30">
              <TabsTrigger value="stats" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Stats</TabsTrigger>
              <TabsTrigger value="shop" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Shop</TabsTrigger>
              <TabsTrigger value="upgrades" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Owned</TabsTrigger>
              <TabsTrigger value="rebirth" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Rebirth</TabsTrigger>
              <TabsTrigger value="leaderboard" className="data-[state=active]:bg-forest-mid data-[state=active]:text-gold-light">Board</TabsTrigger>
            </TabsList>

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
          </Tabs>
        </div>
      </div>
    </div>
  );
}

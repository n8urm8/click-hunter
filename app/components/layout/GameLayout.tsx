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

interface GameLayoutProps {
  player: any;
}

export function GameLayout({ player }: GameLayoutProps) {
  const [activePanel, setActivePanel] = useAtom(activePanelAtom);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: combat area */}
        <div className="lg:col-span-2 space-y-4">
          <PlayerHeader player={player} />
          <FightArea player={player} />
        </div>

        {/* Right column: panels */}
        <div>
          <Tabs
            value={activePanel}
            onValueChange={(val) =>
              setActivePanel(val as "stats" | "shop" | "upgrades" | "rebirth")
            }
          >
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="shop">Shop</TabsTrigger>
              <TabsTrigger value="upgrades">Owned</TabsTrigger>
              <TabsTrigger value="rebirth">Rebirth</TabsTrigger>
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
          </Tabs>
        </div>
      </div>
    </div>
  );
}

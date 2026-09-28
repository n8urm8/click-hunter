import { useState } from "react";
import { Card } from "~/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { BazaarPanel } from "./BazaarPanel";
import { ShopPanel } from "./ShopPanel";
import { formatGold } from "./bazaar/shared";

interface ShopScreenProps {
  player: any;
}

type ShopTab = "shop" | "bazaar";

const SHOP_TABS: Array<{ value: ShopTab; label: string }> = [
  { value: "shop", label: "Shop" },
  { value: "bazaar", label: "Bazaar" },
];

export function ShopScreen({ player }: ShopScreenProps) {
  const [tab, setTab] = useState<ShopTab>("shop");

  return (
    <Card className="forest-card gap-0 p-0">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (SHOP_TABS.some((entry) => entry.value === value)) {
            setTab(value as ShopTab);
          }
        }}
        className="gap-0"
      >
        <div className="flex min-h-8 items-center justify-between gap-3 overflow-x-auto overflow-y-hidden border-b border-forest-light/30 pr-3">
          <TabsList variant="forest" aria-label="Shop" className="min-w-max">
            {SHOP_TABS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <span
            className="shrink-0 text-xs font-semibold tabular-nums text-gold"
            aria-label="Your gold"
          >
            {formatGold(player.gold ?? 0)}
          </span>
        </div>
        <TabsContent value="shop" className="p-4 outline-none">
          <ShopPanel player={player} />
        </TabsContent>
        <TabsContent value="bazaar" className="p-4 outline-none">
          <BazaarPanel player={player} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

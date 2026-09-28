import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { BrowseOrders } from "./bazaar/BrowseOrders";
import { CreateBuyOrder } from "./bazaar/CreateBuyOrder";
import { MyOrders } from "./bazaar/MyOrders";
import { SellItems } from "./bazaar/SellItems";

interface BazaarPanelProps {
  player: any;
}

type BazaarView = "browse" | "sell" | "buy" | "orders";

const BAZAAR_VIEWS: Array<{ value: BazaarView; label: string }> = [
  { value: "browse", label: "Browse" },
  { value: "sell", label: "Sell" },
  { value: "buy", label: "Buy" },
  { value: "orders", label: "My Orders" },
];

export function BazaarPanel({ player }: BazaarPanelProps) {
  const [view, setView] = useState<BazaarView>("browse");

  return (
    <div className="space-y-3">
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (BAZAAR_VIEWS.some((entry) => entry.value === value)) {
            setView(value as BazaarView);
          }
        }}
        className="gap-4"
      >
        <div className="min-h-8 overflow-x-auto overflow-y-hidden border-b border-forest-light/30">
          <TabsList variant="forest" aria-label="Bazaar" className="min-w-max">
            {BAZAAR_VIEWS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="browse" className="outline-none">
          <BrowseOrders player={player} />
        </TabsContent>
        <TabsContent value="sell" className="outline-none">
          <SellItems player={player} />
        </TabsContent>
        <TabsContent value="buy" className="outline-none">
          <CreateBuyOrder player={player} />
        </TabsContent>
        <TabsContent value="orders" className="outline-none">
          <MyOrders player={player} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

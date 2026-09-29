import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { Card } from "~/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { GAME_PATHS, bazaarPath } from "~/lib/gameRoutes";
import { formatGold } from "./bazaar/shared";

interface ShopChromeProps {
  player: { gold?: number };
  children: ReactNode;
}

/**
 * Shared SHOP | BAZAAR tab chrome. The active tab is derived from the
 * route (/shop vs /shop/bazaar/*) so both are real page routes.
 */
export function ShopChrome({ player, children }: ShopChromeProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = location.pathname.startsWith("/shop/bazaar")
    ? "bazaar"
    : "shop";

  return (
    <Card className="forest-card gap-0 p-0">
      <Tabs
        value={active}
        onValueChange={(value) => {
          if (value === "shop") navigate(GAME_PATHS.shopStore);
          else if (value === "bazaar") navigate(bazaarPath("browse"));
        }}
        className="gap-0"
      >
        <div className="flex min-h-8 items-center justify-between gap-3 overflow-x-auto overflow-y-hidden border-b border-forest-light/30 pr-3">
          <TabsList variant="forest" aria-label="Shop" className="min-w-max">
            <TabsTrigger value="shop">Shop</TabsTrigger>
            <TabsTrigger value="bazaar">Bazaar</TabsTrigger>
          </TabsList>
          <span
            className="shrink-0 text-xs font-semibold tabular-nums text-gold"
            aria-label="Your gold"
          >
            {formatGold(player.gold ?? 0)}
          </span>
        </div>
        <div className="p-4">{children}</div>
      </Tabs>
    </Card>
  );
}

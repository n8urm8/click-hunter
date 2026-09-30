import { Navigate, useParams } from "react-router";
import { BazaarPanel } from "~/components/shop/BazaarPanel";
import { Card } from "~/components/ui/card";
import { GAME_PATHS, isBazaarView } from "~/lib/gameRoutes";
import { formatGold } from "~/components/shop/bazaar/shared";
import { useGamePlayer } from "./game";

/**
 * /bazaar/:view where view = browse | sell | buy | orders.
 * Browse filters live in the search params (see BrowseOrders) so every
 * marketplace filter combination is a shareable URL, e.g.
 * /bazaar/browse?side=sell&search=iron&category=crafting&rarity=2&sort=price_asc&min=10&max=500
 */
export default function BazaarPage() {
  const player = useGamePlayer();
  const params = useParams();
  const view = params.view ?? null;

  if (!isBazaarView(view)) {
    return <Navigate to={`${GAME_PATHS.bazaar}/browse`} replace />;
  }

  return (
    <Card className="forest-card gap-0 p-0">
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-forest-light/30 px-4 py-2">
        <h2 className="font-heading text-sm text-gold">Bazaar</h2>
        <span
          className="shrink-0 text-xs font-semibold tabular-nums text-gold"
          aria-label="Your gold"
        >
          {formatGold(player.gold ?? 0)}
        </span>
      </div>
      <div className="p-4">
        <BazaarPanel player={player} view={view} />
      </div>
    </Card>
  );
}

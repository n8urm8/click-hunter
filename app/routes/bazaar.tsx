import { Navigate, useParams } from "react-router";
import { BazaarPanel } from "~/components/shop/BazaarPanel";
import { ShopChrome } from "~/components/shop/ShopChrome";
import { GAME_PATHS, isBazaarView } from "~/lib/gameRoutes";
import { useGamePlayer } from "./game";

/**
 * /shop/bazaar/:view where view = browse | sell | buy | orders.
 * Browse filters live in the search params (see BrowseOrders) so every
 * marketplace filter combination is a shareable URL, e.g.
 * /shop/bazaar/browse?side=sell&search=iron&category=crafting&rarity=2&sort=price_asc&min=10&max=500
 */
export default function BazaarPage() {
  const player = useGamePlayer();
  const params = useParams();
  const view = params.view ?? null;

  if (!isBazaarView(view)) {
    return <Navigate to={`${GAME_PATHS.bazaar}/browse`} replace />;
  }

  return (
    <ShopChrome player={player}>
      <BazaarPanel player={player} view={view} />
    </ShopChrome>
  );
}

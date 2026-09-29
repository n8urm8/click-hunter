import { ShopPanel } from "~/components/shop/ShopPanel";
import { ShopChrome } from "~/components/shop/ShopChrome";
import { useGamePlayer } from "./game";

/** /shop — NPC store. Bazaar lives at /shop/bazaar/:view. */
export default function ShopStorePage() {
  const player = useGamePlayer();
  return (
    <ShopChrome player={player}>
      <ShopPanel player={player} />
    </ShopChrome>
  );
}

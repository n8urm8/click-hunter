import { Navigate, useParams } from "react-router";
import { InventoryPanel } from "~/components/inventory/InventoryPanel";
import { isInventoryTab } from "~/lib/gameRoutes";
import { useGamePlayer } from "./game";

/**
 * /inventory -> /inventory/crafting (canonical)
 * /inventory/:tab where tab = crafting | equipment
 */
export default function InventoryPage() {
  const player = useGamePlayer();
  const params = useParams();

  if (!params.tab) {
    return <Navigate to="/inventory/crafting" replace />;
  }
  if (!isInventoryTab(params.tab)) {
    return <Navigate to="/inventory/crafting" replace />;
  }
  return <InventoryPanel playerId={player._id} />;
}

import { PassiveTree } from "~/components/passives/PassiveTree";
import { useGamePlayer } from "./game";

export default function TreePage() {
  const player = useGamePlayer();
  return <PassiveTree playerId={player._id} isAdmin={player.role === "admin"} />;
}

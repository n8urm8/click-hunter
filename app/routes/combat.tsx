import { FightArea } from "~/components/game/FightArea";
import { useGamePlayer } from "./game";

export default function CombatPage() {
  const player = useGamePlayer();
  return <FightArea player={player} />;
}

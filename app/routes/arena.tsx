import { ArenaPanel } from "~/components/arena/ArenaPanel";
import { useGamePlayer } from "./game";

export default function ArenaPage() {
  const player = useGamePlayer();
  return <ArenaPanel player={player} />;
}

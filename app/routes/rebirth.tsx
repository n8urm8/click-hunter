import { RebirthPanel } from "~/components/player/RebirthPanel";
import { useGamePlayer } from "./game";

export default function RebirthPage() {
  const player = useGamePlayer();
  return <RebirthPanel player={player} />;
}

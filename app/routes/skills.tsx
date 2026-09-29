import { SkillsPanel } from "~/components/skills/SkillsPanel";
import { useGamePlayer } from "./game";

/**
 * /skills and /skills/:skillId
 * The selected skill lives in the path so each skill is a shareable route.
 */
export default function SkillsPage() {
  const player = useGamePlayer();
  return <SkillsPanel playerId={player._id} />;
}

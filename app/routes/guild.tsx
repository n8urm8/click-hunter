import { Navigate, useParams } from "react-router";
import { GuildPanel } from "~/components/guild/GuildPanel";
import { Card } from "~/components/ui/card";
import { GAME_PATHS, isGuildView } from "~/lib/gameRoutes";
import { useGamePlayer } from "./game";

/**
 * /guild/:view where view = hall | roster | bank | raids | objectives | browse | create.
 */
export default function GuildPage() {
  const player = useGamePlayer();
  const params = useParams();
  const view = params.view ?? null;

  if (!isGuildView(view)) {
    return <Navigate to={`${GAME_PATHS.guild}/hall`} replace />;
  }

  return (
    <Card className="forest-card gap-0 p-0">
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-forest-light/30 px-4 py-2">
        <h2 className="font-heading text-sm text-gold">Guild</h2>
      </div>
      <div className="p-4">
        <GuildPanel player={player} view={view} />
      </div>
    </Card>
  );
}

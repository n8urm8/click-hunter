import { Navigate } from "react-router";
import { GAME_PATHS } from "~/lib/gameRoutes";

/** Legacy root: every screen is now its own route; land on Combat. */
export default function Home() {
  return <Navigate to={GAME_PATHS.combat} replace />;
}

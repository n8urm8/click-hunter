import { AdminPanel } from "~/components/admin/AdminPanel";
import { useGamePlayer } from "./game";

/**
 * /admin?adminTab=players|monsters|items|skills|general
 * Tab state already lives in the search params (see AdminPanel).
 */
export default function AdminPage() {
  const player = useGamePlayer();
  if (player.role !== "admin") {
    return (
      <div className="forest-card p-4">
        <p className="text-sm text-blood-light" role="alert">
          Admin access required.
        </p>
      </div>
    );
  }
  return <AdminPanel playerId={player._id} />;
}

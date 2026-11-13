import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useBlockedPlayers, useUnblockPlayer } from "~/hooks/useAccount";
import { toErrorMessage } from "~/lib/errorMessage";
import type { Id } from "../../../convex/_generated/dataModel";

const MAX_BLOCKED_PLAYERS = 200;

/** Everyone this character has blocked in chat, with a way to unblock each. */
export function BlockedPlayersPanel({ playerId }: { playerId: Id<"players"> }) {
  const blocked = useBlockedPlayers(playerId);
  const unblock = useUnblockPlayer();
  const [pendingId, setPendingId] = useState<Id<"players"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnblock = async (targetPlayerId: Id<"players">) => {
    setError(null);
    setPendingId(targetPlayerId);
    try {
      await unblock({ playerId, targetPlayerId });
    } catch (unblockError) {
      setError(toErrorMessage(unblockError, "Could not unblock that player."));
    } finally {
      setPendingId(null);
    }
  };

  const rows = blocked.data ?? [];

  return (
    <section aria-labelledby="blocked-heading" className="forest-panel flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="blocked-heading" className="font-heading text-lg">
          Blocked players
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} of {MAX_BLOCKED_PLAYERS}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Their chat messages are hidden from you, and you cannot start private chats with each
        other. Block someone from their name in chat.
      </p>

      {blocked.isPending && <p className="text-sm text-muted-foreground">Loading blocked players...</p>}
      {blocked.isError && !blocked.data && (
        <p role="alert" className="text-sm text-blood-light">
          Unable to load blocked players.
        </p>
      )}
      {blocked.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">You have not blocked anyone.</p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-forest-light/25">
          {rows.map((row) => (
            <li key={row.playerId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-gold-light">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  Blocked {new Date(row.blockedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingId === row.playerId}
                onClick={() => void handleUnblock(row.playerId)}
                aria-label={`Unblock ${row.name}`}
              >
                {pendingId === row.playerId ? "Unblocking..." : "Unblock"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-blood-light">
          {error}
        </p>
      )}
    </section>
  );
}

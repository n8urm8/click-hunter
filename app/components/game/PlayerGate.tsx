import { useAtom } from "jotai";
import { useState, type ReactNode } from "react";
import { anonymousIdAtom } from "~/store/gameStore";
import {
  type PlayerWithDerivedStats,
  useCreatePlayer,
  usePlayer,
} from "~/hooks/usePlayer";
import { NameEntry } from "./NameEntry";
import { Card } from "../ui/card";

type Player = PlayerWithDerivedStats;

function hasDerivedStats(
  player: ReturnType<typeof usePlayer>["data"]
): player is Player {
  return (
    typeof player === "object" &&
    player !== null &&
    "level" in player &&
    typeof player.level === "number"
  );
}

interface PlayerGateProps {
  children: (player: Player) => ReactNode;
}

export function PlayerGate({ children }: PlayerGateProps) {
  const [anonymousId] = useAtom(anonymousIdAtom);
  const player = usePlayer(anonymousId);
  const createPlayer = useCreatePlayer();
  const [isCreating, setIsCreating] = useState(false);

  const handleNameSubmit = async (name: string) => {
    if (!anonymousId) return;

    setIsCreating(true);
    try {
      await createPlayer({ anonymousId, name });
      localStorage.setItem("clickHunter_playerName", name);
    } catch (error) {
      console.error("Failed to create player:", error);
    } finally {
      setIsCreating(false);
    }
  };

  if (player.isPending) {
    return (
      <Card className="forest-card mx-auto min-h-[240px] max-w-xl p-6">
        <div className="flex min-h-[180px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading your character...</p>
        </div>
      </Card>
    );
  }

  if (player.isError && !player.data) {
    return (
      <Card className="forest-card mx-auto min-h-[240px] max-w-xl p-6">
        <div className="flex min-h-[180px] items-center justify-center">
          <p className="text-sm text-blood-light" role="alert">
            Unable to load your character.
          </p>
        </div>
      </Card>
    );
  }

  if (!player.data) {
    return <NameEntry onSubmit={handleNameSubmit} isLoading={isCreating} />;
  }

  if (!hasDerivedStats(player.data)) {
    return (
      <Card className="forest-card mx-auto min-h-[240px] max-w-xl p-6">
        <div className="flex min-h-[180px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Preparing your character...</p>
        </div>
      </Card>
    );
  }

  return children(player.data);
}

import { useAtom } from "jotai";
import { useState, type ReactNode } from "react";
import { anonymousIdAtom } from "~/store/gameStore";
import {
  type PlayerWithDerivedStats,
  useChooseStarter,
  useCreatePlayer,
  usePlayer,
} from "~/hooks/usePlayer";
import { NameEntry } from "./NameEntry";
import { StarterPicker, type StarterId } from "./StarterPicker";
import { Button } from "../ui/button";
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
  const chooseStarter = useChooseStarter();
  const [isCreating, setIsCreating] = useState(false);
  const [starterId, setStarterId] = useState<StarterId>("sword");
  const [isChoosing, setIsChoosing] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  const handleNameSubmit = async (name: string, starter: StarterId) => {
    if (!anonymousId) return;

    setIsCreating(true);
    try {
      await createPlayer({ anonymousId, name, starterId: starter });
      localStorage.setItem("clickHunter_playerName", name);
    } catch (error) {
      console.error("Failed to create player:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStarterChoice = async () => {
    const playerId = player.data?._id;
    if (!playerId || isChoosing) return;
    setIsChoosing(true);
    setChoiceError(null);
    try {
      await chooseStarter({ playerId, starterId });
    } catch (error) {
      setChoiceError(
        error instanceof Error ? error.message : "Unable to choose starter."
      );
    } finally {
      setIsChoosing(false);
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

  if (player.data.pendingStarterPick) {
    return (
      <div className="min-h-screen flex items-center justify-center forest-bg relative p-4">
        <Card className="w-full max-w-xl forest-card box-glow-gold relative z-10">
          <div className="p-8 space-y-6">
            <div className="text-center">
              <h1 className="text-3xl font-heading text-gold glow-gold">A New Beginning</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Rebirth has wiped your stats clean. Choose the weapon for your next run.
              </p>
            </div>
            <StarterPicker value={starterId} onChange={setStarterId} disabled={isChoosing} />
            {choiceError && (
              <p role="alert" className="text-xs text-blood-light">{choiceError}</p>
            )}
            <Button
              type="button"
              disabled={isChoosing}
              onClick={() => void handleStarterChoice()}
              className="w-full bg-forest-mid hover:bg-forest-light text-gold-light border border-gold/20"
            >
              {isChoosing ? "Arming..." : "⚔ Begin Anew"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return children(player.data);
}

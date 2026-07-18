import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { anonymousIdAtom } from "~/store/gameStore";
import { usePlayer, useCreatePlayer } from "~/hooks/usePlayer";
import { NameEntry } from "./NameEntry";
import { GameLayout } from "../layout/GameLayout";

export function GameRoot() {
  const [anonymousId] = useAtom(anonymousIdAtom);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const player = usePlayer(anonymousId);
  const createPlayer = useCreatePlayer();
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("clickHunter_playerName");
      setPlayerName(stored);
    }
  }, []);

  const handleNameSubmit = async (name: string) => {
    if (!anonymousId) return;

    setIsCreating(true);
    try {
      await createPlayer({ anonymousId, name });
      localStorage.setItem("clickHunter_playerName", name);
      setPlayerName(name);
    } catch (error) {
      console.error("Failed to create player:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // Show name entry if no player exists
  if (!player) {
    return <NameEntry onSubmit={handleNameSubmit} isLoading={isCreating} />;
  }

  // Show game layout once player exists
  return <GameLayout player={player} />;
}

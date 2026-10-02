import { useAtom } from "jotai";
import {
  currentFightAtom,
  clickAnimationsAtom,
  inFightPhaseAtom,
  playerHpAtom,
  playerMaxHpAtom,
  respawnTimerAtom,
  eventTrackerAtom,
  type CurrentFight,
} from "~/store/gameStore";
import {
  useAdvanceTierProgression,
  type PlayerWithDerivedStats,
} from "~/hooks/usePlayer";
import { useStrikeBoss } from "~/hooks/useBossFight";
import { logInfo } from "~/lib/logger";
import { useEffect, useRef, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

interface AttackButtonProps {
  player: PlayerWithDerivedStats;
  respawnTimeMs?: number;
  onStartNextFight: (fightWasBoss: boolean) => boolean;
}

export function AttackButton({
  player,
  respawnTimeMs = 5000,
  onStartNextFight,
}: AttackButtonProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [floaters, setFloaters] = useAtom(clickAnimationsAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [playerHp, setPlayerHp] = useAtom(playerHpAtom);
  const [, setPlayerMaxHp] = useAtom(playerMaxHpAtom);
  const [, setRespawnTimer] = useAtom(respawnTimerAtom);
  const [isProcessingVictory, setIsProcessingVictory] = useState(false);
  const [attackError, setAttackError] = useState<string | null>(null);
  const victoryInProgressRef = useRef(false);
  const defeatInProgressRef = useRef(false);
  const attackInProgressRef = useRef(false);
  const handleAttackRef = useRef<() => Promise<number | null>>(async () => null);
  const currentFightRef = useRef(currentFight);
  const fightPhaseRef = useRef(fightPhase);
  const onStartNextFightRef = useRef(onStartNextFight);
  currentFightRef.current = currentFight;
  fightPhaseRef.current = fightPhase;
  onStartNextFightRef.current = onStartNextFight;
  const strikeBoss = useStrikeBoss();
  const advanceTierProgression = useAdvanceTierProgression();
  const hasActiveFight = Boolean(
    currentFight && currentFight.monsterHp > 0 && fightPhase === "fighting"
  );
  const attackInterval = Math.ceil(1000 / player.attackSpeed);

  const handleVictory = async (
    fight: CurrentFight,
    rewards: { gold: number; experience: number; loot: Array<{ itemName: string; quantity: number; pending: number }> }
  ) => {
    if (victoryInProgressRef.current) return;

    victoryInProgressRef.current = true;
    setIsProcessingVictory(true);
    setFightPhase("victory");

    try {
      // Rewards were already settled server-side by strikeBoss; this call
      // only advances tier progression (proof-gated on the recorded win).
      logInfo(
        `Victory! Earned ${rewards.gold} gold and ${rewards.experience} experience`
      );

      await advanceTierProgression({ playerId: player._id, tierJustBeaten: fight.monsterTier });

      // Update event tracker
      setEventTracker({
        type: "victory",
        reward: {
          gold: rewards.gold,
          exp: rewards.experience,
          loot: rewards.loot.map((drop) => ({
            itemName: drop.itemName,
            quantity: drop.quantity,
            pending: drop.pending,
          })),
        }
      });

      // Clear fight after 2 seconds to allow player to see victory message
      setTimeout(() => {
        const startedNextFight = onStartNextFightRef.current(fight.isBoss);

        if (startedNextFight) {
          setIsProcessingVictory(false);
          victoryInProgressRef.current = false;
          return;
        }

        setCurrentFight(null);
        setFightPhase("idle");
        setEventTracker({ type: "idle" });
        setIsProcessingVictory(false);
        victoryInProgressRef.current = false;
      }, 2000);
    } catch (error) {
      console.error("Failed to record victory:", error);
      setIsProcessingVictory(false);
      victoryInProgressRef.current = false;
    }
  };

  const handleDefeat = (fight: CurrentFight) => {
    // The loss was already recorded server-side by strikeBoss/checkBossFight.
    if (defeatInProgressRef.current) return;
    defeatInProgressRef.current = true;
    setFightPhase("defeat");
    setEventTracker({
      type: "defeat",
      monsterName: fight.monsterName,
    });
    setRespawnTimer(respawnTimeMs);
    setTimeout(() => {
      setCurrentFight(null);
      setEventTracker({ type: "idle" });
      defeatInProgressRef.current = false;
    }, 500);
  };

  const handleAttack = async () => {
    if (attackInProgressRef.current) return attackInterval;
    const fight = currentFightRef.current;
    if (
      !fight ||
      fight.monsterHp <= 0 ||
      fightPhaseRef.current !== "fighting" ||
      victoryInProgressRef.current ||
      defeatInProgressRef.current
    ) {
      return null;
    }
    if (!fight.sessionId) {
      setAttackError("Boss session missing. Restart the fight.");
      return attackInterval;
    }

    attackInProgressRef.current = true;

    try {
      // Server-authoritative strike: cooldown gate, damage roll, and the
      // win/loss verdict all come from convex/bossFights. The client only
      // renders the returned HP.
      const result = await strikeBoss({
        playerId: player._id,
        sessionId: fight.sessionId as Id<"bossSessions">,
      });
      setAttackError(null);
      if ("retryAfterMs" in result) return result.retryAfterMs;

      const activeFight = currentFightRef.current;
      if (
        !activeFight ||
        activeFight.settlementKey !== fight.settlementKey ||
        fightPhaseRef.current !== "fighting"
      ) {
        return null;
      }

      setCurrentFight({ ...activeFight, monsterHp: result.monsterHp });
      setPlayerHp(result.playerHp);
      setPlayerMaxHp(result.playerMaxHp);

      // Add floater animation for the server-rolled damage.
      const floaterId = `float_${Date.now()}_${Math.random()}`;
      setFloaters((prev) => [
        ...prev,
        {
          id: floaterId,
          damage: result.damage,
          x: 50,
          y: 50,
          timestamp: Date.now(),
        },
      ]);

      // Remove floater after animation
      setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== floaterId));
      }, 1000);

      if (result.status === "won" && result.rewards) {
        void handleVictory(
          { ...activeFight, monsterHp: result.monsterHp },
          {
            gold: result.rewards.gold,
            experience: result.rewards.experience,
            loot: result.rewards.loot.map((drop: { itemName: string; quantity: number; pending: number }) => ({
              itemName: drop.itemName,
              quantity: drop.quantity,
              pending: drop.pending,
            })),
          }
        );
      } else if (result.status === "lost") {
        handleDefeat(activeFight);
      }
      return attackInterval;
    } catch (error) {
      console.error("Failed to process attack:", error);
      setAttackError(error instanceof Error ? error.message : "Unable to attack. Retrying...");
      return attackInterval;
    } finally {
      attackInProgressRef.current = false;
    }
  };

  handleAttackRef.current = handleAttack;

  useEffect(() => {
    if (!hasActiveFight) return;
    let cancelled = false;
    let timer: number;
    const attack = async () => {
      const delay = await handleAttackRef.current();
      if (!cancelled && delay !== null) {
        timer = window.setTimeout(() => void attack(), delay);
      }
    };
    timer = window.setTimeout(() => void attack(), attackInterval);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasActiveFight, currentFight?.settlementKey, attackInterval]);

  return (
    <div className="flex flex-col gap-2 text-center">
      <p role="status" className="text-sm text-muted-foreground">
        {isProcessingVictory
          ? "Victory!"
          : hasActiveFight
            ? "Fighting"
            : "Waiting for battle"}
      </p>
      {attackError && <p role="alert" className="text-sm text-destructive">{attackError}</p>}
    </div>
  );
}

import { useAtom } from "jotai";
import {
  currentFightAtom,
  clickAnimationsAtom,
  inFightPhaseAtom,
  playerHpAtom,
  eventTrackerAtom,
  type CurrentFight,
} from "~/store/gameStore";
import { calculateDamage } from "~/lib/statCalculations";
import {
  useAttemptAttack,
  useRecordFight,
  useAdvanceTierProgression,
  type PlayerWithDerivedStats,
} from "~/hooks/usePlayer";
import { logInfo } from "~/lib/logger";
import { useEffect, useRef, useState } from "react";

interface AttackButtonProps {
  player: PlayerWithDerivedStats;
  onStartNextFight: (fightWasBoss: boolean) => boolean;
}

export function AttackButton({
  player,
  onStartNextFight,
}: AttackButtonProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [floaters, setFloaters] = useAtom(clickAnimationsAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const [isProcessingVictory, setIsProcessingVictory] = useState(false);
  const [attackError, setAttackError] = useState<string | null>(null);
  const victoryInProgressRef = useRef(false);
  const attackInProgressRef = useRef(false);
  const handleAttackRef = useRef<() => Promise<number | null>>(async () => null);
  const currentFightRef = useRef(currentFight);
  const fightPhaseRef = useRef(fightPhase);
  const onStartNextFightRef = useRef(onStartNextFight);
  currentFightRef.current = currentFight;
  fightPhaseRef.current = fightPhase;
  onStartNextFightRef.current = onStartNextFight;
  const attemptAttack = useAttemptAttack();
  const recordFight = useRecordFight();
  const advanceTierProgression = useAdvanceTierProgression();
  const hasActiveFight = Boolean(
    currentFight && currentFight.monsterHp > 0 && fightPhase === "fighting"
  );
  const attackInterval = Math.ceil(1000 / player.attackSpeed);

  const handleVictory = async (fight: CurrentFight) => {
    if (victoryInProgressRef.current) return;

    victoryInProgressRef.current = true;
    setIsProcessingVictory(true);
    setFightPhase("victory");

    try {
      // Server-authoritative rewards (passive tree multipliers applied
      // server-side in loot.ts). No client-calculated gold/XP is sent.
      const reward = await recordFight({
        playerId: player._id,
        monsterTier: fight.monsterTier,
        monsterType: fight.monsterType,
        isBoss: fight.isBoss,
        won: true,
        ...(fight.monsterZone === undefined
          ? {}
          : { monsterZone: fight.monsterZone }),
        settlementKey: fight.settlementKey,
      });

      logInfo(
        `Victory! Earned ${reward.goldEarned} gold and ${reward.experienceEarned} experience`
      );

      await advanceTierProgression({ playerId: player._id, tierJustBeaten: fight.monsterTier });

      // Update event tracker
      setEventTracker({ 
        type: "victory", 
        reward: {
          gold: reward.goldEarned,
          exp: reward.experienceEarned,
          loot: reward.loot.map((drop) => ({
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

  const handleAttack = async () => {
    if (attackInProgressRef.current) return attackInterval;
    const fight = currentFightRef.current;
    if (
      !fight ||
      fight.monsterHp <= 0 ||
      fightPhaseRef.current !== "fighting" ||
      victoryInProgressRef.current
    ) {
      return null;
    }

    attackInProgressRef.current = true;

    try {
      const result = await attemptAttack({ playerId: player._id });
      setAttackError(null);
      if (!result.allowed) return result.retryAfterMs;

      const activeFight = currentFightRef.current;
      if (
        !activeFight ||
        activeFight.settlementKey !== fight.settlementKey ||
        activeFight.monsterHp <= 0 ||
        fightPhaseRef.current !== "fighting"
      ) {
        return null;
      }

      // Calculate damage only after the server accepts the attack.
      const damage = calculateDamage(player.attack, player.critChance, player.critDamageMultiplier);
      const newMonsterHp = Math.max(0, activeFight.monsterHp - damage);
      const updatedFight = {
        ...activeFight,
        monsterHp: newMonsterHp,
      };

      setCurrentFight(updatedFight);

      // Add floater animation
      const floaterId = `float_${Date.now()}_${Math.random()}`;
      setFloaters((prev) => [
        ...prev,
        {
          id: floaterId,
          damage,
          x: 50,
          y: 50,
          timestamp: Date.now(),
        },
      ]);

      // Remove floater after animation
      setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== floaterId));
      }, 1000);

      // Check if monster is defeated
      if (newMonsterHp <= 0) {
        void handleVictory(updatedFight);
      }
      return result.retryAfterMs;
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

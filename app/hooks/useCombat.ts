import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  currentFightAtom,
  playerHpAtom,
  inFightPhaseAtom,
  respawnTimerAtom,
  eventTrackerAtom,
} from "~/store/gameStore";
import { useRecordFight } from "./usePlayer";
import { logInfo, logError } from "~/lib/logger";

/**
 * Hook to manage monster attacks, defeat handling, and respawn timing.
 */
export function useCombat(player: any) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [, setPlayerHp] = useAtom(playerHpAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setRespawnTimer] = useAtom(respawnTimerAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const recordFight = useRecordFight();
  const currentFightRef = useRef(currentFight);
  const fightPhaseRef = useRef(fightPhase);

  // Keep timer callbacks pointed at the latest fight state without restarting
  // the monster's attack schedule on every player hit.
  currentFightRef.current = currentFight;
  fightPhaseRef.current = fightPhase;

  // Monster attack interval - convert attackSpeed (attacks/sec) to interval in ms
  useEffect(() => {
    if (
      !currentFight ||
      fightPhase !== "fighting" ||
      currentFight.monsterHp <= 0
    ) {
      return;
    }

    // Convert attacks per second to milliseconds between attacks
    const interval = Math.max(500, 1000 / currentFight.monsterAttackSpeed);

    logInfo(`Monster attack interval: ${interval}ms (${currentFight.monsterAttackSpeed} attacks/sec)`);

    const timer = setInterval(() => {
      const fight = currentFightRef.current;
      if (!fight || fightPhaseRef.current !== "fighting" || fight.monsterHp <= 0) {
        clearInterval(timer);
        return;
      }

      // Monster damage comes from its tier-scaled attack stat.
      const baseDamage = Math.max(
        1,
        Math.ceil(fight.monsterAttack ?? fight.monsterTier * 3)
      );
      const variance = Math.floor(Math.random() * (baseDamage / 2));
      const damage = baseDamage + variance;

      setPlayerHp((prev) => {
        const newHp = Math.max(0, prev - damage);

        logInfo(`Player took ${damage} damage. HP: ${prev} -> ${newHp}`);

        if (newHp <= 0) {
          setFightPhase("defeat");
          handleDefeat();
        }

        return newHp;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [
    currentFight?.monsterAttackSpeed,
    currentFight?.monsterTier,
    fightPhase,
    setPlayerHp,
    setFightPhase,
  ]);

  const handleDefeat = async () => {
    if (!currentFight) return;

    try {
      // Record loss
      await recordFight({
        playerId: player._id,
        monsterTier: currentFight.monsterTier,
        monsterType: currentFight.monsterType,
        won: false,
        goldEarned: 0,
        experienceEarned: 0,
      });

      logInfo(`Fight lost against tier ${currentFight.monsterTier} monster`);

      // Set defeat event tracker
      setEventTracker({
        type: "defeat",
        monsterName: `Tier ${currentFight.monsterTier} Monster`,
      });

      // Start respawn timer (5 seconds)
      const RESPAWN_TIME = 5000; // milliseconds
      setRespawnTimer(RESPAWN_TIME);

      // Clear fight after recording
      setTimeout(() => {
        setCurrentFight(null);
        setEventTracker({ type: "idle" });
      }, 500);
    } catch (error) {
      logError("Failed to record defeat", error as Error);
    }
  };

}

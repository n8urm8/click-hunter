import { useEffect } from "react";
import { useAtom } from "jotai";
import {
  currentFightAtom,
  playerHpAtom,
  inFightPhaseAtom,
  clickAnimationsAtom,
} from "~/store/gameStore";
import { useRecordFight } from "./usePlayer";
import { logInfo, logError } from "~/lib/logger";

/**
 * Hook to manage combat loop: monster attacks, auto-attack, etc.
 */
export function useCombat(
  player: any,
  autoAttackEnabled: boolean,
  autoStartFightEnabled: boolean
) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [playerHp, setPlayerHp] = useAtom(playerHpAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setFloaters] = useAtom(clickAnimationsAtom);
  const recordFight = useRecordFight();

  // Monster attack interval - convert attackSpeed (attacks/sec) to interval in ms
  useEffect(() => {
    if (!currentFight || fightPhase !== "fighting") return;

    // Convert attacks per second to milliseconds between attacks
    const interval = Math.max(500, 1000 / currentFight.monsterAttackSpeed);

    logInfo(`Monster attack interval: ${interval}ms (${currentFight.monsterAttackSpeed} attacks/sec)`);

    const timer = setInterval(() => {
      // Monster does damage - base on tier
      const baseDamage = Math.max(1, currentFight.monsterTier * 3);
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
  }, [currentFight, fightPhase, setPlayerHp, setFightPhase]);

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
    } catch (error) {
      logError("Failed to record defeat", error as Error);
    }
  };

  // Auto-attack logic
  useEffect(() => {
    if (!currentFight || !autoAttackEnabled || fightPhase !== "fighting")
      return;

    const attackInterval = 1000 / Math.max(0.5, player.attackSpeed);

    logInfo(`Auto-attack enabled (${player.attackSpeed} attacks/sec)`);

    // TODO: Wire this to trigger actual attacks on interval

    return () => {};
  }, [currentFight, autoAttackEnabled, fightPhase, player.attackSpeed]);
}

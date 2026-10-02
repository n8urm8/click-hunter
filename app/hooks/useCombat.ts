import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  currentFightAtom,
  playerHpAtom,
  inFightPhaseAtom,
  respawnTimerAtom,
  eventTrackerAtom,
} from "~/store/gameStore";
import { useCheckBossFight } from "./useBossFight";
import { logInfo, logError } from "~/lib/logger";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Hook to manage monster attacks, defeat handling, and respawn timing.
 */
export function useCombat(player: any, respawnTimeMs: number) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [, setPlayerHp] = useAtom(playerHpAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setRespawnTimer] = useAtom(respawnTimerAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const checkBossFight = useCheckBossFight();
  const currentFightRef = useRef(currentFight);
  const fightPhaseRef = useRef(fightPhase);
  const respawnTimeRef = useRef(respawnTimeMs);
  const defeatInProgressRef = useRef(false);

  // Keep timer callbacks pointed at the latest fight state without restarting
  // the monster's attack schedule on every player hit.
  currentFightRef.current = currentFight;
  fightPhaseRef.current = fightPhase;
  respawnTimeRef.current = respawnTimeMs;

  // Monster pressure poll: the server applies time-based monster damage and
  // declares defeat. The client only renders the returned HP — it never
  // decides death locally, so stalling clicks can't dodge a lethal monster.
  useEffect(() => {
    if (
      !currentFight ||
      !currentFight.sessionId ||
      fightPhase !== "fighting"
    ) {
      return;
    }
    const sessionId = currentFight.sessionId;

    const timer = setInterval(() => {
      const fight = currentFightRef.current;
      if (
        !fight ||
        fight.sessionId !== sessionId ||
        fightPhaseRef.current !== "fighting" ||
        defeatInProgressRef.current
      ) {
        return;
      }

      void (async () => {
        try {
          const state = await checkBossFight({
            playerId: player._id,
            sessionId: sessionId as Id<"bossSessions">,
          });
          if (
            !currentFightRef.current ||
            currentFightRef.current.sessionId !== sessionId ||
            fightPhaseRef.current !== "fighting"
          ) {
            return;
          }
          if (state.changed) {
            setPlayerHp(state.playerHp);
          }
          if (state.status === "lost") {
            handleDefeat();
          }
        } catch (error) {
          logError("Failed to sync boss fight", error as Error);
        }
      })();
    }, 1000);

    return () => clearInterval(timer);
  }, [
    currentFight?.sessionId,
    fightPhase,
    setPlayerHp,
    setFightPhase,
  ]);

  const handleDefeat = async () => {
    if (!currentFight || defeatInProgressRef.current) return;
    defeatInProgressRef.current = true;

    try {
      // The loss was already recorded server-side by strikeBoss/checkBossFight.
      logInfo(`Fight lost against tier ${currentFight.monsterTier} monster`);

      // Set defeat event tracker
      setEventTracker({
        type: "defeat",
        monsterName: currentFight.monsterName,
      });

      setRespawnTimer(respawnTimeRef.current);

      // Clear fight after recording
      setTimeout(() => {
        setCurrentFight(null);
        setEventTracker({ type: "idle" });
        defeatInProgressRef.current = false;
      }, 500);
    } catch (error) {
      logError("Failed to record defeat", error as Error);
      defeatInProgressRef.current = false;
    }
  };

}

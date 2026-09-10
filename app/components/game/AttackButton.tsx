import { Button } from "~/components/ui/button";
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
} from "~/hooks/usePlayer";
import { logInfo } from "~/lib/logger";
import { useEffect, useRef, useState } from "react";

interface AttackButtonProps {
  player: any;
}

export function AttackButton({ player }: AttackButtonProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [floaters, setFloaters] = useAtom(clickAnimationsAtom);
  const [fightPhase, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const [isProcessingVictory, setIsProcessingVictory] = useState(false);
  const [isAttackPending, setIsAttackPending] = useState(false);
  const [isAttackOnCooldown, setIsAttackOnCooldown] = useState(false);
  const victoryInProgressRef = useRef(false);
  const attackInProgressRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);
  const handleAttackRef = useRef<() => Promise<void>>(async () => {});
  const currentFightRef = useRef(currentFight);
  const fightPhaseRef = useRef(fightPhase);
  currentFightRef.current = currentFight;
  fightPhaseRef.current = fightPhase;
  const attemptAttack = useAttemptAttack();
  const recordFight = useRecordFight();
  const advanceTierProgression = useAdvanceTierProgression();
  const hasActiveFight = Boolean(
    currentFight && currentFight.monsterHp > 0 && fightPhase === "fighting"
  );
  const isAutoAttackEnabled = Boolean(player.autoAttackEnabled);
  const playerAttackSpeed = Math.max(0.5, player.attackSpeed || 0.5);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const startAttackCooldown = (delayMs: number) => {
    if (cooldownTimerRef.current !== null) {
      window.clearTimeout(cooldownTimerRef.current);
    }

    const safeDelayMs = Math.max(0, delayMs);
    if (safeDelayMs === 0) {
      setIsAttackOnCooldown(false);
      cooldownTimerRef.current = null;
      return;
    }

    setIsAttackOnCooldown(true);
    cooldownTimerRef.current = window.setTimeout(() => {
      cooldownTimerRef.current = null;
      setIsAttackOnCooldown(false);
    }, safeDelayMs);
  };

  const handleVictory = async (fight: CurrentFight) => {
    if (victoryInProgressRef.current) return;

    victoryInProgressRef.current = true;
    setIsProcessingVictory(true);
    setFightPhase("victory");

    // Calculate rewards based on tier
    const baseGold = (fight.monsterTier * 100) + Math.floor(Math.random() * 50);
    const baseExp = (fight.monsterTier * 50) + Math.floor(Math.random() * 25);

    try {
      // Record fight in database
      const reward = await recordFight({
        playerId: player._id,
        monsterTier: fight.monsterTier,
        monsterType: fight.monsterType,
        won: true,
        goldEarned: baseGold,
        experienceEarned: baseExp,
      });

      logInfo(
        `Victory! Earned ${reward.goldEarned} gold and ${reward.experienceEarned} experience`
      );

      await advanceTierProgression({ playerId: player._id, tierJustBeaten: fight.monsterTier });

      // Update event tracker
      setEventTracker({ 
        type: "victory", 
        reward: { gold: reward.goldEarned, exp: reward.experienceEarned }
      });

      // Clear fight after 2 seconds to allow player to see victory message
      setTimeout(() => {
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
    const fight = currentFightRef.current;
    if (
      !fight ||
      fight.monsterHp <= 0 ||
      fightPhaseRef.current !== "fighting" ||
      attackInProgressRef.current ||
      isAttackOnCooldown ||
      victoryInProgressRef.current
    ) {
      return;
    }

    attackInProgressRef.current = true;
    setIsAttackPending(true);

    try {
      const result = await attemptAttack({ playerId: player._id });
      startAttackCooldown(result.retryAfterMs);

      if (!result.allowed) return;

      const activeFight = currentFightRef.current;
      if (
        !activeFight ||
        activeFight.monsterHp <= 0 ||
        fightPhaseRef.current !== "fighting"
      ) {
        return;
      }

      // Calculate damage only after the server accepts the attack.
      const damage = calculateDamage(player.attack, player.critChance);
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
    } catch (error) {
      console.error("Failed to process attack:", error);
    } finally {
      attackInProgressRef.current = false;
      setIsAttackPending(false);
    }
  };

  handleAttackRef.current = handleAttack;

  useEffect(() => {
    if (!player.autoAttackEnabled || !hasActiveFight) return;

    const attackInterval = Math.ceil(1000 / playerAttackSpeed);
    void handleAttackRef.current();
    const timer = window.setInterval(() => {
      void handleAttackRef.current();
    }, attackInterval);

    return () => window.clearInterval(timer);
  }, [hasActiveFight, player.autoAttackEnabled, playerAttackSpeed]);

  return (
    <Button
      onClick={handleAttack}
      size="lg"
      disabled={
        isAutoAttackEnabled ||
        !currentFight ||
        currentFight.monsterHp <= 0 ||
        isProcessingVictory ||
        isAttackPending ||
        isAttackOnCooldown
      }
      className="w-full bg-blood hover:bg-blood-light text-gold-light text-xl py-8 border border-blood-light/30 box-glow-red disabled:bg-forest-dark/50 disabled:text-muted-foreground disabled:border-forest-light/10 disabled:shadow-none"
    >
      {isAutoAttackEnabled
        ? "Auto Attacking"
        : isProcessingVictory
          ? "✨ Victory!"
          : isAttackPending
            ? "⏳ Striking..."
            : isAttackOnCooldown
              ? "⏱️ Attack cooldown"
              : "⚔️ ATTACK!"}
    </Button>
  );
}

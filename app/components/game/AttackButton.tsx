import { Button } from "~/components/ui/button";
import { useAtom } from "jotai";
import { currentFightAtom, clickAnimationsAtom, inFightPhaseAtom, playerHpAtom, eventTrackerAtom } from "~/store/gameStore";
import { calculateDamage } from "~/lib/statCalculations";
import { useRecordFight, useAddExperience, useUpdateGold, useAdvanceTierProgression } from "~/hooks/usePlayer";
import { logInfo } from "~/lib/logger";
import { useState } from "react";

interface AttackButtonProps {
  player: any;
}

export function AttackButton({ player }: AttackButtonProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [floaters, setFloaters] = useAtom(clickAnimationsAtom);
  const [, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const [isProcessingVictory, setIsProcessingVictory] = useState(false);
  const recordFight = useRecordFight();
  const addExperience = useAddExperience();
  const updateGold = useUpdateGold();
  const advanceTierProgression = useAdvanceTierProgression();

  const handleVictory = async () => {
    if (!currentFight) return;

    setIsProcessingVictory(true);

    // Calculate rewards based on tier
    const baseGold = (currentFight.monsterTier * 100) + Math.floor(Math.random() * 50);
    const baseExp = (currentFight.monsterTier * 50) + Math.floor(Math.random() * 25);

    try {
      logInfo(`Victory! Earned ${baseGold} gold and ${baseExp} experience`);

      // Record fight in database
      await recordFight({
        playerId: player._id,
        monsterTier: currentFight.monsterTier,
        monsterType: currentFight.monsterType,
        won: true,
        goldEarned: baseGold,
        experienceEarned: baseExp,
      });

      // Update player stats
      await updateGold({ playerId: player._id, delta: baseGold });
      await addExperience({ playerId: player._id, amount: baseExp });
      await advanceTierProgression({ playerId: player._id, tierJustBeaten: currentFight.monsterTier });

      // Update event tracker
      setEventTracker({ 
        type: "victory", 
        reward: { gold: baseGold, exp: baseExp } 
      });

      // End fight
      setFightPhase("victory");

      // Clear fight after 2 seconds to allow player to see victory message
      setTimeout(() => {
        setCurrentFight(null);
        setFightPhase("idle");
        setEventTracker({ type: "idle" });
        setIsProcessingVictory(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to record victory:", error);
      setIsProcessingVictory(false);
    }
  };

  const handleAttack = () => {
    if (!currentFight) return;

    // Calculate damage
    const damage = calculateDamage(player.attack, player.critChance);

    // Update monster HP
    const newMonsterHp = Math.max(0, currentFight.monsterHp - damage);

    setCurrentFight({
      ...currentFight,
      monsterHp: newMonsterHp,
    });

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
      handleVictory();
    }
  };

  return (
    <Button
      onClick={handleAttack}
      size="lg"
      disabled={!currentFight || currentFight.monsterHp <= 0 || isProcessingVictory}
      className="w-full bg-blood hover:bg-blood-light text-gold-light text-xl py-8 border border-blood-light/30 btn-enchanted box-glow-red disabled:bg-forest-dark/50 disabled:text-muted-foreground disabled:border-forest-light/10 disabled:shadow-none"
    >
      {isProcessingVictory ? "✨ Victory!" : "⚔️ ATTACK!"}
    </Button>
  );
}

import { Button } from "~/components/ui/button";
import { useAtom } from "jotai";
import { currentFightAtom, clickAnimationsAtom, inFightPhaseAtom, playerHpAtom } from "~/store/gameStore";
import { calculateDamage } from "~/lib/statCalculations";
import { useRecordFight, useAddExperience, useUpdateGold, useAdvanceTierProgression } from "~/hooks/usePlayer";
import { logInfo } from "~/lib/logger";

interface AttackButtonProps {
  player: any;
}

export function AttackButton({ player }: AttackButtonProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [floaters, setFloaters] = useAtom(clickAnimationsAtom);
  const [, setFightPhase] = useAtom(inFightPhaseAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const recordFight = useRecordFight();
  const addExperience = useAddExperience();
  const updateGold = useUpdateGold();
  const advanceTierProgression = useAdvanceTierProgression();

  const handleVictory = async () => {
    if (!currentFight) return;

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
      await advanceTierProgression({ playerId: player._id });

      // End fight
      setFightPhase("victory");
    } catch (error) {
      console.error("Failed to record victory:", error);
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
      className="w-full bg-red-600 hover:bg-red-700 text-white text-xl py-8"
    >
      ⚔️ ATTACK!
    </Button>
  );
}

import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useAtom } from "jotai";
import { currentFightAtom, playerHpAtom, playerMaxHpAtom, inFightPhaseAtom } from "~/store/gameStore";
import { getMonstersForTier, MONSTERS } from "~/lib/gameConfig";
import { calculateDerivedStats } from "~/lib/statCalculations";
import { ActiveFight } from "./ActiveFight";
import { useState } from "react";

interface FightAreaProps {
  player: any;
}

export function FightArea({ player }: FightAreaProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [, setPlayerHp] = useAtom(playerHpAtom);
  const [, setPlayerMaxHp] = useAtom(playerMaxHpAtom);
  const [, setFightPhase] = useAtom(inFightPhaseAtom);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartFight = async () => {
    setIsStarting(true);

    // Pick next monster based on currentTierProgression
    const monstersInTier = getMonstersForTier(player.currentTier);
    const monsterType = monstersInTier[player.currentTierProgression];

    if (monsterType) {
      const monsterDef = (MONSTERS as any)[monsterType];
      const monsterStats = calculateDerivedStats(
        monsterDef.baseStats.str,
        monsterDef.baseStats.dex,
        monsterDef.baseStats.int,
        monsterDef.baseStats.luk,
        monsterDef.baseStats.con
      );

      // Initialize fight
      const fight = {
        monsterTier: player.currentTier,
        monsterType,
        monsterHp: monsterStats.health,
        monsterMaxHp: monsterStats.health,
        monsterAttackSpeed: monsterStats.attackSpeed,
      };

      setCurrentFight(fight);
      setPlayerHp(player.health);
      setPlayerMaxHp(player.health);
      setFightPhase("fighting");
    }

    setIsStarting(false);
  };

  if (currentFight) {
    return <ActiveFight player={player} />;
  }

  return (
    <Card className="bg-slate-800 border-slate-700 p-6">
      <div className="flex flex-col items-center justify-center space-y-4 py-12">
        <div className="text-center">
          <p className="text-slate-400 mb-2">Ready for combat?</p>
          <p className="text-sm text-slate-500">
            Tier {player.currentTier} • Monster {player.currentTierProgression + 1}
            /3
          </p>
        </div>
        <Button
          size="lg"
          onClick={handleStartFight}
          disabled={isStarting}
          className="bg-amber-700 hover:bg-amber-800 text-white text-lg px-8"
        >
          {isStarting ? "Starting..." : "Start Fight"}
        </Button>
      </div>
    </Card>
  );
}

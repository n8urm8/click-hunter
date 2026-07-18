import { Card } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { useAtom } from "jotai";
import { currentFightAtom, clickAnimationsAtom, playerHpAtom } from "~/store/gameStore";
import { MONSTERS } from "~/lib/gameConfig";
import { AttackButton } from "./AttackButton";
import { DamageFloater } from "./DamageFloater";
import { HiddenSpots } from "./HiddenSpots";
import { useCombat } from "~/hooks/useCombat";
import { useRef } from "react";

interface ActiveFightProps {
  player: any;
}

export function ActiveFight({ player }: ActiveFightProps) {
  const [currentFight] = useAtom(currentFightAtom);
  const [floaters] = useAtom(clickAnimationsAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  // Enable combat loop
  useCombat(player, player.autoAttackEnabled, player.autoStartFightEnabled);

  if (!currentFight) return null;

  const monsterDef = (MONSTERS as any)[currentFight.monsterType];
  const monsterHpPercent =
    (currentFight.monsterHp / currentFight.monsterMaxHp) * 100;
  const playerHpPercent = (playerHp / player.health) * 100;

  return (
    <Card ref={containerRef} className="bg-slate-800 border-slate-700 p-6 relative overflow-hidden min-h-[400px]">
      {/* Hidden spots for discovery */}
      <HiddenSpots containerRef={containerRef} player={player} />

      {/* Damage floaters */}
      <div className="absolute inset-0 pointer-events-none">
        {floaters.map((floater) => (
          <DamageFloater key={floater.id} floater={floater} />
        ))}
      </div>

      <div className="space-y-6">
        {/* Monster Info */}
        <div className="bg-slate-700 rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-bold text-red-400">{monsterDef.name}</h3>
            <span className="text-sm text-slate-400">
              Tier {currentFight.monsterTier}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">Health</span>
              <span className="font-semibold">
                {currentFight.monsterHp} / {currentFight.monsterMaxHp}
              </span>
            </div>
            <Progress value={monsterHpPercent} className="h-3" />
          </div>
        </div>

        {/* Player HP */}
        <div className="bg-slate-700 rounded p-4">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-slate-300">Your Health</span>
            <span className="font-semibold text-green-400">
              {playerHp} / {player.health}
            </span>
          </div>
          <Progress value={playerHpPercent} className="h-3" />
        </div>

        {/* Attack Button */}
        <AttackButton player={player} />
      </div>
    </Card>
  );
}

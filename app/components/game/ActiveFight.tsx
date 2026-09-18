import { Card } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { useAtom } from "jotai";
import { currentFightAtom, clickAnimationsAtom, playerHpAtom } from "~/store/gameStore";
import { AttackButton } from "./AttackButton";
import { DamageFloater } from "./DamageFloater";
import { HiddenSpots } from "./HiddenSpots";
import { AutomationControls } from "./AutomationControls";
import { useCombat } from "~/hooks/useCombat";
import { useRef } from "react";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { convexQueryCacheOptions } from "~/lib/queryCache";

interface ActiveFightProps {
  player: any;
  respawnTimeMs: number;
  onStartNextFight: (fightWasBoss: boolean) => boolean;
}

export function ActiveFight({
  player,
  respawnTimeMs,
  onStartNextFight,
}: ActiveFightProps) {
  const [currentFight] = useAtom(currentFightAtom);
  const [floaters] = useAtom(clickAnimationsAtom);
  const [playerHp] = useAtom(playerHpAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const monstersQuery = useQuery({
    ...convexQuery(api.seed.getAllMonsters, {}),
    ...convexQueryCacheOptions,
  });
  const monsters = monstersQuery.data;

  // Enable combat loop
  useCombat(player, respawnTimeMs);

  if (!currentFight) return null;

  const monsterName =
    currentFight.monsterName ??
    monsters?.find((m) => m.type === currentFight.monsterType)?.name ??
    currentFight.monsterType;
  const monsterHpPercent =
    (currentFight.monsterHp / currentFight.monsterMaxHp) * 100;
  const playerHpPercent = (playerHp / player.health) * 100;

  return (
    <Card ref={containerRef} className="forest-card box-glow-red p-6 relative overflow-hidden min-h-[400px]">
      {/* Hidden spots for discovery */}
      <HiddenSpots containerRef={containerRef} player={player} />

      <div className="space-y-6">
        {/* Monster Info */}
        <div className="forest-panel p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-heading text-blood-light glow-red">{monsterName}</h3>
              {currentFight.isBoss && (
                <span className="rounded border border-gold/40 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-gold">
                  Boss
                </span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              Tier {currentFight.monsterTier}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/70">Health</span>
              <span className="font-semibold">
                {currentFight.monsterHp} / {currentFight.monsterMaxHp}
              </span>
            </div>
            <div className="relative">
              <Progress value={monsterHpPercent} className="h-3 hp-bar-monster" />
              <div className="absolute inset-0 pointer-events-none">
                {floaters.map((floater) => (
                  <DamageFloater key={floater.id} floater={floater} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Player HP */}
        <div className="forest-panel p-4">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-foreground/70">Your Health</span>
            <span className="font-semibold text-forest-glow glow-green">
              {playerHp} / {player.health}
            </span>
          </div>
          <Progress value={playerHpPercent} className="h-3 hp-bar-player" />
        </div>

        {/* Attack Button */}
        <AttackButton
          player={player}
          onStartNextFight={onStartNextFight}
        />
        <AutomationControls player={player} />
      </div>
    </Card>
  );
}

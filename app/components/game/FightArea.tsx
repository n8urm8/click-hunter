import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useAtom } from "jotai";
import { currentFightAtom, playerHpAtom, playerMaxHpAtom, inFightPhaseAtom, eventTrackerAtom, respawnTimerAtom } from "~/store/gameStore";
import { calculateDerivedStats } from "~/lib/statCalculations";
import { ActiveFight } from "./ActiveFight";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface FightAreaProps {
  player: any;
}

export function FightArea({ player }: FightAreaProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [, setPlayerHp] = useAtom(playerHpAtom);
  const [, setPlayerMaxHp] = useAtom(playerMaxHpAtom);
  const [, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [respawnTimer] = useAtom(respawnTimerAtom);
  const [selectedTier, setSelectedTier] = useState(player.currentTier);
  const [isStarting, setIsStarting] = useState(false);

  const monsters = useQuery(api.seed.getAllMonsters);
  const balanceRows = useQuery(api.seed.getAllGameBalance);

  // Build a lookup from balance key -> value
  const balance = Object.fromEntries(
    (balanceRows ?? []).map((b) => [b.key, b.value])
  );
  const maxTier = (balance.maxTier as number) ?? 20;
  const tierMultiplier = (balance.tierScaleMultiplier as number) ?? 1.15;
  const tierMsReduction = (balance.tierScaleMsReduction as number) ?? 50;
  const minAttackMs = (balance.minAttackMs as number) ?? 800;

  const handleStartFight = async () => {
    if (!monsters || monsters.length === 0) return;
    setIsStarting(true);

    // Weighted random selection — weaker monsters appear more often
    const maxStrength = Math.max(...monsters.map((m) => m.strength));
    const weights = monsters.map((m) => maxStrength - m.strength + 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let baseMonster = monsters[monsters.length - 1];
    for (let i = 0; i < monsters.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { baseMonster = monsters[i]; break; }
    }

    // Exponential tier scaling
    const mult = Math.pow(tierMultiplier, selectedTier - 1);
    const scaledMonster = {
      ...baseMonster,
      str: Math.round(baseMonster.str * mult),
      dex: Math.round(baseMonster.dex * mult),
      int: Math.round(baseMonster.int * mult),
      luk: Math.round(baseMonster.luk * mult),
      con: Math.round(baseMonster.con * mult),
      baseMsPerAttack: Math.max(
        minAttackMs,
        baseMonster.baseMsPerAttack - (selectedTier - 1) * tierMsReduction
      ),
    };

    const monsterStats = calculateDerivedStats(
      scaledMonster.str,
      scaledMonster.dex,
      scaledMonster.int,
      scaledMonster.luk,
      scaledMonster.con
    );

    const fight = {
      monsterTier: selectedTier,
      monsterType: baseMonster.type,
      monsterHp: monsterStats.health,
      monsterMaxHp: monsterStats.health,
      monsterAttackSpeed: monsterStats.attackSpeed,
    };

    setCurrentFight(fight);
    setPlayerHp(player.health);
    setPlayerMaxHp(player.health);
    setFightPhase("fighting");
    setEventTracker({
      type: "fighting",
      monsterName: baseMonster.name,
      tier: selectedTier,
    });

    setIsStarting(false);
  };

  if (currentFight) {
    return <ActiveFight player={player} />;
  }

  const isRespawning = respawnTimer > 0;
  const respawnSeconds = Math.ceil(respawnTimer / 1000);

  return (
    <Card className="forest-card box-glow-green p-6">
      <div className="flex flex-col items-center justify-center space-y-4 py-12">
        <div className="text-center">
          {isRespawning ? (
            <>
              <p className="text-gold font-heading text-lg glow-gold mb-2">Recovering...</p>
              <p className="text-3xl font-bold text-gold-light glow-gold mb-2">{respawnSeconds}s</p>
              <p className="text-sm text-muted-foreground">The forest grants you time to heal your wounds.</p>
            </>
          ) : (
            <>
              <p className="text-forest-glow/70 mb-2 font-heading text-lg">Choose your tier</p>
              <p className="text-sm text-muted-foreground mb-4">
                Max tier reached: {player.maxTierReached || 1}
              </p>
            </>
          )}
        </div>

        {!isRespawning && (
          <>
            {/* Tier Selection Buttons */}
            <div className="grid grid-cols-6 gap-2 w-full max-w-sm">
              {Array.from({ length: Math.min(12, maxTier) }, (_, i) => i + 1).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  disabled={isStarting}
                  className={`py-1 px-2 rounded text-xs font-heading transition-colors ${
                    selectedTier === tier
                      ? "bg-gold/30 text-gold-light border border-gold glow-gold"
                      : "bg-forest-dark/50 text-foreground/60 border border-forest-light/20 hover:border-forest-light/40 hover:text-foreground/80"
                  } disabled:opacity-50`}
                >
                  T{tier}
                </button>
              ))}
            </div>
          </>
        )}

        <Button
          size="lg"
          onClick={handleStartFight}
          disabled={isStarting || isRespawning || !monsters || monsters.length === 0}
          className="bg-forest-mid hover:bg-forest-light text-gold-light text-lg px-8 border border-gold/20 btn-enchanted disabled:bg-forest-dark/50 disabled:text-muted-foreground disabled:border-forest-light/10"
        >
          {isRespawning ? `Recovering (${respawnSeconds}s)` : isStarting ? "Venturing forth..." : "⚔ Enter the Wilds"}
        </Button>
      </div>
    </Card>
  );
}

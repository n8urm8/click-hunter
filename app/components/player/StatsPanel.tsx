import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { calculateDerivedStats } from "~/lib/statCalculations";

interface PlayerHeaderProps {
  player: any;
}

export function StatsPanel({ player }: PlayerHeaderProps) {
  const derived = calculateDerivedStats(
    player.str,
    player.dex,
    player.int,
    player.luk,
    player.con
  );

  const stats = [
    { name: "Strength", abbr: "STR", value: player.str },
    { name: "Dexterity", abbr: "DEX", value: player.dex },
    { name: "Intelligence", abbr: "INT", value: player.int },
    { name: "Luck", abbr: "LUK", value: player.luk },
    { name: "Constitution", abbr: "CON", value: player.con },
  ];

  return (
    <Card className="forest-card p-4 space-y-4">
      <div>
        <h3 className="font-heading text-gold glow-gold mb-3">Base Stats</h3>
        <div className="space-y-2">
          {stats.map((stat) => (
            <div
              key={stat.abbr}
              className="flex items-center justify-between text-sm forest-panel p-2"
            >
              <span className="text-foreground/70">{stat.name}</span>
              <span className="font-bold text-gold">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-forest-light/20 pt-4">
        <h3 className="font-heading text-forest-glow glow-green mb-3">Derived Stats</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm forest-panel p-2">
            <span className="text-foreground/70">Health</span>
            <span className="font-bold text-forest-glow">{derived.health}</span>
          </div>
          <div className="flex items-center justify-between text-sm forest-panel p-2">
            <span className="text-foreground/70">Attack Damage</span>
            <span className="font-bold text-blood-light">
              {Math.floor(derived.attack)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm forest-panel p-2">
            <span className="text-foreground/70">Defense</span>
            <span className="font-bold text-potion-blue">
              {Math.floor(derived.defense)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm forest-panel p-2">
            <span className="text-foreground/70">Attack Speed</span>
            <span className="font-bold text-mystic-glow">
              {derived.attackSpeed.toFixed(2)} / sec
            </span>
          </div>
          <div className="flex items-center justify-between text-sm forest-panel p-2">
            <span className="text-foreground/70">Crit Chance</span>
            <span className="font-bold text-gold-light">
              {derived.critChance.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-forest-light/20 pt-4">
        <h3 className="font-heading text-potion-blue glow-blue mb-3">Progression</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/70">Total Experience</span>
            <span className="font-bold">{player.totalExperience}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/70">Current Tier</span>
            <Badge className="bg-forest-mid text-gold-light border border-gold/20">{player.currentTier}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/70">Rebirth Count</span>
            <span className="font-bold text-mystic-glow glow-purple">{player.rebirthCount}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

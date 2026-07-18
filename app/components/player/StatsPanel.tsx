import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { MONSTERS, getMonstersForTier } from "~/lib/gameConfig";
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
    <Card className="bg-slate-800 border-slate-700 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-amber-400 mb-3">Base Stats</h3>
        <div className="space-y-2">
          {stats.map((stat) => (
            <div
              key={stat.abbr}
              className="flex items-center justify-between text-sm bg-slate-700 rounded p-2"
            >
              <span className="text-slate-300">{stat.name}</span>
              <span className="font-bold text-amber-400">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <h3 className="font-semibold text-green-400 mb-3">Derived Stats</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm bg-slate-700 rounded p-2">
            <span className="text-slate-300">Health</span>
            <span className="font-bold text-green-400">{derived.health}</span>
          </div>
          <div className="flex items-center justify-between text-sm bg-slate-700 rounded p-2">
            <span className="text-slate-300">Attack Damage</span>
            <span className="font-bold text-red-400">
              {Math.floor(derived.attack)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm bg-slate-700 rounded p-2">
            <span className="text-slate-300">Defense</span>
            <span className="font-bold text-blue-400">
              {Math.floor(derived.defense)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm bg-slate-700 rounded p-2">
            <span className="text-slate-300">Attack Speed</span>
            <span className="font-bold text-purple-400">
              {derived.attackSpeed.toFixed(2)} / sec
            </span>
          </div>
          <div className="flex items-center justify-between text-sm bg-slate-700 rounded p-2">
            <span className="text-slate-300">Crit Chance</span>
            <span className="font-bold text-yellow-400">
              {derived.critChance.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <h3 className="font-semibold text-cyan-400 mb-3">Progression</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Total Experience</span>
            <span className="font-bold">{player.totalExperience}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Current Tier</span>
            <Badge className="bg-amber-700">{player.currentTier}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Rebirth Count</span>
            <span className="font-bold text-purple-400">{player.rebirthCount}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

import { Card } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { Badge } from "~/components/ui/badge";
import { formatNumber } from "~/lib/utils";

interface PlayerHeaderProps {
  player: any;
}

export function PlayerHeader({ player }: PlayerHeaderProps) {
  return (
    <Card className="bg-slate-800 border-slate-700 p-4">
      <div className="space-y-4">
        {/* Name and Level */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-amber-400">{player.name}</h2>
            <p className="text-sm text-slate-400">
              Level {player.level} • Tier {player.currentTier} - Monster{" "}
              {player.currentTierProgression + 1}/3
            </p>
          </div>
          {player.rebirthCount > 0 && (
            <Badge variant="secondary" className="bg-purple-900 text-purple-100">
              Rebirths: {player.rebirthCount}
            </Badge>
          )}
        </div>

        {/* Gold */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300">Gold</span>
          <span className="font-semibold text-yellow-400">
            {formatNumber(player.gold)}
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "STR", value: player.str },
            { label: "DEX", value: player.dex },
            { label: "INT", value: player.int },
            { label: "LUK", value: player.luk },
            { label: "CON", value: player.con },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-700 rounded p-2 text-center"
            >
              <div className="text-xs text-slate-400">{stat.label}</div>
              <div className="text-lg font-bold text-amber-400">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Derived Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-700 rounded p-2">
            <span className="text-slate-400">Health</span>
            <div className="font-semibold text-green-400">{player.health}</div>
          </div>
          <div className="bg-slate-700 rounded p-2">
            <span className="text-slate-400">Attack</span>
            <div className="font-semibold text-red-400">
              {Math.floor(player.attack)}
            </div>
          </div>
          <div className="bg-slate-700 rounded p-2">
            <span className="text-slate-400">Defense</span>
            <div className="font-semibold text-blue-400">
              {Math.floor(player.defense)}
            </div>
          </div>
          <div className="bg-slate-700 rounded p-2">
            <span className="text-slate-400">Attack Speed</span>
            <div className="font-semibold text-purple-400">
              {player.attackSpeed.toFixed(2)}/s
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

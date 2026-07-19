import { Card } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { Badge } from "~/components/ui/badge";
import { formatNumber } from "~/lib/utils";
import { EventTracker } from "./EventTracker";

interface PlayerHeaderProps {
  player: any;
}

export function PlayerHeader({ player }: PlayerHeaderProps) {
  return (
    <Card className="forest-card box-glow-gold p-4">
      <div className="space-y-4">
        {/* Name, Level, and Event Tracker */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-heading text-gold glow-gold">{player.name}</h2>
            <p className="text-sm text-muted-foreground">
              Level {player.level} • Tier {player.currentTier} • Max {player.maxTierReached || 1}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <EventTracker />
            {player.rebirthCount > 0 && (
              <Badge variant="secondary" className="bg-mystic/20 text-mystic-glow border border-mystic/30">
                ✨ Rebirths: {player.rebirthCount}
              </Badge>
            )}
          </div>
        </div>

        {/* Gold */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/70">Gold</span>
          <span className="font-semibold text-gold-light glow-gold">
            ✧ {formatNumber(player.gold)}
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
              className="forest-panel p-2 text-center"
            >
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-lg font-bold text-gold">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Derived Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="forest-panel p-2">
            <span className="text-muted-foreground">Health</span>
            <div className="font-semibold text-forest-glow glow-green">{player.health}</div>
          </div>
          <div className="forest-panel p-2">
            <span className="text-muted-foreground">Attack</span>
            <div className="font-semibold text-blood-light glow-red">
              {Math.floor(player.attack)}
            </div>
          </div>
          <div className="forest-panel p-2">
            <span className="text-muted-foreground">Defense</span>
            <div className="font-semibold text-potion-blue glow-blue">
              {Math.floor(player.defense)}
            </div>
          </div>
          <div className="forest-panel p-2">
            <span className="text-muted-foreground">Attack Speed</span>
            <div className="font-semibold text-mystic-glow glow-purple">
              {player.attackSpeed.toFixed(2)}/s
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

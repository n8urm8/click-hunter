import { cn, formatNumber } from "~/lib/utils";
import type { DerivedStats } from "~/lib/statCalculations";

export interface PlayerSummaryStats extends DerivedStats {
  gold: number;
  level: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
  totalExperience: number;
  currentTier: number;
  maxTierReached?: number;
  rebirthCount: number;
}

interface PlayerStatsSummaryProps {
  player: PlayerSummaryStats;
  layout?: "inline" | "menu";
  className?: string;
}

export function PlayerStatsSummary({
  player,
  layout = "menu",
  className,
}: PlayerStatsSummaryProps) {
  const groups = [
    {
      label: "Attributes",
      stats: [
        { label: "Strength", shortLabel: "STR", value: player.str },
        { label: "Dexterity", shortLabel: "DEX", value: player.dex },
        { label: "Intelligence", shortLabel: "INT", value: player.int },
        { label: "Luck", shortLabel: "LUK", value: player.luk },
        { label: "Constitution", shortLabel: "CON", value: player.con },
      ],
    },
    {
      label: "Combat",
      stats: [
        { label: "Health", shortLabel: "HP", value: player.health },
        {
          label: "Attack",
          shortLabel: "ATK",
          value: Math.floor(player.attack),
        },
        {
          label: "Defense",
          shortLabel: "DEF",
          value: Math.floor(player.defense),
        },
        {
          label: "Attack speed",
          shortLabel: "AS",
          value: `${player.attackSpeed.toFixed(2)}/s`,
        },
        {
          label: "Crit chance",
          shortLabel: "Crit",
          value: `${player.critChance.toFixed(1)}%`,
        },
      ],
    },
    {
      label: "Progression",
      stats: [
        { label: "Level", shortLabel: "Lv", value: player.level },
        { label: "Tier", shortLabel: "Tier", value: player.currentTier },
        {
          label: "Best tier",
          shortLabel: "Best",
          value: player.maxTierReached ?? 1,
        },
        {
          label: "Experience",
          shortLabel: "XP",
          value: player.totalExperience,
        },
        {
          label: "Rebirths",
          shortLabel: "RB",
          value: player.rebirthCount,
        },
      ],
    },
    {
      label: "Resources",
      stats: [{ label: "Gold", shortLabel: "Gold", value: player.gold }],
    },
  ];

  return (
    <section
      aria-label="Character stats"
      className={cn("player-stats", `player-stats--${layout}`, className)}
    >
      {groups.map((group) => (
        <div
          key={group.label}
          className={cn(
            "player-stats-group",
            group.label === "Resources" && "player-stats-group--resources"
          )}
        >
          {layout === "menu" && (
            <h3 className="player-stats-heading">{group.label}</h3>
          )}
          <dl aria-label={group.label}>
            {group.stats.map((stat) => {
              const exactValue =
                typeof stat.value === "number"
                  ? stat.value.toLocaleString()
                  : stat.value;

              return (
                <div key={stat.label} className="player-stat">
                  <dt title={stat.label} aria-label={stat.label}>
                    {layout === "inline" || group.label === "Attributes"
                      ? stat.shortLabel
                      : stat.label}
                  </dt>
                  <dd title={`${stat.label}: ${exactValue}`}>
                    {layout === "inline" && typeof stat.value === "number"
                      ? formatNumber(stat.value)
                      : exactValue}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </section>
  );
}

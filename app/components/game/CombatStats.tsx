import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";

type CombatStatsPlayer = Pick<
  PlayerWithDerivedStats,
  "health" | "attack" | "defense" | "attackSpeed" | "critChance" | "critDamageMultiplier"
>;

export function CombatStats({ player }: { player: CombatStatsPlayer }) {
  const stats = [
    { label: "Max health", value: player.health.toLocaleString() },
    { label: "Attack", value: player.attack.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { label: "Defense", value: player.defense.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { label: "Attack speed", value: `${player.attackSpeed.toFixed(2)}/s` },
    { label: "Crit chance", value: `${player.critChance.toFixed(1)}%` },
    { label: "Crit damage", value: `${player.critDamageMultiplier.toFixed(2)}x` },
  ];

  return (
    <dl aria-label="Equipped combat stats" className="combat-stats">
      {stats.map(({ label, value }) => (
        <div key={label} className="combat-stat">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

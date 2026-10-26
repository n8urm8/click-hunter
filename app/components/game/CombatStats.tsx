import { Progress } from "~/components/ui/progress";
import { useHpStatus, type PlayerWithDerivedStats } from "~/hooks/usePlayer";

type CombatStatsPlayer = Pick<
  PlayerWithDerivedStats,
  "_id" | "health" | "attack" | "defense" | "attackSpeed" | "critChance" | "critDamageMultiplier"
>;

type HpStatus = {
  currentHp: number;
  maxHp: number;
  conRegenPerSecond: number;
  boostRegenPerSecond: number;
  totalInCombatRegenPerSecond: number;
};

function isHpStatus(value: unknown): value is HpStatus {
  if (typeof value !== "object" || value === null) return false;
  const hp = value as Record<string, unknown>;
  return (
    typeof hp.currentHp === "number" &&
    typeof hp.maxHp === "number" &&
    typeof hp.conRegenPerSecond === "number" &&
    typeof hp.boostRegenPerSecond === "number" &&
    typeof hp.totalInCombatRegenPerSecond === "number"
  );
}

export function CombatStats({ player }: { player: CombatStatsPlayer }) {
  const hpQuery = useHpStatus(player._id);
  const hp = isHpStatus(hpQuery.data) ? hpQuery.data : null;
  const maxHp = hp?.maxHp ?? player.health;
  const currentHp = hp?.currentHp ?? maxHp;
  const hpPercent =
    maxHp > 0 ? Math.min(100, (currentHp / maxHp) * 100) : 0;

  const stats = [
    { label: "Attack", value: player.attack.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { label: "Defense", value: player.defense.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
    { label: "Attack speed", value: `${player.attackSpeed.toFixed(2)}/s` },
    { label: "Crit chance", value: `${player.critChance.toFixed(1)}%` },
    { label: "Crit damage", value: `${player.critDamageMultiplier.toFixed(2)}x` },
  ];

  return (
    <dl aria-label="Equipped combat stats" className="combat-stats">
      <div className="combat-stat">
        <dt>Health</dt>
        <dd>
          {currentHp.toLocaleString()} / {maxHp.toLocaleString()}
        </dd>
        <Progress
          value={hpPercent}
          className="h-2 hp-bar-player"
          aria-label="Health"
        />
        {hp && (
          <p className="text-xs text-muted-foreground">
            +{hp.totalInCombatRegenPerSecond.toFixed(1)}/s regen
            {hp.boostRegenPerSecond > 0 &&
              ` (potion +${hp.boostRegenPerSecond.toFixed(1)}/s)`}
          </p>
        )}
      </div>
      {stats.map(({ label, value }) => (
        <div key={label} className="combat-stat">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

import { Card } from "~/components/ui/card";
import { usePlayerUpgrades } from "~/hooks/usePlayer";

interface UpgradeListProps {
  playerId: string;
}

export function UpgradeList({ playerId }: UpgradeListProps) {
  const upgrades = usePlayerUpgrades(playerId);

  if (!upgrades || upgrades.length === 0) {
    return (
      <Card className="forest-card p-4">
        <p className="text-muted-foreground text-sm">No upgrades discovered yet.</p>
      </Card>
    );
  }

  return (
    <Card className="forest-card p-4 space-y-2">
      {upgrades.map((upgrade) => (
        <div
          key={upgrade._id}
          className="forest-panel p-3 text-sm flex items-center justify-between"
        >
          <div>
            <div className="font-semibold text-gold glow-gold">{upgrade.upgradeId}</div>
            <div className="text-xs text-muted-foreground">Qty: {upgrade.quantity}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

import { Card } from "~/components/ui/card";
import { usePlayerUpgrades } from "~/hooks/usePlayer";
import type { Id } from "../../../convex/_generated/dataModel";

interface UpgradeListProps {
  playerId: Id<"players">;
}

export function UpgradeList({ playerId }: UpgradeListProps) {
  const upgrades = usePlayerUpgrades(playerId);

  if (upgrades.isPending) {
    return (
      <Card className="forest-card p-4">
        <p className="text-muted-foreground text-sm">Loading upgrades...</p>
      </Card>
    );
  }

  if (upgrades.isError) {
    return (
      <Card className="forest-card p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load upgrades.
        </p>
      </Card>
    );
  }

  if (!upgrades.data || upgrades.data.length === 0) {
    return (
      <Card className="forest-card p-4">
        <p className="text-muted-foreground text-sm">No upgrades discovered yet.</p>
      </Card>
    );
  }

  return (
    <Card className="forest-card p-4 space-y-2">
      {upgrades.data.map((upgrade) => (
        <div
          key={upgrade._id}
          className="forest-panel p-3 text-sm flex items-center justify-between"
        >
          <div>
            <div className="font-semibold text-gold glow-gold">{upgrade.upgradeId}</div>
            <div className="text-xs text-muted-foreground">
              Owned: {upgrade.quantity}
            </div>
            {upgrade.purchaseCount !== undefined && (
              <div className="text-xs text-muted-foreground">
                Paid purchases: {upgrade.purchaseCount}
              </div>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

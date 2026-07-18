import { Card } from "~/components/ui/card";
import { usePlayerUpgrades } from "~/hooks/usePlayer";

interface UpgradeListProps {
  playerId: string;
}

export function UpgradeList({ playerId }: UpgradeListProps) {
  const upgrades = usePlayerUpgrades(playerId);

  if (!upgrades || upgrades.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700 p-4">
        <p className="text-slate-400 text-sm">No upgrades purchased yet.</p>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800 border-slate-700 p-4 space-y-2">
      {upgrades.map((upgrade) => (
        <div
          key={upgrade._id}
          className="bg-slate-700 rounded p-3 text-sm flex items-center justify-between"
        >
          <div>
            <div className="font-semibold text-amber-400">{upgrade.upgradeId}</div>
            <div className="text-xs text-slate-400">Qty: {upgrade.quantity}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

import React from "react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { UPGRADES } from "~/lib/gameConfig";
import { usePurchaseUpgrade } from "~/hooks/usePlayer";

interface ShopPanelProps {
  player: any;
}

export function ShopPanel({ player }: ShopPanelProps) {
  const purchaseUpgrade = usePurchaseUpgrade();
  const [isPurchasing, setIsPurchasing] = React.useState<string | null>(null);

  const handlePurchase = async (upgradeId: string) => {
    setIsPurchasing(upgradeId);
    try {
      await purchaseUpgrade({ playerId: player._id, upgradeId });
    } catch (error) {
      console.error("Purchase failed:", error);
    } finally {
      setIsPurchasing(null);
    }
  };

  const availableUpgrades = Object.values(UPGRADES).filter((upgrade) => {
    // Check prerequisites
    if (upgrade.prerequisites?.minTier) {
      if (player.currentTier < upgrade.prerequisites.minTier) {
        return false;
      }
    }
    return true;
  });

  return (
    <Card className="bg-slate-800 border-slate-700 p-4">
      <div className="space-y-2">
        {availableUpgrades.length === 0 ? (
          <p className="text-slate-400 text-sm">No upgrades available yet.</p>
        ) : (
          availableUpgrades.map((upgrade) => {
            const canAfford = player.gold >= upgrade.cost;
            return (
              <div
                key={upgrade.id}
                className="bg-slate-700 rounded p-3 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-amber-400">
                      {upgrade.name}
                    </h4>
                    <p className="text-xs text-slate-400">
                      {upgrade.description}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-yellow-400">
                      {upgrade.cost}g
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handlePurchase(upgrade.id)}
                  disabled={!canAfford || isPurchasing === upgrade.id}
                  className="w-full text-xs"
                  variant={canAfford ? "default" : "outline"}
                >
                  {isPurchasing === upgrade.id ? "..." : "Buy"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

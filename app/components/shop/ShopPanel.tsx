import React from "react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { usePurchaseUpgrade } from "~/hooks/usePlayer";

interface ShopPanelProps {
  player: any;
}

export function ShopPanel({ player }: ShopPanelProps) {
  const purchaseUpgrade = usePurchaseUpgrade();
  const [isPurchasing, setIsPurchasing] = React.useState<string | null>(null);
  const allUpgrades = useQuery(api.seed.getAllUpgrades);

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

  const availableUpgrades = (allUpgrades ?? []).filter((upgrade) => {
    if (upgrade.minTier && player.currentTier < upgrade.minTier) return false;
    return true;
  });

  return (
    <Card className="forest-card p-4">
      <div className="space-y-2">
        {availableUpgrades.length === 0 ? (
          <p className="text-muted-foreground text-sm">No wares available yet.</p>
        ) : (
          availableUpgrades.map((upgrade) => {
            const canAfford = player.gold >= upgrade.cost;
            return (
              <div
                key={upgrade.upgradeId}
                className="forest-panel p-3 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-gold glow-gold">
                      {upgrade.name}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {upgrade.description}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gold-light glow-gold">
                      ✧ {upgrade.cost}g
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handlePurchase(upgrade.upgradeId)}
                  disabled={!canAfford || isPurchasing === upgrade.upgradeId}
                  className={`w-full text-xs ${canAfford ? 'bg-forest-mid hover:bg-forest-light text-gold-light border border-gold/20' : 'bg-forest-dark/30 text-muted-foreground border border-forest-light/10'}`}
                  variant={canAfford ? "default" : "outline"}
                >
                  {isPurchasing === upgrade.upgradeId ? "..." : "Buy"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

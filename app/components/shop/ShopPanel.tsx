import React from "react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { usePurchaseUpgrade, useShopUpgrades } from "~/hooks/usePlayer";

interface ShopPanelProps {
  player: any;
}

export function ShopPanel({ player }: ShopPanelProps) {
  const purchaseUpgrade = usePurchaseUpgrade();
  const [isPurchasing, setIsPurchasing] = React.useState<string | null>(null);
  const [purchaseError, setPurchaseError] = React.useState<string | null>(null);
  const shopUpgrades = useShopUpgrades(player._id);

  const handlePurchase = async (upgradeId: string) => {
    setIsPurchasing(upgradeId);
    setPurchaseError(null);
    try {
      await purchaseUpgrade({ playerId: player._id, upgradeId });
    } catch (error) {
      console.error("Purchase failed:", error);
      setPurchaseError(
        error instanceof Error ? error.message : "Purchase failed"
      );
    } finally {
      setIsPurchasing(null);
    }
  };

  const availableUpgrades = (shopUpgrades ?? []).filter((upgrade) => {
    const reachedTier = player.maxTierReached ?? player.currentTier;
    if (upgrade.minTier && reachedTier < upgrade.minTier) return false;
    return true;
  });

  return (
    <Card className="forest-card p-4">
      <div className="space-y-2">
        {shopUpgrades === undefined ? (
          <p className="text-muted-foreground text-sm">Loading wares...</p>
        ) : availableUpgrades.length === 0 ? (
          <p className="text-muted-foreground text-sm">No wares available yet.</p>
        ) : (
          availableUpgrades.map((upgrade) => {
            const isStatUpgrade = upgrade.effectType === "stat-boost";
            const canAfford = player.gold >= upgrade.purchaseCost;
            const requiredLevel = upgrade.requiredLevel;
            const levelLocked =
              requiredLevel !== null && player.level < requiredLevel;
            const isOneTimeUpgrade = upgrade.category === "auto";
            const isOwned = isOneTimeUpgrade && upgrade.ownedQuantity > 0;
            const canPurchase = canAfford && !levelLocked && !isOwned;
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
                    {isStatUpgrade && (
                      <p className="text-xs text-muted-foreground">
                        Next purchase: level {upgrade.purchaseLevel} · Owned:{" "}
                        {upgrade.ownedQuantity}
                      </p>
                    )}
                    {requiredLevel !== null && (
                      <p
                        className={`text-xs ${
                          levelLocked
                            ? "text-blood-light"
                            : "text-forest-glow/70"
                        }`}
                      >
                        Requires character level {requiredLevel}
                      </p>
                    )}
                    {isOwned && (
                      <p className="text-xs text-forest-glow">
                        Owned — toggle it in Enter the Wilds.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gold-light glow-gold">
                      ✧ {upgrade.purchaseCost}g
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handlePurchase(upgrade.upgradeId)}
                  disabled={!canPurchase || isPurchasing === upgrade.upgradeId}
                  className={`w-full text-xs ${canPurchase ? 'bg-forest-mid hover:bg-forest-light text-gold-light border border-gold/20' : 'bg-forest-dark/30 text-muted-foreground border border-forest-light/10'}`}
                  variant={canPurchase ? "default" : "outline"}
                >
                  {isPurchasing === upgrade.upgradeId
                    ? "..."
                    : isOwned
                      ? "Owned"
                      : levelLocked
                        ? "Locked"
                        : "Buy"}
                </Button>
              </div>
            );
          })
        )}
        {purchaseError && (
          <p className="text-xs text-blood-light" role="alert">
            {purchaseError}
          </p>
        )}
      </div>
    </Card>
  );
}

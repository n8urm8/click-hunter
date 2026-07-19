import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useCanRebirth, useRebirth } from "~/hooks/usePlayer";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface RebirthPanelProps {
  player: any;
}

export function RebirthPanel({ player }: RebirthPanelProps) {
  const canRebirth = useCanRebirth(player._id);
  const rebirthMutation = useRebirth();
  const thresholdsRow = useQuery(api.seed.getGameBalance, { key: "rebirthThresholds" });
  const rebirthThresholds: number[] = (thresholdsRow?.value as number[]) ?? [5, 10, 15, 21, 28, 36, 45];

  const handleRebirth = async () => {
    if (canRebirth) {
      await rebirthMutation({ playerId: player._id });
    }
  };

  const nextThresholdIndex = Math.min(
    player.rebirthCount + 1,
    rebirthThresholds.length - 1
  );
  const nextThreshold = rebirthThresholds[nextThresholdIndex];

  return (
    <Card className="forest-card box-glow-purple p-4 space-y-4">
      <div>
        <h3 className="font-heading text-mystic-glow glow-purple mb-2">Rebirth</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-foreground/70">Rebirths Completed</span>
            <span className="font-bold">{player.rebirthCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-foreground/70">Current Threshold</span>
            <span className="font-bold">Tier {player.rebirthTierThreshold}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-foreground/70">Current Progress</span>
            <span className="font-bold">Tier {player.currentTier}</span>
          </div>
        </div>
      </div>

      {canRebirth ? (
        <Button
          onClick={handleRebirth}
          className="w-full bg-mystic/30 hover:bg-mystic/50 text-mystic-glow border border-mystic/40 btn-enchanted"
        >
          ✨ REBIRTH (Beat Tier {player.rebirthTierThreshold}!)
        </Button>
      ) : (
        <Button disabled className="w-full bg-forest-dark/50 text-muted-foreground border border-forest-light/10">
          Beat Tier {player.rebirthTierThreshold} to Rebirth
        </Button>
      )}

      <div className="forest-panel p-3 text-xs text-muted-foreground">
        <p className="mb-2">
          Rebirth resets your character to Tier 1 but applies a permanent
          multiplier to your base stats for the next run.
        </p>
        <p>Next threshold: Tier {nextThreshold}</p>
      </div>
    </Card>
  );
}

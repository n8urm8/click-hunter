import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useCanRebirth, useRebirth } from "~/hooks/usePlayer";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { convexQueryCacheOptions } from "../../lib/queryCache";

interface RebirthPanelProps {
  player: any;
}

export function RebirthPanel({ player }: RebirthPanelProps) {
  const canRebirthQuery = useCanRebirth(player._id);
  const rebirthMutation = useRebirth();
  const thresholdsQuery = useQuery({
    ...convexQuery(api.seed.getGameBalance, { key: "rebirthThresholds" }),
    ...convexQueryCacheOptions,
  });
  const rebirthThresholds =
    thresholdsQuery.data?.value &&
    Array.isArray(thresholdsQuery.data.value) &&
    thresholdsQuery.data.value.every((value): value is number => typeof value === "number")
      ? thresholdsQuery.data.value
      : null;
  const canRebirth = canRebirthQuery.data === true;

  const handleRebirth = async () => {
    if (canRebirthQuery.data === true) {
      await rebirthMutation({ playerId: player._id });
    }
  };

  if (canRebirthQuery.isPending || thresholdsQuery.isPending) {
    return (
      <Card className="forest-card box-glow-purple min-h-[260px] p-4">
        <p className="text-sm text-muted-foreground">Loading rebirth...</p>
      </Card>
    );
  }

  if (
    (canRebirthQuery.isError && !canRebirthQuery.data) ||
    (thresholdsQuery.isError && !thresholdsQuery.data) ||
    !rebirthThresholds
  ) {
    return (
      <Card className="forest-card box-glow-purple min-h-[260px] p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load rebirth data.
        </p>
      </Card>
    );
  }

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
          className="w-full bg-mystic/30 hover:bg-mystic/50 text-mystic-glow border border-mystic/40"
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
          Rebirth resets your character to Tier 1, returns paid stat upgrades
          to level 1, and applies a permanent multiplier to your base stats
          for the next run. Hidden-spot bonuses and automation purchases remain
          permanent.
        </p>
        <p>Next threshold: Tier {nextThreshold}</p>
      </div>
    </Card>
  );
}

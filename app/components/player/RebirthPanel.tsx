import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useCanRebirth, useRebirth } from "~/hooks/usePlayer";
import { REBIRTH_TIER_PROGRESSION } from "~/lib/gameConfig";

interface RebirthPanelProps {
  player: any;
}

export function RebirthPanel({ player }: RebirthPanelProps) {
  const canRebirth = useCanRebirth(player._id);
  const rebirthMutation = useRebirth();

  const handleRebirth = async () => {
    if (canRebirth) {
      await rebirthMutation({ playerId: player._id });
    }
  };

  const nextThresholdIndex = Math.min(
    player.rebirthCount + 1,
    REBIRTH_TIER_PROGRESSION.length - 1
  );
  const nextThreshold =
    REBIRTH_TIER_PROGRESSION[nextThresholdIndex];

  return (
    <Card className="bg-slate-800 border-slate-700 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-purple-400 mb-2">Rebirth Info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Rebirths Completed</span>
            <span className="font-bold">{player.rebirthCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Current Threshold</span>
            <span className="font-bold">Tier {player.rebirthTierThreshold}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Current Progress</span>
            <span className="font-bold">Tier {player.currentTier}</span>
          </div>
        </div>
      </div>

      {canRebirth ? (
        <Button
          onClick={handleRebirth}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white"
        >
          REBIRTH (Beat Tier {player.rebirthTierThreshold}!)
        </Button>
      ) : (
        <Button disabled className="w-full">
          Beat Tier {player.rebirthTierThreshold} to Rebirth
        </Button>
      )}

      <div className="bg-slate-700 rounded p-3 text-xs text-slate-400">
        <p className="mb-2">
          Rebirth resets your character to Tier 1 but applies a permanent
          multiplier to your base stats for the next run.
        </p>
        <p>Next threshold: Tier {nextThreshold}</p>
      </div>
    </Card>
  );
}

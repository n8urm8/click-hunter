import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";

export function LeaderboardPanel() {
  const topExp = useQuery(api.leaderboards.getTopByExperience, { limit: 10 });
  const topTier = useQuery(api.leaderboards.getTopByTier, { limit: 10 });
  const topRebirth = useQuery(api.leaderboards.getTopByRebirth, { limit: 10 });

  return (
    <div className="space-y-4">
      {/* Experience Leaderboard */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Top Adventurers (XP)</h3>
        <div className="space-y-2">
          {topExp?.map((entry, idx) => (
            <div
              key={entry._id}
              className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="w-8 h-8 flex items-center justify-center">
                  {idx + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.playerName}</p>
                </div>
              </div>
              <p className="text-sm text-blue-400 font-mono">
                {entry.totalExperience.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Tier Leaderboard */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Highest Tier Reached</h3>
        <div className="space-y-2">
          {topTier?.map((entry, idx) => (
            <div
              key={entry._id}
              className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="w-8 h-8 flex items-center justify-center">
                  {idx + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.playerName}</p>
                </div>
              </div>
              <p className="text-sm text-purple-400 font-mono">
                Tier {entry.maxTierReached}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Rebirth Leaderboard */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Most Rebirths</h3>
        <div className="space-y-2">
          {topRebirth?.map((entry, idx) => (
            <div
              key={entry._id}
              className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="w-8 h-8 flex items-center justify-center">
                  {idx + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.playerName}</p>
                </div>
              </div>
              <p className="text-sm text-green-400 font-mono">
                {entry.rebirthCount} {entry.rebirthCount === 1 ? "rebirth" : "rebirths"}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

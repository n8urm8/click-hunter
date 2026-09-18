import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { convexQueryCacheOptions } from "../../lib/queryCache";

export function LeaderboardPanel() {
  const topExpQuery = useQuery({
    ...convexQuery(api.leaderboards.getTopByExperience, { limit: 10 }),
    ...convexQueryCacheOptions,
  });
  const topTierQuery = useQuery({
    ...convexQuery(api.leaderboards.getTopByTier, { limit: 10 }),
    ...convexQueryCacheOptions,
  });
  const topRebirthQuery = useQuery({
    ...convexQuery(api.leaderboards.getTopByRebirth, { limit: 10 }),
    ...convexQueryCacheOptions,
  });
  const topExp = topExpQuery.data;
  const topTier = topTierQuery.data;
  const topRebirth = topRebirthQuery.data;

  if (topExpQuery.isPending || topTierQuery.isPending || topRebirthQuery.isPending) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, index) => (
          <Card className="min-h-[180px] p-4" key={index}>
            <p className="text-sm text-muted-foreground">Loading leaderboard...</p>
          </Card>
        ))}
      </div>
    );
  }

  if (
    (topExpQuery.isError && !topExpQuery.data) ||
    (topTierQuery.isError && !topTierQuery.data) ||
    (topRebirthQuery.isError && !topRebirthQuery.data)
  ) {
    return (
      <Card className="p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load leaderboards.
        </p>
      </Card>
    );
  }

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

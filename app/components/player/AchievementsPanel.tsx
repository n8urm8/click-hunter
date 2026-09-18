import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { convexQueryCacheOptions } from "../../lib/queryCache";

interface AchievementsPanelProps {
  playerId: Id<"players">;
}

export function AchievementsPanel({ playerId }: AchievementsPanelProps) {
  const achievementsQuery = useQuery({
    ...convexQuery(api.achievements.getPlayerAchievements, {
      playerId,
    }),
    ...convexQueryCacheOptions,
  });
  const achievements = achievementsQuery.data;

  if (achievementsQuery.isPending) {
    return (
      <Card className="p-4">
        <p className="text-sm text-gray-400">Loading achievements...</p>
      </Card>
    );
  }

  if (achievementsQuery.isError && !achievementsQuery.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load achievements.
        </p>
      </Card>
    );
  }

  if (!achievements) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Achievement Progress</h3>
          <span className="text-xs text-gray-400">
            {achievements.progress.count} / {achievements.progress.total}
          </span>
        </div>
        <Progress
          value={(achievements.progress.count / achievements.progress.total) * 100}
          className="h-2"
        />
      </Card>

      {/* Achievement grid */}
      <div className="space-y-2">
        {achievements.all.map((achievement) => {
          const isUnlocked = achievements.unlocked.includes(achievement.achievementId);
          return (
            <div
              key={achievement.achievementId}
              className={`p-3 rounded border transition-all ${
                isUnlocked
                  ? "bg-green-900/20 border-green-500/30"
                  : "bg-zinc-900/50 border-zinc-700"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">{achievement.icon || "🏆"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{achievement.name}</p>
                  <p className="text-xs text-gray-400">{achievement.description}</p>
                </div>
                {isUnlocked && (
                  <Badge variant="secondary" className="shrink-0">
                    ✓
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

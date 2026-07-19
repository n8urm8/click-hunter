import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";

interface AchievementsPanelProps {
  playerId: string;
}

export function AchievementsPanel({ playerId }: AchievementsPanelProps) {
  const achievements = useQuery(api.achievements.getPlayerAchievements, {
    playerId: playerId as any,
  });

  if (!achievements) {
    return (
      <Card className="p-4">
        <p className="text-sm text-gray-400">Loading achievements...</p>
      </Card>
    );
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

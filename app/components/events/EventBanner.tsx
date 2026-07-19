import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";

export function EventBanner() {
  const multipliers = useQuery(api.events.getActiveMultipliers, {});

  if (!multipliers || multipliers.activeEvents.length === 0) {
    return null;
  }

  return (
    <Card className="p-3 border-purple-500/50 bg-purple-900/20">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-purple-300">🎉 Active Events</h3>
        <div className="space-y-1">
          {multipliers.activeEvents.map((event) => (
            <div key={event.eventId} className="flex items-center justify-between text-xs">
              <p className="text-gray-300">{event.name}</p>
              <Badge variant="outline" className="text-purple-400 border-purple-500/50">
                {event.effectType === "gold-multiplier" ? "🪙" : "⭐"}
                {" "}
                {event.effectValue.toFixed(2)}x
              </Badge>
            </div>
          ))}
        </div>
        <div className="pt-2 border-t border-purple-500/30 flex gap-2 text-xs">
          {multipliers.goldMultiplier > 1 && (
            <Badge className="bg-yellow-700">Gold: {multipliers.goldMultiplier.toFixed(2)}x</Badge>
          )}
          {multipliers.xpMultiplier > 1 && (
            <Badge className="bg-blue-700">XP: {multipliers.xpMultiplier.toFixed(2)}x</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

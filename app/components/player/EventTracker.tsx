import { useAtom } from "jotai";
import { eventTrackerAtom, type GameEvent } from "~/store/gameStore";
import { cn } from "~/lib/utils";

export function EventTracker({ className }: { className?: string }) {
  const [event] = useAtom(eventTrackerAtom);

  const getEventLabel = (event: GameEvent) => {
    switch (event.type) {
      case "idle":
        return "Idle";

      case "fighting":
        return `Fighting ${event.monsterName} (T${event.tier})`;

      case "auto_battling":
        return `Auto-battling ${event.monsterName} (T${event.tier})`;

      case "skilling":
        return `Skilling ${event.skillName}`;

      case "victory":
        return `Victory! +${event.reward.gold}G +${event.reward.exp}XP${
          event.reward.loot?.length
            ? ` · ${event.reward.loot
                .map((drop) => `${drop.itemName} x${drop.quantity}`)
                .join(", ")}`
            : ""
        }`;

      case "defeat":
        return `Defeated by ${event.monsterName}`;

      case "shopping":
        return "Shopping";

      case "viewing_stats":
        return "Viewing Stats";

      case "viewing_inventory":
        return "Viewing Inventory";

      case "viewing_rebirth":
        return "Viewing Rebirth";

      default:
        return null;
    }
  };

  const label = getEventLabel(event);
  if (!label) return null;

  return (
    <span
      className={cn("game-event-status", className)}
      data-status={event.type}
      role="status"
      aria-label={`Current activity: ${label}`}
    >
      <span className="game-event-status-indicator" aria-hidden="true" />
      <span className="game-event-status-label">{label}</span>
    </span>
  );
}

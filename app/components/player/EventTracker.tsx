import { useAtom } from "jotai";
import { eventTrackerAtom, type GameEvent } from "~/store/gameStore";
import { Badge } from "~/components/ui/badge";

/**
 * Displays current game event/activity in top right
 */
export function EventTracker() {
  const [event] = useAtom(eventTrackerAtom);

  const renderEvent = (event: GameEvent) => {
    switch (event.type) {
      case "idle":
        return (
          <Badge variant="outline" className="bg-forest-dark/50 text-forest-glow/60 border-forest-light/30">
            Idle
          </Badge>
        );

      case "fighting":
        return (
          <Badge className="bg-blood/20 text-blood-light border-blood/40 animate-pulse">
            ⚔️ Fighting {event.monsterName} (T{event.tier})
          </Badge>
        );

      case "victory":
        return (
          <Badge className="bg-forest-mid/30 text-gold-light border-gold/30 animate-bounce glow-gold">
            ✦ Victory! +{event.reward.gold}G +{event.reward.exp}XP
          </Badge>
        );

      case "defeat":
        return (
          <Badge className="bg-forest-dark/50 text-muted-foreground border-forest-light/20">
            ☠️ Defeated by {event.monsterName}
          </Badge>
        );

      case "shopping":
        return (
          <Badge variant="outline" className="bg-forest-mid/20 text-gold/80 border-gold/20">
            🛍️ Shopping
          </Badge>
        );

      case "viewing_stats":
        return (
          <Badge variant="outline" className="bg-mystic/10 text-mystic-glow/80 border-mystic/20">
            📊 Viewing Stats
          </Badge>
        );

      case "viewing_upgrades":
        return (
          <Badge variant="outline" className="bg-gold-dark/20 text-gold-light/80 border-gold/20">
            ⬆️ Viewing Upgrades
          </Badge>
        );

      case "viewing_rebirth":
        return (
          <Badge variant="outline" className="bg-mystic/15 text-mystic-glow border-mystic/30">
            🔄 Viewing Rebirth
          </Badge>
        );

      default:
        return null;
    }
  };

  return renderEvent(event);
}

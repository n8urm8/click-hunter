import { useRef, useEffect, useState } from "react";
import { useAtom } from "jotai";
import { discoveredSpotsAtom } from "~/store/gameStore";
import { useClaimHiddenSpotReward } from "~/hooks/usePlayer";
import { logInfo, logError } from "~/lib/logger";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface HiddenSpotsProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  player: any;
}

export function HiddenSpots({ containerRef, player }: HiddenSpotsProps) {
  const [discoveredSpots, setDiscoveredSpots] = useAtom(discoveredSpotsAtom);
  const [isHovering, setIsHovering] = useState<string | null>(null);
  const [claimingSpot, setClaimingSpot] = useState<string | null>(null);
  const claimReward = useClaimHiddenSpotReward();
  const spotsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hiddenSpots = useQuery(api.seed.getHiddenSpots) ?? [];

  const handleSpotClick = async (spotId: string, rewardUpgradeId: string) => {
    if (discoveredSpots.has(spotId) || claimingSpot === spotId) {
      return;
    }

    setClaimingSpot(spotId);

    try {
      logInfo(`Claiming hidden spot ${spotId} with reward ${rewardUpgradeId}`);

      // Call Convex mutation to claim reward
      await claimReward({
        playerId: player._id,
        upgradeId: rewardUpgradeId,
        spotId,
      });

      // Mark as discovered locally
      const newDiscovered = new Set(discoveredSpots);
      newDiscovered.add(spotId);
      setDiscoveredSpots(newDiscovered);

      // Store in localStorage for persistence
      try {
        localStorage.setItem(
          "clickHunter_discoveredSpots",
          JSON.stringify(Array.from(newDiscovered))
        );
      } catch (error) {
        console.error("Failed to save discovered spot:", error);
      }

      logInfo(`Successfully claimed hidden spot ${spotId}!`);
    } catch (error) {
      logError("Failed to claim hidden spot", error as Error);
    } finally {
      setClaimingSpot(null);
    }
  };

  useEffect(() => {
    // Set up click detection for each undiscovered spot
    const spots = spotsRef.current;

    hiddenSpots.forEach((spot) => {
      if (discoveredSpots.has(spot.spotId)) return;

      const element = spots.get(spot.spotId);
      if (!element) return;

      const handleMouseEnter = () => {
        if (!discoveredSpots.has(spot.spotId)) {
          setIsHovering(spot.spotId);
        }
      };

      const handleMouseLeave = () => {
        setIsHovering(null);
      };

      const handleClick = () => {
        handleSpotClick(spot.spotId, spot.rewardUpgradeId);
      };

      element.addEventListener("mouseenter", handleMouseEnter);
      element.addEventListener("mouseleave", handleMouseLeave);
      element.addEventListener("click", handleClick);

      return () => {
        element.removeEventListener("mouseenter", handleMouseEnter);
        element.removeEventListener("mouseleave", handleMouseLeave);
        element.removeEventListener("click", handleClick);
      };
    });
  }, [discoveredSpots, hiddenSpots]);

  return (
    <>
      {hiddenSpots.map((spot) => {
        const isDiscovered = discoveredSpots.has(spot.spotId);
        const isHovered = isHovering === spot.spotId && !isDiscovered;
        const isClaiming = claimingSpot === spot.spotId;

        // Don't render discovered spots
        if (isDiscovered) {
          return null;
        }

        return (
          <div
            key={spot.spotId}
            ref={(el) => {
              if (el) spotsRef.current.set(spot.spotId, el);
            }}
            className={`absolute rounded-full cursor-pointer transition-all ${
              isHovered
                ? "bg-yellow-400/40 border-2 border-yellow-300"
                : "bg-transparent border-2 border-transparent"
            }`}
            style={{
              left: `${spot.x}%`,
              top: `${spot.y}%`,
              width: `${spot.radius * 2}px`,
              height: `${spot.radius * 2}px`,
              transform: "translate(-50%, -50%)",
            }}
            title={isHovered ? "Click to discover!" : undefined}
          >
            {/* Pulsing indicator for undiscovered spots on hover */}
            {isHovered && (
              <div className="absolute inset-0 rounded-full bg-yellow-300 animate-pulse opacity-50" />
            )}

            {/* Loading indicator while claiming */}
            {isClaiming && (
              <div className="absolute inset-0 rounded-full bg-blue-400 animate-spin opacity-75" />
            )}
          </div>
        );
      })}
    </>
  );
}

import { useRef, useEffect, useState } from "react";
import { useAtom } from "jotai";
import { discoveredSpotsAtom } from "~/store/gameStore";
import { HIDDEN_SPOTS } from "~/lib/gameConfig";
import { usePurchaseUpgrade } from "~/hooks/usePlayer";
import { logInfo } from "~/lib/logger";

interface HiddenSpotsProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  player: any;
}

export function HiddenSpots({ containerRef, player }: HiddenSpotsProps) {
  const [discoveredSpots] = useAtom(discoveredSpotsAtom);
  const [isHovering, setIsHovering] = useState<string | null>(null);
  const purchaseUpgrade = usePurchaseUpgrade();
  const spotsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleSpotClick = async (spotId: string, rewardUpgradeId: string) => {
    if (discoveredSpots.has(spotId)) {
      logInfo(`Spot ${spotId} already discovered`);
      return;
    }

    // Mark as discovered - update localStorage for persistence
    const newDiscovered = new Set(discoveredSpots);
    newDiscovered.add(spotId);
    
    // Store in localStorage
    try {
      localStorage.setItem("clickHunter_discoveredSpots", JSON.stringify(Array.from(newDiscovered)));
      logInfo(`Discovered hidden spot! Claimed ${rewardUpgradeId}`);
    } catch (error) {
      console.error("Failed to save discovered spot:", error);
    }
  };

  useEffect(() => {
    // Set up click detection for each spot
    const spots = spotsRef.current;

    HIDDEN_SPOTS.forEach((spot) => {
      const element = spots.get(spot.id);
      if (!element) return;

      const handleMouseEnter = () => {
        if (!discoveredSpots.has(spot.id)) {
          setIsHovering(spot.id);
        }
      };

      const handleMouseLeave = () => {
        setIsHovering(null);
      };

      const handleClick = () => {
        handleSpotClick(spot.id, spot.rewardUpgradeId);
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
  }, [discoveredSpots]);

  return (
    <>
      {HIDDEN_SPOTS.map((spot) => {
        const isDiscovered = discoveredSpots.has(spot.id);
        const isHovered = isHovering === spot.id;

        return (
          <div
            key={spot.id}
            ref={(el) => {
              if (el) spotsRef.current.set(spot.id, el);
            }}
            className={`absolute rounded-full cursor-pointer transition-all ${
              isDiscovered
                ? "bg-green-500/20 border-2 border-green-400"
                : isHovered
                ? "bg-yellow-400/30 border-2 border-yellow-300"
                : "bg-transparent border-2 border-transparent"
            }`}
            style={{
              left: `${spot.x}%`,
              top: `${spot.y}%`,
              width: `${spot.radius * 2}px`,
              height: `${spot.radius * 2}px`,
              transform: "translate(-50%, -50%)",
            }}
            title={
              isDiscovered ? "Discovered!" : isHovered ? "Click to discover!" : undefined
            }
          >
            {/* Pulsing indicator for undiscovered spots */}
            {!isDiscovered && isHovered && (
              <div className="absolute inset-0 rounded-full bg-yellow-300 animate-pulse opacity-50" />
            )}

            {/* Checkmark for discovered spots */}
            {isDiscovered && (
              <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-green-400">
                ✓
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

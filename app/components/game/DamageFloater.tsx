import type { ClickAnimation } from "~/store/gameStore";

interface DamageFloaterProps {
  floater: ClickAnimation;
}

export function DamageFloater({ floater }: DamageFloaterProps) {
  const elapsed = Date.now() - floater.timestamp;
  const duration = 1000; // milliseconds
  const progress = Math.min(1, elapsed / duration);

  // Animation: fade out and move up
  const opacity = Math.max(0, 1 - progress);
  const yOffset = progress * 50; // moves up 50px

  return (
    <div
      className="absolute font-bold text-lg pointer-events-none"
      style={{
        left: `${floater.x}%`,
        top: `${floater.y}%`,
        transform: `translate(-50%, calc(-50% - ${yOffset}px))`,
        opacity,
        color: floater.damage > 50 ? "#ffe066" : "#3ddc84", // gold glow for crits, forest green for normal
        textShadow: floater.damage > 50 
          ? "0 0 8px rgba(255, 224, 102, 0.8), 0 0 16px rgba(212, 160, 23, 0.5), 2px 2px 4px rgba(0,0,0,0.9)" 
          : "0 0 6px rgba(61, 220, 132, 0.6), 2px 2px 4px rgba(0,0,0,0.9)",
        transition: "none",
      }}
    >
      +{floater.damage}
    </div>
  );
}

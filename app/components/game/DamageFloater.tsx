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
        color: floater.damage > 50 ? "#fbbf24" : "#86efac", // gold for crits, green for normal
        textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
        transition: "none",
      }}
    >
      +{floater.damage}
    </div>
  );
}

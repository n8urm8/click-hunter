import type { Doc } from "../../../../convex/_generated/dataModel";

export const bazaarInputClass =
  "min-h-8 border border-forest-light/30 bg-forest-deep px-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold/40";

export function formatGold(amount: number): string {
  return `${amount.toLocaleString()}g`;
}

/** Short human time left until an order expires (client-side display). */
export function formatTimeLeft(expiresAt: number, now = Date.now()): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return "expired";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

/**
 * Convex surfaces mutation errors as `Uncaught Error: <message>\n at ...`;
 * strip the wrapper so the readable message reaches the player.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const firstLine = error.message.split("\n")[0] ?? error.message;
  return firstLine.replace(/^Uncaught\s+(?:Error|RangeError):\s*/i, "") || fallback;
}

export function rarityForLevel(
  rarities: ReadonlyArray<Doc<"itemRarities">> | undefined,
  level: number | undefined
): Doc<"itemRarities"> | null {
  if (!rarities || level === undefined) return null;
  return rarities.find((rarity) => rarity.level === level) ?? null;
}

/** Item name styled with its rarity color (falls back to foreground). */
export function ItemName({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  return (
    <span
      className="text-xs font-semibold"
      style={color ? { color } : undefined}
    >
      {name}
    </span>
  );
}

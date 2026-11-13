/** Matches PERMANENT_BAN_UNTIL in convex/accountModeration.ts. */
export const PERMANENT_BAN_UNTIL = Number.MAX_SAFE_INTEGER;

export function isActiveUntil(until: number, now: number): boolean {
  return until > now;
}

/** "permanently", or "until <local date and time>". */
export function formatUntil(until: number): string {
  if (until >= PERMANENT_BAN_UNTIL) return "permanently";
  return `until ${new Date(until).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

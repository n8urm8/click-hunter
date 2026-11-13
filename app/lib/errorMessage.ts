const UNCAUGHT_PATTERN = /Uncaught\s+[A-Za-z]*Error:\s*([^\n]+)/;
const CONVEX_PREFIX_PATTERN = /^\[CONVEX [^\]]*\]\s*(\[Request ID:[^\]]*\]\s*)?(Server Error\s*)?/;

/**
 * Convex wraps a thrown error as `[CONVEX …] [Request ID: …] Server Error` on
 * the first line, with `Uncaught Error: <message>` on the next. Return just the
 * readable message, falling back to the first line when there is no wrapper.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const uncaught = UNCAUGHT_PATTERN.exec(error.message);
  if (uncaught?.[1]) return uncaught[1].trim();
  const firstLine = error.message.split("\n")[0] ?? error.message;
  return firstLine.replace(CONVEX_PREFIX_PATTERN, "").trim() || fallback;
}

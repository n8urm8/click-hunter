/**
 * Type-safe environment variable access
 * Provides compile-time checking and runtime safety
 */

export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "",
  appTitle: import.meta.env.VITE_APP_TITLE || "Click Hunter",
  debugMode: import.meta.env.VITE_DEBUG_MODE === "true",
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;

/**
 * Debug logging utility that respects environment settings
 */
export function debugLog(...args: any[]) {
  if (env.debugMode || env.isDev) {
    console.log("[DEBUG]", ...args);
  }
}

/**
 * Performance monitoring utility
 */
export function measurePerformance(label: string, fn: () => void) {
  if (!env.debugMode) {
    fn();
    return;
  }

  const start = performance.now();
  fn();
  const end = performance.now();
  console.log(`[PERF] ${label}: ${(end - start).toFixed(2)}ms`);
}

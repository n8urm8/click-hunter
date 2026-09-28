import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query's match state.
 *
 * Uses useSyncExternalStore so SSR/hydration starts on the server snapshot
 * (false → mobile layout) and updates immediately on the client.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

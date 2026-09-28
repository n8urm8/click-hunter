import { keepPreviousData } from "@tanstack/react-query";

export const CONVEX_QUERY_GC_TIME = 15 * 60 * 1000;

/**
 * Shared options for convexQuery-backed useQuery calls.
 *
 * placeholderData: keepPreviousData — when a query's arguments change
 * (filter/sort/search), keep the previous result on screen while the new one
 * loads instead of dropping back to `undefined` (which flashed a skeleton on
 * every keystroke/selection). The stale value is flagged via
 * `isPlaceholderData`; the very first load still reports `isPending`.
 */
export const convexQueryCacheOptions = {
  gcTime: CONVEX_QUERY_GC_TIME,
  placeholderData: keepPreviousData,
} as const;

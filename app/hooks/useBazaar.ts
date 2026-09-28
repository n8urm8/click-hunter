import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ItemCategory } from "../../convex/itemTypes";
import { convexQueryCacheOptions } from "../lib/queryCache";

export interface BazaarOrderFilters {
  side: "sell" | "buy";
  viewerPlayerId?: Id<"players">;
  category?: ItemCategory;
  rarityLevel?: number;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: "price_asc" | "price_desc" | "newest";
  limit?: number;
}

export function useBazaarMeta() {
  return useQuery({
    ...convexQuery(api.bazaar.getMeta, {}),
    ...convexQueryCacheOptions,
  });
}

export function useBazaarCatalog() {
  return useQuery({
    ...convexQuery(api.bazaar.getCatalog, {}),
    ...convexQueryCacheOptions,
  });
}

export function useOpenBazaarOrders(filters: BazaarOrderFilters | "skip") {
  return useQuery({
    ...convexQuery(api.bazaar.getOpenOrders, filters),
    ...convexQueryCacheOptions,
  });
}

export function useMyBazaarOrders(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(
      api.bazaar.getMyOrders,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function usePlaceBazaarSellOrder() {
  return useMutation(api.bazaar.placeSellOrder);
}

export function usePlaceBazaarBuyOrder() {
  return useMutation(api.bazaar.placeBuyOrder);
}

export function useFulfillBazaarOrder() {
  return useMutation(api.bazaar.fulfillOrder);
}

export function useCancelBazaarOrder() {
  return useMutation(api.bazaar.cancelOrder);
}

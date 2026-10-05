/**
 * Client mirror of the server infusion success curve
 * (convex/infusion.ts `infusionSuccessFor`). Display only — the server rolls
 * authoritatively at task resolution.
 */
export interface InfusionRates {
  baseRate: number;
  augmentBaseRate?: number;
  falloffPerTierGap: number;
  minRate: number;
  maxRate: number;
  failXpPercent: number;
}

export function infusionSuccessChance(
  infusionLevel: number,
  targetTier: number,
  rates: InfusionRates,
  kind: "craft" | "augment" = "craft"
): number {
  const gap = Math.max(0, targetTier - Math.max(1, infusionLevel));
  const base =
    kind === "augment" ? (rates.augmentBaseRate ?? rates.baseRate) : rates.baseRate;
  const raw = base - gap * rates.falloffPerTierGap;
  return Math.min(rates.maxRate, Math.max(rates.minRate, raw));
}

export function formatPercent(chance: number): string {
  return `${Math.round(chance * 100)}%`;
}

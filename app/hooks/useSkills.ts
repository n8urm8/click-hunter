import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getSkillXpRequiredForLevel } from "../../convex/skillProgression";
import type { SkillPage } from "../../convex/skills";
import { convexQueryCacheOptions } from "../lib/queryCache";

type ContentRows = Pick<SkillPage, "items" | "recipes" | "activities" | "augmentations">;

/**
 * Re-attach the full item documents the server sends once in `items`, so panels
 * keep reading `row.item` / `outputItem` / `requiredMaterialItem` as before.
 */
export function expandSkillRows(rows: ContentRows) {
  const itemFor = (itemId: string | undefined) =>
    itemId === undefined ? null : (rows.items[itemId] ?? null);
  return {
    recipes: rows.recipes.map((recipe) => ({
      ...recipe,
      ingredients: recipe.ingredients.map((row) => ({ ...row, item: itemFor(row.itemId) })),
      outputs: recipe.outputs.map((row) => ({ ...row, item: itemFor(row.itemId) })),
    })),
    activities: rows.activities.map((activity) => ({
      ...activity,
      outputItem: itemFor(activity.outputItemId),
    })),
    augmentations: rows.augmentations.map((augmentation) => ({
      ...augmentation,
      requiredMaterialItem: itemFor(augmentation.requiredMaterialItemId),
      bossCatalystItem: itemFor(augmentation.bossCatalystItemId),
    })),
  };
}

function useSkillProgress(playerId: Id<"players"> | null) {
  return useQuery({
    ...convexQuery(api.skills.getPlayerSkills, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

function withSkillProgress<T extends { skillXpBase: number }>(
  catalog: T,
  progress: Array<{ level: number } & Record<string, unknown>>
) {
  return progress.map((playerSkill) => ({
    ...playerSkill,
    xpRequiredForNextLevel: getSkillXpRequiredForLevel(playerSkill.level, catalog.skillXpBase),
  }));
}

export type SkillPageSelection = {
  /** `undefined` lets the server pick the first enabled skill. */
  skillId?: string;
  /** `undefined` means the player's highest unlocked tier; "all" means every tier. */
  tier?: number | "all";
};

/**
 * One skill's page: the skill list, its tiers and the content for the selected
 * tier, plus the player's progress. The response reports the skill and tier it
 * actually used, so callers can correct their URL.
 */
export function useSkillPage(playerId: Id<"players"> | null, selection: SkillPageSelection) {
  const page = useQuery({
    ...convexQuery(
      api.skills.getSkillPage,
      playerId ? { playerId, skillId: selection.skillId, tier: selection.tier } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
  const progress = useSkillProgress(playerId);
  const data = useMemo(() => {
    if (page.data === undefined || progress.data === undefined) return undefined;
    return {
      ...page.data,
      ...expandSkillRows(page.data),
      playerSkills: progress.data.map((playerSkill) => ({
        ...playerSkill,
        xpRequiredForNextLevel: getSkillXpRequiredForLevel(
          playerSkill.level,
          page.data.skillXpBase
        ),
      })),
    };
  }, [page.data, progress.data]);

  return {
    data,
    isPending: data === undefined && !page.isError && !progress.isError,
    isError: page.isError || progress.isError,
    isPlaceholderData: page.isPlaceholderData,
  };
}

/**
 * Augmentation-only catalog for the inventory and rebirth screens, plus the
 * player's progress. It reads far fewer documents than the skills page does.
 */
export function useSkillPanel(
  playerId: Id<"players"> | null,
  _scope: "augmentations" = "augmentations"
) {
  const catalog = useQuery({
    ...convexQuery(api.skills.getAugmentationCatalog, playerId ? {} : "skip"),
    ...convexQueryCacheOptions,
  });
  const progress = useQuery({
    ...convexQuery(api.skills.getPlayerSkills, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
  const data = useMemo(() => {
    if (catalog.data === undefined || progress.data === undefined) {
      return undefined;
    }
    const skillXpBase = catalog.data.skillXpBase;
    return {
      ...catalog.data,
      ...expandSkillRows(catalog.data),
      playerSkills: progress.data.map((playerSkill) => ({
        ...playerSkill,
        xpRequiredForNextLevel: getSkillXpRequiredForLevel(playerSkill.level, skillXpBase),
      })),
    };
  }, [catalog.data, progress.data]);
  const isError = catalog.isError || progress.isError;

  return {
    data,
    isPending: data === undefined && !isError,
    isError,
    error: catalog.error ?? progress.error ?? null,
  };
}

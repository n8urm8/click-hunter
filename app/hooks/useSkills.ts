import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getSkillXpRequiredForLevel } from "../../convex/skillProgression";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useSkillPanel(playerId: Id<"players"> | null) {
  const catalog = useQuery({
    ...convexQuery(api.skills.getSkillCatalog, playerId ? {} : "skip"),
    ...convexQueryCacheOptions,
  });
  const progress = useQuery({
    ...convexQuery(
      api.skills.getPlayerSkills,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
  const data = useMemo(() => {
    if (catalog.data === undefined || progress.data === undefined) {
      return undefined;
    }
    const skillXpBase = catalog.data.skillXpBase;
    return {
      ...catalog.data,
      playerSkills: progress.data.map((playerSkill) => ({
        ...playerSkill,
        xpRequiredForNextLevel: getSkillXpRequiredForLevel(
          playerSkill.level,
          skillXpBase
        ),
      })),
    };
  }, [catalog.data, progress.data]);
  const isError = catalog.isError || progress.isError;

  return {
    data,
    isPending: !isError && (catalog.isPending || progress.isPending),
    isError,
    error: catalog.error ?? progress.error,
  };
}

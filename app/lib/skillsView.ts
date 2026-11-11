/**
 * Which skill and tier the skills page shows. The URL is the source of truth
 * (`/skills?skill=alchemy&tier=3`, `tier=all` for every tier). The last view is
 * also kept in localStorage so `/skills` without a query returns there.
 */

export const SKILLS_VIEW_STORAGE_KEY = "clickHunter_skillsView";

export type SkillsTierParam = number | "all";

export type SkillsView = {
  skill: string;
  /** Undefined means the skill's highest tier. */
  tier?: SkillsTierParam;
};

/** Parse a `tier` query value. Anything that is not "all" or a positive integer is ignored. */
export function parseTierParam(value: string | null | undefined): SkillsTierParam | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value === "all") return "all";
  const tier = Number(value);
  return Number.isInteger(tier) && tier >= 1 ? tier : undefined;
}

export function skillsViewSearch(view: { skill: string; tier: SkillsTierParam }) {
  return `?skill=${encodeURIComponent(view.skill)}&tier=${view.tier}`;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): KeyValueStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readStoredSkillsView(storage: KeyValueStorage | undefined = defaultStorage()): SkillsView | null {
  try {
    const raw = storage?.getItem(SKILLS_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { skill, tier } = parsed as { skill?: unknown; tier?: unknown };
    if (typeof skill !== "string" || skill === "") return null;
    const parsedTier =
      typeof tier === "number" ? parseTierParam(String(tier)) : parseTierParam(typeof tier === "string" ? tier : undefined);
    return { skill, tier: parsedTier };
  } catch {
    return null;
  }
}

export function writeStoredSkillsView(
  view: { skill: string; tier: SkillsTierParam },
  storage: KeyValueStorage | undefined = defaultStorage()
): void {
  try {
    storage?.setItem(SKILLS_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Storage can be full or disabled; the URL still holds the view.
  }
}

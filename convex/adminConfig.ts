export const ADMIN_CONFIG_TABLES = {
  monsters: [
    "monsters", "bosses", "lootTables", "lootTableEntries", "lootSources", "items",
  ],
  items: ["itemRarities", "items"],
  skills: [
    "skillDefinitions", "skillTierDefinitions", "gatheringActivities", "recipes",
    "recipeIngredients", "recipeOutputs", "augmentationDefinitions", "items",
  ],
  tree: ["passiveNodes"],
  general: [
    "gameBalance", "taskDefinitions", "upgrades", "hiddenSpots", "achievements",
    "rebirthRewards", "gameEvents",
  ],
} as const;

export type AdminConfigSection = keyof typeof ADMIN_CONFIG_TABLES;
export type AdminSection = AdminConfigSection | "players";
export type AdminConfigTable =
  (typeof ADMIN_CONFIG_TABLES)[AdminConfigSection][number];

export function adminSectionsForTables(
  tables: readonly AdminConfigTable[]
): AdminSection[] {
  const changedTables = new Set<AdminConfigTable>(tables);
  const sections = (
    Object.keys(ADMIN_CONFIG_TABLES) as AdminConfigSection[]
  ).filter((section) =>
    ADMIN_CONFIG_TABLES[section].some((table) => changedTables.has(table))
  );
  return changedTables.has("skillDefinitions") ? [...sections, "players"] : sections;
}

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./adminAuth";
import { calculateCharacterLevel } from "./characterLevel";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import { ELEMENT_VALUES, type ElementKind } from "./itemTypes";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

export const PASSIVE_BRANCHES = [
  "sword",
  "dagger",
  "mace",
  "bow",
  "staff",
  "skilling",
  "elemental",
] as const;
export type PassiveBranch = (typeof PASSIVE_BRANCHES)[number];

export const PASSIVE_EFFECT_TYPES = [
  "stat-boost",
  "damage-percent",
  "attack-speed-percent",
  "defense-percent",
  "health-percent",
  "crit-chance",
  "gold-multiplier",
  "xp-multiplier",
  "skill-xp-multiplier",
  "skill-speed-multiplier",
  "elemental-damage-percent",
] as const;
export type PassiveEffectType = (typeof PASSIVE_EFFECT_TYPES)[number];

export function readElementKind(value: unknown): ElementKind | null {
  return (ELEMENT_VALUES as readonly string[]).includes(value as string)
    ? (value as ElementKind)
    : null;
}

export const PASSIVE_POINT_BALANCE_DEFAULT = {
  key: "passivePointInterval",
  value: 5,
  description:
    "Character levels per passive skill point (1 point per interval, earned above the starting-level baseline)",
} as const;

const DEFAULT_STARTING_STATS = { str: 1, dex: 1, int: 1, luk: 1, con: 1 };
const MAX_PASSIVE_ROWS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return (
    await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
  )?.value;
}

function readPointInterval(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 100
    ? value
    : PASSIVE_POINT_BALANCE_DEFAULT.value;
}

function readStartingStatSum(value: unknown) {
  if (!isRecord(value)) return 5;
  let sum = 0;
  for (const stat of ["str", "dex", "int", "luk", "con"]) {
    const entry = value[stat];
    sum +=
      typeof entry === "number" && Number.isFinite(entry) && entry >= 1
        ? Math.floor(entry)
        : 1;
  }
  return sum;
}

export async function getPassiveBaseLevel(ctx: DatabaseCtx) {
  const [startingStatsValue, skills] = await Promise.all([
    getBalanceValue(ctx, "startingStats"),
    ctx.db
      .query("skillDefinitions")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .take(MAX_PASSIVE_ROWS),
  ]);
  return readStartingStatSum(startingStatsValue) + skills.length;
}

export async function getPassivePointInterval(ctx: DatabaseCtx) {
  return readPointInterval(
    await getBalanceValue(ctx, PASSIVE_POINT_BALANCE_DEFAULT.key)
  );
}

export async function getPassivePoints(
  ctx: DatabaseCtx,
  player: Doc<"players">
) {
  const [level, baseLevel, interval, unlocks] = await Promise.all([
    calculateCharacterLevel(ctx, player),
    getPassiveBaseLevel(ctx),
    getPassivePointInterval(ctx),
    ctx.db
      .query("playerPassives")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .collect(),
  ]);
  const earned = Math.max(
    0,
    Math.floor(level / interval) - Math.floor(baseLevel / interval)
  );
  return {
    level,
    baseLevel,
    interval,
    earned,
    spent: unlocks.length,
    available: Math.max(0, earned - unlocks.length),
  };
}

export type PassiveBonuses = {
  stats: { str: number; dex: number; int: number; luk: number; con: number };
  damagePercent: number;
  attackSpeedPercent: number;
  defensePercent: number;
  healthPercent: number;
  critChance: number;
  goldMultiplier: number;
  xpMultiplier: number;
  skillXpMultipliers: { all: number; gathering: number; crafting: number };
  skillSpeedMultipliers: { all: number; gathering: number; crafting: number };
  elements: Record<ElementKind, number>;
};

export const EMPTY_PASSIVE_BONUSES: PassiveBonuses = {
  stats: { str: 0, dex: 0, int: 0, luk: 0, con: 0 },
  damagePercent: 0,
  attackSpeedPercent: 0,
  defensePercent: 0,
  healthPercent: 0,
  critChance: 0,
  goldMultiplier: 1,
  xpMultiplier: 1,
  skillXpMultipliers: { all: 1, gathering: 1, crafting: 1 },
  skillSpeedMultipliers: { all: 1, gathering: 1, crafting: 1 },
  elements: { light: 0, dark: 0, water: 0, fire: 0, wind: 0, earth: 0 },
};

function isStatKey(value: unknown): value is keyof PassiveBonuses["stats"] {
  return (
    value === "str" ||
    value === "dex" ||
    value === "int" ||
    value === "luk" ||
    value === "con"
  );
}

function isSkillScope(
  value: unknown
): value is keyof PassiveBonuses["skillXpMultipliers"] {
  return value === "all" || value === "gathering" || value === "crafting";
}

function applyNodeToBonuses(
  bonuses: PassiveBonuses,
  node: Doc<"passiveNodes">
) {
  const amount = node.effectAmount;
  switch (node.effectType) {
    case "stat-boost":
      if (isStatKey(node.effectStat) && Number.isFinite(amount)) {
        bonuses.stats[node.effectStat] += amount;
      }
      break;
    case "damage-percent":
      if (Number.isFinite(amount)) bonuses.damagePercent += amount;
      break;
    case "attack-speed-percent":
      if (Number.isFinite(amount)) bonuses.attackSpeedPercent += amount;
      break;
    case "defense-percent":
      if (Number.isFinite(amount)) bonuses.defensePercent += amount;
      break;
    case "health-percent":
      if (Number.isFinite(amount)) bonuses.healthPercent += amount;
      break;
    case "crit-chance":
      if (Number.isFinite(amount)) bonuses.critChance += amount;
      break;
    case "gold-multiplier":
      if (Number.isFinite(amount) && amount > 0)
        bonuses.goldMultiplier *= amount;
      break;
    case "xp-multiplier":
      if (Number.isFinite(amount) && amount > 0) bonuses.xpMultiplier *= amount;
      break;
    case "skill-xp-multiplier":
      if (Number.isFinite(amount) && amount > 0) {
        const scope = isSkillScope(node.effectScope) ? node.effectScope : "all";
        bonuses.skillXpMultipliers[scope] *= amount;
      }
      break;
    case "skill-speed-multiplier":
      if (Number.isFinite(amount) && amount > 0) {
        const scope = isSkillScope(node.effectScope) ? node.effectScope : "all";
        bonuses.skillSpeedMultipliers[scope] *= amount;
      }
      break;
    case "elemental-damage-percent": {
      const element = readElementKind(node.element);
      if (element && Number.isFinite(amount)) {
        bonuses.elements[element] += amount;
      }
      break;
    }
    default:
      break;
  }
}

export async function getPassiveBonuses(
  ctx: DatabaseCtx,
  playerId: PlayerId
): Promise<PassiveBonuses> {
  const unlocks = await ctx.db
    .query("playerPassives")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(MAX_PASSIVE_ROWS);
  if (unlocks.length === 0) return structuredClone(EMPTY_PASSIVE_BONUSES);
  const bonuses: PassiveBonuses = structuredClone(EMPTY_PASSIVE_BONUSES);
  const nodeIds = new Set(unlocks.map((row) => row.nodeId));
  const nodes = await ctx.db
    .query("passiveNodes")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .take(MAX_PASSIVE_ROWS);
  for (const node of nodes) {
    if (nodeIds.has(node.nodeId)) applyNodeToBonuses(bonuses, node);
  }
  return bonuses;
}

// ─── Seed data (PoE-like web: 5 weapon arms + skilling arm) ──────────────────

type SeedNode = {
  nodeId: string;
  branch: PassiveBranch;
  name: string;
  description: string;
  effectType: PassiveEffectType;
  effectStat?: "str" | "dex" | "int" | "luk" | "con";
  effectScope?: "all" | "gathering" | "crafting";
  element?: ElementKind;
  effectAmount: number;
  requires: string[];
  requiresAny?: string[];
  // Grid cell override for nodes that sit off the arm paths (elementals).
  cell?: readonly [number, number];
};

type ArmBranch = Exclude<PassiveBranch, "elemental">;

// Grid layout canvas: 21 x 21 cells, hub at (10, 10). Each arm is an explicit
// cell path (root first) so nodes can never overlap — one node per cell.
export const TREE_GRID_SIZE = 21;
const TREE_HUB: readonly [number, number] = [10, 10];

const GRID_PATHS: Record<ArmBranch, Array<readonly [number, number]>> = {
  sword: [
    [10, 9], [10, 8], [10, 7], [10, 6],
    [10, 5], [10, 4], [10, 3], [10, 2],
  ],
  dagger: [
    [11, 9], [12, 8], [13, 7], [14, 6],
    [15, 6], [16, 6], [17, 6], [18, 6],
  ],
  bow: [
    [11, 11], [12, 12], [13, 13], [14, 14],
    [15, 14], [16, 14], [17, 14], [18, 14],
  ],
  mace: [
    [10, 11], [10, 12], [10, 13], [10, 14],
    [10, 15], [10, 16], [10, 17], [10, 18],
  ],
  staff: [
    [9, 11], [8, 12], [7, 13], [6, 14],
    [5, 14], [4, 14], [3, 14], [2, 14],
  ],
  skilling: [
    [9, 9], [8, 8], [7, 7], [6, 6],
    [5, 6], [4, 6], [3, 6], [2, 6],
  ],
};

function branchPosition(branch: ArmBranch, index: number) {
  const path = GRID_PATHS[branch];
  const [col, row] = path[Math.min(index, path.length - 1)];
  // Cell centers in grid units.
  return { positionX: col + 0.5, positionY: row + 0.5 };
}

// Elemental bridge nodes sit in the gaps between arms, each reachable from
// either neighboring arm's 5th node. Unlocking needs just one side, so the
// bridges let builds cross between branches: fire (sword/dagger), wind
// (dagger/bow), light (bow/mace), water (mace/staff), earth (staff/skilling),
// dark (skilling/sword). Opposing elements sit across from each other:
// fire/water, wind/earth, light/dark.
const ELEMENT_CELLS: Record<ElementKind, readonly [number, number]> = {
  fire: [12, 5],
  water: [7, 15],
  wind: [15, 10],
  earth: [5, 10],
  light: [13, 15],
  dark: [8, 5],
};

export function requirementsMetFor(
  unlocked: Set<string>,
  requires: string[],
  requiresAny?: string[]
): boolean {
  if (!requires.every((parent) => unlocked.has(parent))) return false;
  if (requiresAny !== undefined && requiresAny.length > 0) {
    return requiresAny.some((parent) => unlocked.has(parent));
  }
  return true;
}

function missingRequirements(
  unlocked: Set<string>,
  requires: string[],
  requiresAny?: string[]
): string[] {
  const missing = requires.filter((parent) => !unlocked.has(parent));
  if (missing.length > 0) return missing;
  if (
    requiresAny !== undefined &&
    requiresAny.length > 0 &&
    !requiresAny.some((parent) => unlocked.has(parent))
  ) {
    return [...requiresAny];
  }
  return [];
}

function assertGridPathsValid() {
  const seen = new Set<string>();
  const claim = (key: string, label: string) => {
    if (key === `${TREE_HUB[0]},${TREE_HUB[1]}` || seen.has(key)) {
      throw new Error(`Passive tree cells overlap at ${key} (${label})`);
    }
    seen.add(key);
  };
  (Object.keys(GRID_PATHS) as ArmBranch[]).forEach((branch) => {
    const path = GRID_PATHS[branch];
    if (path.length !== 8) {
      throw new Error(`Passive tree arm ${branch} must have 8 cells`);
    }
    path.forEach(([col, row], index) => {
      if (
        !Number.isInteger(col) ||
        !Number.isInteger(row) ||
        col < 0 ||
        col >= TREE_GRID_SIZE ||
        row < 0 ||
        row >= TREE_GRID_SIZE
      ) {
        throw new Error(
          `Passive tree arm ${branch} cell ${index} is outside the grid`
        );
      }
      claim(`${col},${row}`, `arm ${branch}`);
    });
  });
  (Object.entries(ELEMENT_CELLS) as Array<[ElementKind, readonly [number, number]]>).forEach(
    ([element, [col, row]]) => {
      if (col < 0 || col >= TREE_GRID_SIZE || row < 0 || row >= TREE_GRID_SIZE) {
        throw new Error(`Elemental node ${element} is outside the grid`);
      }
      claim(`${col},${row}`, `element ${element}`);
    }
  );
}

function chain(branch: PassiveBranch, nodes: SeedNode[]): SeedNode[] {
  return nodes.map((node, index) => ({
    ...node,
    branch,
    requires: index === 0 ? [] : [`${branch}-${index}`],
  }));
}

function seedNodes(): SeedNode[] {
  return [
    ...chain("sword", [
      { nodeId: "sword-1", branch: "sword", name: "Sword Apprentice", description: "+2 STR. The way of the blade begins.", effectType: "stat-boost", effectStat: "str", effectAmount: 2, requires: [] },
      { nodeId: "sword-2", branch: "sword", name: "Heavy Edge", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "sword-3", branch: "sword", name: "Swordsman Strength", description: "+2 STR.", effectType: "stat-boost", effectStat: "str", effectAmount: 2, requires: [] },
      { nodeId: "sword-4", branch: "sword", name: "Squire's Strength", description: "+1 STR.", effectType: "stat-boost", effectStat: "str", effectAmount: 1, requires: [] },
      { nodeId: "sword-5", branch: "sword", name: "Veteran Vitality", description: "+4% maximum health.", effectType: "health-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "sword-6", branch: "sword", name: "Keen Edge", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "sword-7", branch: "sword", name: "Sharpened Edge", description: "+2% damage.", effectType: "damage-percent", effectAmount: 0.02, requires: [] },
      { nodeId: "sword-8", branch: "sword", name: "Iron Constitution", description: "+2 CON.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
    ]),
    ...chain("dagger", [
      { nodeId: "dagger-1", branch: "dagger", name: "Dagger Apprentice", description: "+2 DEX. Strike first, strike often.", effectType: "stat-boost", effectStat: "dex", effectAmount: 2, requires: [] },
      { nodeId: "dagger-2", branch: "dagger", name: "Quick Hands", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "dagger-3", branch: "dagger", name: "Rogue Agility", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "dagger-4", branch: "dagger", name: "Cutpurse Agility", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "dagger-5", branch: "dagger", name: "Vital Strike", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
      { nodeId: "dagger-6", branch: "dagger", name: "Blur of Blades", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "dagger-7", branch: "dagger", name: "Fleet Footwork", description: "+2% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.02, requires: [] },
      { nodeId: "dagger-8", branch: "dagger", name: "Sharpened Point", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
    ]),
    ...chain("mace", [
      { nodeId: "mace-1", branch: "mace", name: "Mace Apprentice", description: "+2 CON. Endure and crush.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
      { nodeId: "mace-2", branch: "mace", name: "Stone Guard", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-3", branch: "mace", name: "Juggernaut Frame", description: "+2 CON.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
      { nodeId: "mace-4", branch: "mace", name: "Sturdy Frame", description: "+1 CON.", effectType: "stat-boost", effectStat: "con", effectAmount: 1, requires: [] },
      { nodeId: "mace-5", branch: "mace", name: "Thick Blood", description: "+4% maximum health.", effectType: "health-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-6", branch: "mace", name: "Iron Wall", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-7", branch: "mace", name: "Reinforced Guard", description: "+3% defense.", effectType: "defense-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "mace-8", branch: "mace", name: "Crushing Force", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
    ]),
    ...chain("bow", [
      { nodeId: "bow-1", branch: "bow", name: "Bow Apprentice", description: "+2 DEX. One shot, one kill.", effectType: "stat-boost", effectStat: "dex", effectAmount: 2, requires: [] },
      { nodeId: "bow-2", branch: "bow", name: "True Aim", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "bow-3", branch: "bow", name: "Hunter Eye", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
      { nodeId: "bow-4", branch: "bow", name: "Straight Arrow", description: "+2% damage.", effectType: "damage-percent", effectAmount: 0.02, requires: [] },
      { nodeId: "bow-5", branch: "bow", name: "Swift Draw", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "bow-6", branch: "bow", name: "Ranger Agility", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "bow-7", branch: "bow", name: "Tracker's Poise", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "bow-8", branch: "bow", name: "Deadeye", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
    ]),
    ...chain("staff", [
      { nodeId: "staff-1", branch: "staff", name: "Staff Apprentice", description: "+2 INT. The old magic listens.", effectType: "stat-boost", effectStat: "int", effectAmount: 2, requires: [] },
      { nodeId: "staff-2", branch: "staff", name: "Arcane Channel", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "staff-3", branch: "staff", name: "Deep Study", description: "+2 INT.", effectType: "stat-boost", effectStat: "int", effectAmount: 2, requires: [] },
      { nodeId: "staff-4", branch: "staff", name: "Apprentice Lore", description: "+1 INT.", effectType: "stat-boost", effectStat: "int", effectAmount: 1, requires: [] },
      { nodeId: "staff-5", branch: "staff", name: "Warded Robes", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "staff-6", branch: "staff", name: "Overchannel", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "staff-7", branch: "staff", name: "Focused Will", description: "+2% damage.", effectType: "damage-percent", effectAmount: 0.02, requires: [] },
      { nodeId: "staff-8", branch: "staff", name: "Sage Wisdom", description: "+2% combat experience.", effectType: "xp-multiplier", effectAmount: 1.02, requires: [] },
    ]),
    ...chain("skilling", [
      { nodeId: "skilling-1", branch: "skilling", name: "Skilling Focus", description: "+3% skill experience (all skills).", effectType: "skill-xp-multiplier", effectScope: "all", effectAmount: 1.03, requires: [] },
      { nodeId: "skilling-2", branch: "skilling", name: "Gatherer Instinct", description: "+3% gathering experience.", effectType: "skill-xp-multiplier", effectScope: "gathering", effectAmount: 1.03, requires: [] },
      { nodeId: "skilling-3", branch: "skilling", name: "Crafter Patience", description: "+3% crafting experience.", effectType: "skill-xp-multiplier", effectScope: "crafting", effectAmount: 1.03, requires: [] },
      { nodeId: "skilling-4", branch: "skilling", name: "Quick Harvest", description: "Gathering actions complete ~3% faster.", effectType: "skill-speed-multiplier", effectScope: "gathering", effectAmount: 1.03, requires: [] },
      { nodeId: "skilling-5", branch: "skilling", name: "Efficient Hands", description: "Crafting actions complete ~3% faster.", effectType: "skill-speed-multiplier", effectScope: "crafting", effectAmount: 1.03, requires: [] },
      { nodeId: "skilling-6", branch: "skilling", name: "Studious Mind", description: "+2% skill experience (all skills).", effectType: "skill-xp-multiplier", effectScope: "all", effectAmount: 1.02, requires: [] },
      { nodeId: "skilling-7", branch: "skilling", name: "Flow State", description: "All skill actions complete ~2% faster.", effectType: "skill-speed-multiplier", effectScope: "all", effectAmount: 1.02, requires: [] },
      { nodeId: "skilling-8", branch: "skilling", name: "Battle Wisdom", description: "+3% combat experience.", effectType: "xp-multiplier", effectAmount: 1.03, requires: [] },
    ]),
    ...elementalNodes(),
  ];
}

/**
 * Elemental bridge nodes. Each hangs off two neighboring arms' 5th nodes and
 * grants a small damage bonus for one element — applied only while wielding
 * a weapon tagged with that element. Either neighbor unlocks the bridge, so
 * builds can cross between branches. Opposing elements sit across the hub
 * from each other (fire/water, wind/earth, light/dark).
 */
function elementalNodes(): SeedNode[] {
  const definitions: Array<{
    nodeId: string;
    name: string;
    element: ElementKind;
    from: [string, string];
  }> = [
    { nodeId: "element-fire", name: "Cinder Attunement", element: "fire", from: ["sword-5", "dagger-5"] },
    { nodeId: "element-water", name: "Tide Attunement", element: "water", from: ["mace-5", "staff-5"] },
    { nodeId: "element-wind", name: "Gale Attunement", element: "wind", from: ["dagger-5", "bow-5"] },
    { nodeId: "element-earth", name: "Stone Attunement", element: "earth", from: ["staff-5", "skilling-5"] },
    { nodeId: "element-light", name: "Dawn Attunement", element: "light", from: ["bow-5", "mace-5"] },
    { nodeId: "element-dark", name: "Dusk Attunement", element: "dark", from: ["skilling-5", "sword-5"] },
  ];
  return definitions.map(({ nodeId, name, element, from }) => ({
    nodeId,
    branch: "elemental" as const,
    name,
    description: `+4% ${element} damage while wielding a ${element} weapon. Reachable from ${from.join(" or ")}.`,
    effectType: "elemental-damage-percent" as const,
    element,
    effectAmount: 0.04,
    requires: [],
    requiresAny: [...from],
    cell: ELEMENT_CELLS[element],
  }));
}

export async function seedPassiveContent(ctx: MutationCtx) {
  const now = Date.now();
  const intervalRow = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", PASSIVE_POINT_BALANCE_DEFAULT.key))
    .first();
  if (!intervalRow) {
    await ctx.db.insert("gameBalance", {
      ...PASSIVE_POINT_BALANCE_DEFAULT,
      lastUpdated: now,
    });
  }

  assertGridPathsValid();
  const branchIndex: Record<ArmBranch, number> = {
    sword: 0,
    dagger: 0,
    mace: 0,
    bow: 0,
    staff: 0,
    skilling: 0,
  };

  for (const seed of seedNodes()) {
    const { positionX, positionY } =
      seed.cell !== undefined
        ? { positionX: seed.cell[0] + 0.5, positionY: seed.cell[1] + 0.5 }
        : branchPosition(
            seed.branch as ArmBranch,
            branchIndex[seed.branch as ArmBranch]++
          );
    const existing = await ctx.db
      .query("passiveNodes")
      .withIndex("by_nodeId", (q) => q.eq("nodeId", seed.nodeId))
      .first();
    const row = {
      nodeId: seed.nodeId,
      branch: seed.branch,
      name: seed.name,
      description: seed.description,
      effectType: seed.effectType,
      ...(seed.effectStat === undefined ? {} : { effectStat: seed.effectStat }),
      ...(seed.effectScope === undefined
        ? {}
        : { effectScope: seed.effectScope }),
      ...(seed.element === undefined ? {} : { element: seed.element }),
      effectAmount: seed.effectAmount,
      requires: seed.requires,
      requiresAny: seed.requiresAny ?? [],
      positionX,
      positionY,
      enabled: true,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("passiveNodes", { ...row, createdAt: now });
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const getTree = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const [nodes, unlocks, points] = await Promise.all([
      ctx.db.query("passiveNodes").take(MAX_PASSIVE_ROWS),
      ctx.db
        .query("playerPassives")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .take(MAX_PASSIVE_ROWS),
      getPassivePoints(ctx, player),
    ]);
    const unlocked = new Set(unlocks.map((row) => row.nodeId));
    return {
      nodes: nodes
        .filter((node) => node.enabled)
        .map((node) => {
          const requiresAny = node.requiresAny ?? [];
          return {
            ...node,
            requiresAny,
            unlocked: unlocked.has(node.nodeId),
            requirementsMet: requirementsMetFor(
              unlocked,
              node.requires,
              requiresAny
            ),
          };
        }),
      unlocked: unlocks.map((row) => row.nodeId),
      points,
      bonuses: await getPassiveBonuses(ctx, playerId),
    };
  },
});

export const unlockNode = mutation({
  args: { playerId: v.id("players"), nodeId: v.string() },
  handler: async (ctx, { playerId, nodeId }) => {
    await settleTasksBeforeInteraction(ctx, playerId);
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const node = await ctx.db
      .query("passiveNodes")
      .withIndex("by_nodeId", (q) => q.eq("nodeId", nodeId.trim()))
      .first();
    if (!node || !node.enabled) throw new Error("That passive node is not available");
    const existing = await ctx.db
      .query("playerPassives")
      .withIndex("by_playerId_and_nodeId", (q) =>
        q.eq("playerId", playerId).eq("nodeId", node.nodeId)
      )
      .first();
    if (existing) throw new Error("That passive is already unlocked");
    const unlocks = await ctx.db
      .query("playerPassives")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();
    const unlocked = new Set(unlocks.map((row) => row.nodeId));
    const requiresAny = node.requiresAny ?? [];
    const missing = missingRequirements(unlocked, node.requires, requiresAny);
    if (missing.length > 0) {
      const needsAll = node.requires.filter((parent) => !unlocked.has(parent));
      if (needsAll.length > 0) {
        throw new Error(`Requires ${needsAll.join(", ")} first`);
      }
      throw new Error(`Requires ${requiresAny.join(" or ")} first`);
    }
    const points = await getPassivePoints(ctx, player);
    if (points.available < 1) {
      throw new Error(
        `No passive points available (earn 1 every ${points.interval} character levels)`
      );
    }
    await ctx.db.insert("playerPassives", {
      playerId,
      nodeId: node.nodeId,
      unlockedAt: Date.now(),
    });
    return { unlocked: node.nodeId };
  },
});

export async function clearPlayerPassives(
  ctx: MutationCtx,
  playerId: PlayerId
) {
  const rows = await ctx.db
    .query("playerPassives")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

/**
 * Admin-only: (re)seed the default 54-node web and point interval.
 * Idempotent — safe to run multiple times. Needed on existing deployments
 * where the passive tables did not exist at first deploy.
 */
export const seedDefaultTree = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);
    await seedPassiveContent(ctx);
    const count = (
      await ctx.db.query("passiveNodes").take(MAX_PASSIVE_ROWS)
    ).length;
    return { seeded: count };
  },
});

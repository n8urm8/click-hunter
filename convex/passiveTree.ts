import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./adminAuth";
import { calculateCharacterLevel } from "./characterLevel";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;

export const PASSIVE_BRANCHES = [
  "sword",
  "dagger",
  "mace",
  "bow",
  "staff",
  "skilling",
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
  "unlock-auto-attack",
  "unlock-auto-battle",
] as const;
export type PassiveEffectType = (typeof PASSIVE_EFFECT_TYPES)[number];

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
  autoAttack: boolean;
  autoBattle: boolean;
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
  autoAttack: false,
  autoBattle: false,
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
    case "unlock-auto-attack":
      bonuses.autoAttack = true;
      break;
    case "unlock-auto-battle":
      bonuses.autoBattle = true;
      break;
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

export async function hasPassiveUnlock(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  effectType: "unlock-auto-attack" | "unlock-auto-battle"
) {
  const unlocks = await ctx.db
    .query("playerPassives")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(MAX_PASSIVE_ROWS);
  if (unlocks.length === 0) return false;
  const nodeIds = new Set(unlocks.map((row) => row.nodeId));
  for (const node of await ctx.db
    .query("passiveNodes")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .take(MAX_PASSIVE_ROWS)) {
    if (nodeIds.has(node.nodeId) && node.effectType === effectType) return true;
  }
  return false;
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
  effectAmount: number;
  requires: string[];
};

const BRANCH_ANGLES: Record<PassiveBranch, number> = {
  sword: 270,
  dagger: 330,
  bow: 30,
  mace: 90,
  staff: 150,
  skilling: 210,
};

const RADII = [10, 14.5, 19, 23.5, 28, 32.5, 37, 41.5];

function branchPosition(branch: PassiveBranch, index: number) {
  const baseAngle = BRANCH_ANGLES[branch];
  const fan = index % 2 === 0 ? 4 : -4;
  const angle = ((baseAngle + fan * Math.floor(index / 2)) * Math.PI) / 180;
  const radius = RADII[Math.min(index, RADII.length - 1)];
  const positionX = Math.round((50 + radius * Math.cos(angle)) * 10) / 10;
  const positionY = Math.round((50 + radius * Math.sin(angle)) * 10) / 10;
  return { positionX, positionY };
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
      { nodeId: "sword-4", branch: "sword", name: "Battle Rhythm", description: "Unlock automatic attacks at your attack speed.", effectType: "unlock-auto-attack", effectAmount: 1, requires: [] },
      { nodeId: "sword-5", branch: "sword", name: "Veteran Vitality", description: "+4% maximum health.", effectType: "health-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "sword-6", branch: "sword", name: "Keen Edge", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "sword-7", branch: "sword", name: "War Campaign", description: "Unlock battle automation (queued auto-battle).", effectType: "unlock-auto-battle", effectAmount: 1, requires: [] },
      { nodeId: "sword-8", branch: "sword", name: "Iron Constitution", description: "+2 CON.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
    ]),
    ...chain("dagger", [
      { nodeId: "dagger-1", branch: "dagger", name: "Dagger Apprentice", description: "+2 DEX. Strike first, strike often.", effectType: "stat-boost", effectStat: "dex", effectAmount: 2, requires: [] },
      { nodeId: "dagger-2", branch: "dagger", name: "Quick Hands", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "dagger-3", branch: "dagger", name: "Rogue Agility", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "dagger-4", branch: "dagger", name: "Assassin Rhythm", description: "Unlock automatic attacks at your attack speed.", effectType: "unlock-auto-attack", effectAmount: 1, requires: [] },
      { nodeId: "dagger-5", branch: "dagger", name: "Vital Strike", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
      { nodeId: "dagger-6", branch: "dagger", name: "Blur of Blades", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "dagger-7", branch: "dagger", name: "Silent Campaign", description: "Unlock battle automation (queued auto-battle).", effectType: "unlock-auto-battle", effectAmount: 1, requires: [] },
      { nodeId: "dagger-8", branch: "dagger", name: "Sharpened Point", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
    ]),
    ...chain("mace", [
      { nodeId: "mace-1", branch: "mace", name: "Mace Apprentice", description: "+2 CON. Endure and crush.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
      { nodeId: "mace-2", branch: "mace", name: "Stone Guard", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-3", branch: "mace", name: "Juggernaut Frame", description: "+2 CON.", effectType: "stat-boost", effectStat: "con", effectAmount: 2, requires: [] },
      { nodeId: "mace-4", branch: "mace", name: "Relentless Swing", description: "Unlock automatic attacks at your attack speed.", effectType: "unlock-auto-attack", effectAmount: 1, requires: [] },
      { nodeId: "mace-5", branch: "mace", name: "Thick Blood", description: "+4% maximum health.", effectType: "health-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-6", branch: "mace", name: "Iron Wall", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "mace-7", branch: "mace", name: "Siege Campaign", description: "Unlock battle automation (queued auto-battle).", effectType: "unlock-auto-battle", effectAmount: 1, requires: [] },
      { nodeId: "mace-8", branch: "mace", name: "Crushing Force", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
    ]),
    ...chain("bow", [
      { nodeId: "bow-1", branch: "bow", name: "Bow Apprentice", description: "+2 DEX. One shot, one kill.", effectType: "stat-boost", effectStat: "dex", effectAmount: 2, requires: [] },
      { nodeId: "bow-2", branch: "bow", name: "True Aim", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "bow-3", branch: "bow", name: "Hunter Eye", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
      { nodeId: "bow-4", branch: "bow", name: "Rapid Volley", description: "Unlock automatic attacks at your attack speed.", effectType: "unlock-auto-attack", effectAmount: 1, requires: [] },
      { nodeId: "bow-5", branch: "bow", name: "Swift Draw", description: "+3% attack speed.", effectType: "attack-speed-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "bow-6", branch: "bow", name: "Ranger Agility", description: "+1 DEX.", effectType: "stat-boost", effectStat: "dex", effectAmount: 1, requires: [] },
      { nodeId: "bow-7", branch: "bow", name: "Long Hunt", description: "Unlock battle automation (queued auto-battle).", effectType: "unlock-auto-battle", effectAmount: 1, requires: [] },
      { nodeId: "bow-8", branch: "bow", name: "Deadeye", description: "+0.5% critical chance.", effectType: "crit-chance", effectAmount: 0.005, requires: [] },
    ]),
    ...chain("staff", [
      { nodeId: "staff-1", branch: "staff", name: "Staff Apprentice", description: "+2 INT. The old magic listens.", effectType: "stat-boost", effectStat: "int", effectAmount: 2, requires: [] },
      { nodeId: "staff-2", branch: "staff", name: "Arcane Channel", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "staff-3", branch: "staff", name: "Deep Study", description: "+2 INT.", effectType: "stat-boost", effectStat: "int", effectAmount: 2, requires: [] },
      { nodeId: "staff-4", branch: "staff", name: "Resonant Cast", description: "Unlock automatic attacks at your attack speed.", effectType: "unlock-auto-attack", effectAmount: 1, requires: [] },
      { nodeId: "staff-5", branch: "staff", name: "Warded Robes", description: "+4% defense.", effectType: "defense-percent", effectAmount: 0.04, requires: [] },
      { nodeId: "staff-6", branch: "staff", name: "Overchannel", description: "+3% damage.", effectType: "damage-percent", effectAmount: 0.03, requires: [] },
      { nodeId: "staff-7", branch: "staff", name: "Ritual Campaign", description: "Unlock battle automation (queued auto-battle).", effectType: "unlock-auto-battle", effectAmount: 1, requires: [] },
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
  ];
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

  for (const [index, seed] of seedNodes().entries()) {
    const { positionX, positionY } = branchPosition(seed.branch, index % 8);
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
      effectAmount: seed.effectAmount,
      requires: seed.requires,
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
        .map((node) => ({
          ...node,
          unlocked: unlocked.has(node.nodeId),
          requirementsMet: node.requires.every((parent) =>
            unlocked.has(parent)
          ),
        })),
      unlocked: unlocks.map((row) => row.nodeId),
      points,
      bonuses: await getPassiveBonuses(ctx, playerId),
    };
  },
});

export const unlockNode = mutation({
  args: { playerId: v.id("players"), nodeId: v.string() },
  handler: async (ctx, { playerId, nodeId }) => {
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
    const missing = node.requires.filter((parent) => !unlocked.has(parent));
    if (missing.length > 0) {
      throw new Error(`Requires ${missing.join(", ")} first`);
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
 * Admin-only: (re)seed the default 48-node web and point interval.
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

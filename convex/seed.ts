/**
 * Database seeding functions
 * Populates monsters, upgrades, balance, and hidden spots
 *
 * Usage: npx convex run seed:populateAll '{"playerId":"..."}'
 * Safe to call multiple times — upserts existing records.
 */

import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./adminAuth";
import { WORLD_CHAT_SEED_MESSAGES } from "./chatSeedData";
import {
  DEFAULT_BOSS_UNLOCK_LEVEL_PER_TIER,
  bossElementForTier,
  ensureBossForTier,
  getTierScale,
  getTierScaleMultiplier,
  scaleBossStat,
} from "./bossData";
import { DEFAULT_MONSTER_POWER_MULTIPLIER } from "./combat";
import { combatZoneValidator, monstersInZone } from "./zones";
import {
  CATALOG_FETCH_LIMIT,
  DEFAULT_BAZAAR_MAX_OPEN_ORDERS,
  DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS,
  DEFAULT_BAZAAR_TAX_PERCENT,
  readBazaarConfig,
} from "./bazaar";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_ITEM_RARITIES } from "./itemTypes";
import { seedForestCraftingContent } from "./forestCraftingSeed";
import { INFUSION_BALANCE_DEFAULTS } from "./infusion";
import { validateAllRecipeChains } from "./recipeValidation";
import { SKILL_TASK_BALANCE_DEFAULTS } from "./skillBonuses";
import { TASK_SYNC_BALANCE_DEFAULTS } from "./taskTiming";
import {
  PASSIVE_POINT_BALANCE_DEFAULT,
  seedPassiveContent,
} from "./passiveTree";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function populateMonsters(ctx: MutationCtx) {
  const monsters = [
    { type: "rat",       name: "Rat",       element: "earth", str: 2,  dex: 4, int: 1, luk: 2, con: 2, goldDrop: 10,  experienceReward: 5,  baseMsPerAttack: 2000, strength: 5   },
    { type: "goblin",    name: "Goblin",    element: "wind",  str: 3,  dex: 3, int: 2, luk: 3, con: 3, goldDrop: 15,  experienceReward: 8,  baseMsPerAttack: 2000, strength: 15  },
    { type: "orc",       name: "Orc",       element: "fire",  str: 4,  dex: 2, int: 2, luk: 1, con: 4, goldDrop: 20,  experienceReward: 12, baseMsPerAttack: 2000, strength: 25  },
    { type: "troll",     name: "Troll",     element: "water", str: 6,  dex: 3, int: 3, luk: 2, con: 6, goldDrop: 50,  experienceReward: 25, baseMsPerAttack: 2000, strength: 40  },
    { type: "wyvern",    name: "Wyvern",    element: "wind",  str: 5,  dex: 5, int: 4, luk: 3, con: 5, goldDrop: 60,  experienceReward: 30, baseMsPerAttack: 2000, strength: 50  },
    { type: "dragon",    name: "Dragon",    element: "fire",  str: 7,  dex: 4, int: 5, luk: 2, con: 7, goldDrop: 75,  experienceReward: 40, baseMsPerAttack: 2000, strength: 60  },
    { type: "demon",     name: "Demon",     element: "dark",  str: 9,  dex: 6, int: 6, luk: 4, con: 8, goldDrop: 150, experienceReward: 60, baseMsPerAttack: 2000, strength: 75  },
    { type: "nightmare", name: "Nightmare", element: "dark",  str: 8,  dex: 8, int: 7, luk: 5, con: 7, goldDrop: 175, experienceReward: 75, baseMsPerAttack: 2000, strength: 85  },
    { type: "archfiend", name: "Archfiend", element: "light", str: 10, dex: 7, int: 8, luk: 3, con: 9, goldDrop: 200, experienceReward: 90, baseMsPerAttack: 2000, strength: 100 },
  ];
  for (const monster of monsters) {
    const existing = await ctx.db.query("monsters").withIndex("by_type", (q) => q.eq("type", monster.type)).first();
    if (existing) {
      await ctx.db.patch(existing._id, monster);
    } else {
      await ctx.db.insert("monsters", { ...monster, createdAt: Date.now() });
    }
  }
}

async function populateUpgrades(ctx: MutationCtx) {
  const upgrades: Array<{
    upgradeId: string; name: string; category: string; cost: number; description: string;
    effectType: string; effectStat?: string; effectAmount?: number; minTier?: number; minLevel?: number;
  }> = [
    { upgradeId: "str_boost_1",      name: "Strength Training I", category: "stat-boost", cost: 100, description: "+5 STR", effectType: "stat-boost", effectStat: "str", effectAmount: 5, minTier: 1 },
    { upgradeId: "dex_boost_1",      name: "Agility Training I",  category: "stat-boost", cost: 100, description: "+5 DEX", effectType: "stat-boost", effectStat: "dex", effectAmount: 5, minTier: 1 },
    { upgradeId: "int_boost_1",      name: "Magical Aptitude I",  category: "stat-boost", cost: 100, description: "+5 INT", effectType: "stat-boost", effectStat: "int", effectAmount: 5, minTier: 1 },
    { upgradeId: "luk_boost_1",      name: "Fortune's Favor I",   category: "stat-boost", cost: 100, description: "+5 LUK", effectType: "stat-boost", effectStat: "luk", effectAmount: 5, minTier: 1 },
    { upgradeId: "con_boost_1",      name: "Toughening I",        category: "stat-boost", cost: 100, description: "+5 CON", effectType: "stat-boost", effectStat: "con", effectAmount: 5, minTier: 1 },
    { upgradeId: "auto_attack",      name: "Automated Striking",  category: "auto",       cost: 500, description: "Enable automatic attacks at your attack speed", effectType: "enable-auto-attack",      minTier: 2, minLevel: 20 },
    { upgradeId: "auto_start_fight", name: "Battle Automation",   category: "auto",       cost: 750, description: "Automatically start the next fight",        effectType: "enable-auto-start-fight", minTier: 2, minLevel: 25 },
  ];
  for (const upgrade of upgrades) {
    const existing = await ctx.db.query("upgrades").withIndex("by_upgradeId", (q) => q.eq("upgradeId", upgrade.upgradeId)).first();
    if (existing) {
      await ctx.db.patch(existing._id, upgrade);
    } else {
      await ctx.db.insert("upgrades", { ...upgrade, createdAt: Date.now() });
    }
  }
}

async function populateItemRarities(ctx: MutationCtx) {
  for (const rarity of DEFAULT_ITEM_RARITIES) {
    const existing = await ctx.db
      .query("itemRarities")
      .withIndex("by_level", (q) => q.eq("level", rarity.level))
      .first();
    if (existing) continue;

    const now = Date.now();
    await ctx.db.insert("itemRarities", {
      ...rarity,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function populateGameBalance(ctx: MutationCtx) {
  const entries: Array<{ key: string; value: unknown; description: string }> = [
    { key: "tierScaleMultiplier",  value: 2,                            description: "Doubles monster stats per tier level" },
    { key: "tierScaleMsReduction", value: 50,                           description: "Monster attack speed reduction per tier (ms)" },
    { key: "minAttackMs",          value: 800,                          description: "Minimum milliseconds between monster attacks" },
    { key: "bossStatMultiplier",   value: 3,                            description: "Boss stat multiplier over the strongest regular monster before tier scaling" },
    { key: "bossUnlockLevelPerTier", value: DEFAULT_BOSS_UNLOCK_LEVEL_PER_TIER, description: "Character levels required per boss tier (tier multiplied by this value)" },
    { key: "maxTier",              value: 20,                           description: "Maximum tier available to fight" },
    { key: "rebirthThresholds",    value: [5, 10, 15, 21, 28, 36, 45], description: "Tier thresholds required for each rebirth" },
    { key: "startingStats",        value: { str: 1, dex: 1, int: 1, luk: 1, con: 1 }, description: "Starting stats for new players" },
    { key: "inventorySlotCapacity", value: 50,                     description: "Maximum number of unequipped inventory stacks or item instances" },
    { key: "statUpgradeCostMultiplier", value: 2, description: "Cost multiplier applied to each paid stat-upgrade level" },
    { key: "statUpgradeLevelRequirements", value: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377], description: "Character levels required for paid stat-upgrade levels" },
    { key: "taskQueueCapacity", value: 5, description: "Maximum number of active and queued tasks per player" },
    { key: "offlineTaskWindowMs", value: 4 * 60 * 60 * 1000, description: "Maximum offline progress window for offline-capable tasks (milliseconds)" },
    { key: "taskHeartbeatGraceMs", value: 15 * 1000, description: "Maximum heartbeat gap treated as online task time (milliseconds)" },
    { key: "autoBattleBatchLimit", value: 5, description: "Maximum auto-battle fights resolved per online heartbeat" },
    { key: "autoBattleCreditCapMs", value: 5 * 60 * 1000, description: "Maximum online auto-battle time banked between heartbeats (milliseconds)" },
    { key: "respawnTimeMs", value: 5 * 1000, description: "Recovery time after a defeated battle before the next encounter (milliseconds)" },
    { key: "autoBattleRewards", value: { goldPerTier: 100, goldVariance: 50, experiencePerTier: 50, experienceVariance: 25 }, description: "Server-side regular auto-battle reward formula" },
    { key: "monsterPowerMultiplier", value: DEFAULT_MONSTER_POWER_MULTIPLIER, description: "Multiplier for regular-monster HP and damage (1 = original strength)" },
    { key: "bazaarTaxPercent", value: DEFAULT_BAZAAR_TAX_PERCENT, description: "Marketplace tax percent deducted from the seller's proceeds on every Bazaar trade (rounded down)" },
    { key: "bazaarOrderExpiryDays", value: DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS, description: "Days before an open Bazaar order expires and its escrow can be reclaimed" },
    { key: "bazaarMaxOpenOrders", value: DEFAULT_BAZAAR_MAX_OPEN_ORDERS, description: "Maximum number of active Bazaar orders a player may have open at once" },
    { ...PASSIVE_POINT_BALANCE_DEFAULT },
    ...SKILL_TASK_BALANCE_DEFAULTS,
    ...TASK_SYNC_BALANCE_DEFAULTS,
    ...INFUSION_BALANCE_DEFAULTS,
  ];
  for (const entry of entries) {
    const existing = await ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", entry.key)).first();
    if (!existing) {
      await ctx.db.insert("gameBalance", { ...entry, lastUpdated: Date.now() });
    }
  }
}

async function populateTaskDefinitions(ctx: MutationCtx) {
  const now = Date.now();
  const definitions = [
    {
      taskId: "auto_battle",
      name: "Auto-battle",
      category: "battle",
      description:
        "Fight regular monsters at a selected tier while the player remains online. Available to everyone.",
      canProgressOffline: false,
      requiresOnline: true,
      enabled: true,
      prerequisites: {},
      rewards: { uses: "autoBattleRewards" },
    },
  ];

  for (const definition of definitions) {
    const existing = await ctx.db
      .query("taskDefinitions")
      .withIndex("by_taskId", (q) => q.eq("taskId", definition.taskId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: definition.description,
        prerequisites: definition.prerequisites,
        updatedAt: now,
      });
      continue;
    }

    await ctx.db.insert("taskDefinitions", {
      ...definition,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function populateHiddenSpots(ctx: MutationCtx) {
  const spots = [
    { spotId: "spot_1", x: 15, y: 25, rewardUpgradeId: "str_boost_1", radius: 20 },
    { spotId: "spot_2", x: 85, y: 30, rewardUpgradeId: "dex_boost_1", radius: 20 },
    { spotId: "spot_3", x: 50, y: 80, rewardUpgradeId: "con_boost_1", radius: 20 },
  ];
  for (const spot of spots) {
    const existing = await ctx.db.query("hiddenSpots").withIndex("by_spotId", (q) => q.eq("spotId", spot.spotId)).first();
    if (existing) {
      await ctx.db.patch(existing._id, spot);
    } else {
      await ctx.db.insert("hiddenSpots", { ...spot, createdAt: Date.now() });
    }
  }
}

// ─── Public queries ───────────────────────────────────────────────────────────

export const getAllMonsters = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("monsters").collect();
  },
});

export const getMonster = query({
  args: { type: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("monsters")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
  },
});

export const getAllUpgrades = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("upgrades").collect();
  },
});

export const getUpgrade = query({
  args: { upgradeId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("upgrades")
      .withIndex("by_upgradeId", (q) => q.eq("upgradeId", args.upgradeId))
      .first();
  },
});

export const getAllGameBalance = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("gameBalance").collect();
  },
});

export const getGameBalance = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

export const getScaledBoss = query({
  args: {
    tier: v.number(),
    playerId: v.id("players"),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.tier) || args.tier < 1) {
      throw new Error("Boss tier must be a positive integer");
    }

    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error("Player not found");
    }

    const boss = await ctx.db
      .query("bosses")
      .withIndex("by_tier", (q) => q.eq("tier", args.tier))
      .first();
    if (!boss) return null;

    const mult = boss.statsTierScaled
      ? 1
      : getTierScale(args.tier, await getTierScaleMultiplier(ctx));

    return {
      ...boss,
      element: bossElementForTier(args.tier),
      str: scaleBossStat(boss.str, mult),
      dex: scaleBossStat(boss.dex, mult),
      int: scaleBossStat(boss.int, mult),
      luk: scaleBossStat(boss.luk, mult),
      con: scaleBossStat(boss.con, mult),
    };
  },
});

export const getHiddenSpots = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("hiddenSpots").collect();
  },
});

// ─── Monster selection ────────────────────────────────────────────────────────

/** Pick a weighted-random monster (weaker = more common), optionally within a zone. */
export const pickRandomMonster = query({
  args: { zone: v.optional(combatZoneValidator) },
  handler: async (ctx, args) => {
    const allMonsters = await ctx.db.query("monsters").collect();
    const monsters =
      args.zone === undefined ? allMonsters : monstersInZone(allMonsters, args.zone);
    if (monsters.length === 0) return null;
    const maxStrength = Math.max(...monsters.map((m) => m.strength));
    const weights = monsters.map((m) => maxStrength - m.strength + 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    for (let i = 0; i < monsters.length; i++) {
      random -= weights[i];
      if (random <= 0) return monsters[i];
    }
    return monsters[monsters.length - 1];
  },
});

/** Scale a specific monster's stats for a given tier. */
export const getScaledMonster = query({
  args: { type: v.string(), tier: v.number() },
  handler: async (ctx, args) => {
    const monster = await ctx.db
      .query("monsters")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (!monster) return null;

    const [multiplierRow, msReductionRow, minMsRow] = await Promise.all([
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "tierScaleMultiplier")).first(),
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "tierScaleMsReduction")).first(),
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "minAttackMs")).first(),
    ]);

    const tierMultiplier  = (multiplierRow?.value  as number) ?? 2;
    const tierMsReduction = (msReductionRow?.value as number) ?? 50;
    const minAttackMs     = (minMsRow?.value        as number) ?? 800;
    const mult = Math.pow(tierMultiplier, args.tier - 1);

    return {
      ...monster,
      str: Math.round(monster.str * mult),
      dex: Math.round(monster.dex * mult),
      int: Math.round(monster.int * mult),
      luk: Math.round(monster.luk * mult),
      con: Math.round(monster.con * mult),
      goldDrop:         Math.round(monster.goldDrop         * mult),
      experienceReward: Math.round(monster.experienceReward * mult),
      baseMsPerAttack:  Math.max(minAttackMs, monster.baseMsPerAttack - (args.tier - 1) * tierMsReduction),
    };
  },
});

/** Pick a random weighted monster AND scale it — one-shot call for FightArea. */
export const pickAndScaleMonster = query({
  args: { tier: v.number(), zone: v.optional(combatZoneValidator) },
  handler: async (ctx, args) => {
    const allMonsters = await ctx.db.query("monsters").collect();
    const monsters =
      args.zone === undefined ? allMonsters : monstersInZone(allMonsters, args.zone);
    if (monsters.length === 0) return null;

    const maxStrength = Math.max(...monsters.map((m) => m.strength));
    const weights = monsters.map((m) => maxStrength - m.strength + 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let monster = monsters[monsters.length - 1];
    for (let i = 0; i < monsters.length; i++) {
      random -= weights[i];
      if (random <= 0) { monster = monsters[i]; break; }
    }

    const [multiplierRow, msReductionRow, minMsRow] = await Promise.all([
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "tierScaleMultiplier")).first(),
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "tierScaleMsReduction")).first(),
      ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", "minAttackMs")).first(),
    ]);

    const tierMultiplier  = (multiplierRow?.value  as number) ?? 2;
    const tierMsReduction = (msReductionRow?.value as number) ?? 50;
    const minAttackMs     = (minMsRow?.value        as number) ?? 800;
    const mult = Math.pow(tierMultiplier, args.tier - 1);

    return {
      ...monster,
      str: Math.round(monster.str * mult),
      dex: Math.round(monster.dex * mult),
      int: Math.round(monster.int * mult),
      luk: Math.round(monster.luk * mult),
      con: Math.round(monster.con * mult),
      goldDrop:         Math.round(monster.goldDrop         * mult),
      experienceReward: Math.round(monster.experienceReward * mult),
      baseMsPerAttack:  Math.max(minAttackMs, monster.baseMsPerAttack - (args.tier - 1) * tierMsReduction),
    };
  },
});

// ─── Achievement and Rebirth Reward Seeding ───────────────────────────────────

async function populateAchievements(ctx: MutationCtx) {
  const achievements = [
    { achievementId: "first-kill", name: "First Blood", description: "Defeat your first enemy", condition: "firstFight" },
    { achievementId: "tier-5", name: "Tier 5 Warrior", description: "Reach Tier 5", condition: "reachTier:5" },
    { achievementId: "tier-10", name: "Tier 10 Hero", description: "Reach Tier 10", condition: "reachTier:10" },
    { achievementId: "tier-20", name: "Tier 20 Legend", description: "Reach Tier 20", condition: "reachTier:20" },
    { achievementId: "first-rebirth", name: "Reborn", description: "Complete your first rebirth", condition: "firstRebirth" },
    { achievementId: "tier-100-xp", name: "XP Collector", description: "Earn 10,000 total XP", condition: "totalXP:10000" },
  ];
  for (const achievement of achievements) {
    const existing = await ctx.db.query("achievements").withIndex("by_achievementId", (q) => q.eq("achievementId", achievement.achievementId)).first();
    if (!existing) {
      await ctx.db.insert("achievements", { ...achievement, icon: "⭐", createdAt: Date.now() });
    }
  }
}

async function populateRebirthRewards(ctx: MutationCtx) {
  const rewards = [
    { rebirthLevel: 1, name: "Gold Multiplier I", description: "+10% gold per kill", effectType: "gold-multiplier", effectValue: 1.1 },
    { rebirthLevel: 2, name: "XP Multiplier I", description: "+15% XP per kill", effectType: "xp-multiplier", effectValue: 1.15 },
    { rebirthLevel: 3, name: "Gold Multiplier II", description: "+20% gold per kill", effectType: "gold-multiplier", effectValue: 1.2 },
    { rebirthLevel: 4, name: "Stat Boost I", description: "+5% all stats", effectType: "stat-multiplier", effectValue: 1.05 },
    { rebirthLevel: 5, name: "Critical Chance", description: "+10% crit chance", effectType: "crit-chance", effectValue: 0.1 },
  ];
  for (const reward of rewards) {
    const existing = await ctx.db.query("rebirthRewards").withIndex("by_rebirthLevel", (q) => q.eq("rebirthLevel", reward.rebirthLevel)).first();
    if (!existing) {
      await ctx.db.insert("rebirthRewards", { ...reward, createdAt: Date.now() });
    }
  }
}

async function populateChatMessages(ctx: MutationCtx) {
  const now = Date.now();
  for (const message of WORLD_CHAT_SEED_MESSAGES) {
    const existing = await ctx.db
      .query("chatMessages")
      .withIndex("by_seedId", (q) => q.eq("seedId", message.seedId))
      .first();
    if (existing) continue;

    await ctx.db.insert("chatMessages", {
      channelType: "world",
      channelId: "world",
      senderName: message.senderName,
      content: message.content,
      createdAt: now - message.minutesAgo * 60_000,
      seedId: message.seedId,
    });
  }
}

/** Populate all seed data (monsters, upgrades, balance, hidden spots, achievements, rewards, chat) */
export const populateAll = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);
    const startTime = Date.now();
    await populateMonsters(ctx);
    await populateUpgrades(ctx);
    await populateItemRarities(ctx);
    await populateGameBalance(ctx);
    await populateTaskDefinitions(ctx);
    await seedPassiveContent(ctx);
    await ensureBossForTier(ctx, 1);
    await ensureBossForTier(ctx, 2);
    await ensureBossForTier(ctx, 3);
    await seedForestCraftingContent(ctx);
    await validateAllRecipeChains(ctx);
    await populateHiddenSpots(ctx);
    await populateAchievements(ctx);
    await populateRebirthRewards(ctx);
    await populateChatMessages(ctx);
    const duration = Date.now() - startTime;
    return { success: true, message: `Seeded all tables in ${duration}ms` };
  },
});

/**
 * Non-destructive upsert of forest crafting content (incl. infusion).
 * Runs seedForestCraftingContent + recipe validation without wiping player
 * data. Invoke from CLI against self-hosted:
 * npx convex run --env-file docker/.env.selfhosted seed:upsertForestCrafting '{}'
 */
export const upsertForestCrafting = internalMutation({
  args: {},
  handler: async (ctx) => {
    await seedForestCraftingContent(ctx);
    await validateAllRecipeChains(ctx);
    return { success: true };
  },
});

/**
 * Development-only reset for the forest crafting expansion. Combat progression,
 * character stats, gold, and fight history intentionally remain untouched.
 */
export const resetForestCrafting = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);

    const craftingSkillIds = new Set([
      "harvesting",
      "woodcutting",
      "mining",
      "alchemy",
      "woodworking",
      "forging",
      "infusion",
      "leathercrafting",
    ]);
    const skillActionTaskIds = new Set<string>();

    for (const task of await ctx.db.query("playerTasks").collect()) {
      if (
        isRecord(task.payload) &&
        (task.payload.actionType === "gathering" ||
          task.payload.actionType === "crafting")
      ) {
        skillActionTaskIds.add(String(task._id));
        await ctx.db.delete(task._id);
        if (!task.canProgressOffline) {
          const presence = await ctx.db.query("taskPresence")
            .withIndex("by_playerId", (q) => q.eq("playerId", task.playerId)).unique();
          if (presence?.taskId === task._id) await ctx.db.delete(presence._id);
        }
      }
    }

    for (const history of await ctx.db.query("skillActionHistory").collect()) {
      if (
        history.actionType === "gathering" ||
        history.actionType === "crafting" ||
        history.actionType === "augmentation"
      ) {
        if (history.taskId) skillActionTaskIds.add(String(history.taskId));
        await ctx.db.delete(history._id);
      }
    }

    for (const history of await ctx.db.query("taskHistory").collect()) {
      if (skillActionTaskIds.has(String(history.taskId))) {
        await ctx.db.delete(history._id);
      }
    }
    for (const battleStat of await ctx.db.query("taskBattleStats").collect()) {
      if (skillActionTaskIds.has(String(battleStat.taskId))) {
        await ctx.db.delete(battleStat._id);
      }
    }

    for (const playerItemAugment of await ctx.db
      .query("playerItemAugments")
      .collect()) {
      await ctx.db.delete(playerItemAugment._id);
    }
    for (const playerItem of await ctx.db.query("playerItems").collect()) {
      await ctx.db.delete(playerItem._id);
    }

    for (const playerSkill of await ctx.db.query("playerSkills").collect()) {
      if (craftingSkillIds.has(playerSkill.skillId)) {
        await ctx.db.delete(playerSkill._id);
      }
    }

    const recipes = await ctx.db.query("recipes").collect();
    const recipeIds = new Set(recipes.map((recipe) => recipe.recipeId));
    for (const row of await ctx.db.query("recipeIngredients").collect()) {
      if (recipeIds.has(row.recipeId)) await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db.query("recipeOutputs").collect()) {
      if (recipeIds.has(row.recipeId)) await ctx.db.delete(row._id);
    }
    for (const recipe of recipes) await ctx.db.delete(recipe._id);
    for (const activity of await ctx.db.query("gatheringActivities").collect()) {
      if (craftingSkillIds.has(activity.skillId)) await ctx.db.delete(activity._id);
    }
    for (const tier of await ctx.db.query("skillTierDefinitions").collect()) {
      if (craftingSkillIds.has(tier.skillId)) await ctx.db.delete(tier._id);
    }
    for (const skill of await ctx.db.query("skillDefinitions").collect()) {
      if (craftingSkillIds.has(skill.skillId)) await ctx.db.delete(skill._id);
    }
    for (const augmentation of await ctx.db
      .query("augmentationDefinitions")
      .collect()) {
      await ctx.db.delete(augmentation._id);
    }

    for (const lootEntry of await ctx.db.query("lootTableEntries").collect()) {
      await ctx.db.delete(lootEntry._id);
    }
    for (const lootSource of await ctx.db.query("lootSources").collect()) {
      await ctx.db.delete(lootSource._id);
    }
    for (const lootTable of await ctx.db.query("lootTables").collect()) {
      await ctx.db.delete(lootTable._id);
    }
    for (const lootAward of await ctx.db.query("lootAwards").collect()) {
      await ctx.db.delete(lootAward._id);
    }

    const items = await ctx.db.query("items").collect();
    const forestItemIds = new Set<string>();
    for (const item of items) {
      if (item.craftingSkillId !== undefined || item.itemFamily !== undefined) {
        forestItemIds.add(String(item._id));
      }
    }
    for (const reward of await ctx.db.query("pendingRewards").collect()) {
      if (
        reward.sourceType === "skill" ||
        reward.sourceType === "crafting" ||
        forestItemIds.has(String(reward.itemId))
      ) {
        await ctx.db.delete(reward._id);
      }
    }
    for (const item of items) {
      if (forestItemIds.has(String(item._id))) {
        await ctx.db.delete(item._id);
      }
    }

    await seedForestCraftingContent(ctx);
    await validateAllRecipeChains(ctx);
    return {
      success: true,
      message: "Forest crafting content reset and reseeded",
    };
  },
});

// ─── Bazaar order book seeding ───────────────────────────────────────────────

const BAZAAR_SEED_TRADER_PREFIX = "bazaar-trader-";
const BAZAAR_SEED_TRADER_ADJECTIVES = [
  "Swift", "Iron", "Golden", "Mystic", "Shadow", "Crimson", "Azure", "Emerald",
  "Frost", "Blaze", "Storm", "Dusk", "Dawn", "Cobalt", "Amber", "Silver",
  "Rusty", "Velvet", "Thorn", "Gilded",
];
const BAZAAR_SEED_TRADER_ROLES = [
  "Trader", "Merchant", "Peddler", "Broker", "Hawker", "Dealer", "Wanderer",
  "Factor",
];
// Seeded orders are backdated up to 6h so "newest" sorting looks organic;
// expiry still lands a full config period after creation.
const BAZAAR_SEED_TIME_JITTER_MS = 6 * 60 * 60 * 1000;
const BAZAAR_SEED_FALLBACK_REBIRTH_THRESHOLD = 5;
// Stackable seed orders hold at most 30 units regardless of stack size.
const BAZAAR_SEED_MAX_STACK_QUANTITY = 30;

/** Deterministic PRNG so re-seeding always produces the same order book. */
function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unique display name for a seeded trader (covers up to 160 traders). */
function seedTraderName(index: number) {
  const adjective =
    BAZAAR_SEED_TRADER_ADJECTIVES[index % BAZAAR_SEED_TRADER_ADJECTIVES.length];
  const role =
    BAZAAR_SEED_TRADER_ROLES[
      Math.floor(index / BAZAAR_SEED_TRADER_ADJECTIVES.length) %
        BAZAAR_SEED_TRADER_ROLES.length
    ];
  const base = `${adjective} ${role}`;
  const uniqueCount =
    BAZAAR_SEED_TRADER_ADJECTIVES.length * BAZAAR_SEED_TRADER_ROLES.length;
  return index < uniqueCount ? base : `${base} ${index + 1}`;
}

/**
 * Rough plausible gold value for an item, calibrated against the game's
 * economy (upgrade costs run 100–750g, monster drops 10–200g, players hold
 * ~2k–290k gold). Rarity runs 10..80 in steps of 10 (Common → beyond
 * Mythical), so it is squashed into a step number first. Seed prices are test
 * data, not balance — the tax/expiry/cap they trade under come from
 * gameBalance via readBazaarConfig.
 */
function seedBasePrice(item: Doc<"items">): number {
  const rarityStep = Math.max(1, Math.floor((item.rarityLevel ?? 10) / 10));
  if (!item.stackable) {
    // Common gear ~500g, Epic ~3–5k, endgame ~8–11k.
    const stat = (item.baseDamage ?? 0) + (item.baseDefense ?? 0);
    return rarityStep * rarityStep * 100 + stat * 40 + 60;
  }
  // Common mats ~30g, Epic ~180g, top-tier ~550g.
  return rarityStep * rarityStep * 6 + (item.craftingTier ?? 1) * 20 + 5;
}

/**
 * Seed the Bazaar with buy and sell orders covering every catalog item.
 *
 * Orders are owned by generated trader players (anonymousId prefix
 * "bazaar-trader-") because self-trading is blocked and the open-order cap
 * applies per player — each trader holds at most config.maxOpenOrders orders.
 * Buy prices sit below sell prices for the same item so the seeded book has a
 * normal spread instead of crossed pairs. Sell orders escrow items directly
 * (equivalent to a trader that never held them in inventory); buy orders
 * escrow their full trade total in escrowedGold.
 *
 * Re-running deletes previously seeded traders and all their orders first,
 * then rebuilds the book deterministically. Non-seed players and their orders
 * are never touched.
 *
 * Usage: npx convex run seed:seedBazaarOrders '{"playerId":"..."}'
 */
export const seedBazaarOrders = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx, playerId);
    const now = Date.now();
    const config = await readBazaarConfig(ctx);
    const random = createSeededRandom(0x9e3779b9);

    // Reset previous seed traders (and every order they own) so re-runs don't
    // stack duplicates. Only rows with the seed prefix are touched.
    let resetTraders = 0;
    for (const player of await ctx.db.query("players").collect()) {
      if (!player.anonymousId.startsWith(BAZAAR_SEED_TRADER_PREFIX)) continue;
      const orders = await ctx.db
        .query("marketOrders")
        .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
        .collect();
      for (const order of orders) {
        await ctx.db.delete(order._id);
      }
      await ctx.db.delete(player._id);
      resetTraders += 1;
    }

    const items = await ctx.db.query("items").take(CATALOG_FETCH_LIMIT);
    if (items.length === 0) {
      return {
        success: false,
        message: "No items found — run seed:populateAll first",
        resetTraders,
        traders: 0,
        sellOrders: 0,
        buyOrders: 0,
        itemsCovered: 0,
      };
    }

    type OrderSpec = {
      side: "buy" | "sell";
      itemId: Id<"items">;
      quantity: number;
      unitPrice: number;
    };
    const specs: OrderSpec[] = [];
    for (const item of items) {
      const basePrice = seedBasePrice(item);
      const quantity = item.stackable
        ? 1 +
          Math.floor(
            random() *
              Math.max(1, Math.min(item.maxStackSize, BAZAAR_SEED_MAX_STACK_QUANTITY))
          )
        : 1; // Equipment always trades one unit at a time.
      const bid = Math.max(1, Math.floor(basePrice * (0.75 + 0.2 * random())));
      const ask = Math.max(
        bid + 1,
        Math.ceil(basePrice * (1.05 + 0.35 * random()))
      );
      specs.push({ side: "buy", itemId: item._id, quantity, unitPrice: bid });
      specs.push({ side: "sell", itemId: item._id, quantity, unitPrice: ask });
    }

    // Mirror getOrCreatePlayer's rebirth threshold with a validated fallback.
    const thresholdsRow = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "rebirthThresholds"))
      .first();
    const thresholds = thresholdsRow?.value;
    const rebirthTierThreshold =
      Array.isArray(thresholds) &&
      typeof thresholds[0] === "number" &&
      Number.isSafeInteger(thresholds[0]) &&
      thresholds[0] >= 1
        ? thresholds[0]
        : BAZAAR_SEED_FALLBACK_REBIRTH_THRESHOLD;

    let traders = 0;
    let sellOrders = 0;
    let buyOrders = 0;
    for (let start = 0; start < specs.length; start += config.maxOpenOrders) {
      const slice = specs.slice(start, start + config.maxOpenOrders);
      const traderId = await ctx.db.insert("players", {
        anonymousId: `${BAZAAR_SEED_TRADER_PREFIX}${traders}`,
        name: seedTraderName(traders),
        str: 10,
        dex: 10,
        int: 10,
        luk: 10,
        con: 10,
        statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0 },
        gold: 100 + Math.floor(random() * 400),
        totalExperience: 0,
        rebirthCount: 0,
        rebirthTierThreshold,
        currentTier: 1,
        maxTierReached: 1,
        autoAttackEnabled: true,
        autoStartFightEnabled: false,
        createdAt: now,
        lastUpdated: now,
      });
      traders += 1;

      for (const spec of slice) {
        const createdAt = now - Math.floor(random() * BAZAAR_SEED_TIME_JITTER_MS);
        await ctx.db.insert("marketOrders", {
          playerId: traderId,
          side: spec.side,
          itemId: spec.itemId,
          quantity: spec.quantity,
          originalQuantity: spec.quantity,
          unitPrice: spec.unitPrice,
          status: "open",
          ...(spec.side === "buy"
            ? { escrowedGold: spec.quantity * spec.unitPrice }
            : {}),
          createdAt,
          updatedAt: createdAt,
          expiresAt: createdAt + config.expiryMs,
        });
        if (spec.side === "buy") {
          buyOrders += 1;
        } else {
          sellOrders += 1;
        }
      }
    }

    return {
      success: true,
      message: `Seeded ${specs.length} Bazaar orders across ${traders} traders (${resetTraders} previous seed traders reset)`,
      resetTraders,
      traders,
      sellOrders,
      buyOrders,
      itemsCovered: items.length,
    };
  },
});

export const getAllAchievements = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("achievements").collect();
  },
});

export const getRebirthRewards = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("rebirthRewards").collect();
  },
});

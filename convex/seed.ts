/**
 * Database seeding functions
 * Populates monsters, upgrades, balance, and hidden spots
 *
 * Usage: npx convex run seed:populateAll
 * Safe to call multiple times — upserts existing records.
 */

import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function populateMonsters(ctx: MutationCtx) {
  const monsters = [
    { type: "rat",       name: "Rat",       str: 2,  dex: 4, int: 1, luk: 2, con: 2, goldDrop: 10,  experienceReward: 5,  baseMsPerAttack: 2000, strength: 5   },
    { type: "goblin",    name: "Goblin",    str: 3,  dex: 3, int: 2, luk: 3, con: 3, goldDrop: 15,  experienceReward: 8,  baseMsPerAttack: 2000, strength: 15  },
    { type: "orc",       name: "Orc",       str: 4,  dex: 2, int: 2, luk: 1, con: 4, goldDrop: 20,  experienceReward: 12, baseMsPerAttack: 2000, strength: 25  },
    { type: "troll",     name: "Troll",     str: 6,  dex: 3, int: 3, luk: 2, con: 6, goldDrop: 50,  experienceReward: 25, baseMsPerAttack: 2000, strength: 40  },
    { type: "wyvern",    name: "Wyvern",    str: 5,  dex: 5, int: 4, luk: 3, con: 5, goldDrop: 60,  experienceReward: 30, baseMsPerAttack: 2000, strength: 50  },
    { type: "dragon",    name: "Dragon",    str: 7,  dex: 4, int: 5, luk: 2, con: 7, goldDrop: 75,  experienceReward: 40, baseMsPerAttack: 2000, strength: 60  },
    { type: "demon",     name: "Demon",     str: 9,  dex: 6, int: 6, luk: 4, con: 8, goldDrop: 150, experienceReward: 60, baseMsPerAttack: 2000, strength: 75  },
    { type: "nightmare", name: "Nightmare", str: 8,  dex: 8, int: 7, luk: 5, con: 7, goldDrop: 175, experienceReward: 75, baseMsPerAttack: 2000, strength: 85  },
    { type: "archfiend", name: "Archfiend", str: 10, dex: 7, int: 8, luk: 3, con: 9, goldDrop: 200, experienceReward: 90, baseMsPerAttack: 2000, strength: 100 },
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
    effectType: string; effectStat?: string; effectAmount?: number; minTier?: number;
  }> = [
    { upgradeId: "str_boost_1",      name: "Strength Training I", category: "stat-boost", cost: 100, description: "+5 STR", effectType: "stat-boost", effectStat: "str", effectAmount: 5, minTier: 1 },
    { upgradeId: "dex_boost_1",      name: "Agility Training I",  category: "stat-boost", cost: 100, description: "+5 DEX", effectType: "stat-boost", effectStat: "dex", effectAmount: 5, minTier: 1 },
    { upgradeId: "int_boost_1",      name: "Magical Aptitude I",  category: "stat-boost", cost: 100, description: "+5 INT", effectType: "stat-boost", effectStat: "int", effectAmount: 5, minTier: 1 },
    { upgradeId: "luk_boost_1",      name: "Fortune's Favor I",   category: "stat-boost", cost: 100, description: "+5 LUK", effectType: "stat-boost", effectStat: "luk", effectAmount: 5, minTier: 1 },
    { upgradeId: "con_boost_1",      name: "Toughening I",        category: "stat-boost", cost: 100, description: "+5 CON", effectType: "stat-boost", effectStat: "con", effectAmount: 5, minTier: 1 },
    { upgradeId: "auto_attack",      name: "Automated Striking",  category: "auto",       cost: 500, description: "Enable automatic attacks",       effectType: "enable-auto-attack",      minTier: 2 },
    { upgradeId: "auto_start_fight", name: "Battle Automation",   category: "auto",       cost: 750, description: "Automatically start next fight", effectType: "enable-auto-start-fight", minTier: 2 },
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

async function populateGameBalance(ctx: MutationCtx) {
  const entries: Array<{ key: string; value: unknown; description: string }> = [
    { key: "tierScaleMultiplier",  value: 1.15,                         description: "Exponential multiplier per tier level" },
    { key: "tierScaleMsReduction", value: 50,                           description: "Monster attack speed reduction per tier (ms)" },
    { key: "minAttackMs",          value: 800,                          description: "Minimum milliseconds between monster attacks" },
    { key: "maxTier",              value: 20,                           description: "Maximum tier available to fight" },
    { key: "rebirthThresholds",    value: [5, 10, 15, 21, 28, 36, 45], description: "Tier thresholds required for each rebirth" },
    { key: "startingStats",        value: { str: 5, dex: 5, int: 5, luk: 5, con: 5 }, description: "Starting stats for new players" },
  ];
  for (const entry of entries) {
    const existing = await ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", entry.key)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: entry.value, lastUpdated: Date.now() });
    } else {
      await ctx.db.insert("gameBalance", { ...entry, lastUpdated: Date.now() });
    }
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

export const getHiddenSpots = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("hiddenSpots").collect();
  },
});

// ─── Monster selection ────────────────────────────────────────────────────────

/** Pick a weighted-random monster (weaker = more common). */
export const pickRandomMonster = query({
  args: {},
  handler: async (ctx) => {
    const monsters = await ctx.db.query("monsters").collect();
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

    const tierMultiplier  = (multiplierRow?.value  as number) ?? 1.15;
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
  args: { tier: v.number() },
  handler: async (ctx, args) => {
    const monsters = await ctx.db.query("monsters").collect();
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

    const tierMultiplier  = (multiplierRow?.value  as number) ?? 1.15;
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

/** Populate all seed data (monsters, upgrades, balance, hidden spots, achievements, rewards) */
export const populateAll = mutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    await populateMonsters(ctx);
    await populateUpgrades(ctx);
    await populateGameBalance(ctx);
    await populateHiddenSpots(ctx);
    await populateAchievements(ctx);
    await populateRebirthRewards(ctx);
    const duration = Date.now() - startTime;
    return { success: true, message: `Seeded all tables in ${duration}ms` };
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

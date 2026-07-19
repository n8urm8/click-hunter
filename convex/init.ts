/**
 * Convex initialization — runs once on first deploy when tables are empty.
 * Convex calls the default export of convex/init.ts automatically.
 */

import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

async function seedMonsters(ctx: MutationCtx) {
  const existing = await ctx.db.query("monsters").first();
  if (existing) return; // Already seeded

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
  for (const m of monsters) {
    await ctx.db.insert("monsters", { ...m, createdAt: Date.now() });
  }
}

async function seedUpgrades(ctx: MutationCtx) {
  const existing = await ctx.db.query("upgrades").first();
  if (existing) return;

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
  for (const u of upgrades) {
    await ctx.db.insert("upgrades", { ...u, createdAt: Date.now() });
  }
}

async function seedGameBalance(ctx: MutationCtx) {
  const existing = await ctx.db.query("gameBalance").first();
  if (existing) return;

  const entries: Array<{ key: string; value: unknown; description: string }> = [
    { key: "tierScaleMultiplier",  value: 1.15,                         description: "Exponential multiplier per tier level" },
    { key: "tierScaleMsReduction", value: 50,                           description: "Monster attack speed reduction per tier (ms)" },
    { key: "minAttackMs",          value: 800,                          description: "Minimum milliseconds between monster attacks" },
    { key: "maxTier",              value: 20,                           description: "Maximum tier available to fight" },
    { key: "rebirthThresholds",    value: [5, 10, 15, 21, 28, 36, 45], description: "Tier thresholds required for each rebirth" },
    { key: "startingStats",        value: { str: 5, dex: 5, int: 5, luk: 5, con: 5 }, description: "Starting stats for new players" },
  ];
  for (const e of entries) {
    await ctx.db.insert("gameBalance", { ...e, lastUpdated: Date.now() });
  }
}

async function seedHiddenSpots(ctx: MutationCtx) {
  const existing = await ctx.db.query("hiddenSpots").first();
  if (existing) return;

  const spots = [
    { spotId: "spot_1", x: 15, y: 25, rewardUpgradeId: "str_boost_1", radius: 20 },
    { spotId: "spot_2", x: 85, y: 30, rewardUpgradeId: "dex_boost_1", radius: 20 },
    { spotId: "spot_3", x: 50, y: 80, rewardUpgradeId: "con_boost_1", radius: 20 },
  ];
  for (const s of spots) {
    await ctx.db.insert("hiddenSpots", { ...s, createdAt: Date.now() });
  }
}

async function seedAchievements(ctx: MutationCtx) {
  const existing = await ctx.db.query("achievements").first();
  if (existing) return;

  const achievements = [
    { achievementId: "first-kill", name: "First Blood", description: "Defeat your first enemy", condition: "firstFight" },
    { achievementId: "tier-5", name: "Tier 5 Warrior", description: "Reach Tier 5", condition: "reachTier:5" },
    { achievementId: "tier-10", name: "Tier 10 Hero", description: "Reach Tier 10", condition: "reachTier:10" },
    { achievementId: "tier-20", name: "Tier 20 Legend", description: "Reach Tier 20", condition: "reachTier:20" },
    { achievementId: "first-rebirth", name: "Reborn", description: "Complete your first rebirth", condition: "firstRebirth" },
    { achievementId: "tier-100-xp", name: "XP Collector", description: "Earn 10,000 total XP", condition: "totalXP:10000" },
  ];
  for (const a of achievements) {
    await ctx.db.insert("achievements", { ...a, icon: "⭐", createdAt: Date.now() });
  }
}

async function seedRebirthRewards(ctx: MutationCtx) {
  const existing = await ctx.db.query("rebirthRewards").first();
  if (existing) return;

  const rewards = [
    { rebirthLevel: 1, name: "Gold Multiplier I", description: "+10% gold per kill", effectType: "gold-multiplier", effectValue: 1.1 },
    { rebirthLevel: 2, name: "XP Multiplier I", description: "+15% XP per kill", effectType: "xp-multiplier", effectValue: 1.15 },
    { rebirthLevel: 3, name: "Gold Multiplier II", description: "+20% gold per kill", effectType: "gold-multiplier", effectValue: 1.2 },
    { rebirthLevel: 4, name: "Stat Boost I", description: "+5% all stats", effectType: "stat-multiplier", effectValue: 1.05 },
    { rebirthLevel: 5, name: "Critical Chance", description: "+10% crit chance", effectType: "crit-chance", effectValue: 0.1 },
  ];
  for (const r of rewards) {
    await ctx.db.insert("rebirthRewards", { ...r, createdAt: Date.now() });
  }
}

export default internalMutation({
  args: {},
  handler: async (ctx) => {
    await seedMonsters(ctx);
    await seedUpgrades(ctx);
    await seedGameBalance(ctx);
    await seedHiddenSpots(ctx);
    await seedAchievements(ctx);
    await seedRebirthRewards(ctx);
  },
});

/**
 * Data migrations — run these once after schema changes.
 * Each migration is idempotent and safe to re-run.
 */

import { internalMutation } from "./_generated/server";
import {
  DEFAULT_BOSS_UNLOCK_LEVEL_PER_TIER,
  ensureBossForTier,
  getTierScale,
  getTierScaleMultiplier,
  scaleBossStat,
} from "./bossData";
import {
  DEFAULT_AUTO_BATTLE_BATCH_LIMIT,
  DEFAULT_AUTO_BATTLE_CREDIT_CAP_MS,
  DEFAULT_AUTO_BATTLE_RESPAWN_MS,
  DEFAULT_OFFLINE_TASK_WINDOW_MS,
  DEFAULT_TASK_HEARTBEAT_GRACE_MS,
  DEFAULT_TASK_QUEUE_CAPACITY,
} from "./tasks";
import { SKILL_TASK_BALANCE_DEFAULTS } from "./skillBonuses";
import { TASK_SYNC_BALANCE_DEFAULTS } from "./taskTiming";
import { COMBAT_BALANCE_DEFAULTS } from "./items";
import { HP_REGEN_BALANCE_DEFAULTS } from "./playerHp";
import { LEATHER_BALANCE_DEFAULTS } from "./leatherwork";
import { INFUSION_BALANCE_DEFAULTS } from "./infusion";
import {
  DEFAULT_ITEM_RARITY_LEVEL,
  DEFAULT_ITEM_RARITIES,
} from "./itemTypes";
import { SKILL_XP_BALANCE_DEFAULT } from "./skillProgression";
import {
  DEFAULT_BAZAAR_MAX_OPEN_ORDERS,
  DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS,
  DEFAULT_BAZAAR_TAX_PERCENT,
} from "./bazaar";
import { DEFAULT_MONSTER_POWER_MULTIPLIER } from "./combat";

/**
 * Migration: add item rarity definitions and assign existing items to Common.
 *
 * Run: npx convex run migrations:backfillItemRarities
 */
export const backfillItemRarities = internalMutation({
  args: {},
  handler: async (ctx) => {
    let createdRarities = 0;
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
      createdRarities += 1;
    }

    const items = await ctx.db.query("items").collect();
    let updatedItems = 0;
    for (const item of items) {
      if (item.rarityLevel !== undefined) continue;

      await ctx.db.patch(item._id, {
        rarityLevel: DEFAULT_ITEM_RARITY_LEVEL,
        updatedAt: Date.now(),
      });
      updatedItems += 1;
    }

    return {
      createdRarities,
      updatedItems,
      totalItems: items.length,
    };
  },
});

/**
 * Migration: add the configurable character-level requirement for bosses.
 *
 * Run: npx convex run migrations:backfillBossUnlockLevelPerTier
 */
export const backfillBossUnlockLevelPerTier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "bossUnlockLevelPerTier"))
      .first();
    if (existing) {
      return { created: false };
    }

    await ctx.db.insert("gameBalance", {
      key: "bossUnlockLevelPerTier",
      value: DEFAULT_BOSS_UNLOCK_LEVEL_PER_TIER,
      description:
        "Character levels required per boss tier (tier multiplied by this value)",
      lastUpdated: Date.now(),
    });

    return { created: true };
  },
});

/**
 * Migration: add the configurable inventory capacity.
 *
 * Run: npx convex run migrations:backfillInventorySlotCapacity
 */
export const backfillInventorySlotCapacity = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "inventorySlotCapacity"))
      .first();
    if (existing) {
      return { created: false };
    }

    await ctx.db.insert("gameBalance", {
      key: "inventorySlotCapacity",
      value: 50,
      description:
        "Maximum number of unequipped inventory stacks or item instances",
      lastUpdated: Date.now(),
    });
    return { created: true };
  },
});

/**
 * Migration: add task queue and auto-battle balance entries.
 *
 * Run: npx convex run migrations:backfillTaskQueueConfig
 */
export const backfillTaskQueueConfig = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = [
      ...TASK_SYNC_BALANCE_DEFAULTS,
      {
        key: "taskQueueCapacity",
        value: DEFAULT_TASK_QUEUE_CAPACITY,
        description: "Maximum number of active and queued tasks per player",
      },
      {
        key: "offlineTaskWindowMs",
        value: DEFAULT_OFFLINE_TASK_WINDOW_MS,
        description:
          "Maximum offline progress window for offline-capable tasks (milliseconds)",
      },
      {
        key: "taskHeartbeatGraceMs",
        value: DEFAULT_TASK_HEARTBEAT_GRACE_MS,
        description:
          "Maximum heartbeat gap treated as online task time (milliseconds)",
      },
      {
        key: "autoBattleBatchLimit",
        value: DEFAULT_AUTO_BATTLE_BATCH_LIMIT,
        description: "Maximum auto-battle fights resolved per online heartbeat",
      },
      {
        key: "autoBattleCreditCapMs",
        value: DEFAULT_AUTO_BATTLE_CREDIT_CAP_MS,
        description:
          "Maximum online auto-battle time banked between heartbeats (milliseconds)",
      },
      {
        key: "respawnTimeMs",
        value: DEFAULT_AUTO_BATTLE_RESPAWN_MS,
        description:
          "Recovery time after a defeated battle before the next encounter (milliseconds)",
      },
      {
        key: "autoBattleRewards",
        value: {
          goldPerTier: 100,
          goldVariance: 50,
          experiencePerTier: 50,
          experienceVariance: 25,
        },
        description: "Server-side regular auto-battle reward formula",
      },
    ];
    let created = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (existing) continue;

      await ctx.db.insert("gameBalance", {
        ...entry,
        lastUpdated: Date.now(),
      });
      created += 1;
    }

    return { created };
  },
});

/**
 * Add missing combat settings without rewriting weapon records or live tuning.
 * Run: npx convex run migrations:backfillCombatBalance
 */
export const backfillCombatBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    for (const entry of [...COMBAT_BALANCE_DEFAULTS, ...HP_REGEN_BALANCE_DEFAULTS, ...LEATHER_BALANCE_DEFAULTS]) {
      const existing = await ctx.db.query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key)).first();
      if (existing) continue;
      await ctx.db.insert("gameBalance", { ...entry, lastUpdated: Date.now() });
      created += 1;
    }
    return { created };
  },
});

/**
 * Add missing infusion settings (essence/keys/enchanting) without touching
 * live tuning. Run: npx convex run migrations:backfillInfusionBalance
 */
export const backfillInfusionBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    for (const entry of INFUSION_BALANCE_DEFAULTS) {
      const existing = await ctx.db.query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key)).first();
      if (existing) continue;
      await ctx.db.insert("gameBalance", { ...entry, lastUpdated: Date.now() });
      created += 1;
    }
    return { created };
  },
});
/**
 * Backfill tiers on applied augments from their definitions so chained
 * lines can find predecessors. Run:
 * npx convex run migrations:backfillPlayerItemAugmentTiers '{}'
 */
export const backfillPlayerItemAugmentTiers = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    const defs = await ctx.db.query("augmentationDefinitions").collect();
    const tierById = new Map(defs.map((def) => [def.augmentationId, def.tier]));
    for await (const row of ctx.db.query("playerItemAugments")) {
      if (row.tier !== undefined) continue;
      const tier = tierById.get(row.augmentationId);
      if (tier === undefined) continue;
      await ctx.db.patch(row._id, { tier });
      updated += 1;
    }
    return { updated };
  },
});

/**
 * Restore regular enemies to their original unscaled strength. Only replaces
 * the previous 0.5 default, leaving any other admin-tuned value untouched.
 *
 * Run: npx convex run migrations:restoreMonsterPowerMultiplier
 */
export const restoreMonsterPowerMultiplier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const key = "monsterPowerMultiplier";
    const description =
      "Multiplier for regular-monster HP and damage (1 = original strength)";
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      await ctx.db.insert("gameBalance", {
        key,
        value: DEFAULT_MONSTER_POWER_MULTIPLIER,
        description,
        lastUpdated: Date.now(),
      });
      return { created: true, updated: false };
    }

    if (existing.value !== 0.5) {
      return { created: false, updated: false };
    }

    await ctx.db.patch(existing._id, {
      value: DEFAULT_MONSTER_POWER_MULTIPLIER,
      description,
      lastUpdated: Date.now(),
    });
    return { created: false, updated: true };
  },
});

/**
 * Migration: add XP-based skill timing and scoped global skill modifiers.
 *
 * Run: npx convex run migrations:backfillSkillTaskBalance
 */
export const backfillSkillTaskBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let createdBalanceEntries = 0;
    for (const entry of SKILL_TASK_BALANCE_DEFAULTS) {
      const existing = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (existing) continue;
      await ctx.db.insert("gameBalance", {
        ...entry,
        lastUpdated: Date.now(),
      });
      createdBalanceEntries += 1;
    }

    const augmentations = await ctx.db
      .query("augmentationDefinitions")
      .collect();
    let updatedAugmentations = 0;
    for (const augmentation of augmentations) {
      if (augmentation.experienceReward !== undefined) continue;
      await ctx.db.patch(augmentation._id, {
        experienceReward: 50 * augmentation.tier,
        updatedAt: Date.now(),
      });
      updatedAugmentations += 1;
    }
    return { createdBalanceEntries, updatedAugmentations };
  },
});

/**
 * Migration: raise the default skill XP requirement and configure level scaling.
 *
 * Run: npx convex run migrations:backfillSkillXpProgression
 */
export const backfillSkillXpProgression = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) =>
        q.eq("key", SKILL_XP_BALANCE_DEFAULT.key)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("gameBalance", {
        ...SKILL_XP_BALANCE_DEFAULT,
        lastUpdated: Date.now(),
      });
      return { created: true, updated: false };
    }

    const updateDefaultValue = existing.value === 100;
    if (
      !updateDefaultValue &&
      existing.description === SKILL_XP_BALANCE_DEFAULT.description
    ) {
      return { created: false, updated: false };
    }

    await ctx.db.patch(existing._id, {
      ...(updateDefaultValue
        ? { value: SKILL_XP_BALANCE_DEFAULT.value }
        : {}),
      description: SKILL_XP_BALANCE_DEFAULT.description,
      lastUpdated: Date.now(),
    });
    return { created: false, updated: true };
  },
});

/**
 * Migration: add the built-in auto-battle task definition.
 *
 * Run: npx convex run migrations:backfillTaskDefinitions
 */
export const backfillTaskDefinitions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("taskDefinitions")
      .withIndex("by_taskId", (q) => q.eq("taskId", "auto_battle"))
      .first();
    if (existing) return { created: false };

    const now = Date.now();
    await ctx.db.insert("taskDefinitions", {
      taskId: "auto_battle",
      name: "Auto-battle",
      category: "battle",
      description:
        "Fight regular monsters at a selected tier while the player remains online.",
      canProgressOffline: false,
      requiresOnline: true,
      enabled: true,
      prerequisites: { upgradeId: "auto_start_fight" },
      rewards: { uses: "autoBattleRewards" },
      createdAt: now,
      updatedAt: now,
    });
    return { created: true };
  },
});

/**
 * Migration: currentTierProgression -> maxTierReached
 *
 * Old schema had currentTierProgression (0,1,2 — position within a tier's 3 monsters).
 * New schema uses maxTierReached (highest tier beaten, for rebirth eligibility).
 *
 * Run: npx convex run migrations:backfillMaxTierReached
 */
export const backfillMaxTierReached = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      if (player.maxTierReached !== undefined) continue; // already migrated

      // Best estimate: player reached their currentTier
      // (conservative — they may have beaten higher tiers but we have no record)
      const maxTierReached = player.currentTier ?? 1;

      await ctx.db.patch(player._id, { maxTierReached });
      updated++;
    }

    return { updated, total: players.length };
  },
});

/**
 * Migration: assign the temporary admin role used by the development panel.
 *
 * All current accounts are intentionally promoted while the game still uses
 * anonymous IDs. Replace this with an authenticated role migration later.
 *
 * Run: npx convex run migrations:backfillAdminRoles
 */
export const backfillAdminRoles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      if (player.role === "admin") continue;

      await ctx.db.patch(player._id, { role: "admin", lastUpdated: Date.now() });
      updated++;
    }

    return { updated, total: players.length };
  },
});

/**
 * Migration: initialize paid stat-upgrade purchase counts.
 *
 * Existing player-upgrade rows predate the distinction between total quantity
 * and paid purchases, so their quantity is the safest available legacy count.
 * New hidden-spot rewards write purchaseCount: 0 explicitly.
 *
 * Run: npx convex run migrations:backfillStatUpgradePurchaseCounts
 */
export const backfillStatUpgradePurchaseCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const upgrades = await ctx.db.query("upgrades").collect();
    const statUpgradeIds = new Set(
      upgrades
        .filter((upgrade) => upgrade.effectType === "stat-boost")
        .map((upgrade) => upgrade.upgradeId)
    );
    const playerUpgrades = await ctx.db.query("playerUpgrades").collect();
    let updated = 0;

    for (const playerUpgrade of playerUpgrades) {
      if (
        !statUpgradeIds.has(playerUpgrade.upgradeId) ||
        playerUpgrade.purchaseCount !== undefined
      ) {
        continue;
      }

      await ctx.db.patch(playerUpgrade._id, {
        purchaseCount: playerUpgrade.quantity,
      });
      updated++;
    }

    return { updated, total: playerUpgrades.length };
  },
});

/**
 * Migration: create shared boss records only for tiers already needed.
 *
 * Run: npx convex run migrations:backfillBosses
 */
export const backfillBosses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    const highestTier = players.reduce(
      (highest, player) =>
        Math.max(highest, player.maxTierReached ?? player.currentTier ?? 1),
      1
    );
    const tierMultiplier = await getTierScaleMultiplier(ctx);
    const existingBosses = await ctx.db.query("bosses").collect();
    let updated = 0;

    for (const boss of existingBosses) {
      if (boss.statsTierScaled) continue;

      const tierScale = getTierScale(boss.tier, tierMultiplier);
      await ctx.db.patch(boss._id, {
        str: scaleBossStat(boss.str, tierScale),
        dex: scaleBossStat(boss.dex, tierScale),
        int: scaleBossStat(boss.int, tierScale),
        luk: scaleBossStat(boss.luk, tierScale),
        con: scaleBossStat(boss.con, tierScale),
        statsTierScaled: true,
      });
      updated++;
    }

    const existingTiers = new Set(existingBosses.map((boss) => boss.tier));
    let created = 0;

    for (let tier = 1; tier <= highestTier; tier++) {
      if (!existingTiers.has(tier)) {
        await ensureBossForTier(ctx, tier);
        existingTiers.add(tier);
        created++;
      }
    }

    return { created, updated, highestTier };
  },
});

/**
 * Migration: stack duplicate reward-cache rows.
 *
 * Pending rewards used to create one row per settlement, so a full inventory
 * left dozens of x1 rows for the same item. New overflows now merge by
 * (player, item, source); this folds pre-existing duplicates the same way,
 * keeping the earliest row per group (provenance and order preserved).
 *
 * Run: npx convex run migrations:consolidatePendingRewards
 */
export const consolidatePendingRewards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rewards = await ctx.db.query("pendingRewards").collect();
    const groups = new Map<string, typeof rewards>();
    for (const reward of rewards) {
      if (reward.status !== "pending") continue;
      const key = `${reward.playerId}:${reward.itemId}:${reward.sourceType}`;
      const group = groups.get(key);
      if (group) group.push(reward);
      else groups.set(key, [reward]);
    }

    let consolidatedGroups = 0;
    let mergedRows = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((left, right) => left.createdAt - right.createdAt);
      const [keeper, ...dupes] = group;
      let total = keeper.quantity;
      for (const dupe of dupes) {
        total += dupe.quantity;
        await ctx.db.delete(dupe._id);
        mergedRows += 1;
      }
      await ctx.db.patch(keeper._id, { quantity: total });
      consolidatedGroups += 1;
    }

    return { consolidatedGroups, mergedRows, total: rewards.length };
  },
});

/**
 * Migration: add the stat-based rebirth requirement and prestige bonus.
 *
 * Run: npx convex run migrations:backfillRebirthStatBalance
 */
export const backfillRebirthStatBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = [
      {
        key: "rebirthStatLevelRequirement",
        value: 99,
        description:
          "Stat value required in at least one stat to rebirth",
      },
      {
        key: "rebirthStatBonusPercent",
        value: 0.05,
        description:
          "Permanent bonus per rebirth to each stat at the rebirth requirement (fraction: 0.05 = +5%)",
      },
    ];
    let created = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (existing) continue;

      await ctx.db.insert("gameBalance", {
        ...entry,
        lastUpdated: Date.now(),
      });
      created += 1;
    }

    return { created };
  },
});

/**
 * Migration: add skill-level action speed and skill rebirth bonuses.
 *
 * Skill levels now speed up their own tasks, and skills at the rebirth
 * requirement bank a permanent speed bonus like combat stats do.
 * Also refreshes the requirement description for the any-stat-or-skill rule.
 *
 * Run: npx convex run migrations:backfillSkillRebirthBalance
 */
export const backfillSkillRebirthBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = [
      {
        key: "rebirthStatLevelRequirement",
        value: 99,
        description:
          "Stat or skill level required in at least one stat or skill to rebirth",
      },
      {
        key: "rebirthSkillBonusPercent",
        value: 0.05,
        description:
          "Permanent action speed bonus per rebirth to each skill at the rebirth requirement (fraction: 0.05 = +5%)",
      },
      {
        key: "skillLevelSpeedBonusPerLevel",
        value: 0.01,
        description:
          "Action speed bonus per skill level for that skill (fraction per level above 1: 0.01 = +1% speed per level)",
      },
    ];
    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (!existing) {
        await ctx.db.insert("gameBalance", {
          ...entry,
          lastUpdated: Date.now(),
        });
        created += 1;
        continue;
      }
      if (existing.description !== entry.description) {
        await ctx.db.patch(existing._id, {
          description: entry.description,
          lastUpdated: Date.now(),
        });
        updated += 1;
      }
    }

    return { created, updated };
  },
});

/**
 * Migration: add the Bazaar (marketplace) balance configuration.
 *
 * Run: npx convex run migrations:backfillBazaarBalance
 */
export const backfillBazaarBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = [
      {
        key: "bazaarTaxPercent",
        value: DEFAULT_BAZAAR_TAX_PERCENT,
        description:
          "Marketplace tax percent deducted from the seller's proceeds on every Bazaar trade (rounded down)",
      },
      {
        key: "bazaarOrderExpiryDays",
        value: DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS,
        description:
          "Days before an open Bazaar order expires and its escrow can be reclaimed",
      },
      {
        key: "bazaarMaxOpenOrders",
        value: DEFAULT_BAZAAR_MAX_OPEN_ORDERS,
        description:
          "Maximum number of active Bazaar orders a player may have open at once",
      },
    ];
    let created = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (existing) continue;

      await ctx.db.insert("gameBalance", {
        ...entry,
        lastUpdated: Date.now(),
      });
      created += 1;
    }

    return { created };
  },
});

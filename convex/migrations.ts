/**
 * Data migrations — run these once after schema changes.
 * Each migration is idempotent and safe to re-run.
 */

import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { readBalanceValue, rebuildBalanceSnapshot } from "./balance";
import { awardMetAchievements } from "./achievements";
import { setPlayerOwner } from "./playerAuth";
import {
  insertPlayerProgress,
  patchPlayerProgress,
  readPlayerProgressOrNull,
} from "./playerProgress";
import { readPlayerHpOrNull } from "./playerHp";
import type { Doc } from "./_generated/dataModel";
import {
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
  DEFAULT_AUTO_REST_BELOW_PERCENT,
  DEFAULT_AUTO_REST_UNTIL_PERCENT,
} from "./tasks";
import { SKILL_TASK_BALANCE_DEFAULTS } from "./skillBonuses";
import { TASK_SYNC_BALANCE_DEFAULTS } from "./taskTiming";
import { COMBAT_BALANCE_DEFAULTS, DEX_SPEED_COEFF_DEFAULT, inferWeaponType } from "./items";
import { HP_REGEN_BALANCE_DEFAULTS } from "./playerHp";
import { LEATHER_BALANCE_DEFAULTS } from "./leatherwork";
import {
  ALL_ITEMS,
  seedLeathercraftingContent,
  STAFF_BASE_DAMAGE_PER_TIER,
  STARTER_STAFF_BASE_DAMAGE,
} from "./forestCraftingSeed";
import { INFUSION_BALANCE_DEFAULTS, seedInfusionBalance } from "./infusion";
import {
  DEFAULT_ITEM_RARITY_LEVEL,
  DEFAULT_ITEM_RARITIES,
} from "./itemTypes";
import { readSkillXpBase, SKILL_XP_BALANCE_DEFAULT } from "./skillProgression";
import {
  DEFAULT_BAZAAR_MAX_OPEN_ORDERS,
  DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS,
  DEFAULT_BAZAAR_TAX_PERCENT,
} from "./bazaar";
import {
  DEFAULT_MIN_FIGHT_DURATION_MS,
  DEFAULT_MONSTER_POWER_MULTIPLIER,
  DEFAULT_REWARD_TIER_GROWTH,
} from "./combat";
import { PVP_ARENA_BALANCE_DEFAULTS } from "./arena";
import { RANKED_BALANCE_DEFAULTS } from "./ranked";
import { SIM_LIVE_BALANCE_DEFAULTS } from "./simLive";
import type { WeaponType } from "./itemTypes";
import { readStarterAbilityIds } from "./players";
import { calculateWisdomLevel, readWisdomBalance } from "./wisdom";

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
 * Migration: remove the character-level requirement for bosses. Bosses now
 * need every regular monster on the tier defeated, plus the boss key.
 *
 * Run: npx convex run migrations:removeBossUnlockLevelPerTier
 */
export const removeBossUnlockLevelPerTier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "bossUnlockLevelPerTier"))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length > 0) await rebuildBalanceSnapshot(ctx);
    return { removed: rows.length };
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
 * Drop the retired out-of-combat regen multiplier: HP regen now ticks at one
 * rate in and out of fights (see playerHp.ts). Safe to re-run.
 * Run: npx convex run migrations:removeOutOfCombatRegenMultiplier
 */
export const removeOutOfCombatRegenMultiplier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "combatOutOfCombatRegenMultiplier")).first();
    if (!existing) return { deleted: false };
    await ctx.db.delete(existing._id);
    return { deleted: true };
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
 * Rebalance Dexterity's attack-speed contribution. Lowers the seeded
 * `combatDexSpeedCoeff` from the old 0.1 default to 0.01, which only matches
 * the previous default: any other value is treated as live admin tuning and
 * left untouched. Creates the setting when missing. Idempotent.
 *
 * Run: npx convex run migrations:rebalanceDexSpeedCoeff
 */
export const rebalanceDexSpeedCoeff = internalMutation({
  args: {},
  handler: async (ctx) => {
    const key = "combatDexSpeedCoeff";
    const description = "Attacks per second gained per dex above 10";
    const previousDefault = 0.1;
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      await ctx.db.insert("gameBalance", {
        key,
        value: DEX_SPEED_COEFF_DEFAULT,
        description,
        lastUpdated: Date.now(),
      });
      return { created: true, updated: false };
    }

    if (existing.value !== previousDefault) {
      return { created: false, updated: false };
    }

    await ctx.db.patch(existing._id, {
      value: DEX_SPEED_COEFF_DEFAULT,
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
 * Migration: retune the guild passive-XP rate from 10% to 1% and clarify it
 * as bonus XP (never deducted from members). Only replaces the previous
 * default, leaving any other admin-tuned value untouched.
 *
 * Run: npx convex run migrations:retuneGuildActivityXp
 */
export const retuneGuildActivityXp = internalMutation({
  args: {},
  handler: async (ctx) => {
    const key = "guildActivityXpPercent";
    const description =
      "Bonus guild XP granted alongside member combat/skill XP, as a percent of the XP earned (player keeps the full amount; 0-100)";
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      await ctx.db.insert("gameBalance", {
        key,
        value: 1,
        description,
        lastUpdated: Date.now(),
      });
      return { created: true, updated: false };
    }

    if (existing.value !== 10) {
      return { created: false, updated: false };
    }

    await ctx.db.patch(existing._id, {
      value: 1,
      description,
      lastUpdated: Date.now(),
    });
    return { created: false, updated: true };
  },
});

/**
 * Migration: add the PvP arena balance configuration.
 *
 * Run: npx convex run migrations:backfillArenaBalance
 */
export const backfillArenaBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;

    for (const entry of PVP_ARENA_BALANCE_DEFAULTS) {
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
 * Migration: clear the dead arena lobby settlement keys.
 *
 * Arena lobbies carried a `settlementKey` that nothing ever read — arena
 * fights settle their own pot and record no fight history. The field is no
 * longer written; this clears the legacy values so the column can be
 * dropped from the schema afterwards.
 *
 * Run: npx convex run migrations:dropArenaLobbySettlementKeys
 */
export const dropArenaLobbySettlementKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cleared = 0;
    const lobbies = await ctx.db.query("arenaLobbies").collect();
    for (const lobby of lobbies) {
      if (lobby.settlementKey === undefined) continue;
      await ctx.db.patch(lobby._id, { settlementKey: undefined });
      cleared += 1;
    }
    return { cleared, scanned: lobbies.length };
  },
});

/**
 * Migration: add the ranked league balance configuration.
 *
 * Run: npx convex run migrations:backfillRankedBalance
 */
export const backfillRankedBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;

    for (const entry of RANKED_BALANCE_DEFAULTS) {
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
 * Migration: add the live simulation harness master switch.
 *
 * Run: npx convex run migrations:backfillSimLiveBalance
 */
export const backfillSimLiveBalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;

    for (const entry of SIM_LIVE_BALANCE_DEFAULTS) {
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

/**
 * Migration: add wisdom stat to existing players.
 * Sets wis=1 and statXp.wis=0 for all players.
 *
 * Run: npx convex run migrations:backfillWisdom
 */
export const backfillWisdom = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      // statXp lives on the progress row (see playerProgress.ts); a player without one is skipped.
      const progress = await readPlayerProgressOrNull(ctx, player._id);
      const needsWis = player.wis === undefined;
      const needsWisXp = progress !== null && progress.statXp?.wis === undefined;

      if (needsWis || needsWisXp) {
        if (needsWis) {
          await ctx.db.patch(player._id, { wis: 1, lastUpdated: Date.now() });
        }
        if (needsWisXp && progress) {
          await patchPlayerProgress(ctx, progress, {
            statXp: {
              str: progress.statXp?.str ?? 0,
              dex: progress.statXp?.dex ?? 0,
              int: progress.statXp?.int ?? 0,
              luk: progress.statXp?.luk ?? 0,
              con: progress.statXp?.con ?? 0,
              wis: 0,
            },
          });
        }
        updated += 1;
      }
    }

    return { updated };
  },
});

/**
 * Migration: add rebirthAbilityBonuses field to existing players.
 * Sets empty object for all players.
 *
 * Run: npx convex run migrations:backfillRebirthAbilityBonuses
 */
export const backfillRebirthAbilityBonuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    let updated = 0;

    for (const player of players) {
      if (player.rebirthAbilityBonuses === undefined) {
        await ctx.db.patch(player._id, {
          rebirthAbilityBonuses: {},
          lastUpdated: Date.now(),
        });
        updated += 1;
      }
    }

    return { updated };
  },
});

/**
 * Migration: add leathercrafting content to deployments seeded before it
 * existed (skill, tiers, leather items, recipes, balance keys, hide drops).
 *
 * Insert-only: existing rows, admin edits, and other forest crafting content
 * are never patched or deleted. Safe to re-run.
 *
 * Run: npx convex run migrations:backfillLeathercrafting
 */
export const backfillLeathercrafting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const summary = await seedLeathercraftingContent(ctx);
    const inserted = Object.values(summary).reduce(
      (total, count) => total + count,
      0
    );
    return { success: true, inserted, ...summary };
  },
});

/**
 * Migration: tag every seedable weapon with its weapon class and rebalance
 * staves to the new low base damage (25% under the previous values).
 *
 * Staff damage is overwritten (not scaled) so re-running is a no-op:
 *   - Worn Staff: STARTER_STAFF_BASE_DAMAGE
 *   - Crafted staffs: STAFF_BASE_DAMAGE_PER_TIER × craftingTier
 *
 * Run: npx convex run migrations:rebalanceStaffWeapons
 */
export const rebalanceStaffWeapons = internalMutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("items").collect();
    const now = Date.now();
    let weaponTypesBackfilled = 0;
    let staffDamageUpdated = 0;

    for (const item of items) {
      const weaponType = inferWeaponType(item);
      const patch: {
        weaponType?: WeaponType;
        baseDamage?: number;
        updatedAt: number;
      } = { updatedAt: now };

      if (item.weaponType === undefined && weaponType !== null) {
        patch.weaponType = weaponType;
        weaponTypesBackfilled += 1;
      }

      if (weaponType === "staff") {
        const target =
          item.itemId === "worn-staff"
            ? STARTER_STAFF_BASE_DAMAGE
            : typeof item.craftingTier === "number" &&
                Number.isSafeInteger(item.craftingTier) &&
                item.craftingTier > 0
              ? STAFF_BASE_DAMAGE_PER_TIER * item.craftingTier
              : undefined;
        if (target !== undefined && item.baseDamage !== target) {
          patch.baseDamage = target;
          staffDamageUpdated += 1;
        }
      }

      if (patch.weaponType !== undefined || patch.baseDamage !== undefined) {
        await ctx.db.patch(item._id, patch);
      }
    }

    return { weaponTypesBackfilled, staffDamageUpdated, totalItems: items.length };
  },
});

/**
 * Migration: grant the starter ability to existing characters whose starter
 * kit is configured to grant one (e.g. staff -> arcane_bolt) but who were
 * created before abilities were wired up. Learns the ability and equips it in
 * the lowest free slot, up to the configured slot cap (`wisdomMaxSlots`).
 * Idempotent.
 *
 * Run: npx convex run migrations:backfillStarterAbilities
 */
export const backfillStarterAbilities = internalMutation({
  args: {},
  handler: async (ctx) => {
    const balanceRow = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "starterAbilityIds"))
      .first();
    const starterAbilities = readStarterAbilityIds(balanceRow?.value);
    const { maxSlots } = await readWisdomBalance(ctx);
    const players = await ctx.db.query("players").collect();
    const now = Date.now();
    let learned = 0;
    let equipped = 0;
    let skipped = 0;

    for (const player of players) {
      const abilityId = player.starterWeapon
        ? starterAbilities[player.starterWeapon]
        : undefined;
      if (!abilityId) continue;

      const definition = await ctx.db
        .query("abilities")
        .withIndex("by_abilityId", (q) => q.eq("abilityId", abilityId))
        .first();
      if (!definition || !definition.enabled) {
        skipped += 1;
        continue;
      }

      const existing = await ctx.db
        .query("playerAbilities")
        .withIndex("by_playerId_and_abilityId", (q) =>
          q.eq("playerId", player._id).eq("abilityId", abilityId)
        )
        .first();
      if (!existing) {
        await ctx.db.insert("playerAbilities", {
          playerId: player._id,
          abilityId,
          level: 1,
          experience: 0,
          totalExperience: 0,
          learnedAt: now,
          updatedAt: now,
        });
        learned += 1;
      }

      const equippedRows = await ctx.db
        .query("playerEquippedAbilities")
        .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
        .collect();
      if (equippedRows.some((row) => row.abilityId === abilityId)) continue;

      const usedSlots = new Set(equippedRows.map((row) => row.slot));
      let slot = 0;
      while (usedSlots.has(slot)) slot += 1;
      if (slot >= maxSlots) continue;
      await ctx.db.insert("playerEquippedAbilities", {
        playerId: player._id,
        slot,
        abilityId,
        equippedAt: now,
      });
      equipped += 1;
    }

    return { learned, equipped, skipped, totalPlayers: players.length };
  },
});

/**
 * Migration: add startingStats with wisdom to gameBalance if missing.
 *
 * Run: npx convex run migrations:backfillStartingStatsWisdom
 */
export const backfillStartingStatsWisdom = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "startingStats"))
      .first();

    if (existing && existing.value && typeof existing.value === "object") {
      const stats = existing.value as Record<string, number>;
      if (stats.wis === undefined) {
        await ctx.db.patch(existing._id, {
          value: { ...stats, wis: 1 },
          lastUpdated: Date.now(),
        });
        return { updated: true };
      }
    }
    return { updated: false };
  },
});


/**
 * Migration for the batch-settlement and rebalance update. Idempotent.
 *
 * Tuning rows change only if they still hold the old default, so values an admin
 * has set by hand are left alone. Finishes by rebuilding the balance snapshot.
 *
 * Run: npx convex run migrations:applyPerformanceAndBalanceUpdate
 */
export const applyPerformanceAndBalanceUpdate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const retuned: Array<{ key: string; from: unknown; to: unknown }> = [
      { key: "taskHeartbeatGraceMs", from: 15_000, to: DEFAULT_TASK_HEARTBEAT_GRACE_MS },
      { key: "taskPresenceIntervalMs", from: 10_000, to: 45_000 },
      { key: "autoBattleBatchLimit", from: 5, to: DEFAULT_AUTO_BATTLE_BATCH_LIMIT },
      { key: "tierScaleMultiplier", from: 2, to: 1.4 },
      { key: "enchantEssenceQty", from: 100, to: 25 },
      { key: "guildRaidSummonGoldCost", from: 0, to: 100_000 },
      { key: "combatDexSpeedCoeff", from: 0.02, to: DEX_SPEED_COEFF_DEFAULT },
      { key: "combatDexSpeedCoeff", from: 0.008, to: DEX_SPEED_COEFF_DEFAULT },
      { key: "combatConRegenBasePercent", from: 0.005, to: 0.01 },
      { key: "monsterMagDefIntCoeff", from: 0.8, to: 0.5 },
      { key: "minPlayerHp", from: 30, to: 60 },
    ];
    for (const entry of retuned) {
      const row = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (row && row.value === entry.from) {
        await ctx.db.patch(row._id, { value: entry.to, lastUpdated: now });
      }
    }
    const added = [
      { key: "minFightDurationMs", value: DEFAULT_MIN_FIGHT_DURATION_MS, description: "Shortest a won regular fight may take, including the walk to the next monster (milliseconds)" },
      { key: "rewardTierGrowth", value: DEFAULT_REWARD_TIER_GROWTH, description: "Reward multiplier per tier, on top of the linear per-tier reward" },
      { key: "autoRestBelowPercent", value: DEFAULT_AUTO_REST_BELOW_PERCENT, description: "Hunts stop to rest before a fight when HP is below this fraction of max (0 = never)" },
      { key: "autoRestUntilPercent", value: DEFAULT_AUTO_REST_UNTIL_PERCENT, description: "Fraction of max HP a resting hunter recovers to before fighting again" },
      ...COMBAT_BALANCE_DEFAULTS.filter(
        (entry) =>
          entry.key === "weaponSpeedDamageExponent" ||
          entry.key === "monsterDefensePerTier" ||
          entry.key === "bossDefenseMultiplier"
      ),
    ];
    for (const entry of added) {
      const row = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .first();
      if (!row) await ctx.db.insert("gameBalance", { ...entry, lastUpdated: now });
    }
    await seedInfusionBalance(ctx);
    const speedRow = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "combatDexSpeedCoeff"))
      .first();
    const speedDefault = COMBAT_BALANCE_DEFAULTS.find((entry) => entry.key === "combatDexSpeedCoeff");
    if (speedRow && speedDefault && speedRow.description !== speedDefault.description) {
      await ctx.db.patch(speedRow._id, { description: speedDefault.description, lastUpdated: now });
    }

    // Stat shop removal.
    for (const key of ["statUpgradeCostMultiplier", "statUpgradeLevelRequirements"]) {
      const row = await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (row) await ctx.db.delete(row._id);
    }
    const spots = await ctx.db.query("hiddenSpots").take(200);
    const spotRewards = new Set(spots.map((spot) => spot.rewardUpgradeId));
    let removedUpgrades = 0;
    for (const upgrade of await ctx.db.query("upgrades").take(200)) {
      if (!spotRewards.has(upgrade.upgradeId)) {
        await ctx.db.delete(upgrade._id);
        removedUpgrades += 1;
      }
    }

    // Boss rows bake in the tier multiplier when created, so rescale them.
    const previousScale = 2;
    const currentScale = await getTierScaleMultiplier(ctx);
    let rescaledBosses = 0;
    if (currentScale !== previousScale) {
      for (const boss of await ctx.db.query("bosses").take(500)) {
        if (!boss.statsTierScaled || boss.statsTierMultiplier === currentScale) continue;
        const factor =
          getTierScale(boss.tier, currentScale) /
          getTierScale(boss.tier, boss.statsTierMultiplier ?? previousScale);
        await ctx.db.patch(boss._id, {
          str: Math.max(1, Math.round(boss.str * factor)),
          dex: Math.max(1, Math.round(boss.dex * factor)),
          int: Math.max(1, Math.round(boss.int * factor)),
          luk: Math.max(1, Math.round(boss.luk * factor)),
          con: Math.max(1, Math.round(boss.con * factor)),
          statsTierMultiplier: currentScale,
        });
        rescaledBosses += 1;
      }
    }

    await rebuildBalanceSnapshot(ctx);
    await ctx.scheduler.runAfter(0, internal.migrations.backfillPlayerRecords, {});
    return { removedUpgrades, rescaledBosses };
  },
});

/**
 * Per-player half of the update, in pages: ownership rows, wisdom level from its
 * XP, achievements already earned, and purchase counts from the removed shop.
 */
export const backfillPlayerRecords = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const xpBase = readSkillXpBase(await readBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key));
    const page = await ctx.db
      .query("players")
      .paginate({ numItems: 100, cursor: cursor ?? null });
    for (const player of page.page) {
      if (player.authSubject !== undefined) {
        await setPlayerOwner(ctx, player._id, player.authSubject);
      }
      const progress = await readPlayerProgressOrNull(ctx, player._id);
      const wisdomXp = progress?.statXp?.wis ?? 0;
      if (wisdomXp > 0) {
        const level = calculateWisdomLevel(wisdomXp, xpBase);
        if (level !== player.wis) {
          await ctx.db.patch(player._id, { wis: level });
        }
      }
      if (progress) {
        await awardMetAchievements(ctx, player._id, {
          maxTierReached: player.maxTierReached ?? player.currentTier,
          totalExperience: progress.totalExperience,
          rebirthCount: player.rebirthCount,
        });
      }
      const upgrades = await ctx.db
        .query("playerUpgrades")
        .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
        .take(50);
      for (const upgrade of upgrades) {
        if (upgrade.purchaseCount !== undefined) {
          await ctx.db.patch(upgrade._id, { purchaseCount: undefined });
        }
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillPlayerRecords, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * Fields that moved off `players` into `playerProgress` (gold, XP, stat XP) and
 * `playerHp` (HP). The narrowed schema no longer declares them, so they are
 * typed here for this one migration only.
 */
type LegacyPlayerRowFields = {
  gold?: number;
  totalExperience?: number;
  statXp?: Doc<"playerProgress">["statXp"];
  currentHp?: number;
  currentHpUpdatedAt?: number;
};
const LEGACY_PLAYER_FIELDS = [
  "gold",
  "totalExperience",
  "statXp",
  "currentHp",
  "currentHpUpdatedAt",
] as const;

/**
 * Split gold, XP, and HP off the `players` rows (widen, then this, then
 * narrow). Each page copies a player's legacy values into `playerProgress` and
 * `playerHp` when those rows are missing, then rewrites the player row without
 * the legacy fields. Re-running is safe: a row is created only if it's absent.
 *
 * Run: pnpm run migrate:playerSplit. It pages itself until every player is done.
 */
export const splitPlayerRecord = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("players")
      .paginate({ numItems: 100, cursor: cursor ?? null });
    for (const player of page.page) {
      const legacy = player as typeof player & LegacyPlayerRowFields;
      const progress = await readPlayerProgressOrNull(ctx, player._id);
      if (progress === null) {
        await insertPlayerProgress(ctx, player._id, {
          gold: legacy.gold ?? 0,
          totalExperience: legacy.totalExperience ?? 0,
          statXp: legacy.statXp,
          updatedAt: player.lastUpdated,
        });
      }
      if (legacy.currentHp !== undefined || legacy.currentHpUpdatedAt !== undefined) {
        const hp = await readPlayerHpOrNull(ctx, player._id);
        if (hp === null) {
          await ctx.db.insert("playerHp", {
            playerId: player._id,
            currentHp: legacy.currentHp,
            currentHpUpdatedAt: legacy.currentHpUpdatedAt,
          });
        }
      }
      if (LEGACY_PLAYER_FIELDS.some((field) => field in player)) {
        const {
          _id,
          _creationTime,
          gold,
          totalExperience,
          statXp,
          currentHp,
          currentHpUpdatedAt,
          ...stable
        } = legacy;
        await ctx.db.replace(player._id, stable);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.splitPlayerRecord, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * Agility rebalance: boots give AGI instead of DEX, sword/dagger/bow base
 * damage is retuned, and heavy armor speed penalties are halved. Patches only
 * those fields on seeded items, to their current seed values, so tuned rows
 * elsewhere are left alone. Players need no backfill: a missing `agi` reads
 * as 1. Rerunnable.
 */
export const applyAgilityRebalance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let patched = 0;
    for (const seed of ALL_ITEMS) {
      const row = await ctx.db
        .query("items")
        .withIndex("by_itemId", (q) => q.eq("itemId", seed.itemId))
        .first();
      if (!row) continue;
      const patch: Partial<Doc<"items">> = {};
      if (seed.baseDamage !== undefined && row.baseDamage !== seed.baseDamage) {
        patch.baseDamage = seed.baseDamage;
      }
      if (seed.speedPenalty !== undefined && row.speedPenalty !== seed.speedPenalty) {
        patch.speedPenalty = seed.speedPenalty;
      }
      if (seed.effectStat === "agi" && row.effectStat !== "agi") {
        patch.effectStat = "agi";
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(row._id, { ...patch, updatedAt: now });
        patched += 1;
      }
    }
    const speedDefault = COMBAT_BALANCE_DEFAULTS.find(
      (entry) => entry.key === "combatDexSpeedCoeff"
    );
    const speedRow = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "combatDexSpeedCoeff"))
      .first();
    if (speedRow && speedDefault && speedRow.description !== speedDefault.description) {
      await ctx.db.patch(speedRow._id, { description: speedDefault.description, lastUpdated: now });
    }
    return { patched };
  },
});

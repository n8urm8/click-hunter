import { awardCrossedAchievements } from "./achievements";
import { forfeitShelteredGuildGold } from "./guilds";
import { findOpenBuyOrder } from "./bazaar";
import { readBalanceValue } from "./balance";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuthSubject, requirePlayer, requirePlayerRead, requirePlayerOwner, setPlayerOwner } from "./playerAuth";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureBossForTier } from "./bossData";
import { calculateCharacterLevel } from "./characterLevel";
import {
  grantItemToInventory,
} from "./items";
import { clearPlayerPassives } from "./passiveTree";
import { readPlayerCombatProfile } from "./combat";
import {
  insertPlayerProgress,
  patchPlayerProgress,
  progressFields,
  readPlayerProgress,
} from "./playerProgress";
import { STARTER_KITS } from "./forestCraftingSeed";
import {
  getRebirthSkillBonuses,
  getRebirthStatBonuses,
  qualifyingRebirthStats,
  readRebirthStatRequirement,
} from "./rebirth";
import {
  resetAllPlayerAbilities,
  unequipAllAbilities,
  hasAbilityAtLevel,
  learnAbility,
  equipAbility,
  getPlayerEquippedAbilities,
  getAbilityDefinition,
} from "./abilities";
import { getRebirthAbilityBonuses } from "./rebirth";

// Default balance constants — must match gameBalance seeds in seed.ts
const STARTING_STATS = { str: 1, dex: 1, int: 1, luk: 1, con: 1, wis: 1, agi: 1 };
// Casters begin with a spell so a low-damage staff does not leave them
// strictly worse than a swing weapon. Balance-editable via `starterAbilityIds`.
export const STARTER_ABILITY_DEFAULTS: Record<string, string> = {
  staff: "arcane_bolt",
};

export function readStarterAbilityIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return STARTER_ABILITY_DEFAULTS;
  }
  const parsed: Record<string, string> = {};
  for (const [key, abilityId] of Object.entries(value)) {
    if (typeof abilityId === "string" && abilityId) {
      parsed[key] = abilityId;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : STARTER_ABILITY_DEFAULTS;
}
const REBIRTH_TIER_PROGRESSION = [5, 10, 15, 21, 28, 36, 45] as const;
const rateLimiter = new RateLimiter(components.rateLimiter, {});

type DatabaseCtx = QueryCtx | MutationCtx;

function readStartingStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return STARTING_STATS;
  }

  const candidate = value as Record<string, unknown>;
  const stats = { ...STARTING_STATS };
  for (const stat of Object.keys(stats) as Array<keyof typeof stats>) {
    const statValue = candidate[stat];
    if (typeof statValue === "number" && Number.isFinite(statValue) && statValue >= 1) {
      stats[stat] = statValue;
    }
  }
  return stats;
}

function readRebirthThresholds(value: unknown) {
  if (!Array.isArray(value)) {
    return REBIRTH_TIER_PROGRESSION;
  }

  const thresholds = value.filter(
    (threshold): threshold is number =>
      typeof threshold === "number" &&
      Number.isInteger(threshold) &&
      Number.isFinite(threshold) &&
      threshold >= 1
  );
  return thresholds.length > 0 ? thresholds : REBIRTH_TIER_PROGRESSION;
}

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return await readBalanceValue(ctx, key);
}

async function withEquipmentStats(
  ctx: DatabaseCtx,
  player: Doc<"players">
) {
  const { bonuses, passives, weapon, combatStats, effectiveStats } =
    await readPlayerCombatProfile(ctx, player);
  return {
    ...player,
    autoAttackEnabled: true,
    equipmentStatBonuses: bonuses,
    passiveBonuses: passives,
    equippedWeaponElement: weapon?.element ?? null,
    combatStats,
    effectiveStats,
  };
}

async function resetAllStatUpgrades(
  ctx: MutationCtx,
  playerId: Id<"players">
) {
  // Full wipe: every stat-boost upgrade row (paid and free hidden-spot
  // rewards) is deleted. Rebirth returns all stats to base.
  const [upgradeDefinitions, playerUpgrades] = await Promise.all([
    ctx.db.query("upgrades").collect(),
    ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect(),
  ]);
  const statUpgradeIds = new Set(
    upgradeDefinitions
      .filter((upgrade) => upgrade.effectType === "stat-boost")
      .map((upgrade) => upgrade.upgradeId)
  );

  for (const playerUpgrade of playerUpgrades) {
    if (statUpgradeIds.has(playerUpgrade.upgradeId)) {
      await ctx.db.delete(playerUpgrade._id);
    }
  }
}

const starterWeaponValidator = v.union(
  v.literal("sword"),
  v.literal("dagger"),
  v.literal("mace"),
  v.literal("bow"),
  v.literal("staff")
);

async function grantStarterKit(
  ctx: MutationCtx,
  playerId: Id<"players">,
  starterKey: string,
  autoEquip: boolean
) {
  const kit = STARTER_KITS[starterKey];
  if (!kit) throw new Error("Unknown starter kit");
  const now = Date.now();
  for (const [stableId, slot] of [
    [kit.weapon, "mainHand"],
    [kit.chest, "chest"],
  ] as const) {
    const item = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", stableId))
      .first();
    if (!item) throw new Error(`Starter item ${stableId} is not seeded`);
    let owned = await ctx.db
      .query("playerItems")
      .withIndex("by_playerId_and_itemId", (q) =>
        q.eq("playerId", playerId).eq("itemId", item._id)
      )
      .first();
    if (!owned) {
      await grantItemToInventory(ctx, {
        playerId,
        itemId: item._id,
        quantity: 1,
        overflowSource: {
          sourceType: "crafting",
          sourceId: stableId,
          settlementKey: `${playerId}:starter`,
        },
      });
      owned = await ctx.db
        .query("playerItems")
        .withIndex("by_playerId_and_itemId", (q) =>
          q.eq("playerId", playerId).eq("itemId", item._id)
        )
        .first();
    }
    if (owned && autoEquip) {
      await ctx.db.patch(owned._id, {
        equippedSlot: slot,
        updatedAt: now,
      });
    }
  }

  // Casters learn (and, on a fresh character, equip) their starter spell so
  // the caster kit functions from the first fight. Rebirth clears equipped
  // abilities, so re-picking staff re-grants it.
  const starterAbilities = readStarterAbilityIds(
    await getBalanceValue(ctx, "starterAbilityIds")
  );
  const starterAbilityId = starterAbilities[starterKey];
  if (starterAbilityId) {
    // Tolerate deployments where ability content has not been seeded yet:
    // creating a character must not fail because a content row is missing.
    const definition = await getAbilityDefinition(ctx, starterAbilityId);
    if (definition?.enabled) {
      await learnAbility(ctx, playerId, starterAbilityId);
      const equipped = await getPlayerEquippedAbilities(ctx, playerId);
      if (!equipped.some((row) => row.abilityId === starterAbilityId)) {
        await equipAbility(ctx, playerId, starterAbilityId, 0);
      }
    }
  }
}

const MAX_PLAYER_NAME_LENGTH = 32;

/**
 * Get or create a player
 */
export const getOrCreatePlayer = mutation({
  args: {
    anonymousId: v.string(),
    name: v.string(),
    starterId: v.optional(starterWeaponValidator),
  },
  handler: async (ctx, { anonymousId, name, starterId }) => {
    const subject = await requireAuthSubject(ctx);
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > MAX_PLAYER_NAME_LENGTH) {
      throw new Error(`Name must be 1-${MAX_PLAYER_NAME_LENGTH} characters`);
    }

    const owned = await ctx.db
      .query("players")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", subject))
      .first();
    if (owned) {
      return owned;
    }

    const [startingStatsValue, rebirthThresholdsValue] = await Promise.all([
      getBalanceValue(ctx, "startingStats"),
      getBalanceValue(ctx, "rebirthThresholds"),
    ]);
    const startingStats = readStartingStats(startingStatsValue);
    const rebirthThresholds = readRebirthThresholds(rebirthThresholdsValue);

    // Create new player with live balance values
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      anonymousId,
      authSubject: subject,
      name: trimmedName,
      role: "player",
      str: startingStats.str,
      dex: startingStats.dex,
      int: startingStats.int,
      luk: startingStats.luk,
      con: startingStats.con,
      agi: startingStats.agi,
      ...(starterId === undefined ? {} : { starterWeapon: starterId }),
      ...(starterId === undefined ? { pendingStarterPick: true } : {}),
      rebirthCount: 0,
      rebirthTierThreshold: rebirthThresholds[0],
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });
    await insertPlayerProgress(ctx, playerId, {
      gold: 0,
      totalExperience: 0,
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0, agi: 0 },
      updatedAt: now,
    });

    await setPlayerOwner(ctx, playerId, subject);

    if (starterId !== undefined) {
      await grantStarterKit(ctx, playerId, starterId, true);
    }

    return await ctx.db.get(playerId);
  },
});

/**
 * Choose a starter kit after rebirth (re-pick each run).
 */
export const chooseStarter = mutation({
  args: {
    playerId: v.id("players"),
    starterId: starterWeaponValidator,
  },
  handler: async (ctx, { playerId, starterId }) => {
    const player = await requirePlayer(ctx, playerId);
    if (!player.pendingStarterPick) {
      throw new Error("No starter kit is pending");
    }
    await grantStarterKit(ctx, playerId, starterId, false);
    await ctx.db.patch(playerId, {
      starterWeapon: starterId,
      pendingStarterPick: undefined,
      lastUpdated: Date.now(),
    });
    return await ctx.db.get(playerId);
  },
});

/**
 * The caller's own character profile. Identity-derived with no arguments,
 * so there is nothing to forge. This replaces the anonymousId lookup flow.
 */
export const getCurrentPlayer = query({
  args: {},
  handler: async (ctx) => {
    const subject = await requireAuthSubject(ctx);
    const player = await ctx.db
      .query("players")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", subject))
      .first();
    if (!player) return null;
    return {
      ...(await withEquipmentStats(ctx, player)),
      characterLevel: await calculateCharacterLevel(ctx, player),
    };
  },
});

/**
 * Get player by ID. Strictly owner-only.
 */
export const getPlayerById = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayerRead(ctx, playerId);
    const progress = await readPlayerProgress(ctx, playerId);
    return {
      ...(await withEquipmentStats(ctx, player)),
      ...progressFields(progress),
      characterLevel: await calculateCharacterLevel(ctx, player),
    };
  },
});

/**
 * Gold, total XP and stat XP for one character. Kept out of `getCurrentPlayer`
 * so a fight settlement doesn't re-run the stats query. The client merges the
 * two results (see `usePlayer`). Reads only the progress row, not `players`.
 */
export const getPlayerWallet = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    return progressFields(await readPlayerProgress(ctx, playerId));
  },
});

/**
 * Atomically accept an attack when the player's server-side cooldown has elapsed.
 */
export const attemptAttack = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayer(ctx, playerId);

    const { combatStats } = await readPlayerCombatProfile(ctx, player, {
      now: Date.now(),
    });
    const cooldownMs = Math.ceil(1000 / combatStats.attackSpeed);
    const status = await rateLimiter.limit(ctx, "manualAttack", {
      key: playerId,
      config: {
        kind: "token bucket",
        rate: 1,
        period: cooldownMs,
        capacity: 1,
      },
    });

    return {
      allowed: status.ok,
      cooldownMs,
      retryAfterMs: status.ok ? cooldownMs : status.retryAfter,
    };
  },
});

/**
 * Server-only gold adjustment (settlement paths). Internal until auth lands:
 * a public arbitrary-delta mutation is free currency for any caller.
 */
export const updateGold = internalMutation({
  args: {
    playerId: v.id("players"),
    delta: v.number(),
  },
  handler: async (ctx, { playerId, delta }) => {
    const progress = await readPlayerProgress(ctx, playerId);

    const newGold = Math.max(0, progress.gold + delta);
    await patchPlayerProgress(ctx, progress, { gold: newGold });

    return newGold;
  },
});

/**
 * Server-only experience grant (settlement paths). Internal until auth lands.
 */
export const addExperience = internalMutation({
  args: {
    playerId: v.id("players"),
    amount: v.number(),
  },
  handler: async (ctx, { playerId, amount }) => {
    const progress = await readPlayerProgress(ctx, playerId);

    const newExperience = progress.totalExperience + amount;
    // Leaderboards read the progress index, so no separate refresh is needed.
    await patchPlayerProgress(ctx, progress, { totalExperience: newExperience });

    return newExperience;
  },
});

/**
 * Server-only stat adjustment (upgrade/rebirth paths). Internal until auth lands.
 */
export const increaseStat = internalMutation({
  args: {
    playerId: v.id("players"),
    stat: v.union(
      v.literal("str"),
      v.literal("dex"),
      v.literal("int"),
      v.literal("luk"),
      v.literal("con"),
      v.literal("agi")
    ),
    delta: v.number(),
  },
  handler: async (ctx, { playerId, stat, delta }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");

    const statKey = stat as keyof typeof player;
    const currentValue = player[statKey] as number;
    const newValue = Math.max(1, currentValue + delta);

    const updateData: any = {
      lastUpdated: Date.now(),
    };
    updateData[stat] = newValue;

    await ctx.db.patch(playerId, updateData);

    return newValue;
  },
});

/**
 * Advance tier (update maxTierReached if player beats higher tier)
 */
export const advanceTierProgression = mutation({
  args: {
    playerId: v.id("players"),
    tierJustBeaten: v.number(),
  },
  handler: async (ctx, { playerId, tierJustBeaten }) => {
    const player = await requirePlayer(ctx, playerId);
    if (!Number.isSafeInteger(tierJustBeaten) || tierJustBeaten < 1) {
      throw new Error("Tier just beaten must be a positive integer");
    }

    const currentMax = player.maxTierReached || 1;
    // No skipping: live one tier above the proven max at most. Re-asserting
    // an already-reached tier is always allowed (back-compat for rows that
    // predate fight history).
    if (tierJustBeaten > currentMax + 1) {
      throw new Error("Tier progression must advance one tier at a time");
    }
    if (tierJustBeaten > currentMax) {
      const proof = await ctx.db
        .query("fightHistory")
        .withIndex("by_playerId_timestamp", (q) => q.eq("playerId", playerId))
        .filter((q) =>
          q.and(
            q.eq(q.field("monsterTier"), tierJustBeaten),
            q.eq(q.field("won"), true)
          )
        )
        .order("desc")
        .first();
      if (!proof) {
        throw new Error("No recorded victory for that tier");
      }
    }

    // Update maxTierReached if player beat a higher tier
    const newMaxTier = Math.max(currentMax, tierJustBeaten);

    await ctx.db.patch(playerId, {
      maxTierReached: newMaxTier,
      lastUpdated: Date.now(),
    });
    await ensureBossForTier(ctx, newMaxTier);

    // Note: Leaderboards refresh on a schedule.

    return { maxTier: newMaxTier };
  },
});

/**
 * Skill rows at or above the rebirth requirement, by skillId.
 */
async function qualifyingRebirthSkills(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  requirement: number
): Promise<string[]> {
  const rows = await ctx.db
    .query("playerSkills")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  return rows
    .filter((row) => row.level >= requirement)
    .map((row) => row.skillId);
}

/**
 * Reset every skilling skill to level 1. Totals are wiped like the rest of
 * the run's progress; rows are kept so history identity stays stable.
 */
async function resetAllPlayerSkills(ctx: MutationCtx, playerId: Id<"players">) {
  const rows = await ctx.db
    .query("playerSkills")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      level: 1,
      experience: 0,
      totalExperience: 0,
      actionsCompleted: 0,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Check if player can rebirth: at least one combat stat, skilling skill,
 * or ability at the rebirth requirement.
 */
export const canRebirth = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayerRead(ctx, playerId);
    const requirement = await readRebirthStatRequirement(ctx);
    if (qualifyingRebirthStats(player, requirement).length > 0) return true;
    const skills = await qualifyingRebirthSkills(ctx, playerId, requirement);
    if (skills.length > 0) return true;
    const abilities = await hasAbilityAtLevel(ctx, playerId, requirement);
    return abilities.length > 0;
  },
});

/**
 * Rebirth - reset all stats and skills to level 1. Each stat, skill, or ability at
 * the rebirth requirement earns a permanent prestige bonus to itself.
 */
export const rebirth = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayer(ctx, playerId);
    await ctx.runMutation(internal.tasks.prepareRebirth, { playerId });

    // Eligibility: at least one stat, skill, or ability at the requirement.
    const requirement = await readRebirthStatRequirement(ctx);
    const qualifyingStats = qualifyingRebirthStats(player, requirement);
    const qualifyingSkills = await qualifyingRebirthSkills(
      ctx,
      playerId,
      requirement
    );
    const qualifyingAbilities = await hasAbilityAtLevel(ctx, playerId, requirement);
    if (qualifyingStats.length === 0 && qualifyingSkills.length === 0 && qualifyingAbilities.length === 0) {
      throw new Error(
        `Train at least one stat, skill, or ability to level ${requirement} to rebirth`
      );
    }

    // Gold locked in a buy order would survive the wipe below. Cancelling refunds
    // it first, so ask for that instead of letting it dodge the reset.
    const openBuyOrder = await findOpenBuyOrder(ctx, playerId);
    if (openBuyOrder) {
      throw new Error("Cancel your open bazaar buy orders before rebirthing");
    }

    const nextRebirthCount = player.rebirthCount + 1;

    const rebirthThresholds = readRebirthThresholds(
      await getBalanceValue(ctx, "rebirthThresholds")
    );
    const startingStats = readStartingStats(
      await getBalanceValue(ctx, "startingStats")
    );

    // Calculate next threshold index
    const thresholdIndex = Math.min(
      nextRebirthCount,
      rebirthThresholds.length - 1
    );
    const nextThreshold = rebirthThresholds[thresholdIndex];

    // Permanent prestige power: every qualifying stat, skill, and ability banks another bonus.
    const bonuses = getRebirthStatBonuses(player);
    for (const stat of qualifyingStats) {
      bonuses[stat] += 1;
    }
    const skillBonuses = getRebirthSkillBonuses(player);
    for (const skillId of qualifyingSkills) {
      skillBonuses[skillId] = (skillBonuses[skillId] ?? 0) + 1;
    }
    const abilityBonuses = getRebirthAbilityBonuses(player);
    for (const abilityId of qualifyingAbilities) {
      abilityBonuses[abilityId] = (abilityBonuses[abilityId] ?? 0) + 1;
    }

    // Full wipe: all stats and skills return to base (earned and paid alike).
    // Passive skill web fully resets each run.
    // Ability levels reset to 1, equipped abilities cleared.
    await forfeitShelteredGuildGold(ctx, playerId);
    await resetAllStatUpgrades(ctx, playerId);
    await clearPlayerPassives(ctx, playerId);
    await resetAllPlayerSkills(ctx, playerId);
    await resetAllPlayerAbilities(ctx, playerId);
    await unequipAllAbilities(ctx, playerId);

    const progress = await readPlayerProgress(ctx, playerId);
    await patchPlayerProgress(ctx, progress, {
      gold: 0,
      totalExperience: 0,
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0, wis: 0, agi: 0 },
    });
    await ctx.db.patch(playerId, {
      str: startingStats.str,
      dex: startingStats.dex,
      int: startingStats.int,
      luk: startingStats.luk,
      con: startingStats.con,
      wis: startingStats.wis,
      agi: startingStats.agi,
      rebirthStatBonuses: bonuses,
      rebirthSkillBonuses: skillBonuses,
      rebirthAbilityBonuses: abilityBonuses,
      pendingStarterPick: true,
      rebirthCount: nextRebirthCount,
      rebirthTierThreshold: nextThreshold,
      currentTier: 1,
      maxTierReached: 1,
      highestBossDefeated: 0,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      lastUpdated: Date.now(),
    });

    await awardCrossedAchievements(
      ctx,
      playerId,
      { maxTierReached: 1, totalExperience: 0, rebirthCount: player.rebirthCount },
      { maxTierReached: 1, totalExperience: 0, rebirthCount: nextRebirthCount }
    );

    return {
      rebirthCount: nextRebirthCount,
      newThreshold: nextThreshold,
      qualifyingStats,
      qualifyingSkills,
      qualifyingAbilities,
      rebirthStatBonuses: bonuses,
      rebirthSkillBonuses: skillBonuses,
      rebirthAbilityBonuses: abilityBonuses,
    };
  },
});

/**
 * Compatibility endpoint for older clients; automatic attacks cannot be disabled.
 */
export const setAutoAttack = mutation({
  args: {
    playerId: v.id("players"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { playerId, enabled }) => {
    await requirePlayerOwner(ctx, playerId);
    if (!enabled) throw new Error("Auto attack is always enabled");

    await ctx.db.patch(playerId, {
      autoAttackEnabled: true,
      lastUpdated: Date.now(),
    });
  },
});

/**
 * Set auto start fight state. Battle automation is available to everyone.
 */
export const setAutoStartFight = mutation({
  args: {
    playerId: v.id("players"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { playerId, enabled }) => {
    await requirePlayerOwner(ctx, playerId);

    await ctx.db.patch(playerId, {
      autoStartFightEnabled: enabled,
      lastUpdated: Date.now(),
    });
  },
});

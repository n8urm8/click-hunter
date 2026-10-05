import { mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer } from "./playerAuth";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import { consumeItems } from "./items";
import { grantItemToInventory } from "./items";
import {
  applySkillExperience,
  readSkillXpBase,
  SKILL_XP_BALANCE_DEFAULT,
} from "./skillProgression";
import { readBalanceMap } from "./balance";

type DatabaseCtx = QueryCtx | MutationCtx;

export const INFUSION_SKILL_ID = "infusion";

/** Tunable infusion/economy values. Seeded into gameBalance; reads fall back here. */
export const INFUSION_BALANCE_DEFAULTS = [
  { key: "essenceDropChance", value: 0.1, description: "Chance per won regular/boss fight to drop 1x tier-tagged essence" },
  { key: "t1KeyDropChance", value: 0.02, description: "Chance per won regular fight to drop 1x boss-key-tier-1" },
  { key: "bossKeyEssenceQty", value: 100, description: "Essence of tier N required to infuse boss-key-tier-N" },
  { key: "enchantEssenceQty", value: 100, description: "Essence of tier (currentEnchant+1) required per enchant attempt" },
  { key: "enchantDamagePerLevel", value: 2, description: "Flat baseDamage added per enchant level (weapons)" },
  { key: "enchantDefensePerLevel", value: 2, description: "Flat baseDefense added per enchant level (armor)" },
  { key: "enchantLevelCap", value: 1000, description: "Maximum enchant level per equipment instance" },
  { key: "infusionBaseRate", value: 0.95, description: "Infusion success rate when recipe tier <= infusion level" },
  { key: "infusionFalloffPerTierGap", value: 0.22, description: "Success lost per tier above infusion level (T5 at level 1 ≈ 7%)" },
  { key: "infusionMinRate", value: 0.01, description: "Minimum infusion success rate" },
  { key: "infusionMaxRate", value: 0.95, description: "Maximum infusion success rate" },
  { key: "infusionFailXpPercent", value: 0.5, description: "Share of recipe XP granted on infusion failure (0-1)" },
  { key: "augmentBossTokenQty", value: 1, description: "Boss tokens of tier N required per augment-tier-N attempt" },
  { key: "augmentDamagePerTier", value: 3, description: "Flat base damage added per weapon augment tier" },
  { key: "augmentDefensePerTier", value: 3, description: "Flat base defense added per armor augment tier" },
  { key: "augmentBaseRate", value: 0.5, description: "At-level infusion success rate for augmentation (harder than crafting)" },
] as const;

export function essenceItemSlug(tier: number) {
  return `essence-tier-${tier}`;
}

export function bossKeyItemSlug(tier: number) {
  return `boss-key-tier-${tier}`;
}

function readFloat(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readInt(value: unknown, fallback: number, minimum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : fallback;
}

export async function readInfusionBalance(ctx: DatabaseCtx) {
  const map = await readBalanceMap(
    ctx,
    INFUSION_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const get = (key: string, fallback: number) => {
    const raw = map.get(key);
    return raw === undefined ? fallback : raw;
  };
  return {
    essenceDropChance: Math.min(
      1,
      Math.max(0, readFloat(get("essenceDropChance", 0.1), 0.1))
    ),
    t1KeyDropChance: Math.min(
      1,
      Math.max(0, readFloat(get("t1KeyDropChance", 0.02), 0.02))
    ),
    bossKeyEssenceQty: readInt(get("bossKeyEssenceQty", 100), 100, 1),
    enchantEssenceQty: readInt(get("enchantEssenceQty", 100), 100, 1),
    enchantDamagePerLevel: Math.max(
      0,
      readFloat(get("enchantDamagePerLevel", 2), 2)
    ),
    enchantDefensePerLevel: Math.max(
      0,
      readFloat(get("enchantDefensePerLevel", 2), 2)
    ),
    enchantLevelCap: readInt(get("enchantLevelCap", 1000), 1000, 1),
    infusionBaseRate: readFloat(get("infusionBaseRate", 0.95), 0.95),
    infusionFalloffPerTierGap: Math.max(
      0,
      readFloat(get("infusionFalloffPerTierGap", 0.22), 0.22)
    ),
    infusionMinRate: Math.min(
      1,
      Math.max(0, readFloat(get("infusionMinRate", 0.01), 0.01))
    ),
    infusionMaxRate: Math.min(
      1,
      Math.max(0, readFloat(get("infusionMaxRate", 0.95), 0.95))
    ),
    infusionFailXpPercent: Math.min(
      1,
      Math.max(0, readFloat(get("infusionFailXpPercent", 0.5), 0.5))
    ),
    augmentBossTokenQty: readInt(get("augmentBossTokenQty", 1), 1, 1),
    augmentDamagePerTier: Math.max(
      0,
      readFloat(get("augmentDamagePerTier", 3), 3)
    ),
    augmentDefensePerTier: Math.max(
      0,
      readFloat(get("augmentDefensePerTier", 3), 3)
    ),
    augmentBaseRate: Math.min(
      1,
      Math.max(0, readFloat(get("augmentBaseRate", 0.5), 0.5))
    ),
  };
}

/**
 * Infusion is never level-gated: every tier is attemptable from level 1.
 * Success falls off with (tier - level) so T5 at level 1 is near-impossible.
 */
export function infusionSuccessFor(
  infusionLevel: number,
  targetTier: number,
  balance: {
    infusionBaseRate: number;
    infusionFalloffPerTierGap: number;
    infusionMinRate: number;
    infusionMaxRate: number;
  }
) {
  const gap = Math.max(0, targetTier - Math.max(1, infusionLevel));
  const raw =
    balance.infusionBaseRate - gap * balance.infusionFalloffPerTierGap;
  return Math.min(
    balance.infusionMaxRate,
    Math.max(balance.infusionMinRate, raw)
  );
}

export async function getInfusionLevel(
  ctx: DatabaseCtx,
  playerId: Id<"players">
) {
  const row = await ctx.db
    .query("playerSkills")
    .withIndex("by_playerId_and_skillId", (q) =>
      q.eq("playerId", playerId).eq("skillId", INFUSION_SKILL_ID)
    )
    .first();
  return row?.level ?? 1;
}

async function lookupItemBySlug(ctx: DatabaseCtx, slug: string) {
  return await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", slug))
    .first();
}

/**
 * Tier-tagged essence/keys are procedural so tiers past the seed still work.
 * Seeded rows are preferred; creation here is a fallback for unseeded tiers.
 */
export async function ensureEssenceItem(ctx: MutationCtx, tier: number) {
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Essence tier must be a positive integer");
  }
  const slug = essenceItemSlug(tier);
  const existing = await lookupItemBySlug(ctx, slug);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("items", {
    itemId: slug,
    name: `Tier ${tier} Monster Essence`,
    category: "crafting",
    description: `Condensed essence from tier ${tier} monsters. Used in infusion.`,
    stackable: true,
    maxStackSize: 10000,
    allowedEquipmentSlots: [],
    rarityLevel: Math.max(1, tier * 10),
    itemFamily: "monster-material",
    craftingSkillId: INFUSION_SKILL_ID,
    craftingTier: tier,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Essence item could not be created");
  return created;
}

export async function ensureBossKeyItem(ctx: MutationCtx, tier: number) {
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Boss key tier must be a positive integer");
  }
  const slug = bossKeyItemSlug(tier);
  const existing = await lookupItemBySlug(ctx, slug);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("items", {
    itemId: slug,
    name: `Tier ${tier} Boss Key`,
    category: "crafting",
    description: `Infused key required to challenge the tier ${tier} boss. Consumed on start.`,
    stackable: true,
    maxStackSize: 25,
    allowedEquipmentSlots: [],
    rarityLevel: Math.max(1, tier * 10),
    itemFamily: "boss-key",
    craftingSkillId: INFUSION_SKILL_ID,
    craftingTier: tier,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Boss key item could not be created");
  return created;
}

async function ensureInfusionSkillRow(
  ctx: MutationCtx,
  playerId: Id<"players">,
  now: number
) {
  const existing = await ctx.db
    .query("playerSkills")
    .withIndex("by_playerId_and_skillId", (q) =>
      q.eq("playerId", playerId).eq("skillId", INFUSION_SKILL_ID)
    )
    .first();
  if (existing) return existing;
  const skill = await ctx.db
    .query("skillDefinitions")
    .withIndex("by_skillId", (q) => q.eq("skillId", INFUSION_SKILL_ID))
    .first();
  if (!skill) throw new Error("Infusion skill is not configured");
  const id = await ctx.db.insert("playerSkills", {
    playerId,
    skillId: INFUSION_SKILL_ID,
    level: 1,
    experience: 0,
    totalExperience: 0,
    actionsCompleted: 0,
    createdAt: now,
    updatedAt: now,
  });
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Unable to initialize infusion skill");
  return row;
}

/**
 * Instant infusion enchant: +1 enchantLevel for 100x essence of the target
 * level. Enchant target N requires essence tier N; equipment tier is ignored.
 * Flat bonuses apply in getEquippedWeapon/getEquippedProfile.
 */
export const enchantEquipment = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
  },
  handler: async (ctx, { playerId, playerItemId }) => {
    const player = await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    void player;

    const owned = await ctx.db.get(playerItemId);
    if (!owned || owned.playerId !== playerId || owned.quantity !== 1) {
      throw new Error("Equipment item not found");
    }
    const item = await ctx.db.get(owned.itemId);
    if (!item || item.category !== "equipment") {
      throw new Error("Only equipment can be enchanted");
    }
    const isWeapon =
      item.baseDamage !== undefined && item.attackSpeed !== undefined;
    const isArmor = item.baseDefense !== undefined;
    if (!isWeapon && !isArmor) {
      throw new Error("That equipment has no base damage or defense to enchant");
    }

    const now = Date.now();
    const balance = await readInfusionBalance(ctx);
    const current = owned.enchantLevel ?? 0;
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new Error("Equipment has an invalid enchant level");
    }
    const next = current + 1;
    if (next > balance.enchantLevelCap) {
      throw new Error("That equipment is at maximum enchant level");
    }

    const essence = await ensureEssenceItem(ctx, next);
    await consumeItems(ctx, playerId, [
      { itemId: essence._id, quantity: balance.enchantEssenceQty },
    ]);

    const skillRow = await ensureInfusionSkillRow(ctx, playerId, now);
    const skill = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", INFUSION_SKILL_ID))
      .first();
    if (!skill) throw new Error("Infusion skill is not configured");

    const chance = infusionSuccessFor(skillRow.level, next, balance);
    const success = Math.random() < chance;
    const baseReward = 50 * next;
    const earned = success
      ? baseReward
      : Math.floor(baseReward * balance.infusionFailXpPercent);
    const xpBase = readSkillXpBase(
      (
        await ctx.db
          .query("gameBalance")
          .withIndex("by_key", (q) => q.eq("key", SKILL_XP_BALANCE_DEFAULT.key))
          .first()
      )?.value
    );
    const { level, experience } = applySkillExperience(
      skillRow.level,
      skillRow.experience,
      earned,
      skill.maxLevel,
      xpBase
    );
    await ctx.db.patch(skillRow._id, {
      level,
      experience,
      totalExperience: skillRow.totalExperience + earned,
      actionsCompleted: skillRow.actionsCompleted + 1,
      updatedAt: now,
    });

    if (success) {
      await ctx.db.patch(owned._id, { enchantLevel: next, updatedAt: now });
    }
    return {
      success,
      successChance: chance,
      enchantLevel: success ? next : current,
      targetLevel: next,
      experienceEarned: earned,
      infusionLevel: level,
    };
  },
});

/** Direct combat drops for tier-tagged essence + lottery T1 keys. */
export async function grantInfusionDrops(
  ctx: MutationCtx,
  args: {
    playerId: Id<"players">;
    tier: number;
    won: boolean;
    sourceType: "monster" | "boss";
    sourceId: string;
    settlementKey: string;
  }
): Promise<
  Array<{
    itemId: Id<"items">;
    itemName: string;
    quantity: number;
    pending: number;
    purpose: "augmentation" | "boss-catalyst";
    itemSlug?: string;
    itemFamily?: string;
    category?: string;
  }>
> {
  if (!args.won) return [];
  if (!Number.isSafeInteger(args.tier) || args.tier < 1) return [];
  const balance = await readInfusionBalance(ctx);
  const out: Array<{
    itemId: Id<"items">;
    itemName: string;
    quantity: number;
    pending: number;
    purpose: "augmentation" | "boss-catalyst";
    itemSlug?: string;
    itemFamily?: string;
    category?: string;
  }> = [];

  if (Math.random() < balance.essenceDropChance) {
    const essence = await ensureEssenceItem(ctx, args.tier);
    const grant = await grantItemToInventory(ctx, {
      playerId: args.playerId,
      itemId: essence._id,
      quantity: 1,
      overflowSource: {
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        settlementKey: `${args.settlementKey}:essence`,
      },
    });
    await ctx.db.insert("lootAwards", {
      playerId: args.playerId,
      settlementKey: args.settlementKey,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      tier: args.tier,
      itemId: essence._id,
      quantity: 1,
      purpose: "augmentation",
      status: grant.pending > 0 ? "pending" : "granted",
      createdAt: Date.now(),
    });
    out.push({ itemName: essence.name, quantity: 1, pending: grant.pending, itemId: essence._id, purpose: "augmentation", itemSlug: essence.itemId, itemFamily: essence.itemFamily, category: essence.category });
  }

  if (args.sourceType === "monster" && Math.random() < balance.t1KeyDropChance) {
    const key = await ensureBossKeyItem(ctx, 1);
    const grant = await grantItemToInventory(ctx, {
      playerId: args.playerId,
      itemId: key._id,
      quantity: 1,
      overflowSource: {
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        settlementKey: `${args.settlementKey}:t1key`,
      },
    });
    await ctx.db.insert("lootAwards", {
      playerId: args.playerId,
      settlementKey: args.settlementKey,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      tier: args.tier,
      itemId: key._id,
      quantity: 1,
      purpose: "boss-catalyst",
      status: grant.pending > 0 ? "pending" : "granted",
      createdAt: Date.now(),
    });
    out.push({ itemName: key.name, quantity: 1, pending: grant.pending, itemId: key._id, purpose: "boss-catalyst", itemSlug: key.itemId, itemFamily: key.itemFamily, category: key.category });
  }
  return out;
}

export async function consumeBossKey(
  ctx: MutationCtx,
  playerId: Id<"players">,
  tier: number
) {
  const key = await ensureBossKeyItem(ctx, tier);
  await consumeItems(ctx, playerId, [{ itemId: key._id, quantity: 1 }]);
}

export type InfusionGrant = {
  succeeded: boolean;
  successChance: number;
  experienceEarned: number;
};

export async function resolveInfusionCraft(
  ctx: MutationCtx,
  args: {
    playerId: Id<"players">;
    recipeTier: number;
    baseExperienceReward: number;
  }
): Promise<InfusionGrant> {
  const now = Date.now();
  const balance = await readInfusionBalance(ctx);
  const skillRow = await ensureInfusionSkillRow(ctx, args.playerId, now);
  const skill = await ctx.db
    .query("skillDefinitions")
    .withIndex("by_skillId", (q) => q.eq("skillId", INFUSION_SKILL_ID))
    .first();
  if (!skill) throw new Error("Infusion skill is not configured");
  const chance = infusionSuccessFor(skillRow.level, args.recipeTier, balance);
  const succeeded = Math.random() < chance;
  const earned = succeeded
    ? args.baseExperienceReward
    : Math.floor(args.baseExperienceReward * balance.infusionFailXpPercent);
  const xpBase = readSkillXpBase(
    (
      await ctx.db
        .query("gameBalance")
        .withIndex("by_key", (q) => q.eq("key", SKILL_XP_BALANCE_DEFAULT.key))
        .first()
    )?.value
  );
  const { level, experience } = applySkillExperience(
    skillRow.level,
    skillRow.experience,
    earned,
    skill.maxLevel,
    xpBase
  );
  await ctx.db.patch(skillRow._id, {
    level,
    experience,
    totalExperience: skillRow.totalExperience + earned,
    actionsCompleted: skillRow.actionsCompleted + 1,
    updatedAt: now,
  });
  return { succeeded, successChance: chance, experienceEarned: earned };
}

export async function seedInfusionBalance(ctx: MutationCtx) {
  const now = Date.now();
  for (const entry of INFUSION_BALANCE_DEFAULTS) {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", entry.key))
      .first();
    if (existing) continue;
    await ctx.db.insert("gameBalance", { ...entry, lastUpdated: now });
  }
}

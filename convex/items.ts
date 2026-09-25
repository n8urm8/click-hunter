import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BUFF_VARIANT_VALUES,
  COMBAT_EFFECT_TYPES,
  DAMAGE_STAT_VALUES,
  DAMAGE_TYPE_VALUES,
  DEFAULT_ITEM_RARITY_LEVEL,
  EQUIPMENT_SLOT_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  SKILL_BONUS_SCOPE_VALUES,
  SKILL_TASK_EFFECT_TYPES,
  type BuffVariant,
  type CombatEffectType,
  type DamageStat,
  type DamageType,
  type EquipmentSlot,
  type ItemCategory,
  type ItemEffectStat,
  type SkillBonusScope,
  type SkillTaskEffectType,
} from "./itemTypes";
import { MAX_SKILL_MODIFIER_MULTIPLIER } from "./skillBonuses";

function isCombatEffectType(value: unknown): value is CombatEffectType {
  return COMBAT_EFFECT_TYPES.some((effectType) => effectType === value);
}

const itemCategoryValidator = v.union(
  v.literal("crafting"),
  v.literal("equipment")
);
const equipmentSlotValidator = v.union(
  v.literal("head"),
  v.literal("chest"),
  v.literal("mainHand"),
  v.literal("offHand"),
  v.literal("legs"),
  v.literal("feet"),
  v.literal("accessory1"),
  v.literal("accessory2"),
  v.literal("bag"),
  v.literal("craftingEquipment")
);
const itemEffectStatValidator = v.union(
  ...ITEM_EFFECT_STAT_VALUES.map((value) => v.literal(value))
);

function isSkillTaskEffectType(value: unknown): value is SkillTaskEffectType {
  return SKILL_TASK_EFFECT_TYPES.some((effectType) => effectType === value);
}

export const DEFAULT_INVENTORY_SLOT_CAPACITY = 50;

type DatabaseCtx = QueryCtx | MutationCtx;

type OwnedItem = {
  _id: Id<"playerItems">;
  itemId: Id<"items">;
  quantity: number;
  acquiredAt: number;
  updatedAt: number;
  item: Doc<"items">;
  rarity: Doc<"itemRarities"> | null;
  augments: Doc<"playerItemAugments">[];
};

export type EquipmentStatBonuses = {
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
};

const EMPTY_EQUIPMENT_STAT_BONUSES: EquipmentStatBonuses = {
  str: 0,
  dex: 0,
  int: 0,
  luk: 0,
  con: 0,
};

export async function getEquippedStatBonuses(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<EquipmentStatBonuses> {
  const rows = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  const bonuses = { ...EMPTY_EQUIPMENT_STAT_BONUSES };

  for (const row of rows.filter((entry) => entry.equippedSlot !== undefined)) {
    const item = await ctx.db.get(row.itemId);
    if (
      item?.effectType === "stat-bonus" &&
      item.effectStat !== undefined &&
      typeof item.effectAmount === "number" &&
      Number.isFinite(item.effectAmount)
    ) {
      bonuses[item.effectStat] += item.effectAmount;
    }

    const augments = await ctx.db
      .query("playerItemAugments")
      .withIndex("by_playerItemId", (q) => q.eq("playerItemId", row._id))
      .collect();
    for (const augment of augments) {
      if (
        augment.effectType === "stat-bonus" &&
        augment.effectStat !== undefined &&
        Number.isFinite(augment.effectAmount)
      ) {
        bonuses[augment.effectStat] += augment.effectAmount;
      }
    }
  }

  return bonuses;
}

export interface ItemDefinitionInput {
  itemId: string;
  name: string;
  category: ItemCategory;
  description: string;
  stackable: boolean;
  maxStackSize: number;
  allowedEquipmentSlots: EquipmentSlot[];
  rarityLevel: number;
  itemFamily?: string;
  craftingSkillId?: string;
  craftingTier?: number;
  effectType?: string;
  effectStat?: ItemEffectStat;
  effectAmount?: number;
  effectDurationMs?: number;
  effectScope?: SkillBonusScope;
  augmentSlots?: number;
  baseDamage?: number;
  attackSpeed?: number;
  damageStat?: DamageStat;
  damageType?: DamageType;
  baseDefense?: number;
  speedPenalty?: number;
  buffVariant?: BuffVariant;
}

function requiredText(value: string, field: string, maxLength: number) {
  const text = value.trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  if (text.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  }
  return text;
}

function validateItemId(value: string) {
  const itemId = requiredText(value, "Item ID", 100);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(itemId)) {
    throw new Error(
      "Item ID must start with a lowercase letter or number and contain only lowercase letters, numbers, hyphens, or underscores"
    );
  }
  return itemId;
}

function validateMaxStackSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Maximum stack size must be a positive integer");
  }
  return value;
}

function validateRarityLevel(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Rarity level must be a positive integer");
  }
  return value;
}

export function normalizeItemDefinition(input: ItemDefinitionInput) {
  const itemId = validateItemId(input.itemId);
  const name = requiredText(input.name, "Name", 200);
  const description = requiredText(input.description, "Description", 1000);
  const rarityLevel = validateRarityLevel(input.rarityLevel);
  const allowedEquipmentSlots = Array.from(
    new Set(input.allowedEquipmentSlots)
  );

  for (const slot of allowedEquipmentSlots) {
    if (!EQUIPMENT_SLOT_VALUES.includes(slot)) {
      throw new Error(`Unsupported equipment slot: ${slot}`);
    }
  }

  if (input.category === "crafting" && allowedEquipmentSlots.length > 0) {
    throw new Error("Crafting items cannot define equipment slots");
  }
  if (input.category === "equipment" && allowedEquipmentSlots.length === 0) {
    throw new Error("Equipment items must define at least one equipment slot");
  }
  if (input.category === "equipment" && input.stackable) {
    throw new Error("Equipment items cannot be stackable");
  }

  const maxStackSize = validateMaxStackSize(input.maxStackSize);
  if (!input.stackable && maxStackSize !== 1) {
    throw new Error("Non-stackable items must have a maximum stack size of 1");
  }
  if (
    input.craftingTier !== undefined &&
    (!Number.isSafeInteger(input.craftingTier) || input.craftingTier < 1)
  ) {
    throw new Error("Crafting tier must be a positive integer");
  }
  if (
    input.effectAmount !== undefined &&
    (!Number.isFinite(input.effectAmount) || input.effectAmount < 0)
  ) {
    throw new Error("Effect amount must be a non-negative number");
  }
  if (
    input.effectDurationMs !== undefined &&
    (!Number.isSafeInteger(input.effectDurationMs) || input.effectDurationMs < 1)
  ) {
    throw new Error("Effect duration must be a positive integer");
  }
  if (input.effectDurationMs !== undefined && input.effectType === undefined) {
    throw new Error("Effect duration requires an effect type");
  }
  if (
    input.augmentSlots !== undefined &&
    (!Number.isSafeInteger(input.augmentSlots) || input.augmentSlots < 0)
  ) {
    throw new Error("Augmentation slots must be a non-negative integer");
  }
  if (input.effectStat !== undefined && !ITEM_EFFECT_STAT_VALUES.includes(input.effectStat)) {
    throw new Error(`Unsupported effect stat: ${input.effectStat}`);
  }
  if (
    input.effectType === "stat-bonus" &&
    (input.effectStat === undefined || input.effectAmount === undefined)
  ) {
    throw new Error("Stat-bonus items require an effect stat and amount");
  }
  if (
    isSkillTaskEffectType(input.effectType)
  ) {
    if (
      input.category !== "crafting" ||
      input.effectAmount === undefined ||
      input.effectAmount <= 0 ||
      input.effectAmount > MAX_SKILL_MODIFIER_MULTIPLIER ||
      input.effectDurationMs === undefined
    ) {
      throw new Error(
        "Skill boost items require a crafting item, positive multiplier, and duration"
      );
    }
  } else if (input.effectScope !== undefined) {
    throw new Error("Only skill boost items can define an effect scope");
  }

  if (input.effectType !== undefined && isCombatEffectType(input.effectType)) {
    if (input.category !== "crafting") {
      throw new Error("Combat consumables must be crafting items");
    }
    if (
      input.effectAmount === undefined ||
      !Number.isFinite(input.effectAmount) ||
      input.effectAmount <= 0 ||
      input.effectDurationMs === undefined
    ) {
      throw new Error(
        "Combat consumables require a positive effect amount and duration"
      );
    }
    if (input.effectScope !== undefined) {
      throw new Error("Combat consumables cannot define an effect scope");
    }
    if (
      input.effectType === "combat-stat-boost" &&
      (input.effectStat === undefined ||
        !ITEM_EFFECT_STAT_VALUES.includes(input.effectStat))
    ) {
      throw new Error("Combat stat boosts require a valid effect stat");
    }
  }

  const isMainHand = allowedEquipmentSlots.includes("mainHand");
  if (isMainHand) {
    if (
      input.baseDamage === undefined ||
      !Number.isFinite(input.baseDamage) ||
      input.baseDamage <= 0
    ) {
      throw new Error("Main-hand weapons require a positive base damage");
    }
    if (
      input.attackSpeed === undefined ||
      !Number.isFinite(input.attackSpeed) ||
      input.attackSpeed <= 0
    ) {
      throw new Error("Main-hand weapons require a positive attack speed");
    }
    if (
      input.damageStat === undefined ||
      !DAMAGE_STAT_VALUES.includes(input.damageStat)
    ) {
      throw new Error("Main-hand weapons require a damage stat");
    }
    if (
      input.damageType !== undefined &&
      !DAMAGE_TYPE_VALUES.includes(input.damageType)
    ) {
      throw new Error("Weapon damage type must be physical or magical");
    }
    if (input.baseDefense !== undefined || input.speedPenalty !== undefined) {
      throw new Error("Weapons cannot define armor fields");
    }
  } else if (
    input.baseDamage !== undefined ||
    input.attackSpeed !== undefined ||
    input.damageStat !== undefined ||
    input.damageType !== undefined
  ) {
    throw new Error("Only main-hand weapons can define weapon combat fields");
  }

  const ARMOR_SLOTS: EquipmentSlot[] = ["head", "chest", "legs", "feet"];
  const isArmor = allowedEquipmentSlots.some((slot) =>
    ARMOR_SLOTS.includes(slot)
  );
  if (input.baseDefense !== undefined) {
    if (
      !Number.isFinite(input.baseDefense) ||
      input.baseDefense < 0 ||
      !isArmor
    ) {
      throw new Error(
        "Base defense must be a non-negative number on head, chest, legs, or feet gear"
      );
    }
  }
  if (input.speedPenalty !== undefined) {
    if (
      !Number.isFinite(input.speedPenalty) ||
      input.speedPenalty < 0 ||
      !isArmor
    ) {
      throw new Error(
        "Speed penalty must be a non-negative number on head, chest, legs, or feet gear"
      );
    }
  }

  if (
    input.buffVariant !== undefined &&
    !BUFF_VARIANT_VALUES.includes(input.buffVariant)
  ) {
    throw new Error("Buff variant must be base or advanced");
  }
  if (input.buffVariant !== undefined && input.effectType === undefined) {
    throw new Error("Buff variant requires an effect type");
  }

  return {
    itemId,
    name,
    category: input.category,
    description,
    stackable: input.stackable,
    maxStackSize,
    allowedEquipmentSlots,
    rarityLevel,
    ...(input.itemFamily === undefined ? {} : { itemFamily: input.itemFamily }),
    ...(input.craftingSkillId === undefined
      ? {}
      : { craftingSkillId: input.craftingSkillId }),
    ...(input.craftingTier === undefined
      ? {}
      : { craftingTier: input.craftingTier }),
    ...(input.effectType === undefined ? {} : { effectType: input.effectType }),
    ...(input.effectStat === undefined ? {} : { effectStat: input.effectStat }),
    ...(input.effectAmount === undefined
      ? {}
      : { effectAmount: input.effectAmount }),
    ...(input.effectScope === undefined
      ? isSkillTaskEffectType(input.effectType)
        ? { effectScope: "all" as const }
        : {}
      : { effectScope: input.effectScope }),
    ...(input.effectDurationMs === undefined
      ? {}
      : { effectDurationMs: input.effectDurationMs }),
    ...(input.augmentSlots === undefined
      ? {}
      : { augmentSlots: input.augmentSlots }),
    ...(input.baseDamage === undefined
      ? {}
      : { baseDamage: input.baseDamage }),
    ...(input.attackSpeed === undefined
      ? {}
      : { attackSpeed: input.attackSpeed }),
    ...(input.damageStat === undefined
      ? {}
      : { damageStat: input.damageStat }),
    ...(input.damageType === undefined
      ? isMainHand
        ? { damageType: "physical" as const }
        : {}
      : { damageType: input.damageType }),
    ...(input.baseDefense === undefined
      ? {}
      : { baseDefense: input.baseDefense }),
    ...(input.speedPenalty === undefined
      ? {}
      : { speedPenalty: input.speedPenalty }),
    ...(input.buffVariant === undefined
      ? {}
      : { buffVariant: input.buffVariant }),
  };
}

export const COMBAT_BALANCE_DEFAULTS = [
  { key: "combatStatAttackCoeff", value: 1.2, description: "Attack gained per point of a weapon's scaling stat" },
  { key: "combatDexSpeedCoeff", value: 0.1, description: "Attacks per second gained per dex above 10" },
  { key: "combatMinAttackSpeed", value: 0.5, description: "Minimum attacks per second" },
  { key: "combatPhysDefConCoeff", value: 0.8, description: "Physical defense gained per con" },
  { key: "combatMagDefIntCoeff", value: 0.8, description: "Magical defense gained per int" },
  { key: "monsterMagicCoeff", value: 1.2, description: "Magical attack gained per point of monster int" },
  { key: "monsterMagDefIntCoeff", value: 0.8, description: "Monster magical defense gained per monster int" },
  { key: "lukCritChancePerPoint", value: 0.001, description: "Crit chance gained per luk (0.001 = 0.1%)" },
  { key: "critDamageMultiplier", value: 1.5, description: "Damage multiplier on crit" },
  { key: "minPlayerHp", value: 30, description: "Minimum player health regardless of con" },
  { key: "combatRegenCapPerSecond", value: 10, description: "Maximum heal-over-time HP per second" },
  { key: "combatStatBonusCap", value: 100, description: "Maximum combined timed stat bonus per stat" },
  { key: "combatXpMultiplierCap", value: 10, description: "Maximum combined combat XP multiplier" },
] as const;

async function getCombatBalanceNumber(
  ctx: DatabaseCtx,
  key: string,
  fallback: number
) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export async function readCombatBalance(ctx: DatabaseCtx) {
  const entries = await Promise.all(
    COMBAT_BALANCE_DEFAULTS.map((entry) =>
      getCombatBalanceNumber(ctx, entry.key, entry.value)
    )
  );
  return {
    statAttackCoeff: entries[0],
    dexSpeedCoeff: entries[1],
    minAttackSpeed: entries[2],
    physDefConCoeff: entries[3],
    magDefIntCoeff: entries[4],
    monsterMagicCoeff: entries[5],
    monsterMagDefIntCoeff: entries[6],
    lukCritChancePerPoint: entries[7],
    critDamageMultiplier: entries[8],
    minPlayerHp: entries[9],
    regenCapPerSecond: entries[10],
    statBonusCap: entries[11],
    xpMultiplierCap: entries[12],
  };
}

export const useSkillBoost = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
  },
  handler: async (ctx, { playerId, playerItemId }) => {
    const ownedItem = await ctx.db.get(playerItemId);
    if (!ownedItem || ownedItem.playerId !== playerId) {
      throw new Error("Owned item not found");
    }
    const item = await ctx.db.get(ownedItem.itemId);
    if (
      !item ||
      item.category !== "crafting" ||
      !isSkillTaskEffectType(item.effectType)
    ) {
      throw new Error("That item is not a skill boost");
    }
    const effectAmount = item.effectAmount;
    const durationMs = item.effectDurationMs;
    if (
      typeof effectAmount !== "number" ||
      !Number.isFinite(effectAmount) ||
      effectAmount <= 0 ||
      effectAmount > MAX_SKILL_MODIFIER_MULTIPLIER ||
      typeof durationMs !== "number" ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1
    ) {
      throw new Error("Skill boost item has invalid effect settings");
    }

    const effectType = item.effectType as SkillTaskEffectType;
    const effectScope = item.effectScope ?? "all";
    if (!SKILL_BONUS_SCOPE_VALUES.includes(effectScope)) {
      throw new Error("Skill boost item has an invalid effect scope");
    }
    const now = Date.now();
    await consumeItems(ctx, playerId, [{ itemId: item._id, quantity: 1 }]);

    const existing = (
      await ctx.db
        .query("playerSkillBoosts")
        .withIndex("by_playerId_and_effectType_and_effectScope", (q) =>
          q
            .eq("playerId", playerId)
            .eq("effectType", effectType)
            .eq("effectScope", effectScope)
        )
        .collect()
    ).find((row) => row.sourceItemId === item._id);
    const effectiveAmount =
      existing && existing.expiresAt > now
        ? existing.effectAmount
        : effectAmount;
    const expiresAt =
      existing && existing.expiresAt > now
        ? existing.expiresAt + durationMs
        : now + durationMs;

    if (existing) {
      await ctx.db.patch(existing._id, {
        effectAmount: effectiveAmount,
        sourceItemId:
          existing.expiresAt > now ? existing.sourceItemId : item._id,
        startedAt: existing.expiresAt > now ? existing.startedAt : now,
        expiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("playerSkillBoosts", {
        playerId,
        effectType,
        effectScope,
        effectAmount: effectiveAmount,
        sourceItemId: item._id,
        startedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { effectType, effectScope, effectAmount: effectiveAmount, expiresAt };
  },
});

export const useCombatBoost = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
  },
  handler: async (ctx, { playerId, playerItemId }) => {
    const ownedItem = await ctx.db.get(playerItemId);
    if (!ownedItem || ownedItem.playerId !== playerId) {
      throw new Error("Owned item not found");
    }
    const item = await ctx.db.get(ownedItem.itemId);
    if (
      !item ||
      item.category !== "crafting" ||
      item.effectType === undefined ||
      !isCombatEffectType(item.effectType)
    ) {
      throw new Error("That item is not a combat consumable");
    }
    const effectAmount = item.effectAmount;
    const durationMs = item.effectDurationMs;
    if (
      typeof effectAmount !== "number" ||
      !Number.isFinite(effectAmount) ||
      effectAmount <= 0 ||
      typeof durationMs !== "number" ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1
    ) {
      throw new Error("Combat consumable has invalid effect settings");
    }
    if (
      item.effectType === "combat-stat-boost" &&
      item.effectStat === undefined
    ) {
      throw new Error("Combat stat boosts require an effect stat");
    }
    const effectType: CombatEffectType = item.effectType;

    const now = Date.now();
    await consumeItems(ctx, playerId, [{ itemId: item._id, quantity: 1 }]);

    const existing = (
      await ctx.db
        .query("playerCombatBoosts")
        .withIndex("by_playerId_and_effectType", (q) =>
          q.eq("playerId", playerId).eq("effectType", effectType)
        )
        .collect()
    ).find((row) => row.sourceItemId === item._id);
    const expiresAt =
      existing && existing.expiresAt > now
        ? existing.expiresAt + durationMs
        : now + durationMs;

    if (existing) {
      await ctx.db.patch(existing._id, {
        effectAmount,
        startedAt: existing.expiresAt > now ? existing.startedAt : now,
        expiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("playerCombatBoosts", {
        playerId,
        effectType,
        ...(item.effectStat === undefined
          ? {}
          : { effectStat: item.effectStat }),
        ...(item.buffVariant === undefined
          ? {}
          : { variant: item.buffVariant }),
        effectAmount,
        sourceItemId: item._id,
        startedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { effectType, expiresAt };
  },
});

export type EquippedWeaponStats = {
  baseDamage: number;
  attackSpeed: number;
  damageStat: DamageStat;
  damageType: DamageType;
} | null;

export async function getEquippedWeapon(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<EquippedWeaponStats> {
  const wielded = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_equippedSlot", (q) =>
      q.eq("playerId", playerId).eq("equippedSlot", "mainHand")
    )
    .first();
  if (!wielded) return null;
  const item = await ctx.db.get(wielded.itemId);
  if (
    !item ||
    item.baseDamage === undefined ||
    item.attackSpeed === undefined ||
    item.damageStat === undefined
  ) {
    return null;
  }
  return {
    baseDamage: item.baseDamage,
    attackSpeed: item.attackSpeed,
    damageStat: item.damageStat,
    damageType: item.damageType ?? "physical",
  };
}

export async function getEquippedArmorTotals(
  ctx: DatabaseCtx,
  playerId: Id<"players">
) {
  const rows = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  let defense = 0;
  let speedPenalty = 0;
  for (const row of rows.filter((entry) => entry.equippedSlot !== undefined)) {
    const item = await ctx.db.get(row.itemId);
    if (!item) continue;
    if (typeof item.baseDefense === "number") defense += item.baseDefense;
    if (typeof item.speedPenalty === "number") {
      speedPenalty += item.speedPenalty;
    }
  }
  return { defense, speedPenalty };
}

export function computeAttackSpeed(
  weaponSpeed: number,
  dex: number,
  armorPenalty: number,
  balance: { dexSpeedCoeff: number; minAttackSpeed: number }
) {
  return Math.max(
    balance.minAttackSpeed,
    weaponSpeed + Math.max(0, dex - 10) * balance.dexSpeedCoeff - armorPenalty
  );
}

export type ActiveCombatBoosts = {
  statBonus: Record<ItemEffectStat, number>;
  regenPerSecond: number;
  xpMultiplier: number;
};

export async function getActiveCombatBoosts(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  now: number
): Promise<ActiveCombatBoosts> {
  const balance = await readCombatBalance(ctx);
  const rows = await ctx.db
    .query("playerCombatBoosts")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  const statBonus: Record<ItemEffectStat, number> = {
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    con: 0,
  };
  let regenPerSecond = 0;
  let xpMultiplier = 1;
  for (const row of rows) {
    if (row.expiresAt <= now) continue;
    if (row.effectType === "combat-stat-boost" && row.effectStat) {
      statBonus[row.effectStat] = Math.min(
        balance.statBonusCap,
        statBonus[row.effectStat] + row.effectAmount
      );
    } else if (row.effectType === "heal-over-time") {
      regenPerSecond = Math.min(
        balance.regenCapPerSecond,
        regenPerSecond + row.effectAmount
      );
    } else if (row.effectType === "combat-xp-multiplier") {
      xpMultiplier = Math.min(
        balance.xpMultiplierCap,
        xpMultiplier * row.effectAmount
      );
    }
  }
  return { statBonus, regenPerSecond, xpMultiplier };
}

async function getInventorySlotCapacity(ctx: DatabaseCtx) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "inventorySlotCapacity"))
    .first();
  const value = row?.value;

  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : DEFAULT_INVENTORY_SLOT_CAPACITY;
}

async function getOwnedItemRows(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  capacity: number
) {
  return await ctx.db
    .query("playerItems")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(capacity + EQUIPMENT_SLOT_VALUES.length + 1);
}

export const getPlayerInventory = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const capacity = await getInventorySlotCapacity(ctx);
    const rows = await getOwnedItemRows(ctx, playerId, capacity);
    const [rarities, pendingRewards] = await Promise.all([
      ctx.db.query("itemRarities").collect(),
      ctx.db
        .query("pendingRewards")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "pending")
        )
        .order("desc")
        .take(100),
    ]);
    const rarityByLevel = new Map(
      rarities.map((rarity) => [rarity.level, rarity])
    );
    const inventory: OwnedItem[] = [];
    const equippedBySlot = new Map<EquipmentSlot, OwnedItem>();

    for (const row of rows) {
      const item = await ctx.db.get(row.itemId);
      if (!item) {
        throw new Error("Owned item references a missing item definition");
      }

      const ownedItem = {
        _id: row._id,
        itemId: row.itemId,
        quantity: row.quantity,
        acquiredAt: row.acquiredAt,
        updatedAt: row.updatedAt,
        item,
        rarity:
          rarityByLevel.get(item.rarityLevel ?? DEFAULT_ITEM_RARITY_LEVEL) ??
          null,
        augments: await ctx.db
          .query("playerItemAugments")
          .withIndex("by_playerItemId", (q) => q.eq("playerItemId", row._id))
          .collect(),
      };

      if (row.equippedSlot) {
        if (equippedBySlot.has(row.equippedSlot)) {
          throw new Error("Multiple items are equipped to the same slot");
        }
        equippedBySlot.set(row.equippedSlot, ownedItem);
      } else {
        inventory.push(ownedItem);
      }
    }

    return {
      capacity,
      usedSlots: inventory.length,
      remainingSlots: Math.max(0, capacity - inventory.length),
      inventory,
      equipment: EQUIPMENT_SLOT_VALUES.map((slot) => ({
        slot,
        item: equippedBySlot.get(slot) ?? null,
      })),
      pendingRewards: await Promise.all(
        pendingRewards.map(async (reward) => ({
          ...reward,
          item: await ctx.db.get(reward.itemId),
        }))
      ),
    };
  },
});

type PendingRewardSourceType =
  | "monster"
  | "boss"
  | "skill"
  | "crafting";

type InventoryGrantArgs = {
  playerId: Id<"players">;
  itemId: Id<"items">;
  quantity: number;
  overflowSource?: {
    sourceType: PendingRewardSourceType;
    sourceId: string;
    settlementKey: string;
  };
  rejectIfFull?: boolean;
};

export async function grantItemToInventory(
  ctx: MutationCtx,
  {
    playerId,
    itemId,
    quantity,
    overflowSource,
    rejectIfFull = true,
  }: InventoryGrantArgs
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Item quantity must be a positive integer");
  }

  const item = await ctx.db.get(itemId);
  if (!item) {
    throw new Error("Item definition not found");
  }

  const capacity = await getInventorySlotCapacity(ctx);
  const rows = await getOwnedItemRows(ctx, playerId, capacity);
  let usedSlots = rows.filter((row) => row.equippedSlot === undefined).length;
  let remaining = quantity;
  const now = Date.now();

  if (item.stackable) {
    const existingStacks = rows.filter(
      (row) => row.itemId === itemId && row.equippedSlot === undefined
    );
    for (const stack of existingStacks) {
      const available = Math.max(0, item.maxStackSize - stack.quantity);
      if (available === 0) continue;

      const added = Math.min(available, remaining);
      await ctx.db.patch(stack._id, {
        quantity: stack.quantity + added,
        updatedAt: now,
      });
      remaining -= added;
      if (remaining === 0) break;
    }

    while (remaining > 0 && usedSlots < capacity) {
      const stackQuantity = Math.min(item.maxStackSize, remaining);
      await ctx.db.insert("playerItems", {
        playerId,
        itemId,
        quantity: stackQuantity,
        acquiredAt: now,
        updatedAt: now,
      });
      remaining -= stackQuantity;
      usedSlots++;
    }
  } else {
    const availableSlots = Math.max(0, capacity - usedSlots);
    const inventoryQuantity = Math.min(quantity, availableSlots);
    for (let index = 0; index < inventoryQuantity; index += 1) {
      await ctx.db.insert("playerItems", {
        playerId,
        itemId,
        quantity: 1,
        acquiredAt: now,
        updatedAt: now,
      });
    }
    remaining -= inventoryQuantity;
    usedSlots += inventoryQuantity;
  }

  if (remaining > 0) {
    if (!overflowSource) {
      if (rejectIfFull) {
        throw new Error("Inventory is full");
      }
    } else {
      const existingReward = await ctx.db
        .query("pendingRewards")
        .withIndex("by_settlementKey", (q) =>
          q.eq("settlementKey", overflowSource.settlementKey)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("playerId"), playerId),
            q.eq(q.field("itemId"), itemId),
            q.eq(q.field("status"), "pending")
          )
        )
        .first();
      if (existingReward) {
        await ctx.db.patch(existingReward._id, {
          quantity: existingReward.quantity + remaining,
        });
      } else {
        await ctx.db.insert("pendingRewards", {
          playerId,
          itemId,
          quantity: remaining,
          sourceType: overflowSource.sourceType,
          sourceId: overflowSource.sourceId,
          settlementKey: overflowSource.settlementKey,
          status: "pending",
          createdAt: now,
        });
      }
    }
  }

  return {
    requested: quantity,
    added: quantity - remaining,
    pending: remaining,
    usedSlots,
  };
}

export async function consumeItems(
  ctx: MutationCtx,
  playerId: Id<"players">,
  requirements: Array<{ itemId: Id<"items">; quantity: number }>
) {
  for (const requirement of requirements) {
    if (
      !Number.isSafeInteger(requirement.quantity) ||
      requirement.quantity < 1
    ) {
      throw new Error("Item quantity must be a positive integer");
    }

    const rows = (
      await ctx.db
        .query("playerItems")
        .withIndex("by_playerId_and_itemId", (q) =>
          q.eq("playerId", playerId).eq("itemId", requirement.itemId)
        )
        .collect()
    ).filter((row) => row.equippedSlot === undefined);
    let remaining = requirement.quantity;
    for (const row of rows) {
      if (remaining === 0) break;
      const consumed = Math.min(row.quantity, remaining);
      remaining -= consumed;
      if (consumed === row.quantity) {
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, {
          quantity: row.quantity - consumed,
          updatedAt: Date.now(),
        });
      }
    }
    if (remaining > 0) {
      throw new Error("Insufficient crafting materials");
    }
  }
}

export const addItemToInventory = internalMutation({
  args: {
    playerId: v.id("players"),
    itemId: v.id("items"),
    quantity: v.number(),
    sourceType: v.optional(
      v.union(
        v.literal("monster"),
        v.literal("boss"),
        v.literal("skill"),
        v.literal("crafting")
      )
    ),
    sourceId: v.optional(v.string()),
    settlementKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const hasOverflowMetadata =
      args.sourceType !== undefined &&
      args.sourceId !== undefined &&
      args.settlementKey !== undefined;
    return await grantItemToInventory(ctx, {
      ...args,
      ...(hasOverflowMetadata
        ? {
            overflowSource: {
              sourceType: args.sourceType!,
              sourceId: args.sourceId!,
              settlementKey: args.settlementKey!,
            },
          }
        : {}),
    });
  },
});

export const claimPendingReward = mutation({
  args: {
    playerId: v.id("players"),
    rewardId: v.id("pendingRewards"),
  },
  handler: async (ctx, { playerId, rewardId }) => {
    const reward = await ctx.db.get(rewardId);
    if (
      !reward ||
      reward.playerId !== playerId ||
      reward.status !== "pending"
    ) {
      throw new Error("Pending reward not found");
    }

    const result = await grantItemToInventory(ctx, {
      playerId,
      itemId: reward.itemId,
      quantity: reward.quantity,
      rejectIfFull: false,
    });
    if (result.added === 0) {
      throw new Error("Inventory is full");
    }
    if (result.pending === 0) {
      await ctx.db.delete(reward._id);
    } else {
      await ctx.db.patch(reward._id, {
        quantity: result.pending,
      });
    }
    return {
      claimed: result.added,
      remaining: result.pending,
    };
  },
});

export const claimAllPendingRewards = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const rewards = await ctx.db
      .query("pendingRewards")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "pending")
      )
      .take(100);
    let claimed = 0;
    for (const reward of rewards) {
      const result = await grantItemToInventory(ctx, {
        playerId,
        itemId: reward.itemId,
        quantity: reward.quantity,
        rejectIfFull: false,
      });
      claimed += result.added;
      if (result.pending === 0) {
        await ctx.db.delete(reward._id);
      } else if (result.added > 0) {
        await ctx.db.patch(reward._id, {
          quantity: result.pending,
        });
      }
      if (result.added === 0) break;
    }
    return { claimed };
  },
});

export const equipItem = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
    slot: equipmentSlotValidator,
  },
  handler: async (ctx, { playerId, playerItemId, slot }) => {
    const ownedItem = await ctx.db.get(playerItemId);
    if (!ownedItem || ownedItem.playerId !== playerId) {
      throw new Error("Owned item not found");
    }

    const item = await ctx.db.get(ownedItem.itemId);
    if (!item) {
      throw new Error("Item definition not found");
    }
    if (
      item.category !== "equipment" ||
      item.stackable ||
      !item.allowedEquipmentSlots.includes(slot)
    ) {
      throw new Error("Item cannot be equipped to that slot");
    }

    const capacity = await getInventorySlotCapacity(ctx);
    const occupyingItem = await ctx.db
      .query("playerItems")
      .withIndex("by_playerId_and_equippedSlot", (q) =>
        q.eq("playerId", playerId).eq("equippedSlot", slot)
      )
      .first();
    if (
      occupyingItem &&
      occupyingItem._id !== playerItemId &&
      ownedItem.equippedSlot !== undefined
    ) {
      const rows = await getOwnedItemRows(ctx, playerId, capacity);
      const usedSlots = rows.filter(
        (row) => row.equippedSlot === undefined
      ).length;
      if (usedSlots >= capacity) {
        throw new Error("Inventory is full");
      }
    }
    const now = Date.now();

    if (occupyingItem && occupyingItem._id !== playerItemId) {
      await ctx.db.patch(occupyingItem._id, {
        equippedSlot: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch(playerItemId, {
      equippedSlot: slot,
      updatedAt: now,
    });

    return {
      equipped: true,
      slot,
      replacedItemId: occupyingItem?._id ?? null,
    };
  },
});

export const unequipItem = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
  },
  handler: async (ctx, { playerId, playerItemId }) => {
    const ownedItem = await ctx.db.get(playerItemId);
    if (!ownedItem || ownedItem.playerId !== playerId) {
      throw new Error("Owned item not found");
    }
    if (ownedItem.equippedSlot === undefined) {
      return { unequipped: false };
    }

    const capacity = await getInventorySlotCapacity(ctx);
    const rows = await getOwnedItemRows(ctx, playerId, capacity);
    const usedSlots = rows.filter(
      (row) => row.equippedSlot === undefined
    ).length;
    if (usedSlots >= capacity) {
      throw new Error("Inventory is full");
    }

    await ctx.db.patch(playerItemId, {
      equippedSlot: undefined,
      updatedAt: Date.now(),
    });
    return { unequipped: true };
  },
});

export { itemCategoryValidator, equipmentSlotValidator };

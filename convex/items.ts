import { internalMutation, mutation, query } from "./_generated/server";
import { readBalanceMap, readBalanceValue } from "./balance";
import { requirePlayer, requirePlayerRead, requirePlayerOwner } from "./playerAuth";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import {
  BUFF_VARIANT_VALUES,
  COMBAT_EFFECT_TYPES,
  DAMAGE_STAT_VALUES,
  DAMAGE_TYPE_VALUES,
  DEFAULT_ITEM_RARITY_LEVEL,
  ELEMENT_VALUES,
  EQUIPMENT_SLOT_VALUES,
  ITEM_CATEGORY_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  SKILL_BONUS_SCOPE_VALUES,
  SKILL_TASK_EFFECT_TYPES,
  WEAPON_TYPE_VALUES,
  type BuffVariant,
  type CombatEffectType,
  type DamageStat,
  type DamageType,
  type ElementKind,
  type EquipmentSlot,
  type ItemCategory,
  type ItemEffectStat,
  type SkillBonusScope,
  type SkillTaskEffectType,
  type WeaponType,
} from "./itemTypes";
import { MAX_SKILL_MODIFIER_MULTIPLIER } from "./skillBonuses";
import { getBagCapacityBonus } from "./leatherwork";

function isCombatEffectType(value: unknown): value is CombatEffectType {
  return COMBAT_EFFECT_TYPES.some((effectType) => effectType === value);
}

// Derived from the shared value lists so this validator cannot drift from
// the schema's item categories (ability books included).
const itemCategoryValidator = v.union(
  ...ITEM_CATEGORY_VALUES.map((value) => v.literal(value))
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
  v.literal("amulet"),
  v.literal("belt"),
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
  enchantLevel?: number;
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

/**
 * A player's equipment, fully resolved: stat bonuses, armor totals, the
 * elemental ward, and the wielded weapon. A combat profile built from a
 * resolved source uses all four — a partial bundle would silently drop a stat
 * from the fight.
 */
export type ResolvedEquipment = {
  bonuses: EquipmentStatBonuses;
  armor: { defense: number; speedPenalty: number };
  ward: Record<ElementKind, number>;
  weapon: EquippedWeaponStats;
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
  const { bonuses } = await getEquippedProfile(ctx, playerId);
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
  weaponType?: WeaponType;
  element?: ElementKind;
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
    if (
      input.weaponType !== undefined &&
      !WEAPON_TYPE_VALUES.includes(input.weaponType)
    ) {
      throw new Error("Weapon type must be sword, dagger, mace, bow, or staff");
    }
    if (
      input.element !== undefined &&
      !ELEMENT_VALUES.includes(input.element)
    ) {
      throw new Error(
        "Weapon element must be light, dark, water, fire, wind, or earth"
      );
    }
    if (input.baseDefense !== undefined || input.speedPenalty !== undefined) {
      throw new Error("Weapons cannot define armor fields");
    }
  } else if (
    input.baseDamage !== undefined ||
    input.attackSpeed !== undefined ||
    input.damageStat !== undefined ||
    input.damageType !== undefined ||
    input.weaponType !== undefined ||
    input.element !== undefined
  ) {
    throw new Error("Only main-hand weapons can define weapon combat fields");
  }

  const ARMOR_SLOTS: EquipmentSlot[] = ["head", "chest", "legs", "feet", "belt"];
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
        "Base defense must be a non-negative number on head, chest, legs, feet, or belt gear"
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
    ...(input.weaponType === undefined ? {} : { weaponType: input.weaponType }),
    ...(input.element === undefined ? {} : { element: input.element }),
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

export const PLAYER_ATTACK_SPEED_BALANCE_DEFAULT = {
  key: "combatAttackSpeedMultiplier",
  value: 0.5,
  description: "Multiplier on all player attack speeds after DEX, armor and the minimum speed (0.5 = half speed)",
} as const;

/**
 * Fraction of weapon speed gained per point of the weapon's scaling stat above
 * 10. The balance key still says "Dex" because it predates every weapon getting
 * this: renaming it would orphan tuned rows.
 */
export const DEX_SPEED_COEFF_DEFAULT = 0.005;

export const COMBAT_BALANCE_DEFAULTS = [
  { key: "combatStatAttackCoeff", value: 1.2, description: "Attack gained per point of a weapon's scaling stat" },
  { key: "combatDexSpeedCoeff", value: DEX_SPEED_COEFF_DEFAULT, description: "Fraction of weapon speed gained per point of the weapon's scaling stat above 10 (0.005 = +0.5%)" },
  { key: "combatMinAttackSpeed", value: 0.5, description: "Minimum attacks per second" },
  { key: "combatPhysDefConCoeff", value: 0.8, description: "Physical defense gained per con" },
  { key: "combatMagDefIntCoeff", value: 0.8, description: "Magical defense gained per int" },
  { key: "monsterMagicCoeff", value: 1.2, description: "Magical attack gained per point of monster int" },
  { key: "monsterMagDefIntCoeff", value: 0.5, description: "Monster magical defense gained per monster int" },
  { key: "lukCritChancePerPoint", value: 0.001, description: "Crit chance gained per luk (0.001 = 0.1%)" },
  { key: "critDamageMultiplier", value: 1.5, description: "Damage multiplier on crit" },
  { key: "minPlayerHp", value: 60, description: "Minimum player health regardless of con" },
  { key: "combatRegenCapPerSecond", value: 10, description: "Maximum heal-over-time HP per second" },
  { key: "combatStatBonusCap", value: 100, description: "Maximum combined timed stat bonus per stat" },
  { key: "combatXpMultiplierCap", value: 10, description: "Maximum combined combat XP multiplier" },
  PLAYER_ATTACK_SPEED_BALANCE_DEFAULT,
  { key: "weaponSpeedDamageExponent", value: 1, description: "How much a slow weapon's hits make up for its speed: damage is multiplied by (1 / weapon speed) ^ this (0 = no compensation, 1 = equal base damage per second)" },
] as const;

async function getCombatBalanceNumber(
  ctx: DatabaseCtx,
  key: string,
  fallback: number
) {
  const value = await readBalanceValue(ctx, key);
  return typeof value === "number" && Number.isFinite(value) &&
    (key === "combatAttackSpeedMultiplier" ? value > 0 : value >= 0)
    ? value
    : fallback;
}

export async function readCombatBalance(ctx: DatabaseCtx) {
  const values = await readBalanceMap(
    ctx,
    COMBAT_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const entries = COMBAT_BALANCE_DEFAULTS.map((entry) => {
    const value = values.get(entry.key);
    return typeof value === "number" &&
      Number.isFinite(value) &&
      (entry.key === "combatAttackSpeedMultiplier" ? value > 0 : value >= 0)
      ? value
      : entry.value;
  });
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
    attackSpeedMultiplier: entries[13],
    weaponSpeedDamageExponent: entries[14],
  };
}

export const useSkillBoost = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
  },
  handler: async (ctx, { playerId, playerItemId }) => {
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
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
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
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

/**
 * Weapon class for an item definition. Prefers the explicit admin-set field and
 * falls back to the item family/item ID token (e.g. `forging-sword`,
 * `worn-staff`) so weapon gating also works for definitions created before the
 * field existed. The stat fallback only handles unambiguous staff builds.
 */
export function inferWeaponType(item: {
  itemFamily?: string;
  itemId: string;
  damageStat?: string;
  damageType?: string;
  weaponType?: string;
}): WeaponType | null {
  if (
    item.weaponType !== undefined &&
    (WEAPON_TYPE_VALUES as readonly string[]).includes(item.weaponType)
  ) {
    return item.weaponType as WeaponType;
  }
  const tokens = `${item.itemFamily ?? ""}-${item.itemId}`
    .toLowerCase()
    .split(/[^a-z]+/);
  for (const type of WEAPON_TYPE_VALUES) {
    if (tokens.includes(type)) return type;
  }
  if (item.damageType === "magical" || item.damageStat === "int") {
    return "staff";
  }
  return null;
}

export type EquippedWeaponStats = {
  baseDamage: number;
  attackSpeed: number;
  damageStat: DamageStat;
  damageType: DamageType;
  weaponType: WeaponType | null;
  element: ElementKind | null;
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
  return computeWeaponStats(ctx, wielded);
}

/**
 * Weapon stats for one explicitly provided wielded row. Shared by live
 * equipment reads and PvP loadout resolution so both use identical math.
 */
export async function computeWeaponStats(
  ctx: DatabaseCtx,
  wielded: Doc<"playerItems">
): Promise<EquippedWeaponStats> {
  const item = await ctx.db.get(wielded.itemId);
  if (
    !item ||
    item.baseDamage === undefined ||
    item.attackSpeed === undefined ||
    item.damageStat === undefined
  ) {
    return null;
  }
  const enchantLevel =
    typeof wielded.enchantLevel === "number" &&
    Number.isSafeInteger(wielded.enchantLevel) &&
    wielded.enchantLevel > 0
      ? wielded.enchantLevel
      : 0;
  let damagePerLevel = 2;
  if (enchantLevel > 0) {
    const value = await readBalanceValue(ctx, "enchantDamagePerLevel");
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      damagePerLevel = value;
    }
  }
  // Damage-bonus augmentations add flat base damage; the first elemental
  // augment also imbues the weapon, enabling elemental passive scaling.
  const weaponAugments = await ctx.db
    .query("playerItemAugments")
    .withIndex("by_playerItemId", (q) => q.eq("playerItemId", wielded._id))
    .take(50);
  let augmentDamage = 0;
  let augmentElement: ElementKind | null = null;
  for (const augment of weaponAugments) {
    if (
      augment.effectType === "damage-bonus" &&
      Number.isFinite(augment.effectAmount) &&
      augment.effectAmount > 0
    ) {
      augmentDamage += augment.effectAmount;
    }
    if (
      augmentElement === null &&
      augment.effectElement !== undefined &&
      (ELEMENT_VALUES as readonly string[]).includes(augment.effectElement)
    ) {
      augmentElement = augment.effectElement as ElementKind;
    }
  }
  return {
    baseDamage: item.baseDamage + enchantLevel * damagePerLevel + augmentDamage,
    attackSpeed: item.attackSpeed,
    damageStat: item.damageStat,
    damageType: item.damageType ?? "physical",
    weaponType: inferWeaponType(item),
    element:
      augmentElement ??
      (item.element !== undefined &&
      (ELEMENT_VALUES as readonly string[]).includes(item.element)
        ? (item.element as ElementKind)
        : null),
  };
}

export async function getEquippedArmorTotals(
  ctx: DatabaseCtx,
  playerId: Id<"players">
) {
  const { armor } = await getEquippedProfile(ctx, playerId);
  return armor;
}

/**
 * Shared hot-path reader: one playerItems collect + batched item/augment
 * fetch yields both stat bonuses and armor totals. Used by combat profiles
 * (called on every sync/battle) instead of two separate collects.
 */
export async function getEquippedProfile(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<{
  bonuses: EquipmentStatBonuses;
  armor: { defense: number; speedPenalty: number };
  ward: Record<ElementKind, number>;
}> {
  // Range over set slots only: unequipped rows sort before any string, so a
  // full inventory costs nothing here and loot grants don't invalidate readers.
  const equipped = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_equippedSlot", (q) =>
      q.eq("playerId", playerId).gt("equippedSlot", undefined)
    )
    .take(32);
  return computeEquipmentStats(ctx, playerId, equipped);
}

/**
 * Equipment math over explicitly provided rows. Shared by live equipment
 * reads and PvP loadout resolution so both use identical math. Every row is
 * treated as equipped (callers override `equippedSlot` for loadout pieces).
 */
export async function computeEquipmentStats(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  equipped: Doc<"playerItems">[]
): Promise<{
  bonuses: EquipmentStatBonuses;
  armor: { defense: number; speedPenalty: number };
  ward: Record<ElementKind, number>;
}> {
  const bonuses = { ...EMPTY_EQUIPMENT_STAT_BONUSES };
  let defense = 0;
  let speedPenalty = 0;
  const ward: Record<ElementKind, number> = {
    light: 0, dark: 0, water: 0, fire: 0, wind: 0, earth: 0,
  };
  if (equipped.length === 0)
    return { bonuses, armor: { defense, speedPenalty }, ward };
  const distinctIds = [...new Set(equipped.map((row) => row.itemId))];
  const [defs, allAugments] = await Promise.all([
    Promise.all(distinctIds.map((itemId) => ctx.db.get(itemId))),
    ctx.db
      .query("playerItemAugments")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(500),
  ]);
  const defById = new Map(
    distinctIds.map((id, index) => [String(id), defs[index]])
  );
  let defensePerLevel = 2;
  if (equipped.some((row) => (row.enchantLevel ?? 0) > 0)) {
    const value = await readBalanceValue(ctx, "enchantDefensePerLevel");
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      defensePerLevel = value;
    }
  }
  const augmentsByRow = new Map<string, typeof allAugments>();
  for (const augment of allAugments) {
    const key = String(augment.playerItemId);
    const list = augmentsByRow.get(key);
    if (list) list.push(augment);
    else augmentsByRow.set(key, [augment]);
  }
  for (const row of equipped) {
    const item = defById.get(String(row.itemId));
    if (!item) continue;
    if (
      item.effectType === "stat-bonus" &&
      item.effectStat !== undefined &&
      typeof item.effectAmount === "number" &&
      Number.isFinite(item.effectAmount)
    ) {
      bonuses[item.effectStat] += item.effectAmount;
    }
    if (typeof item.baseDefense === "number") {
      const enchantLevel =
        typeof row.enchantLevel === "number" &&
        Number.isSafeInteger(row.enchantLevel) &&
        row.enchantLevel > 0
          ? row.enchantLevel
          : 0;
      defense += item.baseDefense + enchantLevel * defensePerLevel;
    }
    if (typeof item.speedPenalty === "number") {
      speedPenalty += item.speedPenalty;
    }
    for (const augment of augmentsByRow.get(String(row._id)) ?? []) {
      if (
        augment.effectType === "stat-bonus" &&
        augment.effectStat !== undefined &&
        Number.isFinite(augment.effectAmount)
      ) {
        bonuses[augment.effectStat] += augment.effectAmount;
      }
      if (
        augment.effectType === "defense-bonus" &&
        Number.isFinite(augment.effectAmount) &&
        augment.effectAmount > 0
      ) {
        defense += augment.effectAmount;
      }
      // Elemental ward: attuned armor mitigates matching-element hits.
      if (
        augment.effectType === "defense-bonus" &&
        augment.effectElement !== undefined &&
        (ELEMENT_VALUES as readonly string[]).includes(augment.effectElement) &&
        Number.isFinite(augment.effectAmount) &&
        augment.effectAmount > 0
      ) {
        ward[augment.effectElement as ElementKind] += augment.effectAmount;
      }
    }
  }
  return { bonuses, armor: { defense, speedPenalty }, ward };
}

/**
 * Bonuses scale the weapon's own speed instead of adding a flat amount, and
 * come from the stat the weapon already scales with. Together with
 * weaponSpeedDamageExponent, that leaves speed as a choice of how damage is
 * delivered rather than how much: a flat bonus or a DEX-only one would hand
 * fast weapons a second multiplier on their main stat.
 */
export function computeAttackSpeed(
  weaponSpeed: number,
  scalingStat: number,
  armorPenalty: number,
  balance: { dexSpeedCoeff: number; minAttackSpeed: number; attackSpeedMultiplier: number }
) {
  return Math.max(
    balance.minAttackSpeed,
    weaponSpeed * (1 + Math.max(0, scalingStat - 10) * balance.dexSpeedCoeff - armorPenalty)
  ) * balance.attackSpeedMultiplier;
}

export type ActiveCombatBoosts = {
  statBonus: Record<ItemEffectStat, number>;
  regenPerSecond: number;
  xpMultiplier: number;
};

export async function getActiveCombatBoosts(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  now: number,
  balance?: Awaited<ReturnType<typeof readCombatBalance>>
): Promise<ActiveCombatBoosts> {
  const resolvedBalance = balance ?? await readCombatBalance(ctx);
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
        resolvedBalance.statBonusCap,
        statBonus[row.effectStat] + row.effectAmount
      );
    } else if (row.effectType === "heal-over-time") {
      regenPerSecond = Math.min(
        resolvedBalance.regenCapPerSecond,
        regenPerSecond + row.effectAmount
      );
    } else if (row.effectType === "combat-xp-multiplier") {
      xpMultiplier = Math.min(
        resolvedBalance.xpMultiplierCap,
        xpMultiplier * row.effectAmount
      );
    }
  }
  return { statBonus, regenPerSecond, xpMultiplier };
}

export async function getInventorySlotCapacity(
  ctx: DatabaseCtx,
  playerId?: Id<"players">
) {
  const value = await readBalanceValue(ctx, "inventorySlotCapacity");

  const base =
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
      ? value
      : DEFAULT_INVENTORY_SLOT_CAPACITY;
  if (playerId === undefined) return base;
  return base + (await getBagCapacityBonus(ctx, playerId));
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
    await requirePlayerOwner(ctx, playerId);
    const capacity = await getInventorySlotCapacity(ctx, playerId);
    const rows = await getOwnedItemRows(ctx, playerId, capacity);
    const [rarities, pendingRewards, attackSpeedMultiplier, allAugments] = await Promise.all([
      ctx.db.query("itemRarities").take(100),
      ctx.db
        .query("pendingRewards")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "pending")
        )
        .order("desc")
        .take(100),
      getCombatBalanceNumber(ctx, PLAYER_ATTACK_SPEED_BALANCE_DEFAULT.key, PLAYER_ATTACK_SPEED_BALANCE_DEFAULT.value),
      // Single indexed read for all augments instead of N per-row collects.
      // Skipped for empty inventories.
      rows.length === 0
        ? Promise.resolve([])
        : ctx.db
            .query("playerItemAugments")
            .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
            .take(500),
    ]);
    const rarityByLevel = new Map(
      rarities.map((rarity) => [rarity.level, rarity])
    );
    // Dedupe item definitions: stacks of the same item share one fetch.
    const distinctItemIds = [...new Set(rows.map((row) => row.itemId))];
    const distinctPendingItemIds = [
      ...new Set(pendingRewards.map((reward) => reward.itemId)),
    ].filter((itemId) => !distinctItemIds.includes(itemId));
    const [itemDefs, pendingItemDefs] = await Promise.all([
      Promise.all(distinctItemIds.map((itemId) => ctx.db.get(itemId))),
      Promise.all(distinctPendingItemIds.map((itemId) => ctx.db.get(itemId))),
    ]);
    const itemById = new Map(
      distinctItemIds.map((itemId, index) => [itemId, itemDefs[index]])
    );
    for (const [index, itemId] of distinctPendingItemIds.entries()) {
      itemById.set(itemId, pendingItemDefs[index]);
    }
    const augmentsByRowId = new Map<string, Doc<"playerItemAugments">[]>();
    for (const augment of allAugments) {
      const key = String(augment.playerItemId);
      const list = augmentsByRowId.get(key);
      if (list) list.push(augment);
      else augmentsByRowId.set(key, [augment]);
    }
    const inventory: OwnedItem[] = [];
    const equippedBySlot = new Map<EquipmentSlot, OwnedItem>();

    for (const row of rows) {
      const item = itemById.get(row.itemId);
      if (!item) {
        throw new Error("Owned item references a missing item definition");
      }

      const ownedItem = {
        _id: row._id,
        itemId: row.itemId,
        quantity: row.quantity,
        ...(row.enchantLevel === undefined ? {} : { enchantLevel: row.enchantLevel }),
        acquiredAt: row.acquiredAt,
        updatedAt: row.updatedAt,
        item,
        rarity:
          rarityByLevel.get(item.rarityLevel ?? DEFAULT_ITEM_RARITY_LEVEL) ??
          null,
        augments: augmentsByRowId.get(String(row._id)) ?? [],
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
      attackSpeedMultiplier,
      usedSlots: inventory.length,
      remainingSlots: Math.max(0, capacity - inventory.length),
      inventory,
      equipment: EQUIPMENT_SLOT_VALUES.map((slot) => ({
        slot,
        item: equippedBySlot.get(slot) ?? null,
      })),
      pendingRewards: pendingRewards.map((reward) => ({
        ...reward,
        item: itemById.get(reward.itemId) ?? null,
      })),
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
  /** Inventory already read this transaction; kept current by each grant. */
  inventory?: InventoryForGrants;
};

export type InventoryForGrants = {
  capacity: number;
  rows: Doc<"playerItems">[];
};

/**
 * Read a player's inventory once for several grants in one transaction. Pass the
 * result to each grantItemToInventory call, which keeps it current.
 */
export async function readInventoryForGrants(
  ctx: MutationCtx,
  playerId: Id<"players">
): Promise<InventoryForGrants> {
  const capacity = await getInventorySlotCapacity(ctx, playerId);
  const rows = await getOwnedItemRows(ctx, playerId, capacity);
  return { capacity, rows: [...rows] };
}

export async function grantItemToInventory(
  ctx: MutationCtx,
  {
    playerId,
    itemId,
    quantity,
    overflowSource,
    rejectIfFull = true,
    inventory,
  }: InventoryGrantArgs
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Item quantity must be a positive integer");
  }

  const item = await ctx.db.get(itemId);
  if (!item) {
    throw new Error("Item definition not found");
  }

  const { capacity, rows } = inventory ?? await readInventoryForGrants(ctx, playerId);
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
      stack.quantity += added;
      remaining -= added;
      if (remaining === 0) break;
    }

    while (remaining > 0 && usedSlots < capacity) {
      const stackQuantity = Math.min(item.maxStackSize, remaining);
      const fields = {
        playerId,
        itemId,
        quantity: stackQuantity,
        acquiredAt: now,
        updatedAt: now,
      };
      const rowId = await ctx.db.insert("playerItems", fields);
      rows.push({ ...fields, _id: rowId, _creationTime: now });
      remaining -= stackQuantity;
      usedSlots++;
    }
  } else {
    const availableSlots = Math.max(0, capacity - usedSlots);
    const inventoryQuantity = Math.min(quantity, availableSlots);
    for (let index = 0; index < inventoryQuantity; index += 1) {
      const fields = {
        playerId,
        itemId,
        quantity: 1,
        acquiredAt: now,
        updatedAt: now,
      };
      const rowId = await ctx.db.insert("playerItems", fields);
      rows.push({ ...fields, _id: rowId, _creationTime: now });
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
      // Stack onto any pending row for the same item and source, even when
      // the overflow comes from a different settlement — otherwise every
      // full-inventory kill leaves its own x1 row in the reward cache.
      // Source type is part of the key so the cache label stays truthful.
      const existingReward = await ctx.db
        .query("pendingRewards")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "pending")
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("itemId"), itemId),
            q.eq(q.field("sourceType"), overflowSource.sourceType)
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

/**
 * Pre-flight check for grantItemToInventory: whether the full quantity can be
 * granted without hitting capacity. Mirrors grantItemToInventory's allocation
 * order (merge into existing stacks first, then new stacks up to capacity) —
 * keep the two in sync.
 *
 * Used by the Bazaar to decide whether a fill can be delivered before any
 * writes happen, so a full inventory never leaves a mutation half-applied.
 */
export async function canGrantItemToInventory(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  itemId: Id<"items">,
  quantity: number
): Promise<boolean> {
  const item = await ctx.db.get(itemId);
  if (!item) return false;

  const capacity = await getInventorySlotCapacity(ctx, playerId);
  const rows = await getOwnedItemRows(ctx, playerId, capacity);
  const unequipped = rows.filter((row) => row.equippedSlot === undefined);
  const freeSlots = Math.max(0, capacity - unequipped.length);

  if (item.stackable) {
    let stackRoom = 0;
    for (const row of unequipped) {
      if (row.itemId !== itemId) continue;
      stackRoom += Math.max(0, item.maxStackSize - row.quantity);
    }
    return stackRoom + freeSlots * item.maxStackSize >= quantity;
  }
  return freeSlots >= quantity;
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
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
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
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
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
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
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

    const capacity = await getInventorySlotCapacity(ctx, playerId);
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
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const ownedItem = await ctx.db.get(playerItemId);
    if (!ownedItem || ownedItem.playerId !== playerId) {
      throw new Error("Owned item not found");
    }
    if (ownedItem.equippedSlot === undefined) {
      return { unequipped: false };
    }

    const capacity = await getInventorySlotCapacity(ctx, playerId);
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

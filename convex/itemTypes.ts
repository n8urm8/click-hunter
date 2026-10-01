export const ITEM_CATEGORY_VALUES = ["crafting", "equipment"] as const;
export type ItemCategory = (typeof ITEM_CATEGORY_VALUES)[number];

export const DEFAULT_ITEM_RARITY_LEVEL = 10;

export const ITEM_EFFECT_STAT_VALUES = [
  "str",
  "dex",
  "int",
  "luk",
  "con",
] as const;
export type ItemEffectStat = (typeof ITEM_EFFECT_STAT_VALUES)[number];

export const SKILL_BONUS_SCOPE_VALUES = [
  "all",
  "gathering",
  "crafting",
] as const;
export type SkillBonusScope = (typeof SKILL_BONUS_SCOPE_VALUES)[number];

export const SKILL_TASK_EFFECT_TYPES = [
  "skill-speed-multiplier",
  "skill-xp-multiplier",
] as const;
export type SkillTaskEffectType = (typeof SKILL_TASK_EFFECT_TYPES)[number];

export const COMBAT_EFFECT_TYPES = [
  "combat-stat-boost",
  "heal-over-time",
  "combat-xp-multiplier",
] as const;
export type CombatEffectType = (typeof COMBAT_EFFECT_TYPES)[number];

export const DAMAGE_STAT_VALUES = ["str", "dex", "int"] as const;
export type DamageStat = (typeof DAMAGE_STAT_VALUES)[number];

export const DAMAGE_TYPE_VALUES = ["physical", "magical"] as const;
export type DamageType = (typeof DAMAGE_TYPE_VALUES)[number];

export const ELEMENT_VALUES = [
  "light",
  "dark",
  "water",
  "fire",
  "wind",
  "earth",
] as const;
export type ElementKind = (typeof ELEMENT_VALUES)[number];

export const BUFF_VARIANT_VALUES = ["base", "advanced"] as const;
export type BuffVariant = (typeof BUFF_VARIANT_VALUES)[number];

export const DEFAULT_ITEM_RARITIES = [
  { level: 10, name: "Common", color: "#9ca3af" },
  { level: 20, name: "Uncommon", color: "#22c55e" },
  { level: 30, name: "Rare", color: "#3b82f6" },
  { level: 40, name: "Epic", color: "#a855f7" },
  { level: 50, name: "Mythical", color: "#f59e0b" },
  { level: 60, name: "Celestial", color: "#22d3ee" },
  { level: 70, name: "Eternal", color: "#f472b6" },
  { level: 80, name: "Starforged", color: "#facc15" },
] as const;

export const EQUIPMENT_SLOT_VALUES = [
  "head",
  "chest",
  "mainHand",
  "offHand",
  "legs",
  "feet",
  "accessory1",
  "accessory2",
  "bag",
  "craftingEquipment",
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOT_VALUES)[number];

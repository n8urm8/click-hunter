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

export const DEFAULT_ITEM_RARITIES = [
  { level: 10, name: "Common", color: "#9ca3af" },
  { level: 20, name: "Uncommon", color: "#22c55e" },
  { level: 30, name: "Rare", color: "#3b82f6" },
  { level: 40, name: "Epic", color: "#a855f7" },
  { level: 50, name: "Mythical", color: "#f59e0b" },
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

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { SKILL_XP_BALANCE_DEFAULT } from "./skillProgression";
import { SKILL_TASK_BALANCE_DEFAULTS } from "./skillBonuses";
import { COMBAT_BALANCE_DEFAULTS } from "./items";
import { HP_REGEN_BALANCE_DEFAULTS } from "./playerHp";
import {
  LEATHER_BALANCE_DEFAULTS,
  readLeatherBalance,
} from "./leatherwork";
import { ELEMENT_VALUES } from "./itemTypes";
import { INFUSION_BALANCE_DEFAULTS } from "./infusion";
import { ENDGAME_GATE_BALANCE_DEFAULTS } from "./endgameGate";
import { BOSS_REWARD_BALANCE_DEFAULTS } from "./bossData";
import {
  BIOMES,
  RIFT_FIRST_TIER,
  allMaterialSeeds,
  biomeMonsterSeeds,
  bossKeyTrophyItemId,
  materialItemId,
  materialItemIdForTier,
  monsterDropsForTier,
  RIFT_ARCHETYPES,
  RIFT_SHARD_ITEM_ID,
  type MaterialKind,
} from "./biomes";

type SeedItem = {
  itemId: string;
  name: string;
  category: "crafting" | "equipment";
  description: string;
  stackable: boolean;
  maxStackSize: number;
  allowedEquipmentSlots: Array<
    | "head"
    | "chest"
    | "mainHand"
    | "offHand"
    | "legs"
    | "feet"
    | "accessory1"
    | "accessory2"
    | "amulet"
    | "belt"
    | "bag"
    | "craftingEquipment"
  >;
  rarityLevel: number;
  itemFamily?: string;
  craftingSkillId?: string;
  craftingTier?: number;
  effectType?: string;
  effectStat?: "str" | "dex" | "int" | "luk" | "con" | "agi";
  effectAmount?: number;
  effectDurationMs?: number;
  effectScope?: "all" | "gathering" | "crafting";
  augmentSlots?: number;
  baseDamage?: number;
  attackSpeed?: number;
  damageStat?: "str" | "dex" | "int";
  damageType?: "physical" | "magical";
  weaponType?: "sword" | "dagger" | "mace" | "bow" | "staff";
  baseDefense?: number;
  speedPenalty?: number;
  buffVariant?: "base" | "advanced";
};

type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type EquipmentSlot = SeedItem["allowedEquipmentSlots"][number];
type EffectStat = NonNullable<SeedItem["effectStat"]>;

const TIERS: Tier[] = [1, 2, 3, 4, 5, 6, 7, 8];
/** Infusion (boss keys / enchanting) is seeded to the combat max tier. */
const INFUSION_MAX_SEED_TIER = 20;
const INFUSION_TIERS: number[] = Array.from(
  { length: INFUSION_MAX_SEED_TIER },
  (_, index) => index + 1
);
const TIER_NAMES = [
  "Grove",
  "Moonlit Grove",
  "Ancient Grove",
  "Deepwood",
  "Emberfall",
  "Elderwild",
  "Nightmare Thicket",
  "Starforged",
];
const TIER_LEVELS = [1, 14, 26, 39, 52, 65, 77, 90];

function craftingItem(
  itemId: string,
  name: string,
  description: string,
  itemFamily: string,
  craftingSkillId: string,
  craftingTier: Tier,
  maxStackSize = 1000
): SeedItem {
  return {
    itemId,
    name,
    category: "crafting",
    description,
    stackable: true,
    maxStackSize,
    allowedEquipmentSlots: [],
    rarityLevel: craftingTier * 10,
    itemFamily,
    craftingSkillId,
    craftingTier,
  };
}

type WeaponSpec = {
  damage: number;
  speed: number;
  scaling: "str" | "dex" | "int";
  magical?: boolean;
};

/**
 * Staff raw damage, tuned with the agility rebalance alongside the caster's
 * starter spell. Exported so the seed and the staff migrations cannot drift
 * apart.
 */
export const STAFF_BASE_DAMAGE_PER_TIER = 10.5;
export const STARTER_STAFF_BASE_DAMAGE = 4.375;

const WEAPON_SPECS: Record<string, WeaponSpec> = {
  // Tuned with the agility split (70% damage stat / 15% AGI / 15% CON) so
  // every weapon type reaches stat level 100 in about the same hunting time.
  sword: { damage: 12, speed: 1.0, scaling: "str" },
  dagger: { damage: 7.5, speed: 1.6, scaling: "dex" },
  mace: { damage: 16, speed: 0.65, scaling: "str" },
  bow: { damage: 9, speed: 1.3, scaling: "dex" },
  // Staves are intentionally the weakest raw weapon: the caster kit starts
  // with an arcane bolt and scales through abilities rather than swings.
  staff: { damage: STAFF_BASE_DAMAGE_PER_TIER, speed: 0.8, scaling: "int", magical: true },
};

type ArmorSpec = { defense: number; penalty: number };

const HEAVY_ARMOR: Record<string, ArmorSpec> = {
  // A full heavy set slows attacks by 10%.
  helm: { defense: 4, penalty: 0.02 },
  mail: { defense: 6, penalty: 0.04 },
  greaves: { defense: 5, penalty: 0.03 },
  boots: { defense: 3, penalty: 0.01 },
};

const LIGHT_ARMOR: Record<string, number> = {
  hood: 2,
  vest: 4,
  leggings: 3,
  boots: 2,
};

function weaponItem(
  itemId: string,
  name: string,
  itemFamily: string,
  craftingSkillId: "woodworking" | "forging",
  craftingTier: Tier,
  slot: EquipmentSlot,
  effectStat: EffectStat,
  kind: keyof typeof WEAPON_SPECS
): SeedItem {
  const spec = WEAPON_SPECS[kind];
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name} shaped from tier ${craftingTier} mystical forest materials.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: [slot],
    rarityLevel: craftingTier * 10,
    itemFamily,
    craftingSkillId,
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier * 2,
    augmentSlots: 1,
    baseDamage: spec.damage * craftingTier,
    attackSpeed: spec.speed,
    damageStat: spec.scaling,
    damageType: spec.magical ? "magical" : "physical",
    weaponType: kind as SeedItem["weaponType"],
  };
}

function heavyArmorItem(
  itemId: string,
  name: string,
  itemFamily: string,
  craftingTier: Tier,
  slot: EquipmentSlot,
  effectStat: EffectStat,
  kind: keyof typeof HEAVY_ARMOR
): SeedItem {
  const spec = HEAVY_ARMOR[kind];
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name} forged from tier ${craftingTier} mystical forest ores.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: [slot],
    rarityLevel: craftingTier * 10,
    itemFamily,
    craftingSkillId: "forging",
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier * 2,
    augmentSlots: 1,
    baseDefense: spec.defense * craftingTier,
    speedPenalty: spec.penalty,
  };
}

function lightArmorItem(
  itemId: string,
  name: string,
  itemFamily: string,
  craftingTier: Tier,
  slot: EquipmentSlot,
  effectStat: EffectStat,
  kind: keyof typeof LIGHT_ARMOR
): SeedItem {
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name} shaped from tier ${craftingTier} mystical forest materials.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: [slot],
    rarityLevel: craftingTier * 10,
    itemFamily,
    craftingSkillId: "woodworking",
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier * 2,
    augmentSlots: 1,
    baseDefense: LIGHT_ARMOR[kind] * craftingTier,
  };
}

// ─── Gathering resources ────────────────────────────────────────────────────

const HARVESTING_RESOURCES = [
  ["moonlit-herb", "Moonlit Herb", 1, "A silver-veined herb that opens beneath moonlight."],
  ["silverdew-leaf", "Silverdew Leaf", 1, "A broad leaf beaded with alchemically pure dew."],
  ["starlight-moss", "Starlight Moss", 1, "Soft moss that keeps a trace of the night sky."],
  ["glimmering-mushroom", "Glimmering Mushroom", 2, "A blue mushroom that stores a quiet woodland glow."],
  ["sunveil-bloom", "Sunveil Bloom", 2, "A warm blossom hidden beneath the forest canopy."],
  ["dreamcap-spore", "Dreamcap Spore", 2, "A drifting spore gathered from sleeping dreamcaps."],
  ["whispering-flower", "Whispering Flower", 3, "Its petals murmur forgotten names when gathered."],
  ["astral-orchid", "Astral Orchid", 3, "A rare orchid whose markings resemble constellations."],
  ["elderroot", "Elderroot", 3, "An ancient medicinal root steeped in forest memory."],
  ["emberleaf", "Emberleaf", 4, "A leaf warm to the touch, veined like cooling embers."],
  ["frostcap", "Frostcap", 4, "A pale mushroom rimed with everlasting frost."],
  ["thornbloom", "Thornbloom", 4, "A fierce blossom that only opens for careful hands."],
  ["tidepetal", "Tidepetal", 5, "Petals that smell of rain no matter the season."],
  ["stormspore", "Stormspore", 5, "A spore that crackles faintly before a storm."],
  ["glowroot", "Glowroot", 5, "A root that pulses with soft amber light."],
  ["voidfern", "Voidfern", 6, "A fern the color of the sky between stars."],
  ["sunscale-lichen", "Sunscale Lichen", 6, "Golden lichen that grows only in true sunlight."],
  ["hexbark-blossom", "Hexbark Blossom", 6, "A blossom warded by the tree that bore it."],
  ["nightshade-crown", "Nightshade Crown", 7, "A dark flower fit for an unseen monarch."],
  ["wraithvine", "Wraithvine", 7, "A vine that passes through shadows to drink."],
  ["doomorchid", "Doomorchid", 7, "Beautiful the way a drawn blade is beautiful."],
  ["starforged-seed", "Starforged Seed", 8, "A seed that fell from the reforged sky."],
  ["dawnpetal", "Dawnpetal", 8, "The first color of morning, gathered whole."],
  ["eternalmoss", "Eternalmoss", 8, "Moss that has never known a winter."],
] as const;

const WOOD_RESOURCES = [
  ["moonwood-log", "Moonwood Log", 1, "Pale wood harvested from trees that drink in starlight."],
  ["living-bark", "Living Bark", 2, "Warm bark that flexes like a slow, sleeping heartbeat."],
  ["thornvine-bundle", "Thornvine Bundle", 3, "A coil of thornvine gathered before its thorns unfurl."],
  ["emberwood-log", "Emberwood Log", 4, "Wood that smolders gently for years after cutting."],
  ["tidewood-log", "Tidewood Log", 5, "Waterlogged timber light as balsa and hard as oak."],
  ["voidwood-log", "Voidwood Log", 6, "Timber that drinks the light around it."],
  ["dreadwood-log", "Dreadwood Log", 7, "Black wood that whispers when the wind moves it."],
  ["worldheart-log", "Worldheart Log", 8, "A section of the forest's own beating heart."],
] as const;

const ORE_RESOURCES = [
  ["moonstone-shard", "Moonstone Shard", 1, "A cool shard that reflects a sky no matter the hour."],
  ["root-amber", "Root Amber", 2, "Golden resin found where ancient roots cross the stone."],
  ["root-iron-ore", "Root-Iron Ore", 3, "Dense ore threaded with roots that refuse to break."],
  ["emberstone-shard", "Emberstone Shard", 4, "Stone that holds the day's heat past midnight."],
  ["stormsilver-ore", "Stormsilver Ore", 5, "Bright ore that hums during thunderstorms."],
  ["voidquartz-ore", "Voidquartz Ore", 6, "A crystal with a darkness visible inside."],
  ["nightsteel-ore", "Nightsteel Ore", 7, "Ore that only surfaces under a moonless sky."],
  ["starforged-ore", "Starforged Ore", 8, "Metal reforged in the heart of a fallen star."],
] as const;

const RESOURCE_ITEMS: SeedItem[] = [
  ...HARVESTING_RESOURCES.map(([itemId, name, tier, description]) =>
    craftingItem(itemId, name, description, "harvesting-resource", "harvesting", tier as Tier)
  ),
  ...WOOD_RESOURCES.map(([itemId, name, tier, description]) =>
    craftingItem(itemId, name, description, "woodcutting-resource", "woodcutting", tier as Tier)
  ),
  ...ORE_RESOURCES.map(([itemId, name, tier, description]) =>
    craftingItem(itemId, name, description, "mining-resource", "mining", tier as Tier)
  ),
];

// Refinement lines: [essence, powder, extract] harvesting resources per tier.
const ESSENCE_LINE = [
  ["moonlit-essence", "Moonlit Essence", "moonlit-herb"],
  ["glimmering-essence", "Glimmering Essence", "glimmering-mushroom"],
  ["whispering-essence", "Whispering Essence", "whispering-flower"],
  ["ember-essence", "Ember Essence", "emberleaf"],
  ["tide-essence", "Tide Essence", "tidepetal"],
  ["void-essence", "Void Essence", "voidfern"],
  ["nightmare-essence", "Nightmare Essence", "nightshade-crown"],
  ["starforged-essence", "Starforged Essence", "starforged-seed"],
] as const;
const POWDER_LINE = [
  ["silverdew-powder", "Silverdew Powder", "silverdew-leaf"],
  ["sunveil-powder", "Sunveil Powder", "sunveil-bloom"],
  ["astral-powder", "Astral Powder", "astral-orchid"],
  ["ember-powder", "Ember Powder", "frostcap"],
  ["tide-powder", "Tide Powder", "stormspore"],
  ["void-powder", "Void Powder", "sunscale-lichen"],
  ["nightmare-powder", "Nightmare Powder", "wraithvine"],
  ["starforged-powder", "Starforged Powder", "dawnpetal"],
] as const;
const EXTRACT_LINE = [
  ["starlight-extract", "Starlight Extract", "starlight-moss"],
  ["dreamcap-extract", "Dreamcap Extract", "dreamcap-spore"],
  ["elderroot-extract", "Elderroot Extract", "elderroot"],
  ["ember-extract", "Ember Extract", "thornbloom"],
  ["tide-extract", "Tide Extract", "glowroot"],
  ["void-extract", "Void Extract", "hexbark-blossom"],
  ["nightmare-extract", "Nightmare Extract", "doomorchid"],
  ["starforged-extract", "Starforged Extract", "eternalmoss"],
] as const;
const LUMBER_LINE = [
  ["moonwood-lumber", "Moonwood Lumber", "moonwood-log"],
  ["living-bark-lumber", "Living Bark Lumber", "living-bark"],
  ["thornvine-lumber", "Thornvine Lumber", "thornvine-bundle"],
  ["emberwood-lumber", "Emberwood Lumber", "emberwood-log"],
  ["tidewood-lumber", "Tidewood Lumber", "tidewood-log"],
  ["voidwood-lumber", "Voidwood Lumber", "voidwood-log"],
  ["dreadwood-lumber", "Dreadwood Lumber", "dreadwood-log"],
  ["worldheart-lumber", "Worldheart Lumber", "worldheart-log"],
] as const;
const INGOT_LINE = [
  ["moonstone-ingot", "Moonstone Ingot", "moonstone-shard"],
  ["ambersteel-ingot", "Ambersteel Ingot", "root-amber"],
  ["root-iron-ingot", "Root-Iron Ingot", "root-iron-ore"],
  ["emberstone-ingot", "Emberstone Ingot", "emberstone-shard"],
  ["stormsilver-ingot", "Stormsilver Ingot", "stormsilver-ore"],
  ["voidquartz-ingot", "Voidquartz Ingot", "voidquartz-ore"],
  ["nightsteel-ingot", "Nightsteel Ingot", "nightsteel-ore"],
  ["starforged-ingot", "Starforged Ingot", "starforged-ore"],
] as const;

const REFINED_ITEMS: SeedItem[] = [
  ...ESSENCE_LINE.map(([itemId, name], index) =>
    craftingItem(itemId, name, `A tier ${index + 1} reagent refined before final alchemical brewing.`, "alchemy-essence", "alchemy", (index + 1) as Tier)
  ),
  ...POWDER_LINE.map(([itemId, name], index) =>
    craftingItem(itemId, name, `A tier ${index + 1} reagent refined before final alchemical brewing.`, "alchemy-powder", "alchemy", (index + 1) as Tier)
  ),
  ...EXTRACT_LINE.map(([itemId, name], index) =>
    craftingItem(itemId, name, `A tier ${index + 1} reagent refined before final alchemical brewing.`, "alchemy-extract", "alchemy", (index + 1) as Tier)
  ),
  ...LUMBER_LINE.map(([itemId, name], index) =>
    craftingItem(itemId, name, `Tier ${index + 1} lumber refined for woodworking.`, "woodworking-lumber", "woodworking", (index + 1) as Tier)
  ),
  ...INGOT_LINE.map(([itemId, name], index) =>
    craftingItem(itemId, name, `A tier ${index + 1} ingot refined for forging.`, "forging-ingot", "forging", (index + 1) as Tier)
  ),
];

// ─── Combat consumables (alchemy products) ──────────────────────────────────

type ConsumableEffect =
  | { effectType: "heal-over-time"; effectAmount: number; effectDurationMs: number }
  | { effectType: "combat-stat-boost"; effectStat: EffectStat; effectAmount: number; effectDurationMs: number }
  | { effectType: "skill-xp-multiplier" | "skill-speed-multiplier"; effectAmount: number; effectDurationMs: number; effectScope: "gathering" | "crafting" }
  | { effectType: "combat-xp-multiplier"; effectAmount: number; effectDurationMs: number };

const MIN = 60_000;

const CONSUMABLE_ITEMS: Array<
  SeedItem & { tier: Tier; family: string; variant: "base" | "advanced" }
> = [
  // Track 1 — combat (alchemy-might), one per tier.
  { ...craftingItem("verdant-tonic", "Verdant Tonic", "A soothing tonic that knits wounds over time.", "alchemy-might", "alchemy", 1, 1000), ...{ effectType: "heal-over-time", effectAmount: 1.5, effectDurationMs: 5 * MIN } as ConsumableEffect, tier: 1, family: "alchemy-might", variant: "base" },
  { ...craftingItem("ember-might-draught", "Ember Might Draught", "Kindles raw strength for a time.", "alchemy-might", "alchemy", 2, 1000), ...{ effectType: "combat-stat-boost", effectStat: "str", effectAmount: 3, effectDurationMs: 5 * MIN } as ConsumableEffect, tier: 2, family: "alchemy-might", variant: "base" },
  { ...craftingItem("hunters-swift-draught", "Hunter's Swiftness Draught", "Sharpens reflexes for a time.", "alchemy-might", "alchemy", 3, 1000), ...{ effectType: "combat-stat-boost", effectStat: "dex", effectAmount: 3, effectDurationMs: 6 * MIN } as ConsumableEffect, tier: 3, family: "alchemy-might", variant: "base" },
  { ...craftingItem("starwater-salve", "Starwater Salve", "A potent salve that closes wounds over time.", "alchemy-might", "alchemy", 4, 1000), ...{ effectType: "heal-over-time", effectAmount: 3, effectDurationMs: 8 * MIN } as ConsumableEffect, tier: 4, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("demonseed-might-draught", "Demonseed Might Draught", "Burns with a dangerous, mighty strength.", "alchemy-might", "alchemy", 5, 1000), ...{ effectType: "combat-stat-boost", effectStat: "str", effectAmount: 7, effectDurationMs: 10 * MIN } as ConsumableEffect, tier: 5, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("stonehide-draught", "Stonehide Draught", "Skin takes on the patience of stone.", "alchemy-might", "alchemy", 6, 1000), ...{ effectType: "combat-stat-boost", effectStat: "con", effectAmount: 4, effectDurationMs: 10 * MIN } as ConsumableEffect, tier: 6, family: "alchemy-might", variant: "base" },
  { ...craftingItem("nightmare-swift-draught", "Nightmare Swiftness Draught", "Move like something out of a bad dream.", "alchemy-might", "alchemy", 7, 1000), ...{ effectType: "combat-stat-boost", effectStat: "dex", effectAmount: 7, effectDurationMs: 12 * MIN } as ConsumableEffect, tier: 7, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("starforged-heart-draught", "Starforged Heart Draught", "The heart of the forest, beating in a flask.", "alchemy-might", "alchemy", 8, 1000), ...{ effectType: "combat-stat-boost", effectStat: "con", effectAmount: 8, effectDurationMs: 15 * MIN } as ConsumableEffect, tier: 8, family: "alchemy-might", variant: "advanced" },
  // Track 2 — skill XP (alchemy-focus), per-skill pairs.
  { ...craftingItem("gathering-focus-tonic", "Gathering Focus Tonic", "Sharpens gathering instincts, improving skill gains.", "alchemy-focus", "alchemy", 1, 1000), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 1, family: "alchemy-focus", variant: "base" },
  { ...craftingItem("crafting-focus-tonic", "Crafting Focus Tonic", "Steadies the hand, improving crafting skill gains.", "alchemy-focus", "alchemy", 1, 1000), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 1, family: "alchemy-focus", variant: "base" },
  { ...craftingItem("gathering-focus-elixir", "Gathering Focus Elixir", "Deep attunement to the wilds.", "alchemy-focus", "alchemy", 5, 1000), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.8, effectDurationMs: 45 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 5, family: "alchemy-focus", variant: "advanced" },
  { ...craftingItem("crafting-focus-elixir", "Crafting Focus Elixir", "The workshop feels like an extension of the self.", "alchemy-focus", "alchemy", 5, 1000), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.8, effectDurationMs: 45 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 5, family: "alchemy-focus", variant: "advanced" },
  // Track 3 — skill speed (alchemy-swiftness), per-skill pairs.
  { ...craftingItem("gathering-alacrity-tonic", "Gathering Alacrity Tonic", "Quickens gathering work.", "alchemy-swiftness", "alchemy", 2, 1000), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.2, effectDurationMs: 30 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 2, family: "alchemy-swiftness", variant: "base" },
  { ...craftingItem("crafting-alacrity-tonic", "Crafting Alacrity Tonic", "Quickens crafting work.", "alchemy-swiftness", "alchemy", 2, 1000), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.2, effectDurationMs: 30 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 2, family: "alchemy-swiftness", variant: "base" },
  { ...craftingItem("gathering-alacrity-elixir", "Gathering Alacrity Elixir", "Blur through the undergrowth.", "alchemy-swiftness", "alchemy", 6, 1000), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.6, effectDurationMs: 45 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 6, family: "alchemy-swiftness", variant: "advanced" },
  { ...craftingItem("crafting-alacrity-elixir", "Crafting Alacrity Elixir", "Hands move faster than thought.", "alchemy-swiftness", "alchemy", 6, 1000), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.6, effectDurationMs: 45 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 6, family: "alchemy-swiftness", variant: "advanced" },
  // Track 4 — combat XP (alchemy-wisdom), single pair.
  { ...craftingItem("wisdom-draught", "Wisdom Draught", "Learn from every battle.", "alchemy-wisdom", "alchemy", 3, 1000), ...{ effectType: "combat-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN } as ConsumableEffect, tier: 3, family: "alchemy-wisdom", variant: "base" },
  { ...craftingItem("wisdom-elixir", "Wisdom Elixir", "Every scar is a lesson.", "alchemy-wisdom", "alchemy", 7, 1000), ...{ effectType: "combat-xp-multiplier", effectAmount: 2.0, effectDurationMs: 45 * MIN } as ConsumableEffect, tier: 7, family: "alchemy-wisdom", variant: "advanced" },
];

// Greater brews: a stronger copy of each combat brew (double effect), brewed
// from that brew plus Blighted ichor. One per crafting tier.
const GREATER_BREWS = CONSUMABLE_ITEMS.filter(
  (item) => item.family === "alchemy-might"
).map((item) => ({
  itemId: `greater-${item.itemId}`,
  name: `Greater ${item.name}`,
  tier: item.tier,
  baseItemId: item.itemId,
  item: {
    ...item,
    itemId: `greater-${item.itemId}`,
    name: `Greater ${item.name}`,
    description: `${item.description} Twice as strong, thanks to Blighted ichor.`,
    itemFamily: "alchemy-greater",
    rarityLevel: item.rarityLevel + 10,
    effectAmount:
      item.effectAmount === undefined ? undefined : item.effectAmount * 2,
    family: "alchemy-greater",
    variant: "base" as const,
  },
}));

// ─── Forged gear (7 pieces × 8 tiers) ───────────────────────────────────────

const FORGE_SETS = [
  "Moonstone",
  "Ambersteel",
  "Root-Iron",
  "Emberstone",
  "Stormsilver",
  "Voidquartz",
  "Nightsteel",
  "Starforged",
] as const;
const FORGE_IDS = [
  "moonstone",
  "ambersteel",
  "root-iron",
  "emberstone",
  "stormsilver",
  "voidquartz",
  "nightsteel",
  "starforged",
] as const;

const FORGING_ITEMS: SeedItem[] = TIERS.flatMap((tier) => {
  const index = tier - 1;
  const material = FORGE_SETS[index];
  const prefix = FORGE_IDS[index];
  return [
    weaponItem(`${prefix}-sword`, `${material} Sword`, "forging-sword", "forging", tier, "mainHand", "str", "sword"),
    weaponItem(`${prefix}-dagger`, `${material} Dagger`, "forging-dagger", "forging", tier, "mainHand", "dex", "dagger"),
    weaponItem(`${prefix}-mace`, `${material} Mace`, "forging-mace", "forging", tier, "mainHand", "con", "mace"),
    heavyArmorItem(`${prefix}-helm`, `${material} Helm`, "forging-head", tier, "head", "con", "helm"),
    heavyArmorItem(`${prefix}-mail`, `${material} Mail`, "forging-chest", tier, "chest", "con", "mail"),
    heavyArmorItem(`${prefix}-greaves`, `${material} Greaves`, "forging-legs", tier, "legs", "str", "greaves"),
    heavyArmorItem(`${prefix}-boots`, `${material} Boots`, "forging-feet", tier, "feet", "agi", "boots"),
  ];
});

// ─── Woodworked gear (6 pieces × 8 tiers) ───────────────────────────────────

const WOOD_SETS = [
  "Moonwood",
  "Living Bark",
  "Thornvine",
  "Emberwood",
  "Tidewood",
  "Voidwood",
  "Dreadwood",
  "Worldheart",
] as const;
const WOOD_IDS = [
  "moonwood",
  "living-bark",
  "thornvine",
  "emberwood",
  "tidewood",
  "voidwood",
  "dreadwood",
  "worldheart",
] as const;

const WOODWORKING_ITEMS: SeedItem[] = TIERS.flatMap((tier) => {
  const index = tier - 1;
  const material = WOOD_SETS[index];
  const prefix = WOOD_IDS[index];
  return [
    weaponItem(`${prefix}-bow`, `${material} Bow`, "woodworking-bow", "woodworking", tier, "mainHand", "dex", "bow"),
    weaponItem(`${prefix}-staff`, `${material} Staff`, "woodworking-staff", "woodworking", tier, "mainHand", "int", "staff"),
    lightArmorItem(`${prefix}-hood`, `${material} Hood`, "woodworking-head", tier, "head", "luk", "hood"),
    lightArmorItem(`${prefix}-vest`, `${material} Vest`, "woodworking-chest", tier, "chest", "con", "vest"),
    lightArmorItem(`${prefix}-leggings`, `${material} Leggings`, "woodworking-legs", tier, "legs", "dex", "leggings"),
    lightArmorItem(`${prefix}-boots`, `${material} Boots`, "woodworking-feet", tier, "feet", "agi", "boots"),
  ];
});

// ─── Blighted gear (forged + woodworked, tiers 9–16) ────────────────────────
// The endgame power ladder. Tier 9+N regrows the tier 8 piece in Blighted
// biome N's bone (forged) or hide (woodworked): each tier is the previous
// piece plus Blighted materials and the previous tier's boss token, so each
// boss kill unlocks the next gear tier. Damage, defense and the stat bonus all
// grow: tier 9 is BLIGHTED_GEAR_FIRST_STEP× tier 8 (it absorbs the tier 9
// jump), then each tier is BLIGHTED_GEAR_GROWTH×, matching the 1.4× monster
// step. Growing the stat bonus matters: player HP only comes from CON, so
// without it monster damage outruns survivability. Tuned with the balance sim
// (convex/balanceSim.test.ts) so a Blighted tier plays like a main tier: gear
// of the tier clears its easy and full zones, wins most hard-zone fights and
// beats its boss; gear a tier behind can't beat the boss.

export const BLIGHTED_GEAR_GROWTH = 1.4;
/** Tier 9 over tier 8: the first Blighted piece absorbs the tier 9 jump. */
export const BLIGHTED_GEAR_FIRST_STEP = 8;
export const BLIGHTED_GEAR_TIERS = [9, 10, 11, 12, 13, 14, 15, 16] as const;
/** Skill level for every Blighted tier: the materials are the real gate. */
const BLIGHTED_GEAR_LEVEL = 95;
const BLIGHTED_GEAR_DROP_QTY = 4;
const BLIGHTED_GEAR_REFINED_QTY = 3;

export function blightedGearItemId(baseItemId: string, tier: number) {
  return `${baseItemId}-t${tier}`;
}

function blightedGearItem(base: SeedItem, tier: number): SeedItem {
  const growth = BLIGHTED_GEAR_FIRST_STEP * Math.pow(BLIGHTED_GEAR_GROWTH, tier - 9);
  const grow = (value: number) => Math.round(value * growth * 100) / 100;
  const biome = BIOMES[tier - 9];
  const kind = base.craftingSkillId === "forging" ? "bone" : "hide";
  const name = `${biome.blight.label} ${base.name}`;
  return {
    ...base,
    itemId: blightedGearItemId(base.itemId, tier),
    name,
    description: `${name}: tier 8 gear regrown in Blighted ${biome.name} ${kind}. Tier ${tier}.`,
    rarityLevel: tier * 10,
    craftingTier: tier,
    ...(base.effectAmount === undefined ? {} : { effectAmount: Math.round(base.effectAmount * growth) }),
    ...(base.baseDamage === undefined ? {} : { baseDamage: grow(base.baseDamage) }),
    ...(base.baseDefense === undefined ? {} : { baseDefense: grow(base.baseDefense) }),
  };
}

/** The tier 8 pieces each Blighted ladder starts from. */
const BLIGHTED_GEAR_BASES: SeedItem[] = [...FORGING_ITEMS, ...WOODWORKING_ITEMS].filter(
  (item) => item.craftingTier === TIERS.length
);

const BLIGHTED_GEAR_ITEMS: SeedItem[] = BLIGHTED_GEAR_BASES.flatMap((base) =>
  BLIGHTED_GEAR_TIERS.map((tier) => blightedGearItem(base, tier))
);

// ─── Leatherwork (leathercrafting skill: belts, bags, leather armor) ─────────
// Three leather lines, one per damage stat. Tier N leather cures from the
// tier N biome's hide (convex/biomes.ts) plus the tier N-1 leather; each line
// also takes one other biome material, so every hunt feeds some leather.
const LEATHER_SOURCES: ReadonlyArray<{
  monster: string;
  prefix: string;
  name: string;
  stat: EffectStat;
  extra: MaterialKind;
}> = [
  { monster: "brawler", prefix: "brawler", name: "Brawler", stat: "str", extra: "bone" },
  { monster: "ranger", prefix: "ranger", name: "Ranger", stat: "dex", extra: "hide" },
  { monster: "mystic", prefix: "mystic", name: "Mystic", stat: "int", extra: "ichor" },
];

const LEATHER_ARMOR_PIECES = [
  { suffix: "cap", slot: "head", name: "Cap", defense: 1 },
  { suffix: "vest", slot: "chest", name: "Vest", defense: 3 },
  { suffix: "leggings", slot: "legs", name: "Leggings", defense: 2 },
  { suffix: "boots", slot: "feet", name: "Boots", defense: 1 },
] as const;

function leatherItem(
  itemId: string,
  name: string,
  monster: string,
  craftingTier: Tier
): SeedItem {
  return {
    ...craftingItem(
      itemId,
      name,
      `Cured tier ${craftingTier} ${monster} leather. Upgrades with the tiers.`,
      `leather-${monster}`,
      "leathercrafting",
      craftingTier
    ),
  };
}

function beltItem(
  itemId: string,
  name: string,
  monster: string,
  craftingTier: Tier,
  effectStat: EffectStat
): SeedItem {
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name}: holds alchemy brews at the hip (tier ${craftingTier} belts unlock more consumable slots) and carries the ${effectStat.toUpperCase()} of the ${monster}.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["belt"],
    rarityLevel: craftingTier * 10,
    itemFamily: `leather-belt-${monster}`,
    craftingSkillId: "leathercrafting",
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier,
    augmentSlots: 1,
    // Zero base defense keeps unenchanted belts purely utility; the armor
    // flag makes them enchantable (and augmentable) like any equipment.
    baseDefense: 0,
  };
}

function bagItem(itemId: string, name: string, craftingTier: Tier): SeedItem {
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name}: stitched carry space that expands inventory capacity while equipped. No combat bonus.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["bag"],
    rarityLevel: craftingTier * 10,
    itemFamily: "leather-bag",
    craftingSkillId: "leathercrafting",
    craftingTier,
    augmentSlots: 0,
  };
}

/**
 * Bag capacity is configurable balance (`bagInventorySlotsPerTier`), so the
 * item description is written from the effective value at seed time instead
 * of baking the default into the item row.
 */
function leatherBagDescription(
  name: string,
  craftingTier: number,
  slotsPerTier: number
) {
  return `${name}: stitched carry space, +${craftingTier * slotsPerTier} inventory slots while equipped. No combat bonus.`;
}

function leatherSeedValues(item: SeedItem, bagSlotsPerTier: number): SeedItem {
  if (item.itemFamily === "leather-bag" && item.craftingTier !== undefined) {
    return {
      ...item,
      description: leatherBagDescription(
        item.name,
        item.craftingTier,
        bagSlotsPerTier
      ),
    };
  }
  return item;
}

function leatherArmorItem(
  itemId: string,
  name: string,
  monster: string,
  craftingTier: Tier,
  slot: EquipmentSlot,
  effectStat: EffectStat,
  baseDefensePerTier: number
): SeedItem {
  return {
    itemId,
    name,
    category: "equipment",
    description: `${name}: supple tier ${craftingTier} ${monster} leather. Less protection than wood or metal, but alive with ${effectStat.toUpperCase()}.`,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: [slot],
    rarityLevel: craftingTier * 10,
    itemFamily: `leather-armor-${monster}-${slot}`,
    craftingSkillId: "leathercrafting",
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier,
    augmentSlots: 1,
    baseDefense: baseDefensePerTier * craftingTier,
  };
}

const LEATHERWORKING_ITEMS: SeedItem[] = TIERS.flatMap((tier) => [
  ...LEATHER_SOURCES.map((source) =>
    leatherItem(
      `${source.prefix}-leather-t${tier}`,
      `${source.name} Leather T${tier}`,
      source.monster,
      tier
    )
  ),
  ...LEATHER_SOURCES.map((source) =>
    beltItem(
      `${source.prefix}-belt-t${tier}`,
      `${source.name} Belt T${tier}`,
      source.monster,
      tier,
      source.stat as EffectStat
    )
  ),
  bagItem(`traveler-bag-t${tier}`, `Traveler's Bag T${tier}`, tier),
  ...LEATHER_SOURCES.flatMap((source) =>
    LEATHER_ARMOR_PIECES.map((piece) =>
      leatherArmorItem(
        `${source.prefix}-${piece.suffix}-t${tier}`,
        `${source.name} ${piece.name} T${tier}`,
        source.monster,
        tier,
        piece.slot as EquipmentSlot,
        source.stat as EffectStat,
        piece.defense
      )
    )
  ),
]);

type LeatherRecipeSeed = {
  recipeId: string;
  outputItemId: string;
  tier: Tier;
  name: string;
  description: string;
  outputFamily: string;
  ingredients: Array<{ itemId: string; quantity: number }>;
};

/**
 * Leatherwork recipes are stageless legacy recipes (like talismans and boss
 * keys) because hides come from combat loot, not a paired gathering skill, so
 * the refinement/product chain rules cannot apply. Crafting-tier gates still
 * apply via skillTierDefinitions. Every line upgrades stepwise (tier N
 * consumes the tier N-1 piece), so tiers extend as data-only rows.
 */
function buildLeatherRecipes(bagSlotsPerTier: number): LeatherRecipeSeed[] {
  const recipes: LeatherRecipeSeed[] = [];
  for (const tier of TIERS) {
    for (const source of LEATHER_SOURCES) {
      const leatherId = `${source.prefix}-leather-t${tier}`;
      recipes.push({
        recipeId: leatherId,
        outputItemId: leatherId,
        tier,
        name: `Cure ${source.name} Leather T${tier}`,
        description:
          tier === 1
            ? `Cure ${BIOMES[0].materials.hide} into workable tier 1 leather.`
            : `Upgrade ${source.name} leather to tier ${tier} with fresh ${BIOMES[tier - 1].materials.hide}.`,
        outputFamily: `leather-${source.monster}`,
        ingredients: [
          { itemId: materialItemId(tier, "hide"), quantity: source.extra === "hide" ? 4 : 3 },
          ...(source.extra === "hide"
            ? []
            : [{ itemId: materialItemId(tier, source.extra), quantity: 1 }]),
          ...(tier === 1
            ? []
            : [
                {
                  itemId: `${source.prefix}-leather-t${tier - 1}`,
                  quantity: 1,
                },
              ]),
        ],
      });
      const beltId = `${source.prefix}-belt-t${tier}`;
      recipes.push({
        recipeId: beltId,
        outputItemId: beltId,
        tier,
        name: `Stitch ${source.name} Belt T${tier}`,
        description: `Stitch a tier ${tier} ${source.monster} belt. Higher tiers hold more consumables.`,
        outputFamily: `leather-belt-${source.monster}`,
        ingredients: [
          { itemId: leatherId, quantity: 2 },
          ...(tier === 1
            ? []
            : [
                {
                  itemId: `${source.prefix}-belt-t${tier - 1}`,
                  quantity: 1,
                },
              ]),
        ],
      });
      for (const piece of LEATHER_ARMOR_PIECES) {
        const armorId = `${source.prefix}-${piece.suffix}-t${tier}`;
        recipes.push({
          recipeId: armorId,
          outputItemId: armorId,
          tier,
          name: `Stitch ${source.name} ${piece.name} T${tier}`,
          description: `Stitch tier ${tier} ${source.monster} ${piece.name.toLowerCase()} from cured leather.`,
          outputFamily: `leather-armor-${source.monster}-${piece.slot}`,
          ingredients: [
            { itemId: leatherId, quantity: 2 },
            ...(tier === 1
              ? []
              : [
                  {
                    itemId: `${source.prefix}-${piece.suffix}-t${tier - 1}`,
                    quantity: 1,
                  },
                ]),
          ],
        });
      }
    }
    const bagId = `traveler-bag-t${tier}`;
    recipes.push({
      recipeId: bagId,
      outputItemId: bagId,
      tier,
      name: `Stitch Traveler's Bag T${tier}`,
      description: `Stitch a tier ${tier} carry bag from all three cured leathers. +${tier * bagSlotsPerTier} inventory slots while equipped.`,
      outputFamily: "leather-bag",
      ingredients: [
        ...LEATHER_SOURCES.map((source) => ({
          itemId: `${source.prefix}-leather-t${tier}`,
          quantity: 2,
        })),
        ...(tier === 1
          ? []
          : [{ itemId: `traveler-bag-t${tier - 1}`, quantity: 1 }]),
      ],
    });
  }
  return recipes;
}

const OUTPUT_ITEMS: SeedItem[] = [
  ...REFINED_ITEMS,
  ...[...CONSUMABLE_ITEMS, ...GREATER_BREWS.map((brew) => brew.item)].map(
    ({ tier: _tier, family: _family, variant, ...item }) => ({
      ...item,
      buffVariant: variant,
    })
  ),
  ...WOODWORKING_ITEMS,
  ...FORGING_ITEMS,
  ...LEATHERWORKING_ITEMS,
];

// ─── Starter kits (T0, no recipes) ──────────────────────────────────────────

const STARTER_ITEMS: SeedItem[] = [
  {
    itemId: "worn-sword",
    name: "Worn Sword",
    category: "equipment",
    description: "A reliable blade for a new hunter.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 1,
    augmentSlots: 0,
    baseDamage: 5,
    attackSpeed: 1.0,
    damageStat: "str",
    damageType: "physical",
    weaponType: "sword",
  },
  {
    itemId: "worn-dagger",
    name: "Worn Dagger",
    category: "equipment",
    description: "Quick and quiet.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "dex",
    effectAmount: 1,
    augmentSlots: 0,
    baseDamage: 3.75,
    attackSpeed: 1.6,
    damageStat: "dex",
    damageType: "physical",
    weaponType: "dagger",
  },
  {
    itemId: "worn-mace",
    name: "Worn Mace",
    category: "equipment",
    description: "Heavy, slow, and persuasive.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 1,
    augmentSlots: 0,
    baseDamage: 6,
    attackSpeed: 0.65,
    damageStat: "str",
    damageType: "physical",
    weaponType: "mace",
  },
  {
    itemId: "worn-bow",
    name: "Worn Bow",
    category: "equipment",
    description: "A ranger's first bow.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "dex",
    effectAmount: 1,
    augmentSlots: 0,
    baseDamage: 4.5,
    attackSpeed: 1.3,
    damageStat: "dex",
    damageType: "physical",
    weaponType: "bow",
  },
  {
    itemId: "worn-staff",
    name: "Worn Staff",
    category: "equipment",
    description: "Hums faintly with old magic.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "int",
    effectAmount: 1,
    augmentSlots: 0,
    baseDamage: STARTER_STAFF_BASE_DAMAGE,
    attackSpeed: 0.8,
    damageStat: "int",
    damageType: "magical",
    weaponType: "staff",
  },
  {
    itemId: "worn-mail",
    name: "Worn Mail",
    category: "equipment",
    description: "Dented but dependable.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["chest"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "con",
    effectAmount: 1,
    augmentSlots: 0,
    baseDefense: 3,
    speedPenalty: 0.04,
  },
  {
    itemId: "worn-vest",
    name: "Worn Vest",
    category: "equipment",
    description: "Light leathers for quick movers.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["chest"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "dex",
    effectAmount: 1,
    augmentSlots: 0,
    baseDefense: 2,
  },
  {
    itemId: "worn-robe",
    name: "Worn Robe",
    category: "equipment",
    description: "Threadbare, but steeped in old spells.",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["chest"],
    rarityLevel: 10,
    effectType: "stat-bonus",
    effectStat: "int",
    effectAmount: 1,
    augmentSlots: 0,
    baseDefense: 2,
  },
];

export const STARTER_KITS: Record<string, { weapon: string; chest: string }> = {
  sword: { weapon: "worn-sword", chest: "worn-mail" },
  dagger: { weapon: "worn-dagger", chest: "worn-vest" },
  mace: { weapon: "worn-mace", chest: "worn-mail" },
  bow: { weapon: "worn-bow", chest: "worn-vest" },
  staff: { weapon: "worn-staff", chest: "worn-robe" },
};

// Combat materials (convex/biomes.ts): hide, bone, ichor and trophy for each
// biome, their Blighted grades, and Rift Shards.
const BIOME_MATERIAL_ITEMS: SeedItem[] = allMaterialSeeds().map((material) => ({
  itemId: material.itemId,
  name: material.name,
  category: "crafting",
  description: material.description,
  stackable: true,
  maxStackSize: 10000,
  allowedEquipmentSlots: [],
  rarityLevel: material.rarityLevel,
  itemFamily: "monster-drop",
}));

const BOSS_TOKEN_ITEMS: SeedItem[] = INFUSION_TIERS.map((tier) => ({
  itemId: `forest-boss-token-${tier}`,
  name: `Heart of the Grove ${tier}`,
  category: "crafting",
  description: `A token claimed from the tier ${tier} guardian of the forest.`,
  stackable: true,
  maxStackSize: 1000,
  allowedEquipmentSlots: [],
  rarityLevel: 30,
  itemFamily: "boss-catalyst",
}));

// Raid-only guild building materials (convex/guildBuildings.ts). Raid kills
// put them in the guild stash, one grade per tier band.
const DRAGON_SCALE_ITEMS: SeedItem[] = (
  [
    ["dragon-scale", "Dragon Scale", "tiers 1–8", 40],
    ["blighted-dragon-scale", "Blighted Dragon Scale", "tiers 9–16", 90],
    ["rift-dragon-scale", "Rift Dragon Scale", "tiers 17–20", 170],
  ] as const
).map(([itemId, name, band, rarityLevel]) => ({
  itemId,
  name,
  category: "crafting",
  description: `Shed by a raid dragon (${band}). Guild officers spend it on guild buildings.`,
  stackable: true,
  maxStackSize: 10000,
  allowedEquipmentSlots: [],
  rarityLevel,
  itemFamily: "raid-material",
}));

const ESSENCE_ITEMS: SeedItem[] = INFUSION_TIERS.map((tier) => ({
  itemId: `essence-tier-${tier}`,
  name: `Tier ${tier} Monster Essence`,
  category: "crafting",
  description: `Condensed essence from tier ${tier} monsters. Used in infusion.`,
  stackable: true,
  maxStackSize: 10000,
  allowedEquipmentSlots: [],
  rarityLevel: Math.max(1, tier * 10),
  itemFamily: "monster-material",
  craftingSkillId: "infusion",
  craftingTier: tier as Tier,
}));

const BOSS_KEY_ITEMS: SeedItem[] = INFUSION_TIERS.map((tier) => ({  itemId: `boss-key-tier-${tier}`,
  name: `Tier ${tier} Boss Key`,
  category: "crafting",
  description: `Infused key required to challenge the tier ${tier} boss. Consumed on start.`,
  stackable: true,
  maxStackSize: 1000,
  allowedEquipmentSlots: [],
  rarityLevel: Math.max(1, tier * 10),
  itemFamily: "boss-key",
  craftingSkillId: "infusion",
  craftingTier: tier as Tier,
}));

function talismanItem(
  itemId: string,
  name: string,
  description: string,
  craftingTier: Tier,
  effectStat: EffectStat,
  effectAmount: number
): SeedItem {
  return {
    itemId,
    name,
    category: "equipment",
    description,
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["accessory1", "accessory2", "amulet"],
    rarityLevel: craftingTier * 10,
    itemFamily: "forging-talisman",
    craftingSkillId: "forging",
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount,
    augmentSlots: 1,
  };
}

// Trophy talismans: four stat lines, one per tier. Tier N is forged from the
// tier N biome trophy, tier N ingots and the tier N-1 talisman of the line.
const TALISMAN_LINES = [
  { line: "hunter", name: "Hunter's Talisman", stat: "luk", blurb: "A charm of lucky finds." },
  { line: "swiftwind", name: "Swiftwind Talisman", stat: "dex", blurb: "Quick as a gust through leaves." },
  { line: "warlord", name: "Warlord Talisman", stat: "str", blurb: "It hits back." },
  { line: "bulwark", name: "Bulwark Talisman", stat: "con", blurb: "Hard as old roots." },
] as const;

function talismanItemId(line: string, tier: number) {
  return `talisman-${line}-t${tier}`;
}

const TALISMAN_ITEMS: SeedItem[] = TALISMAN_LINES.flatMap((line) =>
  TIERS.map((tier) => ({
    ...talismanItem(
      talismanItemId(line.line, tier),
      `${line.name} T${tier}`,
      `${line.blurb} Set with a ${BIOMES[tier - 1].materials.trophy}.`,
      tier,
      line.stat as EffectStat,
      Math.round(tier * 1.5)
    ),
    itemFamily: `forging-talisman-${line.line}`,
  }))
);

export const ALL_ITEMS = [
  ...RESOURCE_ITEMS,
  ...OUTPUT_ITEMS,
  ...STARTER_ITEMS,
  ...BIOME_MATERIAL_ITEMS,
  ...BOSS_TOKEN_ITEMS,
  ...DRAGON_SCALE_ITEMS,
  ...ESSENCE_ITEMS,
  ...BOSS_KEY_ITEMS,
  ...TALISMAN_ITEMS,
  ...BLIGHTED_GEAR_ITEMS,
];

const SKILLS = [
  {
    skillId: "harvesting",
    name: "Harvesting",
    category: "gathering" as const,
    pairedSkillId: "alchemy",
    description: "Gather herbs, flowers, and fungi from the mystical forest.",
  },
  {
    skillId: "woodcutting",
    name: "Woodcutting",
    category: "gathering" as const,
    pairedSkillId: "woodworking",
    description: "Gather moonwood, living bark, and thornvine.",
  },
  {
    skillId: "mining",
    name: "Mining",
    category: "gathering" as const,
    pairedSkillId: "forging",
    description: "Extract moonstone, amber, and root-iron from hidden seams.",
  },
  {
    skillId: "alchemy",
    name: "Alchemy",
    category: "crafting" as const,
    pairedSkillId: "harvesting",
    description: "Turn gathered plants into tonics, salves, and elixirs.",
  },
  {
    skillId: "woodworking",
    name: "Woodworking",
    category: "crafting" as const,
    pairedSkillId: "woodcutting",
    description: "Shape living forest materials into bows, staves, and armor.",
  },
  {
    skillId: "forging",
    name: "Forging",
    category: "crafting" as const,
    pairedSkillId: "mining",
    description: "Temper forest ores into weapons and protective equipment.",
  },
  {
    skillId: "infusion",
    name: "Infusion",
    category: "crafting" as const,
    description:
      "Bind monster essence into boss keys, augmentations, and enchantments. Every tier is attemptable from level 1 with success falling off by tier gap.",
  },
  {
    skillId: "leathercrafting",
    name: "Leathercrafting",
    category: "crafting" as const,
    description:
      "Cure monster hides into tiered leather and stitch it into belts, bags, and light armor. A craft-only skill: hides come from troll, wyvern, and dragon loot.",
  },
];

// Monster types from before the biome roster; their augmentations stay disabled.
const LEGACY_MONSTER_IDS = [
  "rat", "goblin", "orc", "troll", "wyvern", "dragon", "demon", "nightmare", "archfiend",
] as const;

// Retired content: recipes are disabled (items stay for existing inventories).
const RETIRED_RECIPE_IDS = [
  "moonward-philter",
  "starward-philter",
  "dreamward-philter",
  "ratfang-draught",
  "trollhide-draught",
  "demonseed-draught",
  "goblin-charm-oil",
  "wyvern-scale-oil",
  "nightmare-leaf-oil",
  "orc-heartwood-elixir",
  "dragon-ember-elixir",
  "archfiend-horn-elixir",
  "dreambloom-elixir",
  "amber-root-sword",
  "amber-root-dagger",
  "amber-root-mace",
  "amber-root-helm",
  "amber-root-mail",
  "amber-root-greaves",
  "amber-root-boots",
  "root-iron-blade",
];

// ─── Seed plans (pure data) ─────────────────────────────────────────────────
// Everything the crafting seed writes is described here as plain data, so
// the plans can be inspected and tested without a database, and the writers
// below only have to diff and upsert.

/** One recipe row plus its ingredient and output rows. */
export type RecipePlan = {
  recipeId: string;
  skillId: string;
  tier: number;
  name: string;
  description: string;
  outputFamily: string;
  /** Absent on legacy (stageless) recipes: boss keys, talismans, leather. */
  stage?: "refinement" | "product" | "consumable";
  requiresMonsterDrop?: boolean;
  ingredients: Array<{ itemId: string; quantity: number }>;
  outputItemId: string;
};

/** Gathering activities: [activityId, skillId, tier, name, outputItemId, minYield, maxYield]. */
const GATHERING_ACTIVITIES = [
  ["harvest-herbs", "harvesting", 1, "Harvest Moonlit Herbs", "moonlit-herb", 1, 3],
  ["gather-silverdew", "harvesting", 1, "Gather Silverdew Leaves", "silverdew-leaf", 1, 3],
  ["gather-starlight-moss", "harvesting", 1, "Gather Starlight Moss", "starlight-moss", 1, 3],
  ["harvest-mushrooms", "harvesting", 2, "Gather Glimmering Mushrooms", "glimmering-mushroom", 1, 2],
  ["gather-sunveil", "harvesting", 2, "Gather Sunveil Blooms", "sunveil-bloom", 1, 2],
  ["gather-dreamcap", "harvesting", 2, "Gather Dreamcap Spores", "dreamcap-spore", 1, 2],
  ["harvest-flowers", "harvesting", 3, "Gather Whispering Flowers", "whispering-flower", 1, 2],
  ["gather-astral-orchids", "harvesting", 3, "Gather Astral Orchids", "astral-orchid", 1, 2],
  ["gather-elderroot", "harvesting", 3, "Gather Elderroot", "elderroot", 1, 2],
  ["harvest-emberleaf", "harvesting", 4, "Gather Emberleaf", "emberleaf", 1, 2],
  ["harvest-frostcap", "harvesting", 4, "Gather Frostcap", "frostcap", 1, 2],
  ["harvest-thornbloom", "harvesting", 4, "Gather Thornbloom", "thornbloom", 1, 2],
  ["harvest-tidepetal", "harvesting", 5, "Gather Tidepetal", "tidepetal", 1, 2],
  ["harvest-stormspore", "harvesting", 5, "Gather Stormspore", "stormspore", 1, 2],
  ["harvest-glowroot", "harvesting", 5, "Gather Glowroot", "glowroot", 1, 2],
  ["harvest-voidfern", "harvesting", 6, "Gather Voidfern", "voidfern", 1, 2],
  ["harvest-sunscale", "harvesting", 6, "Gather Sunscale Lichen", "sunscale-lichen", 1, 2],
  ["harvest-hexbark", "harvesting", 6, "Gather Hexbark Blossom", "hexbark-blossom", 1, 2],
  ["harvest-nightshade", "harvesting", 7, "Gather Nightshade Crown", "nightshade-crown", 1, 2],
  ["harvest-wraithvine", "harvesting", 7, "Gather Wraithvine", "wraithvine", 1, 2],
  ["harvest-doomorchid", "harvesting", 7, "Gather Doomorchid", "doomorchid", 1, 2],
  ["harvest-starforged-seed", "harvesting", 8, "Gather Starforged Seed", "starforged-seed", 1, 2],
  ["harvest-dawnpetal", "harvesting", 8, "Gather Dawnpetal", "dawnpetal", 1, 2],
  ["harvest-eternalmoss", "harvesting", 8, "Gather Eternalmoss", "eternalmoss", 1, 2],
  ["cut-moonwood", "woodcutting", 1, "Cut Moonwood", "moonwood-log", 1, 3],
  ["strip-bark", "woodcutting", 2, "Strip Living Bark", "living-bark", 1, 2],
  ["bind-thornvine", "woodcutting", 3, "Bind Thornvine", "thornvine-bundle", 1, 2],
  ["cut-emberwood", "woodcutting", 4, "Cut Emberwood", "emberwood-log", 1, 2],
  ["cut-tidewood", "woodcutting", 5, "Cut Tidewood", "tidewood-log", 1, 2],
  ["cut-voidwood", "woodcutting", 6, "Cut Voidwood", "voidwood-log", 1, 2],
  ["cut-dreadwood", "woodcutting", 7, "Cut Dreadwood", "dreadwood-log", 1, 2],
  ["cut-worldheart", "woodcutting", 8, "Cut Worldheart", "worldheart-log", 1, 2],
  ["mine-moonstone", "mining", 1, "Mine Moonstone", "moonstone-shard", 1, 3],
  ["mine-amber", "mining", 2, "Mine Root Amber", "root-amber", 1, 2],
  ["mine-root-iron", "mining", 3, "Mine Root-Iron", "root-iron-ore", 1, 2],
  ["mine-emberstone", "mining", 4, "Mine Emberstone", "emberstone-shard", 1, 2],
  ["mine-stormsilver", "mining", 5, "Mine Stormsilver", "stormsilver-ore", 1, 2],
  ["mine-voidquartz", "mining", 6, "Mine Voidquartz", "voidquartz-ore", 1, 2],
  ["mine-nightsteel", "mining", 7, "Mine Nightsteel", "nightsteel-ore", 1, 2],
  ["mine-starforged", "mining", 8, "Mine Starforged", "starforged-ore", 1, 2],
] as const;;

type RecipeSeed = {
  recipeId: string;
  outputItemId: string;
  skillId: "alchemy" | "woodworking" | "forging";
  tier: Tier;
  name: string;
  outputFamily: string;
  stage: "refinement" | "product" | "consumable";
  requiresMonsterDrop: boolean;
  ingredients: Array<{ itemId: string; quantity: number }>;
};

/** Refinement, product and consumable recipes (validated as chains). */
function buildStagedRecipes(): RecipeSeed[] {

  const refinementChain = (
    skillId: RecipeSeed["skillId"],
    outputFamily: string,
    entries: ReadonlyArray<readonly [string, string, string]>,
    currentQuantity: number
  ): RecipeSeed[] =>
    entries.map(([outputItemId, name, resourceId], tierIndex) => {
      const tier = (tierIndex + 1) as Tier;
      return {
        recipeId: outputItemId,
        outputItemId,
        skillId,
        tier,
        name: `Refine ${name}`,
        outputFamily,
        stage: "refinement" as const,
        requiresMonsterDrop: false,
        ingredients: [
          { itemId: resourceId, quantity: currentQuantity },
          ...(tierIndex === 0
            ? []
            : [{ itemId: entries[tierIndex - 1][0], quantity: 1 }]),
        ],
      };
    });

  const gearChain = (
    skillId: RecipeSeed["skillId"],
    outputFamily: string,
    verb: string,
    materials: ReadonlyArray<readonly [string, string]>,
    itemType: string,
    fileSuffix: string,
    refinedPerTier: string[],
    dropKind: MaterialKind
  ): RecipeSeed[] =>
    materials.map(([prefix, material], tierIndex) => {
      const outputItemId = `${prefix}-${fileSuffix}`;
      return {
        recipeId: outputItemId,
        outputItemId,
        skillId,
        tier: (tierIndex + 1) as Tier,
        name: `${verb} ${material} ${itemType}`,
        outputFamily,
        stage: "product" as const,
        // Every tier N piece also takes the tier N biome's bone or hide.
        requiresMonsterDrop: true,
        ingredients: [
          { itemId: refinedPerTier[tierIndex], quantity: 2 },
          { itemId: materialItemId(tierIndex + 1, dropKind), quantity: 2 },
          ...(tierIndex === 0
            ? []
            : [
                {
                  itemId: `${materials[tierIndex - 1][0]}-${fileSuffix}`,
                  quantity: 1,
                },
              ]),
        ],
      };
    });

  const alchemyRefinementRecipes = [
    ...refinementChain("alchemy", "alchemy-essence", ESSENCE_LINE, 3),
    ...refinementChain("alchemy", "alchemy-powder", POWDER_LINE, 3),
    ...refinementChain("alchemy", "alchemy-extract", EXTRACT_LINE, 3),
  ];
  const woodworkingRefinementRecipes = refinementChain(
    "woodworking",
    "woodworking-lumber",
    LUMBER_LINE,
    4
  );
  const forgingRefinementRecipes = refinementChain(
    "forging",
    "forging-ingot",
    INGOT_LINE,
    4
  );

  const refinedIds = (line: ReadonlyArray<readonly [string, string, string]>) =>
    line.map((r) => r[0] as string);
  const materialPairs = (names: ReadonlyArray<string>, ids: ReadonlyArray<string>) =>
    ids.map((id, index) => [id, names[index]] as const);

  const woodworkingProductRecipes = (
    [
      ["woodworking-bow", "Bow", "bow", "Shape"],
      ["woodworking-staff", "Staff", "staff", "Shape"],
      ["woodworking-head", "Hood", "hood", "Shape"],
      ["woodworking-chest", "Vest", "vest", "Shape"],
      ["woodworking-legs", "Leggings", "leggings", "Shape"],
      ["woodworking-feet", "Boots", "boots", "Shape"],
    ] as const
  ).flatMap(([family, itemType, fileSuffix, verb]) =>
    gearChain(
      "woodworking",
      family,
      verb,
      materialPairs(WOOD_SETS, WOOD_IDS),
      itemType,
      fileSuffix,
      refinedIds(LUMBER_LINE),
      "hide"
    )
  );

  const forgingProductRecipes = (
    [
      ["forging-sword", "Sword", "sword"],
      ["forging-dagger", "Dagger", "dagger"],
      ["forging-mace", "Mace", "mace"],
      ["forging-head", "Helm", "helm"],
      ["forging-chest", "Mail", "mail"],
      ["forging-legs", "Greaves", "greaves"],
      ["forging-feet", "Boots", "boots"],
    ] as const
  ).flatMap(([family, itemType, fileSuffix]) =>
    gearChain(
      "forging",
      family,
      "Forge",
      materialPairs(FORGE_SETS, FORGE_IDS),
      itemType,
      fileSuffix,
      refinedIds(INGOT_LINE),
      "bone"
    )
  );

  const essenceT = refinedIds(ESSENCE_LINE);
  const powderT = refinedIds(POWDER_LINE);
  const extractT = refinedIds(EXTRACT_LINE);

  const consumable = (
    outputItemId: string,
    name: string,
    tier: Tier,
    outputFamily: string,
    requiresMonsterDrop: boolean,
    ingredients: Array<{ itemId: string; quantity: number }>
  ): RecipeSeed => ({
    recipeId: outputItemId,
    outputItemId,
    skillId: "alchemy",
    tier,
    name,
    outputFamily,
    stage: "consumable",
    requiresMonsterDrop,
    ingredients,
  });

  const consumableRecipes: RecipeSeed[] = [
    // Combat brews always take their biome's ichor: 1 for base, 2 for advanced.
    consumable("verdant-tonic", "Brew Verdant Tonic", 1, "alchemy-might", true, [
      { itemId: extractT[0], quantity: 2 },
      { itemId: materialItemId(1, "ichor"), quantity: 1 },
    ]),
    consumable("ember-might-draught", "Brew Ember Might Draught", 2, "alchemy-might", true, [
      { itemId: extractT[1], quantity: 2 },
      { itemId: materialItemId(2, "ichor"), quantity: 1 },
    ]),
    consumable("hunters-swift-draught", "Brew Hunter's Swiftness Draught", 3, "alchemy-might", true, [
      { itemId: extractT[2], quantity: 2 },
      { itemId: materialItemId(3, "ichor"), quantity: 1 },
    ]),
    consumable("starwater-salve", "Brew Starwater Salve", 4, "alchemy-might", true, [
      { itemId: extractT[3], quantity: 2 },
      { itemId: "verdant-tonic", quantity: 1 },
      { itemId: materialItemId(4, "ichor"), quantity: 2 },
    ]),
    consumable("demonseed-might-draught", "Brew Demonseed Might Draught", 5, "alchemy-might", true, [
      { itemId: extractT[4], quantity: 2 },
      { itemId: "ember-might-draught", quantity: 1 },
      { itemId: materialItemId(5, "ichor"), quantity: 2 },
    ]),
    consumable("stonehide-draught", "Brew Stonehide Draught", 6, "alchemy-might", true, [
      { itemId: extractT[5], quantity: 2 },
      { itemId: materialItemId(6, "ichor"), quantity: 1 },
    ]),
    consumable("nightmare-swift-draught", "Brew Nightmare Swiftness Draught", 7, "alchemy-might", true, [
      { itemId: extractT[6], quantity: 2 },
      { itemId: "hunters-swift-draught", quantity: 1 },
      { itemId: materialItemId(7, "ichor"), quantity: 2 },
    ]),
    consumable("starforged-heart-draught", "Brew Starforged Heart Draught", 8, "alchemy-might", true, [
      { itemId: extractT[7], quantity: 2 },
      { itemId: "stonehide-draught", quantity: 1 },
      { itemId: materialItemId(8, "ichor"), quantity: 2 },
      { itemId: "forest-boss-token-8", quantity: 1 },
    ]),
    consumable("gathering-focus-tonic", "Brew Gathering Focus Tonic", 1, "alchemy-focus", false, [
      { itemId: powderT[0], quantity: 2 },
    ]),
    consumable("crafting-focus-tonic", "Brew Crafting Focus Tonic", 1, "alchemy-focus", false, [
      { itemId: powderT[0], quantity: 2 },
    ]),
    consumable("gathering-focus-elixir", "Brew Gathering Focus Elixir", 5, "alchemy-focus", false, [
      { itemId: powderT[4], quantity: 2 },
      { itemId: "gathering-focus-tonic", quantity: 1 },
    ]),
    consumable("crafting-focus-elixir", "Brew Crafting Focus Elixir", 5, "alchemy-focus", false, [
      { itemId: powderT[4], quantity: 2 },
      { itemId: "crafting-focus-tonic", quantity: 1 },
    ]),
    consumable("gathering-alacrity-tonic", "Brew Gathering Alacrity Tonic", 2, "alchemy-swiftness", false, [
      { itemId: essenceT[1], quantity: 2 },
    ]),
    consumable("crafting-alacrity-tonic", "Brew Crafting Alacrity Tonic", 2, "alchemy-swiftness", false, [
      { itemId: essenceT[1], quantity: 2 },
    ]),
    consumable("gathering-alacrity-elixir", "Brew Gathering Alacrity Elixir", 6, "alchemy-swiftness", false, [
      { itemId: essenceT[5], quantity: 2 },
      { itemId: "gathering-alacrity-tonic", quantity: 1 },
    ]),
    consumable("crafting-alacrity-elixir", "Brew Crafting Alacrity Elixir", 6, "alchemy-swiftness", false, [
      { itemId: essenceT[5], quantity: 2 },
      { itemId: "crafting-alacrity-tonic", quantity: 1 },
    ]),
    consumable("wisdom-draught", "Brew Wisdom Draught", 3, "alchemy-wisdom", true, [
      { itemId: extractT[2], quantity: 2 },
      { itemId: materialItemId(3, "ichor"), quantity: 1 },
    ]),
    consumable("wisdom-elixir", "Brew Wisdom Elixir", 7, "alchemy-wisdom", true, [
      { itemId: extractT[6], quantity: 2 },
      { itemId: "wisdom-draught", quantity: 1 },
      { itemId: materialItemId(7, "ichor"), quantity: 2 },
    ]),
    // Greater brews: the tier N combat brew, refined with Blighted ichor from
    // the Blighted version of biome N (combat tier 8+N).
    ...GREATER_BREWS.map((brew) =>
      consumable(brew.itemId, `Brew ${brew.name}`, brew.tier, "alchemy-greater", true, [
        { itemId: extractT[brew.tier - 1], quantity: 2 },
        { itemId: brew.baseItemId, quantity: 1 },
        { itemId: materialItemId(brew.tier, "ichor", "blighted"), quantity: 3 },
      ])
    ),
  ];

  const recipes: RecipeSeed[] = [
    ...alchemyRefinementRecipes,
    ...woodworkingRefinementRecipes,
    ...forgingRefinementRecipes,
    ...woodworkingProductRecipes,
    ...forgingProductRecipes,
    ...consumableRecipes,
  ];
  return recipes;
}

function stagedRecipeDescription(recipe: RecipeSeed): string {
  if (recipe.stage === "refinement") {
    return `Refine tier ${recipe.tier} gathered materials for later crafting.`;
  }
  if (recipe.stage === "consumable") {
    return `Brew ${recipe.name.toLowerCase().replace(/^(brew|refine|shape|forge) /, "")} from tier ${recipe.tier} refined materials.`;
  }
  return `Craft ${recipe.name.toLowerCase()} from tier ${recipe.tier} refined materials.`;
}

const BOSS_KEY_ESSENCE_QTY = 100;
/** Boss tokens per kill: one per piece of a five-piece Blighted set. */
const BOSS_TOKEN_DROP_QTY = 5;
const TALISMAN_TROPHY_QTY = 3;

/** Every crafting recipe the seed owns, across all crafting skills. */
export function buildRecipePlans(bagSlotsPerTier: number): RecipePlan[] {
  const staged: RecipePlan[] = buildStagedRecipes().map((recipe) => ({
    recipeId: recipe.recipeId,
    skillId: recipe.skillId,
    tier: recipe.tier,
    name: recipe.name,
    description: stagedRecipeDescription(recipe),
    outputFamily: recipe.outputFamily,
    stage: recipe.stage,
    requiresMonsterDrop: recipe.requiresMonsterDrop,
    ingredients: recipe.ingredients,
    outputItemId: recipe.outputItemId,
  }));

  // Boss-key chain: T1 = 100x essence T1; TN = 100x essence TN + 1x key T(N-1),
  // plus that tier's trophy (biome trophy, Blighted trophy, or Rift Shards).
  // Legacy recipes (no stage): gated by infusion success, not level locks.
  const bossKeys: RecipePlan[] = INFUSION_TIERS.map((tier) => ({
    recipeId: `infuse-boss-key-tier-${tier}`,
    skillId: "infusion",
    tier,
    name: `Infuse Tier ${tier} Boss Key`,
    description: `Condense tier ${tier} monster essence and a trophy${tier > 1 ? " with the previous tier key" : ""} into a boss key. Consumed when the boss fight starts.`,
    outputFamily: "boss-key",
    ingredients: [
      { itemId: `essence-tier-${tier}`, quantity: BOSS_KEY_ESSENCE_QTY },
      { itemId: bossKeyTrophyItemId(tier), quantity: tier >= RIFT_FIRST_TIER ? 5 : 1 },
      ...(tier > 1 ? [{ itemId: `boss-key-tier-${tier - 1}`, quantity: 1 }] : []),
    ],
    outputItemId: `boss-key-tier-${tier}`,
  }));

  // Trophy talismans: legacy (stageless) ladders. Tier N = biome N trophies
  // + tier N ingots + the line's tier N-1 talisman.
  const ingotT = INGOT_LINE.map((row) => row[0] as string);
  const talismans: RecipePlan[] = TALISMAN_LINES.flatMap((line) =>
    TIERS.map((tier) => ({
      recipeId: `forge-${talismanItemId(line.line, tier)}`,
      skillId: "forging",
      tier,
      name: `Forge ${line.name} T${tier}`,
      description: `Forge a tier ${tier} talisman from ${BIOMES[tier - 1].materials.trophy} and tier ${tier} ingots${tier > 1 ? ", upgrading the previous tier" : ""}.`,
      outputFamily: `forging-talisman-${line.line}`,
      ingredients: [
        { itemId: materialItemId(tier, "trophy"), quantity: TALISMAN_TROPHY_QTY },
        { itemId: ingotT[tier - 1], quantity: 2 },
        ...(tier === 1
          ? []
          : [{ itemId: talismanItemId(line.line, tier - 1), quantity: 1 }]),
      ],
      outputItemId: talismanItemId(line.line, tier),
    }))
  );

  // Blighted gear: legacy (stageless) ladders past tier 8, since there are no
  // tier 9+ refined materials. Tier 9+N = the previous piece + Blighted biome
  // N bone/hide + tier 8 ingots or lumber + the tier N-1 boss token.
  const lumberT = LUMBER_LINE.map((row) => row[0] as string);
  const blightedGear: RecipePlan[] = BLIGHTED_GEAR_BASES.flatMap((base) => {
    const skillId = base.craftingSkillId as "forging" | "woodworking";
    const forged = skillId === "forging";
    return BLIGHTED_GEAR_TIERS.map((tier) => {
      const previous =
        tier === BLIGHTED_GEAR_TIERS[0]
          ? base.itemId
          : blightedGearItemId(base.itemId, tier - 1);
      const outputItemId = blightedGearItemId(base.itemId, tier);
      const biome = BIOMES[tier - 9];
      return {
        recipeId: outputItemId,
        skillId,
        tier,
        name: `${forged ? "Forge" : "Shape"} ${biome.blight.label} ${base.name}`,
        description: `Regrow the tier ${tier - 1} piece in Blighted ${biome.name} ${forged ? "bone" : "hide"} with a tier ${tier - 1} boss token: ${
          tier === BLIGHTED_GEAR_TIERS[0]
            ? `${BLIGHTED_GEAR_FIRST_STEP}×`
            : `${Math.round((BLIGHTED_GEAR_GROWTH - 1) * 100)}% more`
        } damage, defense and stat bonus.`,
        outputFamily: base.itemFamily!,
        ingredients: [
          { itemId: previous, quantity: 1 },
          {
            itemId: materialItemId(tier - 8, forged ? "bone" : "hide", "blighted"),
            quantity: BLIGHTED_GEAR_DROP_QTY,
          },
          {
            itemId: forged ? ingotT[TIERS.length - 1] : lumberT[TIERS.length - 1],
            quantity: BLIGHTED_GEAR_REFINED_QTY,
          },
          // The previous tier's boss gates the next gear tier.
          { itemId: `forest-boss-token-${tier - 1}`, quantity: 1 },
        ],
        outputItemId,
      };
    });
  });

  const leather: RecipePlan[] = buildLeatherRecipes(bagSlotsPerTier).map((recipe) => ({
    recipeId: recipe.recipeId,
    skillId: "leathercrafting",
    tier: recipe.tier,
    name: recipe.name,
    description: recipe.description,
    outputFamily: recipe.outputFamily,
    ingredients: recipe.ingredients,
    outputItemId: recipe.outputItemId,
  }));

  return [...staged, ...bossKeys, ...talismans, ...blightedGear, ...leather];
}

/** Augmentation rows, with their material as an item slug. */
export type AugmentationPlan = {
  augmentationId: string;
  skillId: string;
  tier: number;
  name: string;
  description: string;
  allowedEquipmentSlots: Array<"head" | "chest" | "mainHand" | "legs" | "feet" | "belt">;
  requiredMaterialSlug: string;
  requiredMaterialQuantity: number;
  effectType: string;
  effectElement: string;
  effectAmount: number;
  requiresPreviousTier: boolean;
  experienceReward: number;
};

/**
 * Chained boss-token lines: weapon (damage + element imbue) and armor
 * (+defense + elemental ward). Tier N requires the tier N-1 augment on the
 * same item, which it replaces. No cap.
 */
export function buildAugmentationPlans(): AugmentationPlan[] {
  const balanceDefault = (key: string, fallback: number) => {
    const found = INFUSION_BALANCE_DEFAULTS.find((entry) => entry.key === key);
    return typeof found?.value === "number" ? found.value : fallback;
  };
  const tokenQty = balanceDefault("augmentBossTokenQty", 1);
  const damagePerTier = balanceDefault("augmentDamagePerTier", 3);
  const defensePerTier = balanceDefault("augmentDefensePerTier", 3);
  return INFUSION_TIERS.flatMap((tier) => {
    const chainNote =
      tier > 1 ? ` Requires the tier ${tier - 1} augment on the same item first.` : "";
    const imbue = ELEMENT_VALUES[(tier - 1) % ELEMENT_VALUES.length];
    const shared = {
      skillId: "infusion",
      tier,
      requiredMaterialSlug: `forest-boss-token-${tier}`,
      requiredMaterialQuantity: tokenQty,
      effectElement: imbue,
      requiresPreviousTier: tier > 1,
      experienceReward: 50 * tier,
    };
    return [
      {
        ...shared,
        augmentationId: `augment-weapon-tier-${tier}`,
        name: `Tier ${tier} Weapon Infusion`,
        description: `Imbue a weapon with ${imbue} for +${tier * damagePerTier} base damage.${chainNote}`,
        allowedEquipmentSlots: ["mainHand"] as AugmentationPlan["allowedEquipmentSlots"],
        effectType: "damage-bonus",
        effectAmount: tier * damagePerTier,
      },
      {
        ...shared,
        augmentationId: `augment-armor-tier-${tier}`,
        name: `Tier ${tier} Armor Infusion`,
        description: `Attune armor to ${imbue} for +${tier * defensePerTier} base defense and a ${imbue} ward against matching hits.${chainNote}`,
        allowedEquipmentSlots: ["head", "chest", "legs", "feet", "belt"] as AugmentationPlan["allowedEquipmentSlots"],
        effectType: "defense-bonus",
        effectAmount: tier * defensePerTier,
      },
    ];
  });
}

/** A loot table, its entries (item slugs), and the sources that point at it. */
export type LootTablePlan = {
  lootTableId: string;
  name: string;
  sourceType: "monster" | "boss";
  tier?: number;
  rollCount: number;
  entries: Array<{
    itemId: string;
    dropChance: number;
    minQuantity: number;
    maxQuantity: number;
    guaranteed: boolean;
    purpose: "augmentation" | "boss-catalyst";
  }>;
  /** `tier: undefined` is the monster's fallback source for any tier. */
  sources: Array<{ sourceId: string; tier?: number }>;
};

/**
 * Monster loot: each biome monster has a main-tier table (tierless source)
 * and a Blighted table for tier 8+N; Rift archetypes add one table for tiers
 * 17–20. Bosses pay their tier's token and trophy plus a chance at hide, bone
 * and ichor; Rift bosses pay Rift Shards.
 */
export function buildLootTablePlans(): LootTablePlan[] {
  const monsterEntries = (drops: Array<{ itemId: string; chance: number }>) =>
    drops.map((drop) => ({
      itemId: drop.itemId,
      dropChance: drop.chance,
      minQuantity: 1,
      maxQuantity: 1,
      guaranteed: false,
      purpose: "augmentation" as const,
    }));
  const riftTiers = INFUSION_TIERS.filter((tier) => tier >= RIFT_FIRST_TIER);
  const monsterTables: LootTablePlan[] = biomeMonsterSeeds().flatMap((monster) => {
    const tables: LootTablePlan[] = [
      {
        lootTableId: `loot-monster-${monster.type}`,
        name: `${monster.name} drops`,
        sourceType: "monster",
        rollCount: 1,
        entries: monsterEntries(monsterDropsForTier(monster, monster.biomeTier)),
        sources: [{ sourceId: monster.type }],
      },
      {
        lootTableId: `loot-monster-${monster.type}-blighted`,
        name: `Blighted ${monster.name} drops`,
        sourceType: "monster",
        rollCount: 1,
        entries: monsterEntries(
          monsterDropsForTier(monster, monster.biomeTier + TIERS.length)
        ),
        sources: [{ sourceId: monster.type, tier: monster.biomeTier + TIERS.length }],
      },
    ];
    if (RIFT_ARCHETYPES.includes(monster.archetype)) {
      tables.push({
        lootTableId: `loot-monster-${monster.type}-rift`,
        name: `Riftborn ${monster.name} drops`,
        sourceType: "monster",
        rollCount: 1,
        entries: monsterEntries(monsterDropsForTier(monster, RIFT_FIRST_TIER)),
        sources: riftTiers.map((tier) => ({ sourceId: monster.type, tier })),
      });
    }
    return tables;
  });

  // Boss kills cost a key chain worth ~1,000 wins of essence per tier, so the
  // table is net positive: a set's worth of tokens (one per Blighted gear
  // piece, or augments), more trophies than the key took, guaranteed
  // materials, and Rift Shards from Blighted bosses on.
  const guaranteed = (itemId: string, minQuantity: number, maxQuantity: number) => ({
    itemId,
    dropChance: 1,
    minQuantity,
    maxQuantity,
    guaranteed: true,
    purpose: "boss-catalyst" as const,
  });
  const bossTables: LootTablePlan[] = INFUSION_TIERS.map((tier) => ({
    lootTableId: `loot-boss-tier-${tier}`,
    name: `Tier ${tier} guardian rewards`,
    sourceType: "boss",
    tier,
    rollCount: 1,
    entries: [
      guaranteed(`forest-boss-token-${tier}`, BOSS_TOKEN_DROP_QTY, BOSS_TOKEN_DROP_QTY),
      ...(tier >= RIFT_FIRST_TIER
        ? [guaranteed(RIFT_SHARD_ITEM_ID, 6, 10)]
        : [
            guaranteed(bossKeyTrophyItemId(tier), 3, 5),
            ...(["hide", "bone", "ichor"] as const).map((kind) =>
              guaranteed(materialItemIdForTier(tier, kind), 3, 6)
            ),
            ...(tier > TIERS.length ? [guaranteed(RIFT_SHARD_ITEM_ID, 1, 2)] : []),
          ]),
    ],
    sources: [{ sourceId: `boss_tier_${tier}`, tier }],
  }));

  return [...monsterTables, ...bossTables];
}

// ─── Seed writers ───────────────────────────────────────────────────────────
// The writers diff each row against the plan and only write what changed, so
// re-running the seed on an up-to-date deployment is read-only (no write
// churn, no needless subscription invalidations).

export const CRAFTING_SEED_SECTIONS = [
  "catalog",
  "recipes:alchemy",
  "recipes:woodworking",
  "recipes:forging",
  "recipes:leathercrafting",
  "recipes:infusion",
  "augmentations",
  "loot",
] as const;

export type CraftingSeedSection = (typeof CRAFTING_SEED_SECTIONS)[number];

export type CraftingSeedCounts = {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
};

/** Whether any field of `values` differs from the stored row. */
function rowDiffers(existing: Record<string, unknown>, values: Record<string, unknown>) {
  return Object.entries(values).some(
    ([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value)
  );
}

/** Order-independent signature of child rows, for "did these change" checks. */
function rowsSignature(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
    .sort()
    .join("|");
}

class CraftingSeedWriter {
  readonly counts: CraftingSeedCounts = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
  private readonly itemIds = new Map<string, Id<"items">>();

  constructor(
    readonly ctx: MutationCtx,
    readonly now: number
  ) {}

  /** Document id of a seeded item by slug (memoized; one read per slug). */
  async item(slug: string): Promise<Id<"items">> {
    const known = this.itemIds.get(slug);
    if (known) return known;
    const row = await this.ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", slug))
      .first();
    if (!row) throw new Error(`Seed item ${slug} was not created`);
    this.itemIds.set(slug, row._id);
    return row._id;
  }

  remember(slug: string, id: Id<"items">) {
    this.itemIds.set(slug, id);
  }

  /**
   * Insert or patch one row. `values` must not include timestamps; the
   * timestamp field is bumped only when something changed.
   */
  async upsert<T extends "items" | "skillDefinitions" | "skillTierDefinitions" | "gatheringActivities" | "recipes" | "augmentationDefinitions" | "taskDefinitions" | "lootTables">(
    table: T,
    existing: Doc<T> | null,
    values: Record<string, unknown>
  ): Promise<Id<T>> {
    const db = this.ctx.db as unknown as GenericDbWriter;
    if (!existing) {
      this.counts.inserted += 1;
      return (await db.insert(table, {
        ...values,
        createdAt: this.now,
        updatedAt: this.now,
      })) as Id<T>;
    }
    if (rowDiffers(existing as Record<string, unknown>, values)) {
      await db.patch(existing._id, { ...values, updatedAt: this.now });
      this.counts.updated += 1;
    } else {
      this.counts.unchanged += 1;
    }
    return existing._id;
  }

  /** Replace a set of child rows only when it differs from `desired`. */
  async syncChildren<T extends "recipeIngredients" | "recipeOutputs" | "lootTableEntries" | "lootSources">(
    table: T,
    existing: Array<Doc<T>>,
    desired: Array<Record<string, unknown>>,
    compareKeys: string[],
    timestamps: boolean
  ) {
    const project = (row: Record<string, unknown>) =>
      Object.fromEntries(compareKeys.map((key) => [key, row[key] ?? null]));
    if (
      rowsSignature(existing.map((row) => project(row as Record<string, unknown>))) ===
      rowsSignature(desired.map(project))
    ) {
      this.counts.unchanged += 1;
      return;
    }
    const db = this.ctx.db as unknown as GenericDbWriter;
    for (const row of existing) {
      await db.delete(row._id);
      this.counts.deleted += 1;
    }
    for (const row of desired) {
      await db.insert(
        table,
        timestamps ? { ...row, createdAt: this.now, updatedAt: this.now } : row
      );
      this.counts.inserted += 1;
    }
  }
}

/** The writer only needs untyped insert/patch/delete across seeded tables. */
type GenericDbWriter = {
  insert: (table: string, value: Record<string, unknown>) => Promise<Id<TableNames>>;
  patch: (id: Id<TableNames>, value: Record<string, unknown>) => Promise<void>;
  delete: (id: Id<TableNames>) => Promise<void>;
};

async function seedCatalog(writer: CraftingSeedWriter) {
  const { ctx, now } = writer;
  const leatherBalance = await readLeatherBalance(ctx);

  for (const item of ALL_ITEMS) {
    const existing = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", item.itemId))
      .first();
    const id = await writer.upsert(
      "items",
      existing,
      leatherSeedValues(item, leatherBalance.bagSlotsPerTier) as Record<string, unknown>
    );
    writer.remember(item.itemId, id);
  }

  // Seed-owned balance values are kept in sync; tunable defaults are only
  // inserted when missing so admin edits survive.
  const ownedBalance = [
    SKILL_XP_BALANCE_DEFAULT,
    { key: "bossGoldPerTier", value: 500, description: "Base boss gold reward per tier" },
    { key: "bossExperiencePerTier", value: 250, description: "Base boss experience reward per tier" },
  ];
  const defaultBalance = [
    ...SKILL_TASK_BALANCE_DEFAULTS,
    ...COMBAT_BALANCE_DEFAULTS,
    ...HP_REGEN_BALANCE_DEFAULTS,
    ...LEATHER_BALANCE_DEFAULTS,
    ...INFUSION_BALANCE_DEFAULTS,
    ...ENDGAME_GATE_BALANCE_DEFAULTS,
    ...BOSS_REWARD_BALANCE_DEFAULTS,
  ];
  for (const [entry, owned] of [
    ...ownedBalance.map((entry) => [entry, true] as const),
    ...defaultBalance.map((entry) => [entry, false] as const),
  ]) {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", entry.key))
      .first();
    if (!existing) {
      await ctx.db.insert("gameBalance", { ...entry, lastUpdated: now });
      writer.counts.inserted += 1;
    } else if (
      owned &&
      rowDiffers(existing, { value: entry.value, description: entry.description })
    ) {
      await ctx.db.patch(existing._id, {
        value: entry.value,
        description: entry.description,
        lastUpdated: now,
      });
      writer.counts.updated += 1;
    } else {
      writer.counts.unchanged += 1;
    }
  }

  for (const skill of SKILLS) {
    const existing = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", skill.skillId))
      .first();
    await writer.upsert("skillDefinitions", existing, {
      ...skill,
      enabled: true,
      maxLevel: undefined,
    });
  }

  const tierRows = [
    ...SKILLS.flatMap((skill) =>
      TIERS.map((tier) => ({
        skillId: skill.skillId,
        tier,
        name: `${TIER_NAMES[tier - 1]} ${skill.name}`,
        description: `Tier ${tier} ${skill.name.toLowerCase()} activities.`,
        // Infusion is never level-gated; every tier attemptable from level 1.
        requiredLevel: skill.skillId === "infusion" ? 1 : TIER_LEVELS[tier - 1],
        enabled: true,
      }))
    ),
    // Blighted gear tiers for the two gear skills.
    ...SKILLS.filter((skill) => skill.skillId === "forging" || skill.skillId === "woodworking").flatMap(
      (skill) =>
        BLIGHTED_GEAR_TIERS.map((tier) => ({
          skillId: skill.skillId,
          tier,
          name: `${BIOMES[tier - 9].blight.label} ${skill.name}`,
          description: `Tier ${tier}: regrow tier 8 gear in Blighted ${BIOMES[tier - 9].name} materials.`,
          requiredLevel: BLIGHTED_GEAR_LEVEL,
          enabled: true,
        }))
    ),
    // Infusion tiers past the 8 hand-authored tiers (up to the seeded max).
    ...INFUSION_TIERS.filter((tier) => tier > TIERS.length).map((tier) => ({
      skillId: "infusion",
      tier,
      name: `Tier ${tier} Infusion`,
      description: `Tier ${tier} infusion activities.`,
      requiredLevel: 1,
      enabled: true,
    })),
  ];
  for (const tierRow of tierRows) {
    const existing = await ctx.db
      .query("skillTierDefinitions")
      .withIndex("by_skillId_and_tier", (q) =>
        q.eq("skillId", tierRow.skillId).eq("tier", tierRow.tier)
      )
      .first();
    await writer.upsert("skillTierDefinitions", existing, tierRow);
  }

  for (const [activityId, skillId, tier, name, outputItemId, minYield, maxYield] of GATHERING_ACTIVITIES) {
    const existing = await ctx.db
      .query("gatheringActivities")
      .withIndex("by_activityId", (q) => q.eq("activityId", activityId))
      .first();
    await writer.upsert("gatheringActivities", existing, {
      activityId,
      skillId,
      tier,
      name,
      description: `Gather ${name.toLowerCase()} from the mystical forest.`,
      outputItemId: await writer.item(outputItemId),
      minYield,
      maxYield,
      durationMs: tier * 30_000,
      experienceReward: tier * 25,
      enabled: true,
    });
  }

  const existingTask = await ctx.db
    .query("taskDefinitions")
    .withIndex("by_taskId", (q) => q.eq("taskId", "skill_action"))
    .first();
  await writer.upsert("taskDefinitions", existingTask, {
    taskId: "skill_action",
    name: "Skill action",
    category: "skill",
    description: "Gather resources or craft an item.",
    canProgressOffline: true,
    requiresOnline: false,
    enabled: true,
    prerequisites: null,
    rewards: { uses: "skillAction" },
  });

  for (const recipeId of RETIRED_RECIPE_IDS) {
    const retired = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .first();
    if (retired && retired.enabled) {
      await ctx.db.patch(retired._id, { enabled: false, updatedAt: now });
      writer.counts.updated += 1;
    }
  }
}

async function seedRecipes(writer: CraftingSeedWriter, skillId: string) {
  const { ctx } = writer;
  const leatherBalance = await readLeatherBalance(ctx);
  const plans = buildRecipePlans(leatherBalance.bagSlotsPerTier).filter(
    (plan) => plan.skillId === skillId
  );
  for (const plan of plans) {
    const existing = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", plan.recipeId))
      .first();
    await writer.upsert("recipes", existing, {
      recipeId: plan.recipeId,
      skillId: plan.skillId,
      tier: plan.tier,
      name: plan.name,
      description: plan.description,
      durationMs: plan.tier * 45_000,
      experienceReward: plan.tier * 50,
      outputFamily: plan.outputFamily,
      ...(plan.stage === undefined ? {} : { stage: plan.stage }),
      ...(plan.requiresMonsterDrop === undefined
        ? {}
        : { requiresMonsterDrop: plan.requiresMonsterDrop }),
      enabled: true,
    });

    const ingredients = await Promise.all(
      plan.ingredients.map(async (ingredient) => ({
        recipeId: plan.recipeId,
        itemId: await writer.item(ingredient.itemId),
        quantity: ingredient.quantity,
      }))
    );
    await writer.syncChildren(
      "recipeIngredients",
      await ctx.db
        .query("recipeIngredients")
        .withIndex("by_recipeId", (q) => q.eq("recipeId", plan.recipeId))
        .collect(),
      ingredients,
      ["recipeId", "itemId", "quantity"],
      false
    );
    await writer.syncChildren(
      "recipeOutputs",
      await ctx.db
        .query("recipeOutputs")
        .withIndex("by_recipeId", (q) => q.eq("recipeId", plan.recipeId))
        .collect(),
      [{ recipeId: plan.recipeId, itemId: await writer.item(plan.outputItemId), quantity: 1 }],
      ["recipeId", "itemId", "quantity"],
      false
    );
  }
}

async function seedAugmentations(writer: CraftingSeedWriter) {
  const { ctx, now } = writer;
  // Legacy flavor augmentations from the pre-biome monsters stay disabled for
  // any applied augments and refunds.
  for (const monsterId of LEGACY_MONSTER_IDS) {
    const existing = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) => q.eq("augmentationId", `augment-${monsterId}`))
      .first();
    if (existing && existing.enabled) {
      await ctx.db.patch(existing._id, { enabled: false, updatedAt: now });
      writer.counts.updated += 1;
    }
  }
  for (const plan of buildAugmentationPlans()) {
    const { requiredMaterialSlug, ...row } = plan;
    const existing = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) => q.eq("augmentationId", plan.augmentationId))
      .first();
    await writer.upsert("augmentationDefinitions", existing, {
      ...row,
      requiredMaterialItemId: await writer.item(requiredMaterialSlug),
      enabled: true,
    });
  }
}

async function seedLoot(writer: CraftingSeedWriter) {
  const { ctx } = writer;
  const plans = buildLootTablePlans();

  // Monster loot the plans no longer describe (old rosters) is removed.
  const wantedMonsterTables = new Set(
    plans.filter((plan) => plan.sourceType === "monster").map((plan) => plan.lootTableId)
  );
  for (const table of await ctx.db
    .query("lootTables")
    .withIndex("by_sourceType_and_tier", (q) => q.eq("sourceType", "monster"))
    .collect()) {
    if (wantedMonsterTables.has(table.lootTableId)) continue;
    for (const entry of await ctx.db
      .query("lootTableEntries")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", table.lootTableId))
      .collect()) {
      await ctx.db.delete(entry._id);
      writer.counts.deleted += 1;
    }
    await ctx.db.delete(table._id);
    writer.counts.deleted += 1;
  }
  const monsterSources = await ctx.db
    .query("lootSources")
    .withIndex("by_sourceType_and_sourceId", (q) => q.eq("sourceType", "monster"))
    .collect();
  for (const source of monsterSources) {
    if (!wantedMonsterTables.has(source.lootTableId)) {
      await ctx.db.delete(source._id);
      writer.counts.deleted += 1;
    }
  }

  for (const plan of plans) {
    const existing = await ctx.db
      .query("lootTables")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", plan.lootTableId))
      .first();
    await writer.upsert("lootTables", existing, {
      lootTableId: plan.lootTableId,
      name: plan.name,
      sourceType: plan.sourceType,
      ...(plan.tier === undefined ? {} : { tier: plan.tier }),
      rollCount: plan.rollCount,
      enabled: true,
    });
    const entries = await Promise.all(
      plan.entries.map(async (entry) => ({
        lootTableId: plan.lootTableId,
        itemId: await writer.item(entry.itemId),
        weight: 1,
        dropChance: entry.dropChance,
        minQuantity: entry.minQuantity,
        maxQuantity: entry.maxQuantity,
        guaranteed: entry.guaranteed,
        purpose: entry.purpose,
        enabled: true,
      }))
    );
    await writer.syncChildren(
      "lootTableEntries",
      await ctx.db
        .query("lootTableEntries")
        .withIndex("by_lootTableId", (q) => q.eq("lootTableId", plan.lootTableId))
        .collect(),
      entries,
      ["itemId", "weight", "dropChance", "minQuantity", "maxQuantity", "guaranteed", "purpose", "enabled"],
      true
    );
    // Sources for this table's source ids, matched on (sourceId, tier).
    const sourceIds = [...new Set(plan.sources.map((source) => source.sourceId))];
    const existingSources = (
      await Promise.all(
        sourceIds.map((sourceId) =>
          ctx.db
            .query("lootSources")
            .withIndex("by_sourceType_and_sourceId", (q) =>
              q.eq("sourceType", plan.sourceType).eq("sourceId", sourceId)
            )
            .collect()
        )
      )
    ).flat();
    for (const source of plan.sources) {
      const match = existingSources.find(
        (row) => row.sourceId === source.sourceId && row.tier === source.tier
      );
      if (!match) {
        await ctx.db.insert("lootSources", {
          sourceType: plan.sourceType,
          sourceId: source.sourceId,
          ...(source.tier === undefined ? {} : { tier: source.tier }),
          lootTableId: plan.lootTableId,
          createdAt: writer.now,
          updatedAt: writer.now,
        });
        writer.counts.inserted += 1;
      } else if (match.lootTableId !== plan.lootTableId) {
        await ctx.db.patch(match._id, { lootTableId: plan.lootTableId, updatedAt: writer.now });
        writer.counts.updated += 1;
      } else {
        writer.counts.unchanged += 1;
      }
    }
  }
}

/**
 * Sync one section of the crafting content. Sections are sized to stay well
 * inside a single transaction's read limit, so deployments with existing rows
 * can run each in its own mutation (`seed:upsertForestCrafting`). Run
 * "catalog" first: the other sections look items up by slug.
 */
export async function seedForestCraftingSection(
  ctx: MutationCtx,
  section: CraftingSeedSection
): Promise<CraftingSeedCounts> {
  const writer = new CraftingSeedWriter(ctx, Date.now());
  if (section === "catalog") await seedCatalog(writer);
  else if (section === "augmentations") await seedAugmentations(writer);
  else if (section === "loot") await seedLoot(writer);
  else await seedRecipes(writer, section.slice("recipes:".length));
  return writer.counts;
}

/**
 * Sync every section in this one transaction. Fine for fresh databases and
 * tests; deployments with existing rows should use `seed:upsertForestCrafting`,
 * which runs each section in its own transaction.
 */
export async function seedForestCraftingContent(ctx: MutationCtx) {
  const results: Partial<Record<CraftingSeedSection, CraftingSeedCounts>> = {};
  for (const section of CRAFTING_SEED_SECTIONS) {
    results[section] = await seedForestCraftingSection(ctx, section);
  }
  return results;
}

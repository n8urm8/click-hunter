import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { SKILL_XP_BALANCE_DEFAULT } from "./skillProgression";
import { SKILL_TASK_BALANCE_DEFAULTS } from "./skillBonuses";
import { COMBAT_BALANCE_DEFAULTS } from "./items";

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
    | "bag"
    | "craftingEquipment"
  >;
  rarityLevel: number;
  itemFamily?: string;
  craftingSkillId?: string;
  craftingTier?: number;
  effectType?: string;
  effectStat?: "str" | "dex" | "int" | "luk" | "con";
  effectAmount?: number;
  effectDurationMs?: number;
  effectScope?: "all" | "gathering" | "crafting";
  augmentSlots?: number;
  baseDamage?: number;
  attackSpeed?: number;
  damageStat?: "str" | "dex" | "int";
  damageType?: "physical" | "magical";
  baseDefense?: number;
  speedPenalty?: number;
  buffVariant?: "base" | "advanced";
};

type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type EquipmentSlot = SeedItem["allowedEquipmentSlots"][number];
type EffectStat = NonNullable<SeedItem["effectStat"]>;

const TIERS: Tier[] = [1, 2, 3, 4, 5, 6, 7, 8];
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
  maxStackSize = 100
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

const WEAPON_SPECS: Record<string, WeaponSpec> = {
  sword: { damage: 10, speed: 1.0, scaling: "str" },
  dagger: { damage: 6, speed: 1.6, scaling: "dex" },
  mace: { damage: 16, speed: 0.65, scaling: "str" },
  bow: { damage: 8, speed: 1.3, scaling: "dex" },
  staff: { damage: 12, speed: 0.8, scaling: "int", magical: true },
};

type ArmorSpec = { defense: number; penalty: number };

const HEAVY_ARMOR: Record<string, ArmorSpec> = {
  helm: { defense: 4, penalty: 0.04 },
  mail: { defense: 6, penalty: 0.08 },
  greaves: { defense: 5, penalty: 0.06 },
  boots: { defense: 3, penalty: 0.02 },
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
  { ...craftingItem("verdant-tonic", "Verdant Tonic", "A soothing tonic that knits wounds over time.", "alchemy-might", "alchemy", 1, 25), ...{ effectType: "heal-over-time", effectAmount: 1.5, effectDurationMs: 5 * MIN } as ConsumableEffect, tier: 1, family: "alchemy-might", variant: "base" },
  { ...craftingItem("ember-might-draught", "Ember Might Draught", "Kindles raw strength for a time.", "alchemy-might", "alchemy", 2, 25), ...{ effectType: "combat-stat-boost", effectStat: "str", effectAmount: 3, effectDurationMs: 5 * MIN } as ConsumableEffect, tier: 2, family: "alchemy-might", variant: "base" },
  { ...craftingItem("hunters-swift-draught", "Hunter's Swiftness Draught", "Sharpens reflexes for a time.", "alchemy-might", "alchemy", 3, 25), ...{ effectType: "combat-stat-boost", effectStat: "dex", effectAmount: 3, effectDurationMs: 6 * MIN } as ConsumableEffect, tier: 3, family: "alchemy-might", variant: "base" },
  { ...craftingItem("starwater-salve", "Starwater Salve", "A potent salve that closes wounds over time.", "alchemy-might", "alchemy", 4, 25), ...{ effectType: "heal-over-time", effectAmount: 3, effectDurationMs: 8 * MIN } as ConsumableEffect, tier: 4, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("demonseed-might-draught", "Demonseed Might Draught", "Burns with a dangerous, mighty strength.", "alchemy-might", "alchemy", 5, 25), ...{ effectType: "combat-stat-boost", effectStat: "str", effectAmount: 7, effectDurationMs: 10 * MIN } as ConsumableEffect, tier: 5, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("stonehide-draught", "Stonehide Draught", "Skin takes on the patience of stone.", "alchemy-might", "alchemy", 6, 25), ...{ effectType: "combat-stat-boost", effectStat: "con", effectAmount: 4, effectDurationMs: 10 * MIN } as ConsumableEffect, tier: 6, family: "alchemy-might", variant: "base" },
  { ...craftingItem("nightmare-swift-draught", "Nightmare Swiftness Draught", "Move like something out of a bad dream.", "alchemy-might", "alchemy", 7, 25), ...{ effectType: "combat-stat-boost", effectStat: "dex", effectAmount: 7, effectDurationMs: 12 * MIN } as ConsumableEffect, tier: 7, family: "alchemy-might", variant: "advanced" },
  { ...craftingItem("starforged-heart-draught", "Starforged Heart Draught", "The heart of the forest, beating in a flask.", "alchemy-might", "alchemy", 8, 25), ...{ effectType: "combat-stat-boost", effectStat: "con", effectAmount: 8, effectDurationMs: 15 * MIN } as ConsumableEffect, tier: 8, family: "alchemy-might", variant: "advanced" },
  // Track 2 — skill XP (alchemy-focus), per-skill pairs.
  { ...craftingItem("gathering-focus-tonic", "Gathering Focus Tonic", "Sharpens gathering instincts, improving skill gains.", "alchemy-focus", "alchemy", 1, 25), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 1, family: "alchemy-focus", variant: "base" },
  { ...craftingItem("crafting-focus-tonic", "Crafting Focus Tonic", "Steadies the hand, improving crafting skill gains.", "alchemy-focus", "alchemy", 1, 25), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 1, family: "alchemy-focus", variant: "base" },
  { ...craftingItem("gathering-focus-elixir", "Gathering Focus Elixir", "Deep attunement to the wilds.", "alchemy-focus", "alchemy", 5, 25), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.8, effectDurationMs: 45 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 5, family: "alchemy-focus", variant: "advanced" },
  { ...craftingItem("crafting-focus-elixir", "Crafting Focus Elixir", "The workshop feels like an extension of the self.", "alchemy-focus", "alchemy", 5, 25), ...{ effectType: "skill-xp-multiplier", effectAmount: 1.8, effectDurationMs: 45 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 5, family: "alchemy-focus", variant: "advanced" },
  // Track 3 — skill speed (alchemy-swiftness), per-skill pairs.
  { ...craftingItem("gathering-alacrity-tonic", "Gathering Alacrity Tonic", "Quickens gathering work.", "alchemy-swiftness", "alchemy", 2, 25), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.2, effectDurationMs: 30 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 2, family: "alchemy-swiftness", variant: "base" },
  { ...craftingItem("crafting-alacrity-tonic", "Crafting Alacrity Tonic", "Quickens crafting work.", "alchemy-swiftness", "alchemy", 2, 25), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.2, effectDurationMs: 30 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 2, family: "alchemy-swiftness", variant: "base" },
  { ...craftingItem("gathering-alacrity-elixir", "Gathering Alacrity Elixir", "Blur through the undergrowth.", "alchemy-swiftness", "alchemy", 6, 25), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.6, effectDurationMs: 45 * MIN, effectScope: "gathering" } as ConsumableEffect, tier: 6, family: "alchemy-swiftness", variant: "advanced" },
  { ...craftingItem("crafting-alacrity-elixir", "Crafting Alacrity Elixir", "Hands move faster than thought.", "alchemy-swiftness", "alchemy", 6, 25), ...{ effectType: "skill-speed-multiplier", effectAmount: 1.6, effectDurationMs: 45 * MIN, effectScope: "crafting" } as ConsumableEffect, tier: 6, family: "alchemy-swiftness", variant: "advanced" },
  // Track 4 — combat XP (alchemy-wisdom), single pair.
  { ...craftingItem("wisdom-draught", "Wisdom Draught", "Learn from every battle.", "alchemy-wisdom", "alchemy", 3, 25), ...{ effectType: "combat-xp-multiplier", effectAmount: 1.3, effectDurationMs: 30 * MIN } as ConsumableEffect, tier: 3, family: "alchemy-wisdom", variant: "base" },
  { ...craftingItem("wisdom-elixir", "Wisdom Elixir", "Every scar is a lesson.", "alchemy-wisdom", "alchemy", 7, 25), ...{ effectType: "combat-xp-multiplier", effectAmount: 2.0, effectDurationMs: 45 * MIN } as ConsumableEffect, tier: 7, family: "alchemy-wisdom", variant: "advanced" },
];

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
    heavyArmorItem(`${prefix}-boots`, `${material} Boots`, "forging-feet", tier, "feet", "dex", "boots"),
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
    lightArmorItem(`${prefix}-boots`, `${material} Boots`, "woodworking-feet", tier, "feet", "dex", "boots"),
  ];
});

const OUTPUT_ITEMS: SeedItem[] = [
  ...REFINED_ITEMS,
  ...CONSUMABLE_ITEMS.map(
    ({ tier: _tier, family: _family, variant, ...item }) => ({
      ...item,
      buffVariant: variant,
    })
  ),
  ...WOODWORKING_ITEMS,
  ...FORGING_ITEMS,
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
    baseDamage: 4,
    attackSpeed: 1.0,
    damageStat: "str",
    damageType: "physical",
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
    baseDamage: 3,
    attackSpeed: 1.6,
    damageStat: "dex",
    damageType: "physical",
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
    baseDamage: 4,
    attackSpeed: 1.3,
    damageStat: "dex",
    damageType: "physical",
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
    baseDamage: 5,
    attackSpeed: 0.8,
    damageStat: "int",
    damageType: "magical",
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
    speedPenalty: 0.08,
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

const MONSTER_DROP_ITEMS: SeedItem[] = [
  {
    itemId: "moonlit-rat-fang",
    name: "Moonlit Rat Fang",
    category: "crafting",
    description: "A sharp fang stained by the moonlit burrows beneath the forest.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 10,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "goblin-thorn-charm",
    name: "Goblin Thorn Charm",
    category: "crafting",
    description: "A crooked charm cut from a goblin's stolen thornwood.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 10,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "orc-heartwood-shard",
    name: "Orc Heartwood Shard",
    category: "crafting",
    description: "A splinter of heartwood carried by orc chieftains.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 20,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "troll-moss-hide",
    name: "Troll Moss Hide",
    category: "crafting",
    description: "Tough hide covered in the moss of a troll's den.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 20,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "wyvern-moon-scale",
    name: "Wyvern Moon Scale",
    category: "crafting",
    description: "A scale that catches moonlight even in a closed pouch.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 30,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "dragon-ember-scale",
    name: "Dragon Ember Scale",
    category: "crafting",
    description: "A warm scale that remembers the color of a dragon's fire.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 30,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "demon-ash-seed",
    name: "Demon Ash Seed",
    category: "crafting",
    description: "A seed that refuses to sprout unless fed a spark of shadow.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 30,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "nightmare-dreamleaf",
    name: "Nightmare Dreamleaf",
    category: "crafting",
    description: "A leaf plucked from the edge of a nightmare.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 30,
    itemFamily: "monster-augmentation",
  },
  {
    itemId: "archfiend-horn",
    name: "Archfiend Horn",
    category: "crafting",
    description: "A horn whose black grain twists toward forbidden paths.",
    stackable: true,
    maxStackSize: 100,
    allowedEquipmentSlots: [],
    rarityLevel: 30,
    itemFamily: "monster-augmentation",
  },
];

const BOSS_TOKEN_ITEMS: SeedItem[] = TIERS.map((tier) => ({
  itemId: `forest-boss-token-${tier}`,
  name: `Heart of the Grove ${tier}`,
  category: "crafting",
  description: `A token claimed from the tier ${tier} guardian of the forest.`,
  stackable: true,
  maxStackSize: 25,
  allowedEquipmentSlots: [],
  rarityLevel: 30,
  itemFamily: "boss-catalyst",
}));

const ALL_ITEMS = [
  ...RESOURCE_ITEMS,
  ...OUTPUT_ITEMS,
  ...STARTER_ITEMS,
  ...MONSTER_DROP_ITEMS,
  ...BOSS_TOKEN_ITEMS,
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
];

const MONSTER_DROPS = [
  ["rat", "moonlit-rat-fang"],
  ["goblin", "goblin-thorn-charm"],
  ["orc", "orc-heartwood-shard"],
  ["troll", "troll-moss-hide"],
  ["wyvern", "wyvern-moon-scale"],
  ["dragon", "dragon-ember-scale"],
  ["demon", "demon-ash-seed"],
  ["nightmare", "nightmare-dreamleaf"],
  ["archfiend", "archfiend-horn"],
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

function itemIdFor(itemById: Map<string, Id<"items">>, itemId: string) {
  const id = itemById.get(itemId);
  if (!id) throw new Error(`Seed item ${itemId} was not created`);
  return id;
}

export async function seedForestCraftingContent(ctx: MutationCtx) {
  const now = Date.now();
  const itemById = new Map<string, Id<"items">>();

  for (const item of ALL_ITEMS) {
    const existing = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", item.itemId))
      .first();
    const values = { ...item, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      itemById.set(item.itemId, existing._id);
    } else {
      const id = await ctx.db.insert("items", {
        ...values,
        createdAt: now,
      });
      itemById.set(item.itemId, id);
    }
  }

  for (const entry of [
    SKILL_XP_BALANCE_DEFAULT,
    { key: "bossGoldPerTier", value: 500, description: "Base boss gold reward per tier" },
    { key: "bossExperiencePerTier", value: 250, description: "Base boss experience reward per tier" },
  ]) {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", entry.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: entry.value,
        description: entry.description,
        lastUpdated: now,
      });
    } else {
      await ctx.db.insert("gameBalance", {
        ...entry,
        lastUpdated: now,
      });
    }
  }
  for (const entry of [...SKILL_TASK_BALANCE_DEFAULTS, ...COMBAT_BALANCE_DEFAULTS]) {
    const existing = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", entry.key))
      .first();
    if (existing) continue;
    await ctx.db.insert("gameBalance", {
      ...entry,
      lastUpdated: now,
    });
  }

  for (const skill of SKILLS) {
    const existing = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", skill.skillId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...skill,
        enabled: true,
        maxLevel: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("skillDefinitions", {
        ...skill,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  for (const skill of SKILLS) {
    for (const tier of TIERS) {
      const index = tier - 1;
      const tierRow = {
        skillId: skill.skillId,
        tier,
        name: `${TIER_NAMES[index]} ${skill.name}`,
        description: `Tier ${tier} ${skill.name.toLowerCase()} activities.`,
        requiredLevel: TIER_LEVELS[index],
        enabled: true,
        updatedAt: now,
      };
      const existing = await ctx.db
        .query("skillTierDefinitions")
        .withIndex("by_skillId_and_tier", (q) =>
          q.eq("skillId", skill.skillId).eq("tier", tier)
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, tierRow);
      } else {
        await ctx.db.insert("skillTierDefinitions", {
          ...tierRow,
          createdAt: now,
        });
      }
    }
  }

  const gathering = [
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
  ] as const;
  for (const [
    activityId,
    skillId,
    tier,
    name,
    outputItemId,
    minYield,
    maxYield,
  ] of gathering) {
    const activity = {
      activityId,
      skillId,
      tier,
      name,
      description: `Gather ${name.toLowerCase()} from the mystical forest.`,
      outputItemId: itemIdFor(itemById, outputItemId),
      minYield,
      maxYield,
      durationMs: tier * 30_000,
      experienceReward: tier * 25,
      enabled: true,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("gatheringActivities")
      .withIndex("by_activityId", (q) => q.eq("activityId", activityId))
      .first();
    if (existing) await ctx.db.patch(existing._id, activity);
    else await ctx.db.insert("gatheringActivities", { ...activity, createdAt: now });
  }

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
    refinedPerTier: string[]
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
        requiresMonsterDrop: false,
        ingredients: [
          { itemId: refinedPerTier[tierIndex], quantity: 2 },
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
      refinedIds(LUMBER_LINE)
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
      refinedIds(INGOT_LINE)
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
    consumable("verdant-tonic", "Brew Verdant Tonic", 1, "alchemy-might", false, [
      { itemId: extractT[0], quantity: 2 },
    ]),
    consumable("ember-might-draught", "Brew Ember Might Draught", 2, "alchemy-might", false, [
      { itemId: extractT[1], quantity: 2 },
    ]),
    consumable("hunters-swift-draught", "Brew Hunter's Swiftness Draught", 3, "alchemy-might", false, [
      { itemId: extractT[2], quantity: 2 },
    ]),
    consumable("starwater-salve", "Brew Starwater Salve", 4, "alchemy-might", true, [
      { itemId: extractT[3], quantity: 2 },
      { itemId: "verdant-tonic", quantity: 1 },
      { itemId: "troll-moss-hide", quantity: 1 },
    ]),
    consumable("demonseed-might-draught", "Brew Demonseed Might Draught", 5, "alchemy-might", true, [
      { itemId: extractT[4], quantity: 2 },
      { itemId: "ember-might-draught", quantity: 1 },
      { itemId: "demon-ash-seed", quantity: 1 },
    ]),
    consumable("stonehide-draught", "Brew Stonehide Draught", 6, "alchemy-might", false, [
      { itemId: extractT[5], quantity: 2 },
    ]),
    consumable("nightmare-swift-draught", "Brew Nightmare Swiftness Draught", 7, "alchemy-might", true, [
      { itemId: extractT[6], quantity: 2 },
      { itemId: "hunters-swift-draught", quantity: 1 },
      { itemId: "nightmare-dreamleaf", quantity: 1 },
    ]),
    consumable("starforged-heart-draught", "Brew Starforged Heart Draught", 8, "alchemy-might", true, [
      { itemId: extractT[7], quantity: 2 },
      { itemId: "stonehide-draught", quantity: 1 },
      { itemId: "archfiend-horn", quantity: 1 },
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
    consumable("wisdom-draught", "Brew Wisdom Draught", 3, "alchemy-wisdom", false, [
      { itemId: extractT[2], quantity: 2 },
    ]),
    consumable("wisdom-elixir", "Brew Wisdom Elixir", 7, "alchemy-wisdom", true, [
      { itemId: extractT[6], quantity: 2 },
      { itemId: "wisdom-draught", quantity: 1 },
      { itemId: "wyvern-moon-scale", quantity: 1 },
    ]),
  ];

  const recipes: RecipeSeed[] = [
    ...alchemyRefinementRecipes,
    ...woodworkingRefinementRecipes,
    ...forgingRefinementRecipes,
    ...woodworkingProductRecipes,
    ...forgingProductRecipes,
    ...consumableRecipes,
  ];
  for (const seed of recipes) {
    const {
      recipeId,
      outputItemId,
      skillId,
      tier,
      name,
      outputFamily,
      stage,
      requiresMonsterDrop,
      ingredients,
    } = seed;
    const recipe = {
      recipeId,
      skillId,
      tier,
      name,
      description:
        stage === "refinement"
          ? `Refine tier ${tier} gathered materials for later crafting.`
          : stage === "consumable"
            ? `Brew ${name.toLowerCase().replace(/^(brew|refine|shape|forge) /, "")} from tier ${tier} refined materials.`
            : `Craft ${name.toLowerCase()} from tier ${tier} refined materials.`,
      durationMs: tier * 45_000,
      experienceReward: tier * 50,
      outputFamily,
      stage,
      requiresMonsterDrop,
      enabled: true,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .first();
    if (existing) await ctx.db.patch(existing._id, recipe);
    else await ctx.db.insert("recipes", { ...recipe, createdAt: now });

    const oldIngredients = await ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect();
    for (const row of oldIngredients) await ctx.db.delete(row._id);
    for (const ingredient of ingredients) {
      await ctx.db.insert("recipeIngredients", {
        recipeId,
        itemId: itemIdFor(itemById, ingredient.itemId),
        quantity: ingredient.quantity,
      });
    }

    const oldOutputs = await ctx.db
      .query("recipeOutputs")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect();
    for (const row of oldOutputs) await ctx.db.delete(row._id);
    await ctx.db.insert("recipeOutputs", {
      recipeId,
      itemId: itemIdFor(itemById, outputItemId),
      quantity: 1,
    });
  }

  for (const recipeId of RETIRED_RECIPE_IDS) {
    const retired = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .first();
    if (retired && retired.enabled) {
      await ctx.db.patch(retired._id, { enabled: false, updatedAt: now });
    }
  }

  const augmentments = MONSTER_DROPS.map(([monsterId, materialId], index) => {
    const tier = index < 3 ? 1 : index < 6 ? 2 : 3;
    const stat = (["str", "dex", "int", "luk", "con"] as const)[index % 5];
    return {
      augmentationId: `augment-${monsterId}`,
      skillId: "forging",
      tier,
      name: `${monsterId[0].toUpperCase()}${monsterId.slice(1)} Aspect`,
      description: `Bind the aspect of a ${monsterId} to a crafted equipment item.`,
      allowedEquipmentSlots: [],
      requiredMaterialItemId: itemIdFor(itemById, materialId),
      requiredMaterialQuantity: tier,
      bossCatalystItemId: itemIdFor(
        itemById,
        `forest-boss-token-${tier}`
      ),
      bossCatalystQuantity: 1,
      effectType: "stat-bonus",
      effectStat: stat,
      effectAmount: tier * 2,
      experienceReward: 50 * tier,
      enabled: true,
      updatedAt: now,
    };
  });
  for (const augmentation of augmentments) {
    const existing = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) =>
        q.eq("augmentationId", augmentation.augmentationId)
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, augmentation);
    else await ctx.db.insert("augmentationDefinitions", { ...augmentation, createdAt: now });
  }

  const upsertTask = async () => {
    const existing = await ctx.db
      .query("taskDefinitions")
      .withIndex("by_taskId", (q) => q.eq("taskId", "skill_action"))
      .first();
    const definition = {
      taskId: "skill_action",
      name: "Skill action",
      category: "skill",
      description: "Gather resources or craft an item.",
      canProgressOffline: true,
      requiresOnline: false,
      enabled: true,
      prerequisites: null,
      rewards: { uses: "skillAction" },
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, definition);
    else await ctx.db.insert("taskDefinitions", { ...definition, createdAt: now });
  };
  await upsertTask();

  for (const [monsterId, materialId] of MONSTER_DROPS) {
    const tableId = `loot-monster-${monsterId}`;
    const existingTable = await ctx.db
      .query("lootTables")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", tableId))
      .first();
    const table = {
      lootTableId: tableId,
      name: `${monsterId} aspect drops`,
      sourceType: "monster" as const,
      rollCount: 1,
      enabled: true,
      updatedAt: now,
    };
    if (existingTable) await ctx.db.patch(existingTable._id, table);
    else await ctx.db.insert("lootTables", { ...table, createdAt: now });

    const oldEntries = await ctx.db
      .query("lootTableEntries")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", tableId))
      .collect();
    for (const row of oldEntries) await ctx.db.delete(row._id);
    await ctx.db.insert("lootTableEntries", {
      lootTableId: tableId,
      itemId: itemIdFor(itemById, materialId),
      weight: 1,
      dropChance: 1,
      minQuantity: 1,
      maxQuantity: 1,
      guaranteed: false,
      purpose: "augmentation",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const existingSource = (
      await ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId", (q) =>
          q.eq("sourceType", "monster").eq("sourceId", monsterId)
        )
        .collect()
    ).find((row) => row.tier === undefined);
    if (existingSource) {
      await ctx.db.patch(existingSource._id, {
        lootTableId: tableId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("lootSources", {
        sourceType: "monster",
        sourceId: monsterId,
        lootTableId: tableId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const bossCatalysts = [
    "moonlit-rat-fang",
    "goblin-thorn-charm",
    "orc-heartwood-shard",
    "troll-moss-hide",
    "wyvern-moon-scale",
    "dragon-ember-scale",
    "demon-ash-seed",
    "nightmare-dreamleaf",
  ];
  for (const tier of TIERS) {
    const tableId = `loot-boss-tier-${tier}`;
    const tokenId = itemIdFor(itemById, `forest-boss-token-${tier}`);
    const existingTable = await ctx.db
      .query("lootTables")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", tableId))
      .first();
    const table = {
      lootTableId: tableId,
      name: `Tier ${tier} guardian rewards`,
      sourceType: "boss" as const,
      tier,
      rollCount: 1,
      enabled: true,
      updatedAt: now,
    };
    if (existingTable) await ctx.db.patch(existingTable._id, table);
    else await ctx.db.insert("lootTables", { ...table, createdAt: now });
    const oldEntries = await ctx.db
      .query("lootTableEntries")
      .withIndex("by_lootTableId", (q) => q.eq("lootTableId", tableId))
      .collect();
    for (const row of oldEntries) await ctx.db.delete(row._id);
    await ctx.db.insert("lootTableEntries", {
      lootTableId: tableId,
      itemId: tokenId,
      weight: 1,
      dropChance: 1,
      minQuantity: 1,
      maxQuantity: 1,
      guaranteed: true,
      purpose: "boss-catalyst",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const catalystId = itemIdFor(itemById, bossCatalysts[tier - 1]);
    await ctx.db.insert("lootTableEntries", {
      lootTableId: tableId,
      itemId: catalystId,
      weight: 1,
      dropChance: 0.25,
      minQuantity: 1,
      maxQuantity: 1,
      guaranteed: false,
      purpose: "boss-catalyst",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const sourceId = `boss_tier_${tier}`;
    const existingSource = (
      await ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId_and_tier", (q) =>
          q.eq("sourceType", "boss").eq("sourceId", sourceId).eq("tier", tier)
        )
        .collect()
    )[0];
    if (existingSource) {
      await ctx.db.patch(existingSource._id, {
        lootTableId: tableId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("lootSources", {
        sourceType: "boss",
        sourceId,
        tier,
        lootTableId: tableId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

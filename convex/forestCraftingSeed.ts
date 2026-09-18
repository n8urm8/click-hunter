import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
  augmentSlots?: number;
};

type Tier = 1 | 2 | 3;
type EquipmentSlot = SeedItem["allowedEquipmentSlots"][number];
type EffectStat = NonNullable<SeedItem["effectStat"]>;

const TIERS: Tier[] = [1, 2, 3];

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

function equipmentItem(
  itemId: string,
  name: string,
  itemFamily: string,
  craftingSkillId: "woodworking" | "forging",
  craftingTier: Tier,
  slot: EquipmentSlot,
  effectStat: EffectStat
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
    craftingSkillId,
    craftingTier,
    effectType: "stat-bonus",
    effectStat,
    effectAmount: craftingTier * 2,
    augmentSlots: 1,
  };
}

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
] as const;

const RESOURCE_ITEMS: SeedItem[] = [
  ...HARVESTING_RESOURCES.map(([itemId, name, tier, description]) =>
    craftingItem(
      itemId,
      name,
      description,
      "harvesting-resource",
      "harvesting",
      tier
    )
  ),
  craftingItem(
    "moonwood-log",
    "Moonwood Log",
    "Pale wood harvested from trees that drink in starlight.",
    "woodcutting-resource",
    "woodcutting",
    1
  ),
  craftingItem(
    "living-bark",
    "Living Bark",
    "Warm bark that flexes like a slow, sleeping heartbeat.",
    "woodcutting-resource",
    "woodcutting",
    2
  ),
  craftingItem(
    "thornvine-bundle",
    "Thornvine Bundle",
    "A coil of thornvine gathered before its thorns unfurl.",
    "woodcutting-resource",
    "woodcutting",
    3
  ),
  craftingItem(
    "moonstone-shard",
    "Moonstone Shard",
    "A cool shard that reflects a sky no matter the hour.",
    "mining-resource",
    "mining",
    1
  ),
  craftingItem(
    "root-amber",
    "Root Amber",
    "Golden resin found where ancient roots cross the stone.",
    "mining-resource",
    "mining",
    2
  ),
  craftingItem(
    "root-iron-ore",
    "Root-Iron Ore",
    "Dense ore threaded with roots that refuse to break.",
    "mining-resource",
    "mining",
    3
  ),
];

const REFINED_ITEMS: SeedItem[] = [
  ...[
    ["moonlit-essence", "Moonlit Essence", 1, "alchemy-essence"],
    ["glimmering-essence", "Glimmering Essence", 2, "alchemy-essence"],
    ["whispering-essence", "Whispering Essence", 3, "alchemy-essence"],
    ["silverdew-powder", "Silverdew Powder", 1, "alchemy-powder"],
    ["sunveil-powder", "Sunveil Powder", 2, "alchemy-powder"],
    ["astral-powder", "Astral Powder", 3, "alchemy-powder"],
    ["starlight-extract", "Starlight Extract", 1, "alchemy-extract"],
    ["dreamcap-extract", "Dreamcap Extract", 2, "alchemy-extract"],
    ["elderroot-extract", "Elderroot Extract", 3, "alchemy-extract"],
  ].map(([itemId, name, tier, family]) =>
    craftingItem(
      itemId as string,
      name as string,
      `A tier ${tier} reagent refined before final alchemical brewing.`,
      family as string,
      "alchemy",
      tier as Tier
    )
  ),
  ...[
    ["moonwood-lumber", "Moonwood Lumber", 1],
    ["living-bark-lumber", "Living Bark Lumber", 2],
    ["thornvine-lumber", "Thornvine Lumber", 3],
  ].map(([itemId, name, tier]) =>
    craftingItem(
      itemId as string,
      name as string,
      `Tier ${tier} lumber refined for woodworking.`,
      "woodworking-lumber",
      "woodworking",
      tier as Tier
    )
  ),
  ...[
    ["moonstone-ingot", "Moonstone Ingot", 1],
    ["ambersteel-ingot", "Ambersteel Ingot", 2],
    ["root-iron-ingot", "Root-Iron Ingot", 3],
  ].map(([itemId, name, tier]) =>
    craftingItem(
      itemId as string,
      name as string,
      `A tier ${tier} ingot refined for forging.`,
      "forging-ingot",
      "forging",
      tier as Tier
    )
  ),
];

const ALCHEMY_EFFECTS: Record<
  string,
  Pick<SeedItem, "effectType" | "effectStat" | "effectAmount" | "effectDurationMs">
> = {
  "verdant-tonic": {
    effectType: "restoration",
    effectAmount: 25,
    effectDurationMs: 10_000,
  },
  "starwater-salve": {
    effectType: "restoration",
    effectAmount: 55,
    effectDurationMs: 15_000,
  },
  "dreambloom-elixir": {
    effectType: "restoration",
    effectAmount: 100,
    effectDurationMs: 20_000,
  },
  "moonward-philter": {
    effectType: "stat-bonus",
    effectStat: "con",
    effectAmount: 2,
    effectDurationMs: 30_000,
  },
  "starward-philter": {
    effectType: "stat-bonus",
    effectStat: "con",
    effectAmount: 4,
    effectDurationMs: 45_000,
  },
  "dreamward-philter": {
    effectType: "stat-bonus",
    effectStat: "con",
    effectAmount: 7,
    effectDurationMs: 60_000,
  },
  "ratfang-draught": {
    effectType: "stat-bonus",
    effectStat: "dex",
    effectAmount: 2,
    effectDurationMs: 30_000,
  },
  "trollhide-draught": {
    effectType: "stat-bonus",
    effectStat: "con",
    effectAmount: 4,
    effectDurationMs: 45_000,
  },
  "demonseed-draught": {
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 7,
    effectDurationMs: 60_000,
  },
  "goblin-charm-oil": {
    effectType: "stat-bonus",
    effectStat: "luk",
    effectAmount: 2,
    effectDurationMs: 30_000,
  },
  "wyvern-scale-oil": {
    effectType: "stat-bonus",
    effectStat: "dex",
    effectAmount: 4,
    effectDurationMs: 45_000,
  },
  "nightmare-leaf-oil": {
    effectType: "stat-bonus",
    effectStat: "int",
    effectAmount: 7,
    effectDurationMs: 60_000,
  },
  "orc-heartwood-elixir": {
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 2,
    effectDurationMs: 30_000,
  },
  "dragon-ember-elixir": {
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 4,
    effectDurationMs: 45_000,
  },
  "archfiend-horn-elixir": {
    effectType: "stat-bonus",
    effectStat: "str",
    effectAmount: 7,
    effectDurationMs: 60_000,
  },
};

const ALCHEMY_PRODUCT_ITEMS: SeedItem[] = [
  ["verdant-tonic", "Verdant Tonic", 1, "alchemy-restorative"],
  ["starwater-salve", "Starwater Salve", 2, "alchemy-restorative"],
  ["dreambloom-elixir", "Dreambloom Elixir", 3, "alchemy-restorative"],
  ["moonward-philter", "Moonward Philter", 1, "alchemy-ward"],
  ["starward-philter", "Starward Philter", 2, "alchemy-ward"],
  ["dreamward-philter", "Dreamward Philter", 3, "alchemy-ward"],
  ["ratfang-draught", "Ratfang Draught", 1, "alchemy-predator"],
  ["trollhide-draught", "Trollhide Draught", 2, "alchemy-predator"],
  ["demonseed-draught", "Demonseed Draught", 3, "alchemy-predator"],
  ["goblin-charm-oil", "Goblin Charm Oil", 1, "alchemy-cunning"],
  ["wyvern-scale-oil", "Wyvern Scale Oil", 2, "alchemy-cunning"],
  ["nightmare-leaf-oil", "Nightmare Leaf Oil", 3, "alchemy-cunning"],
  ["orc-heartwood-elixir", "Orc Heartwood Elixir", 1, "alchemy-might"],
  ["dragon-ember-elixir", "Dragon Ember Elixir", 2, "alchemy-might"],
  ["archfiend-horn-elixir", "Archfiend Horn Elixir", 3, "alchemy-might"],
].map(([itemId, name, tier, family]) => ({
  ...craftingItem(
    itemId as string,
    name as string,
    `A tier ${tier} final alchemical product of the mystical forest.`,
    family as string,
    "alchemy",
    tier as Tier,
    25
  ),
  ...ALCHEMY_EFFECTS[itemId as string],
}));

const WOOD_NAMES = ["Moonwood", "Living Bark", "Thornvine"] as const;
const WOOD_IDS = ["moonwood", "living-bark", "thornvine"] as const;
const WOODWORKING_ITEMS: SeedItem[] = TIERS.flatMap((tier) => {
  const index = tier - 1;
  const material = WOOD_NAMES[index];
  const prefix = WOOD_IDS[index];
  return [
    equipmentItem(`${prefix}-bow`, `${material} Bow`, "woodworking-bow", "woodworking", tier, "mainHand", "dex"),
    equipmentItem(`${prefix}-staff`, `${material} Staff`, "woodworking-staff", "woodworking", tier, "mainHand", "int"),
    equipmentItem(`${prefix}-hood`, `${material} Hood`, "woodworking-head", "woodworking", tier, "head", "luk"),
    equipmentItem(`${prefix}-vest`, `${material} Vest`, "woodworking-chest", "woodworking", tier, "chest", "con"),
    equipmentItem(`${prefix}-leggings`, `${material} Leggings`, "woodworking-legs", "woodworking", tier, "legs", "dex"),
    equipmentItem(`${prefix}-boots`, `${material} Boots`, "woodworking-feet", "woodworking", tier, "feet", "dex"),
  ];
});

const FORGE_NAMES = ["Moonstone", "Amberroot", "Root-Iron"] as const;
const FORGE_IDS = ["moonstone", "amber-root", "root-iron"] as const;
const FORGING_ITEMS: SeedItem[] = TIERS.flatMap((tier) => {
  const index = tier - 1;
  const material = FORGE_NAMES[index];
  const prefix = FORGE_IDS[index];
  return [
    equipmentItem(
      tier === 3 ? "root-iron-blade" : `${prefix}-sword`,
      `${material} Sword`,
      "forging-sword",
      "forging",
      tier,
      "mainHand",
      "str"
    ),
    equipmentItem(`${prefix}-dagger`, `${material} Dagger`, "forging-dagger", "forging", tier, "mainHand", "dex"),
    equipmentItem(`${prefix}-mace`, `${material} Mace`, "forging-mace", "forging", tier, "mainHand", "con"),
    equipmentItem(`${prefix}-helm`, `${material} Helm`, "forging-head", "forging", tier, "head", "con"),
    equipmentItem(
      tier === 1 ? "moonstone-mail" : `${prefix}-mail`,
      `${material} Mail`,
      "forging-chest",
      "forging",
      tier,
      "chest",
      "con"
    ),
    equipmentItem(`${prefix}-greaves`, `${material} Greaves`, "forging-legs", "forging", tier, "legs", "str"),
    equipmentItem(`${prefix}-boots`, `${material} Boots`, "forging-feet", "forging", tier, "feet", "dex"),
  ];
});

const OUTPUT_ITEMS: SeedItem[] = [
  ...REFINED_ITEMS,
  ...ALCHEMY_PRODUCT_ITEMS,
  ...WOODWORKING_ITEMS,
  ...FORGING_ITEMS,
];

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

const BOSS_TOKEN_ITEMS: SeedItem[] = [1, 2, 3].map((tier) => ({
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
    { key: "skillXpPerLevel", value: 100, description: "Skill XP required per level" },
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

  for (const skill of SKILLS) {
    const existing = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", skill.skillId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...skill,
        enabled: true,
        maxLevel: 99,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("skillDefinitions", {
        ...skill,
        enabled: true,
        maxLevel: 99,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  for (const skill of SKILLS) {
    for (const tier of [1, 2, 3]) {
      const tierNames = ["Grove", "Moonlit Grove", "Ancient Grove"];
      const tierRow = {
        skillId: skill.skillId,
        tier,
        name: `${tierNames[tier - 1]} ${skill.name}`,
        description: `Tier ${tier} ${skill.name.toLowerCase()} activities.`,
        requiredLevel: tier === 1 ? 1 : tier === 2 ? 5 : 10,
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
    ["cut-moonwood", "woodcutting", 1, "Cut Moonwood", "moonwood-log", 1, 3],
    ["strip-bark", "woodcutting", 2, "Strip Living Bark", "living-bark", 1, 2],
    ["bind-thornvine", "woodcutting", 3, "Bind Thornvine", "thornvine-bundle", 1, 2],
    ["mine-moonstone", "mining", 1, "Mine Moonstone", "moonstone-shard", 1, 3],
    ["mine-amber", "mining", 2, "Mine Root Amber", "root-amber", 1, 2],
    ["mine-root-iron", "mining", 3, "Mine Root-Iron", "root-iron-ore", 1, 2],
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
    stage: "refinement" | "product";
    requiresMonsterDrop: boolean;
    ingredients: Array<{ itemId: string; quantity: number }>;
  };
  type ChainStep = {
    outputItemId: string;
    name: string;
    currentIngredientId: string;
    monsterDropItemId?: string;
  };
  const makeRecipeChain = (
    skillId: RecipeSeed["skillId"],
    outputFamily: string,
    stage: RecipeSeed["stage"],
    steps: [ChainStep, ChainStep, ChainStep],
    currentQuantity: number
  ): RecipeSeed[] =>
    steps.map((step, index) => ({
      recipeId: step.outputItemId,
      outputItemId: step.outputItemId,
      skillId,
      tier: (index + 1) as Tier,
      name: `${stage === "refinement" ? "Refine" : skillId === "alchemy" ? "Brew" : skillId === "woodworking" ? "Shape" : "Forge"} ${step.name}`,
      outputFamily,
      stage,
      requiresMonsterDrop: step.monsterDropItemId !== undefined,
      ingredients: [
        { itemId: step.currentIngredientId, quantity: currentQuantity },
        ...(index === 0
          ? []
          : [{ itemId: steps[index - 1].outputItemId, quantity: 1 }]),
        ...(step.monsterDropItemId === undefined
          ? []
          : [{ itemId: step.monsterDropItemId, quantity: 1 }]),
      ],
    }));

  const alchemyRefinementRecipes = [
    ...makeRecipeChain(
      "alchemy",
      "alchemy-essence",
      "refinement",
      [
        { outputItemId: "moonlit-essence", name: "Moonlit Essence", currentIngredientId: "moonlit-herb" },
        { outputItemId: "glimmering-essence", name: "Glimmering Essence", currentIngredientId: "glimmering-mushroom" },
        { outputItemId: "whispering-essence", name: "Whispering Essence", currentIngredientId: "whispering-flower" },
      ],
      3
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-powder",
      "refinement",
      [
        { outputItemId: "silverdew-powder", name: "Silverdew Powder", currentIngredientId: "silverdew-leaf" },
        { outputItemId: "sunveil-powder", name: "Sunveil Powder", currentIngredientId: "sunveil-bloom" },
        { outputItemId: "astral-powder", name: "Astral Powder", currentIngredientId: "astral-orchid" },
      ],
      3
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-extract",
      "refinement",
      [
        { outputItemId: "starlight-extract", name: "Starlight Extract", currentIngredientId: "starlight-moss" },
        { outputItemId: "dreamcap-extract", name: "Dreamcap Extract", currentIngredientId: "dreamcap-spore" },
        { outputItemId: "elderroot-extract", name: "Elderroot Extract", currentIngredientId: "elderroot" },
      ],
      3
    ),
  ];

  const alchemyProductRecipes = [
    ...makeRecipeChain(
      "alchemy",
      "alchemy-restorative",
      "product",
      [
        { outputItemId: "verdant-tonic", name: "Verdant Tonic", currentIngredientId: "moonlit-essence" },
        { outputItemId: "starwater-salve", name: "Starwater Salve", currentIngredientId: "glimmering-essence" },
        { outputItemId: "dreambloom-elixir", name: "Dreambloom Elixir", currentIngredientId: "whispering-essence" },
      ],
      2
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-ward",
      "product",
      [
        { outputItemId: "moonward-philter", name: "Moonward Philter", currentIngredientId: "silverdew-powder" },
        { outputItemId: "starward-philter", name: "Starward Philter", currentIngredientId: "sunveil-powder" },
        { outputItemId: "dreamward-philter", name: "Dreamward Philter", currentIngredientId: "astral-powder" },
      ],
      2
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-predator",
      "product",
      [
        { outputItemId: "ratfang-draught", name: "Ratfang Draught", currentIngredientId: "moonlit-essence", monsterDropItemId: "moonlit-rat-fang" },
        { outputItemId: "trollhide-draught", name: "Trollhide Draught", currentIngredientId: "glimmering-essence", monsterDropItemId: "troll-moss-hide" },
        { outputItemId: "demonseed-draught", name: "Demonseed Draught", currentIngredientId: "whispering-essence", monsterDropItemId: "demon-ash-seed" },
      ],
      2
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-cunning",
      "product",
      [
        { outputItemId: "goblin-charm-oil", name: "Goblin Charm Oil", currentIngredientId: "silverdew-powder", monsterDropItemId: "goblin-thorn-charm" },
        { outputItemId: "wyvern-scale-oil", name: "Wyvern Scale Oil", currentIngredientId: "sunveil-powder", monsterDropItemId: "wyvern-moon-scale" },
        { outputItemId: "nightmare-leaf-oil", name: "Nightmare Leaf Oil", currentIngredientId: "astral-powder", monsterDropItemId: "nightmare-dreamleaf" },
      ],
      2
    ),
    ...makeRecipeChain(
      "alchemy",
      "alchemy-might",
      "product",
      [
        { outputItemId: "orc-heartwood-elixir", name: "Orc Heartwood Elixir", currentIngredientId: "starlight-extract", monsterDropItemId: "orc-heartwood-shard" },
        { outputItemId: "dragon-ember-elixir", name: "Dragon Ember Elixir", currentIngredientId: "dreamcap-extract", monsterDropItemId: "dragon-ember-scale" },
        { outputItemId: "archfiend-horn-elixir", name: "Archfiend Horn Elixir", currentIngredientId: "elderroot-extract", monsterDropItemId: "archfiend-horn" },
      ],
      2
    ),
  ];

  const woodworkingRefinementRecipes = makeRecipeChain(
    "woodworking",
    "woodworking-lumber",
    "refinement",
    [
      { outputItemId: "moonwood-lumber", name: "Moonwood Lumber", currentIngredientId: "moonwood-log" },
      { outputItemId: "living-bark-lumber", name: "Living Bark Lumber", currentIngredientId: "living-bark" },
      { outputItemId: "thornvine-lumber", name: "Thornvine Lumber", currentIngredientId: "thornvine-bundle" },
    ],
    4
  );
  const woodworkingProductRecipes = [
    ["woodworking-bow", ["moonwood-bow", "living-bark-bow", "thornvine-bow"], "Bow"],
    ["woodworking-staff", ["moonwood-staff", "living-bark-staff", "thornvine-staff"], "Staff"],
    ["woodworking-head", ["moonwood-hood", "living-bark-hood", "thornvine-hood"], "Hood"],
    ["woodworking-chest", ["moonwood-vest", "living-bark-vest", "thornvine-vest"], "Vest"],
    ["woodworking-legs", ["moonwood-leggings", "living-bark-leggings", "thornvine-leggings"], "Leggings"],
    ["woodworking-feet", ["moonwood-boots", "living-bark-boots", "thornvine-boots"], "Boots"],
  ].flatMap(([family, outputIds, itemType]) =>
    makeRecipeChain(
      "woodworking",
      family as string,
      "product",
      TIERS.map((tier) => ({
        outputItemId: (outputIds as string[])[tier - 1],
        name: `${WOOD_NAMES[tier - 1]} ${itemType}`,
        currentIngredientId: ["moonwood-lumber", "living-bark-lumber", "thornvine-lumber"][tier - 1],
      })) as [ChainStep, ChainStep, ChainStep],
      2
    )
  );

  const forgingRefinementRecipes = makeRecipeChain(
    "forging",
    "forging-ingot",
    "refinement",
    [
      { outputItemId: "moonstone-ingot", name: "Moonstone Ingot", currentIngredientId: "moonstone-shard" },
      { outputItemId: "ambersteel-ingot", name: "Ambersteel Ingot", currentIngredientId: "root-amber" },
      { outputItemId: "root-iron-ingot", name: "Root-Iron Ingot", currentIngredientId: "root-iron-ore" },
    ],
    4
  );
  const forgingProductRecipes = [
    ["forging-sword", ["moonstone-sword", "amber-root-sword", "root-iron-blade"], "Sword"],
    ["forging-dagger", ["moonstone-dagger", "amber-root-dagger", "root-iron-dagger"], "Dagger"],
    ["forging-mace", ["moonstone-mace", "amber-root-mace", "root-iron-mace"], "Mace"],
    ["forging-head", ["moonstone-helm", "amber-root-helm", "root-iron-helm"], "Helm"],
    ["forging-chest", ["moonstone-mail", "amber-root-mail", "root-iron-mail"], "Mail"],
    ["forging-legs", ["moonstone-greaves", "amber-root-greaves", "root-iron-greaves"], "Greaves"],
    ["forging-feet", ["moonstone-boots", "amber-root-boots", "root-iron-boots"], "Boots"],
  ].flatMap(([family, outputIds, itemType]) =>
    makeRecipeChain(
      "forging",
      family as string,
      "product",
      TIERS.map((tier) => ({
        outputItemId: (outputIds as string[])[tier - 1],
        name: `${FORGE_NAMES[tier - 1]} ${itemType}`,
        currentIngredientId: ["moonstone-ingot", "ambersteel-ingot", "root-iron-ingot"][tier - 1],
      })) as [ChainStep, ChainStep, ChainStep],
      2
    )
  );

  const recipes: RecipeSeed[] = [
    ...alchemyRefinementRecipes,
    ...alchemyProductRecipes,
    ...woodworkingRefinementRecipes,
    ...woodworkingProductRecipes,
    ...forgingRefinementRecipes,
    ...forgingProductRecipes,
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

  for (const tier of [1, 2, 3]) {
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
    const catalystId = itemIdFor(
      itemById,
      tier === 1 ? "moonlit-rat-fang" : tier === 2 ? "wyvern-moon-scale" : "archfiend-horn"
    );
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

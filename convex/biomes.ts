/**
 * The world map for regular combat.
 *
 * - Tiers 1–8 are the main game: one biome per tier, matched to the crafting
 *   tier of the same number. Each biome has its own six monsters built from
 *   shared archetypes (stat shapes) and drops its own four materials.
 * - Tiers 9–16 are the Blighted biomes: tier 8+N is a harder version of biome
 *   N. Same roster with a "Blighted" prefix and one stat twist per biome, and
 *   upgraded ("Blighted") versions of that biome's materials.
 * - Tiers 17–20 are the Rift: the two hard-zone monsters of every biome, and
 *   the one endgame material, Rift Shards.
 *
 * Pure data and helpers with no imports, so the client can use it directly.
 * Monster rows without a `biomeTier` (admin-made or test fixtures) belong to
 * every tier.
 */

export const MAIN_BIOME_COUNT = 8;
export const BLIGHTED_FIRST_TIER = MAIN_BIOME_COUNT + 1; // 9
export const RIFT_FIRST_TIER = MAIN_BIOME_COUNT * 2 + 1; // 17

export type MaterialKind = "hide" | "bone" | "ichor" | "trophy";
export const MATERIAL_KINDS: MaterialKind[] = ["hide", "bone", "ichor", "trophy"];

export type ArchetypeId =
  | "skitterer"
  | "trickster"
  | "brute"
  | "stalker"
  | "fiend"
  | "apex";

type StatBlock = { str: number; dex: number; int: number; luk: number; con: number };

export type Archetype = {
  id: ArchetypeId;
  stats: StatBlock;
  goldDrop: number;
  experienceReward: number;
  /** Difficulty weighting (lower = more common, easier zone). */
  strength: number;
  /**
   * Material drops: chance per win for one of this biome's materials. Tuned
   * with convex/balanceSim.test.ts: about 15–25 of a zone's main material
   * and 1–1.5 trophies per hour of hard-zone hunting at ~330 fights/hour.
   */
  drops: Array<{ kind: MaterialKind; chance: number }>;
};

/** Stat shapes shared by every biome; tier scaling does the rest. */
export const ARCHETYPES: Archetype[] = [
  {
    id: "skitterer",
    stats: { str: 2, dex: 4, int: 1, luk: 2, con: 2 },
    goldDrop: 10,
    experienceReward: 5,
    strength: 5,
    drops: [{ kind: "bone", chance: 0.06 }],
  },
  {
    id: "trickster",
    stats: { str: 3, dex: 3, int: 2, luk: 3, con: 3 },
    goldDrop: 15,
    experienceReward: 8,
    strength: 15,
    drops: [{ kind: "ichor", chance: 0.06 }],
  },
  {
    id: "brute",
    stats: { str: 6, dex: 3, int: 3, luk: 2, con: 6 },
    goldDrop: 50,
    experienceReward: 25,
    strength: 40,
    drops: [{ kind: "hide", chance: 0.08 }],
  },
  {
    id: "stalker",
    stats: { str: 5, dex: 5, int: 4, luk: 3, con: 5 },
    goldDrop: 60,
    experienceReward: 30,
    strength: 50,
    drops: [
      { kind: "hide", chance: 0.05 },
      { kind: "bone", chance: 0.03 },
    ],
  },
  {
    id: "fiend",
    stats: { str: 9, dex: 6, int: 6, luk: 4, con: 8 },
    goldDrop: 150,
    experienceReward: 60,
    strength: 75,
    drops: [
      { kind: "ichor", chance: 0.05 },
      { kind: "trophy", chance: 0.003 },
    ],
  },
  {
    id: "apex",
    stats: { str: 10, dex: 7, int: 8, luk: 3, con: 9 },
    goldDrop: 200,
    experienceReward: 90,
    strength: 100,
    drops: [
      { kind: "bone", chance: 0.05 },
      { kind: "trophy", chance: 0.006 },
    ],
  },
];

/** Archetypes that make up the Rift roster. */
export const RIFT_ARCHETYPES: ArchetypeId[] = ["fiend", "apex"];

export type BlightModifier = {
  label: string;
  description: string;
  stats: Partial<Record<keyof StatBlock, number>>;
  /** Multiplier on time between attacks (below 1 = faster). */
  attackIntervalMultiplier?: number;
};

export type Biome = {
  tier: number;
  id: string;
  name: string;
  element: "light" | "dark" | "water" | "fire" | "wind" | "earth";
  monsters: Record<ArchetypeId, string>;
  materials: Record<MaterialKind, string>;
  blight: BlightModifier;
};

export const BIOMES: Biome[] = [
  {
    tier: 1,
    id: "grove",
    name: "Grove",
    element: "earth",
    monsters: {
      skitterer: "Burrow Rat",
      trickster: "Thorn Goblin",
      brute: "Moss Troll",
      stalker: "Briar Wolf",
      fiend: "Bramble Fiend",
      apex: "Grove Treant",
    },
    materials: { hide: "Mossy Pelt", bone: "Briar Bone", ichor: "Sap Ichor", trophy: "Treant Heartwood" },
    blight: { label: "Overgrown", description: "Thick bark: much tougher", stats: { con: 1.6 } },
  },
  {
    tier: 2,
    id: "moonlit",
    name: "Moonlit Grove",
    element: "water",
    monsters: {
      skitterer: "Moon Moth",
      trickster: "Will-o'-Wisp",
      brute: "Silverback Bear",
      stalker: "Moonlit Wyvern",
      fiend: "Lunar Shade",
      apex: "Pale Stag",
    },
    materials: { hide: "Moonlit Pelt", bone: "Silver Bone", ichor: "Moonlight Ichor", trophy: "Lunar Antler" },
    blight: { label: "Moonmad", description: "Frenzied: quicker and more agile", stats: { dex: 1.5 }, attackIntervalMultiplier: 0.85 },
  },
  {
    tier: 3,
    id: "ancient",
    name: "Ancient Grove",
    element: "light",
    monsters: {
      skitterer: "Root Beetle",
      trickster: "Sap Sprite",
      brute: "Elder Ogre",
      stalker: "Ancient Owlbear",
      fiend: "Barrow Wight",
      apex: "Ancient Ent",
    },
    materials: { hide: "Ancient Hide", bone: "Barrow Bone", ichor: "Amber Ichor", trophy: "Ent Heartseed" },
    blight: { label: "Hexed", description: "Wreathed in magic: hits harder with spells, resists magic", stats: { int: 1.8, con: 1.15 } },
  },
  {
    tier: 4,
    id: "deepwood",
    name: "Deepwood",
    element: "wind",
    monsters: {
      skitterer: "Shadow Spider",
      trickster: "Deepwood Kobold",
      brute: "Mire Troll",
      stalker: "Deepwood Panther",
      fiend: "Hollow Demon",
      apex: "Deepwood Basilisk",
    },
    materials: { hide: "Shadow Pelt", bone: "Hollow Bone", ichor: "Bog Ichor", trophy: "Basilisk Eye" },
    blight: { label: "Ravenous", description: "Relentless: attacks much faster", stats: {}, attackIntervalMultiplier: 0.7 },
  },
  {
    tier: 5,
    id: "emberfall",
    name: "Emberfall",
    element: "fire",
    monsters: {
      skitterer: "Cinder Rat",
      trickster: "Ember Imp",
      brute: "Magma Golem",
      stalker: "Ash Wyvern",
      fiend: "Flame Fiend",
      apex: "Ember Dragon",
    },
    materials: { hide: "Ember Scale", bone: "Cinder Bone", ichor: "Magma Ichor", trophy: "Dragon Heartflame" },
    blight: { label: "Scorched", description: "Burning rage: hits much harder", stats: { str: 1.5 } },
  },
  {
    tier: 6,
    id: "elderwild",
    name: "Elderwild",
    element: "earth",
    monsters: {
      skitterer: "Thornback Boar",
      trickster: "Wild Satyr",
      brute: "Rock Giant",
      stalker: "Elderwild Griffin",
      fiend: "Feral Chimera",
      apex: "Elder Wyrm",
    },
    materials: { hide: "Wild Hide", bone: "Giant Bone", ichor: "Wildroot Ichor", trophy: "Wyrm Horn" },
    blight: { label: "Primal", description: "Stronger and tougher", stats: { str: 1.25, con: 1.25 } },
  },
  {
    tier: 7,
    id: "nightmare",
    name: "Nightmare Thicket",
    element: "dark",
    monsters: {
      skitterer: "Dread Crow",
      trickster: "Whispering Shade",
      brute: "Nightmare Hulk",
      stalker: "Night Stalker",
      fiend: "Dream Eater",
      apex: "Nightmare Archfiend",
    },
    materials: { hide: "Nightmare Pelt", bone: "Dread Bone", ichor: "Dream Ichor", trophy: "Nightmare Horn" },
    blight: { label: "Haunting", description: "Elusive and vicious", stats: { dex: 1.4, str: 1.2 } },
  },
  {
    tier: 8,
    id: "starforged",
    name: "Starforged",
    element: "light",
    monsters: {
      skitterer: "Star Mite",
      trickster: "Astral Sprite",
      brute: "Star Golem",
      stalker: "Comet Wyvern",
      fiend: "Void Fiend",
      apex: "Starforged Dragon",
    },
    materials: { hide: "Star Scale", bone: "Astral Bone", ichor: "Stardust Ichor", trophy: "Starforged Core" },
    blight: { label: "Ascended", description: "Everything about them is stronger", stats: { str: 1.25, dex: 1.25, int: 1.25, con: 1.25 } },
  },
];

export const RIFT_NAME = "The Rift";
export const RIFT_SHARD_ITEM_ID = "rift-shard";
export const RIFT_SHARD_NAME = "Rift Shard";

export type TierBand = "main" | "blighted" | "rift";

export function tierBand(tier: number): TierBand {
  if (tier >= RIFT_FIRST_TIER) return "rift";
  if (tier >= BLIGHTED_FIRST_TIER) return "blighted";
  return "main";
}

/** The biome a tier draws its roster from, or null in the Rift. */
export function biomeForTier(tier: number): Biome | null {
  const band = tierBand(tier);
  if (band === "rift") return null;
  const index = band === "blighted" ? tier - MAIN_BIOME_COUNT : tier;
  return BIOMES[Math.min(Math.max(index, 1), MAIN_BIOME_COUNT) - 1] ?? null;
}

/** Display name of a tier's area. */
export function tierAreaName(tier: number): string {
  const band = tierBand(tier);
  const biome = biomeForTier(tier);
  if (band === "rift" || !biome) return RIFT_NAME;
  return band === "blighted" ? `Blighted ${biome.name}` : biome.name;
}

type PoolMonster = { biomeTier?: number; archetype?: string };

/** Whether a monster row belongs on `tier`. Unassigned rows belong everywhere. */
export function monsterBelongsToTier(monster: PoolMonster, tier: number): boolean {
  if (monster.biomeTier === undefined) return true;
  if (tierBand(tier) === "rift") {
    return RIFT_ARCHETYPES.includes(monster.archetype as ArchetypeId);
  }
  return biomeForTier(tier)?.tier === monster.biomeTier;
}

/** The monster rows that can appear on `tier`. */
export function monstersForTier<T extends PoolMonster>(monsters: T[], tier: number): T[] {
  return monsters.filter((monster) => monsterBelongsToTier(monster, tier));
}

/** Name a biome monster as it appears on `tier` (Blighted / Riftborn prefix). */
export function monsterNameForTier(monster: PoolMonster & { name: string }, tier: number): string {
  if (monster.biomeTier === undefined) return monster.name;
  const band = tierBand(tier);
  if (band === "blighted") return `Blighted ${monster.name}`;
  if (band === "rift") return `Riftborn ${monster.name}`;
  return monster.name;
}

/** The Blighted twist a monster carries on `tier`, if any. */
export function blightForTier(monster: PoolMonster, tier: number): BlightModifier | null {
  if (monster.biomeTier === undefined || tierBand(tier) !== "blighted") return null;
  return biomeForTier(tier)?.blight ?? null;
}

/**
 * Monster stat multiplier for a tier: `tierMultiplier` per tier, times a
 * one-time `jumpMultiplier` from the endgame gate tier up.
 */
export function tierStatScale(
  tier: number,
  tierMultiplier: number,
  endgame: { gateTier: number; jumpMultiplier: number } | null = null
): number {
  const base = Math.pow(tierMultiplier, tier - 1);
  if (!endgame || tier < endgame.gateTier) return base;
  return base * Math.max(1, endgame.jumpMultiplier);
}

/** Apply a monster's Blighted stat twist. */
export function applyBlight<T extends StatBlock & { baseMsPerAttack: number }>(
  monster: T,
  blight: BlightModifier | null,
  minimumAttackMs: number
): T {
  if (!blight) return monster;
  const scaled = { ...monster };
  for (const [stat, multiplier] of Object.entries(blight.stats) as Array<[keyof StatBlock, number]>) {
    scaled[stat] = Math.max(1, Math.round(monster[stat] * multiplier)) as T[keyof StatBlock];
  }
  if (blight.attackIntervalMultiplier !== undefined) {
    scaled.baseMsPerAttack = Math.max(
      minimumAttackMs,
      Math.round(monster.baseMsPerAttack * blight.attackIntervalMultiplier)
    );
  }
  return scaled;
}

/**
 * Encounter weights for a monster pool: inversely proportional to strength,
 * so weaker monsters are more common without making the strongest one rare.
 * In a two-monster zone the harder one shows up about 40% of the time
 * (Bramble Fiend 75 vs Grove Treant 100), not 1 in 27 as with a linear
 * "max − strength" weight.
 */
export function encounterWeights(monsters: Array<{ strength: number }>): number[] {
  const minStrength = Math.max(1, Math.min(...monsters.map((m) => m.strength)));
  return monsters.map((monster) => minStrength / Math.max(1, monster.strength));
}

/** Pick from a pool by `encounterWeights`. `random` returns [0, 1). */
export function pickEncounter<T extends { strength: number }>(
  monsters: T[],
  random: () => number = Math.random
): T {
  const weights = encounterWeights(monsters);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < monsters.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return monsters[index];
  }
  return monsters[monsters.length - 1];
}

// ─── Materials ──────────────────────────────────────────────────────────────

export type MaterialGrade = "regular" | "blighted";

export function materialItemId(biomeTier: number, kind: MaterialKind, grade: MaterialGrade = "regular"): string {
  const biome = BIOMES[biomeTier - 1];
  if (!biome) throw new Error(`No biome for tier ${biomeTier}`);
  return grade === "blighted" ? `blighted-${biome.id}-${kind}` : `${biome.id}-${kind}`;
}

export function materialName(biomeTier: number, kind: MaterialKind, grade: MaterialGrade = "regular"): string {
  const biome = BIOMES[biomeTier - 1];
  if (!biome) throw new Error(`No biome for tier ${biomeTier}`);
  return grade === "blighted" ? `Blighted ${biome.materials[kind]}` : biome.materials[kind];
}

/**
 * The material of `kind` that a combat tier produces: the biome's regular
 * material in tiers 1–8, its Blighted version in 9–16, Rift Shards beyond.
 */
export function materialItemIdForTier(tier: number, kind: MaterialKind): string {
  const band = tierBand(tier);
  const biome = biomeForTier(tier);
  if (band === "rift" || !biome) return RIFT_SHARD_ITEM_ID;
  return materialItemId(biome.tier, kind, band === "blighted" ? "blighted" : "regular");
}

export type MaterialSeed = {
  itemId: string;
  name: string;
  description: string;
  rarityLevel: number;
};

const KIND_BLURB: Record<MaterialKind, string> = {
  hide: "Cured into leather and wrapped into woodworked gear",
  bone: "Forged into weapons and armor",
  ichor: "Brewed into combat potions",
  trophy: "A rare trophy for boss keys and talismans",
};

/** Every combat material item: 32 regular, 32 Blighted, and Rift Shards. */
export function allMaterialSeeds(): MaterialSeed[] {
  const seeds: MaterialSeed[] = [];
  for (const biome of BIOMES) {
    for (const kind of MATERIAL_KINDS) {
      seeds.push({
        itemId: materialItemId(biome.tier, kind),
        name: materialName(biome.tier, kind),
        description: `${KIND_BLURB[kind]}. Drops in the ${biome.name} (tier ${biome.tier}).`,
        rarityLevel: kind === "trophy" ? 30 : 10 + Math.floor((biome.tier - 1) / 4) * 10,
      });
      seeds.push({
        itemId: materialItemId(biome.tier, kind, "blighted"),
        name: materialName(biome.tier, kind, "blighted"),
        description: `${KIND_BLURB[kind]}; the Blighted grade feeds masterwork enchanting. Drops in the Blighted ${biome.name} (tier ${biome.tier + MAIN_BIOME_COUNT}).`,
        rarityLevel: kind === "trophy" ? 40 : 30,
      });
    }
  }
  seeds.push({
    itemId: RIFT_SHARD_ITEM_ID,
    name: RIFT_SHARD_NAME,
    description: "A shard of the Rift (tiers 17–20). The top enchants and boss keys are built from these.",
    rarityLevel: 50,
  });
  return seeds;
}

// ─── Monster rows ───────────────────────────────────────────────────────────

export type BiomeMonsterSeed = StatBlock & {
  type: string;
  name: string;
  element: string;
  goldDrop: number;
  experienceReward: number;
  baseMsPerAttack: number;
  strength: number;
  biomeTier: number;
  archetype: ArchetypeId;
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** All 48 biome monster rows. */
export function biomeMonsterSeeds(): BiomeMonsterSeed[] {
  return BIOMES.flatMap((biome) =>
    ARCHETYPES.map((archetype) => ({
      type: slug(biome.monsters[archetype.id]),
      name: biome.monsters[archetype.id],
      element: biome.element,
      ...archetype.stats,
      goldDrop: archetype.goldDrop,
      experienceReward: archetype.experienceReward,
      baseMsPerAttack: 2000,
      strength: archetype.strength,
      biomeTier: biome.tier,
      archetype: archetype.id,
    }))
  );
}

/**
 * Loot rows for one monster on one tier band: its archetype's drops, mapped to
 * the band's grade. Rift monsters drop Rift Shards instead of trophies, plus
 * their Blighted biome materials.
 */
export function monsterDropsForTier(
  monster: { archetype: ArchetypeId; biomeTier: number },
  tier: number
): Array<{ itemId: string; chance: number }> {
  const archetype = ARCHETYPES.find((entry) => entry.id === monster.archetype);
  if (!archetype) return [];
  const band = tierBand(tier);
  if (band === "rift") {
    const drops = archetype.drops
      .filter((drop) => drop.kind !== "trophy")
      .map((drop) => ({
        itemId: materialItemId(monster.biomeTier, drop.kind, "blighted"),
        chance: drop.chance,
      }));
    drops.push({ itemId: RIFT_SHARD_ITEM_ID, chance: archetype.id === "apex" ? 0.008 : 0.005 });
    return drops;
  }
  const grade: MaterialGrade = band === "blighted" ? "blighted" : "regular";
  return archetype.drops.map((drop) => ({
    itemId: materialItemId(monster.biomeTier, drop.kind, grade),
    chance: drop.chance,
  }));
}

/**
 * Masterwork material for an enchant attempt to `level`: bone for weapons,
 * hide for armor. Levels 1–8 use the regular biome material of that number,
 * 9–16 the Blighted one, and 17+ Rift Shards.
 */
export function enchantMaterialItemId(level: number, isWeapon: boolean): string {
  return materialItemIdForTier(level, isWeapon ? "bone" : "hide");
}

/** Display name for `enchantMaterialItemId`. */
export function enchantMaterialName(level: number, isWeapon: boolean): string {
  const kind: MaterialKind = isWeapon ? "bone" : "hide";
  const band = tierBand(level);
  const biome = biomeForTier(level);
  if (band === "rift" || !biome) return RIFT_SHARD_NAME;
  return materialName(biome.tier, kind, band === "blighted" ? "blighted" : "regular");
}

/** Boss-key trophy for tier N: biome trophy, Blighted trophy, or Rift Shards. */
export function bossKeyTrophyItemId(tier: number): string {
  return materialItemIdForTier(tier, "trophy");
}

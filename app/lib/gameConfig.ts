/**
 * Click-Hunter Game Configuration
 * All static balance data, monster definitions, and upgrade templates
 */

export type StatType = "str" | "dex" | "int" | "luk" | "con";
export type UpgradeCategory = "stat-boost" | "weapon" | "armor" | "auto" | "special";

// Base starting stats - all players start equal
export const STARTING_STATS = {
  str: 5,
  dex: 5,
  int: 5,
  luk: 5,
  con: 5,
} as const;

// Monster tiers: each tier has 3 monsters, progressively harder
export type MonsterType =
  // Tier 1
  | "rat"
  | "goblin"
  | "orc"
  // Tier 2
  | "troll"
  | "wyvern"
  | "dragon"
  // Tier 3
  | "demon"
  | "nightmare"
  | "archfiend";

export interface MonsterDef {
  type: MonsterType;
  tier: number;
  monsterIndex: number; // 0, 1, or 2 within tier
  name: string;
  baseStats: Record<StatType, number>;
  goldDrop: number;
  experienceReward: number;
  // Monster attack interval: base milliseconds, reduces with tier
  // formula: baseMsPerAttack - (tier - 1) * 100
  // Tier 1 = 2000ms (0.5 attacks/sec), Tier 2 = 1900ms, Tier 3 = 1800ms, etc.
  baseMsPerAttack: number;
}

export const MONSTERS: Record<MonsterType, MonsterDef> = {
  // Tier 1
  rat: {
    type: "rat",
    tier: 1,
    monsterIndex: 0,
    name: "Rat",
    baseStats: { str: 2, dex: 4, int: 1, luk: 2, con: 2 },
    goldDrop: 10,
    experienceReward: 5,
    baseMsPerAttack: 2000,
  },
  goblin: {
    type: "goblin",
    tier: 1,
    monsterIndex: 1,
    name: "Goblin",
    baseStats: { str: 3, dex: 3, int: 2, luk: 3, con: 3 },
    goldDrop: 15,
    experienceReward: 8,
    baseMsPerAttack: 2000,
  },
  orc: {
    type: "orc",
    tier: 1,
    monsterIndex: 2,
    name: "Orc",
    baseStats: { str: 4, dex: 2, int: 2, luk: 1, con: 4 },
    goldDrop: 20,
    experienceReward: 12,
    baseMsPerAttack: 2000,
  },

  // Tier 2
  troll: {
    type: "troll",
    tier: 2,
    monsterIndex: 0,
    name: "Troll",
    baseStats: { str: 6, dex: 3, int: 3, luk: 2, con: 6 },
    goldDrop: 50,
    experienceReward: 25,
    baseMsPerAttack: 1900,
  },
  wyvern: {
    type: "wyvern",
    tier: 2,
    monsterIndex: 1,
    name: "Wyvern",
    baseStats: { str: 5, dex: 5, int: 4, luk: 3, con: 5 },
    goldDrop: 60,
    experienceReward: 30,
    baseMsPerAttack: 1900,
  },
  dragon: {
    type: "dragon",
    tier: 2,
    monsterIndex: 2,
    name: "Dragon",
    baseStats: { str: 7, dex: 4, int: 5, luk: 2, con: 7 },
    goldDrop: 75,
    experienceReward: 40,
    baseMsPerAttack: 1900,
  },

  // Tier 3
  demon: {
    type: "demon",
    tier: 3,
    monsterIndex: 0,
    name: "Demon",
    baseStats: { str: 9, dex: 6, int: 6, luk: 4, con: 8 },
    goldDrop: 150,
    experienceReward: 60,
    baseMsPerAttack: 1800,
  },
  nightmare: {
    type: "nightmare",
    tier: 3,
    monsterIndex: 1,
    name: "Nightmare",
    baseStats: { str: 8, dex: 8, int: 7, luk: 5, con: 7 },
    goldDrop: 175,
    experienceReward: 75,
    baseMsPerAttack: 1800,
  },
  archfiend: {
    type: "archfiend",
    tier: 3,
    monsterIndex: 2,
    name: "Archfiend",
    baseStats: { str: 10, dex: 7, int: 8, luk: 3, con: 9 },
    goldDrop: 200,
    experienceReward: 90,
    baseMsPerAttack: 1800,
  },
};

// Get list of monsters for a specific tier
export function getMonstersForTier(tier: number): MonsterType[] {
  return Object.keys(MONSTERS)
    .filter((key) => MONSTERS[key as MonsterType].tier === tier)
    .sort((a, b) => MONSTERS[a as MonsterType].monsterIndex - MONSTERS[b as MonsterType].monsterIndex) as MonsterType[];
}

// Get total number of tiers
export const TOTAL_TIERS = Math.max(...Object.values(MONSTERS).map((m) => m.tier));

// Rebirth tier progression: beat Tier N to unlock rebirth, next threshold increases
export const REBIRTH_TIER_PROGRESSION = [3, 5, 8, 12, 17, 23, 30] as const;

export interface Upgrade {
  id: string;
  name: string;
  category: UpgradeCategory;
  cost: number;
  description: string;
  effect: {
    type:
      | "stat-boost"
      | "enable-auto-attack"
      | "enable-auto-start-fight"
      | "special";
    stat?: StatType;
    amount?: number;
  };
  prerequisites?: {
    minTier?: number;
    minLevel?: number;
    previousUpgrades?: string[];
  };
}

// Upgrade definitions (can be expanded)
export const UPGRADES: Record<string, Upgrade> = {
  str_boost_1: {
    id: "str_boost_1",
    name: "Strength Training I",
    category: "stat-boost",
    cost: 100,
    description: "+5 STR",
    effect: { type: "stat-boost", stat: "str", amount: 5 },
    prerequisites: { minTier: 1 },
  },
  dex_boost_1: {
    id: "dex_boost_1",
    name: "Agility Training I",
    category: "stat-boost",
    cost: 100,
    description: "+5 DEX",
    effect: { type: "stat-boost", stat: "dex", amount: 5 },
    prerequisites: { minTier: 1 },
  },
  int_boost_1: {
    id: "int_boost_1",
    name: "Magical Aptitude I",
    category: "stat-boost",
    cost: 100,
    description: "+5 INT",
    effect: { type: "stat-boost", stat: "int", amount: 5 },
    prerequisites: { minTier: 1 },
  },
  luk_boost_1: {
    id: "luk_boost_1",
    name: "Fortune's Favor I",
    category: "stat-boost",
    cost: 100,
    description: "+5 LUK",
    effect: { type: "stat-boost", stat: "luk", amount: 5 },
    prerequisites: { minTier: 1 },
  },
  con_boost_1: {
    id: "con_boost_1",
    name: "Toughening I",
    category: "stat-boost",
    cost: 100,
    description: "+5 CON",
    effect: { type: "stat-boost", stat: "con", amount: 5 },
    prerequisites: { minTier: 1 },
  },
  auto_attack: {
    id: "auto_attack",
    name: "Automated Striking",
    category: "auto",
    cost: 500,
    description: "Enable automatic attacks",
    effect: { type: "enable-auto-attack" },
    prerequisites: { minTier: 2 },
  },
  auto_start_fight: {
    id: "auto_start_fight",
    name: "Battle Automation",
    category: "auto",
    cost: 750,
    description: "Automatically start next fight",
    effect: { type: "enable-auto-start-fight" },
    prerequisites: { minTier: 2 },
  },
};

// Hidden spots on the game screen: fixed positions for discovery
export interface HiddenSpot {
  id: string;
  x: number; // percentage from left
  y: number; // percentage from top
  rewardUpgradeId: string;
  radius: number; // click radius in pixels
}

export const HIDDEN_SPOTS: HiddenSpot[] = [
  {
    id: "spot_1",
    x: 15,
    y: 25,
    rewardUpgradeId: "str_boost_1",
    radius: 20,
  },
  {
    id: "spot_2",
    x: 85,
    y: 30,
    rewardUpgradeId: "dex_boost_1",
    radius: 20,
  },
  {
    id: "spot_3",
    x: 50,
    y: 80,
    rewardUpgradeId: "con_boost_1",
    radius: 20,
  },
];

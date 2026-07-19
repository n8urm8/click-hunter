/**
 * Click-Hunter Game Configuration — types only
 * All runtime data (monsters, upgrades, balance) lives in the Convex database.
 * See convex/seed.ts for data and convex/schema.ts for structure.
 */

export type StatType = "str" | "dex" | "int" | "luk" | "con";
export type UpgradeCategory = "stat-boost" | "weapon" | "armor" | "auto" | "special";
export type MonsterType =
  | "rat"
  | "goblin"
  | "orc"
  | "troll"
  | "wyvern"
  | "dragon"
  | "demon"
  | "nightmare"
  | "archfiend";

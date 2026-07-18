/**
 * Stat calculation formulas
 * All derived stats are calculated from the 5 base stats
 */

import type { StatType } from "./gameConfig";

export interface DerivedStats {
  health: number;
  attack: number;
  defense: number;
  attackSpeed: number; // attacks per second
  critChance: number; // percentage 0-100
}

export interface AllStats extends DerivedStats {
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
}

/**
 * Calculate all derived stats from 5 base stats
 */
export function calculateDerivedStats(
  str: number,
  dex: number,
  int: number,
  luk: number,
  con: number
): DerivedStats {
  return {
    health: con * 10 + int * 2,
    attack: str * 1.2 + dex * 0.5,
    defense: con * 0.8 + int * 0.3,
    attackSpeed: Math.max(0.5, (dex - 10) * 0.1 + 1.0), // min 0.5 attacks/sec
    critChance: luk * 0.5, // percentage
  };
}

/**
 * Calculate player level (average of all stats)
 */
export function calculatePlayerLevel(
  str: number,
  dex: number,
  int: number,
  luk: number,
  con: number
): number {
  return Math.floor((str + dex + int + luk + con) / 5);
}

/**
 * Get all stats (base + derived)
 */
export function getAllStats(
  str: number,
  dex: number,
  int: number,
  luk: number,
  con: number
): AllStats {
  const derived = calculateDerivedStats(str, dex, int, luk, con);
  return {
    ...derived,
    str,
    dex,
    int,
    luk,
    con,
  };
}

/**
 * Roll for critical hit
 */
export function rollCrit(critChance: number): boolean {
  return Math.random() * 100 < critChance;
}

/**
 * Calculate damage with crit multiplier
 */
export function calculateDamage(
  baseAttack: number,
  critChance: number,
  critMultiplier: number = 1.5
): number {
  const isCrit = rollCrit(critChance);
  const multiplier = isCrit ? critMultiplier : 1.0;
  // Add slight variance to damage ±10%
  const variance = 1 + (Math.random() - 0.5) * 0.2;
  return Math.ceil(baseAttack * multiplier * variance);
}

/**
 * Calculate monster attack interval in milliseconds
 * Faster monsters have lower intervals
 * Base: 2000ms for Tier 1, decreases by 100ms per tier
 */
export function calculateMonsterAttackInterval(baseMsPerAttack: number, tier: number): number {
  return baseMsPerAttack - (tier - 1) * 100;
}

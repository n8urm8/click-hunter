import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  computeAttackSpeed,
  getActiveCombatBoosts,
  getEquippedArmorTotals,
  getEquippedStatBonuses,
  getEquippedWeapon,
  readCombatBalance,
  type EquipmentStatBonuses,
} from "./items";
import { getPassiveBonuses } from "./passiveTree";
import { getActiveEventMultipliers, settleCombatFight } from "./loot";
import {
  monstersInZone,
  type CombatZone,
} from "./zones";

type PlayerId = Id<"players">;
type Player = Doc<"players">;
type Monster = Doc<"monsters">;

export const DEFAULT_AUTO_BATTLE_REWARDS = {
  goldPerTier: 100,
  goldVariance: 50,
  experiencePerTier: 50,
  experienceVariance: 25,
};

/**
 * Fallback regular-monster power when the `monsterPowerMultiplier` balance
 * entry is missing or malformed. Scales monster HP and damage (1 = unchanged).
 * The seeded balance row carries the same value; the admin General tab can
 * tune it live. Must match DEFAULT_MONSTER_POWER_MULTIPLIER in
 * app/lib/combatZones.ts (client manual-fight fallback).
 */
export const DEFAULT_MONSTER_POWER_MULTIPLIER = 0.5;

type AutoBattleRewards = typeof DEFAULT_AUTO_BATTLE_REWARDS;

async function getBalanceValue(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value;
}

function readNonNegativeNumber(
  value: unknown,
  fallback: number,
  integer = false
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    return fallback;
  }
  return value;
}

function readAutoBattleRewards(value: unknown): AutoBattleRewards {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_AUTO_BATTLE_REWARDS;
  }

  const record = value as Record<string, unknown>;
  return {
    goldPerTier: readNonNegativeNumber(
      record.goldPerTier,
      DEFAULT_AUTO_BATTLE_REWARDS.goldPerTier
    ),
    goldVariance: readNonNegativeNumber(
      record.goldVariance,
      DEFAULT_AUTO_BATTLE_REWARDS.goldVariance,
      true
    ),
    experiencePerTier: readNonNegativeNumber(
      record.experiencePerTier,
      DEFAULT_AUTO_BATTLE_REWARDS.experiencePerTier
    ),
    experienceVariance: readNonNegativeNumber(
      record.experienceVariance,
      DEFAULT_AUTO_BATTLE_REWARDS.experienceVariance,
      true
    ),
  };
}

function pickWeightedMonster(monsters: Monster[]) {
  const maxStrength = Math.max(...monsters.map((monster) => monster.strength));
  const weights = monsters.map((monster) =>
    Math.max(1, maxStrength - monster.strength + 1)
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let random = Math.random() * totalWeight;

  for (let index = 0; index < monsters.length; index += 1) {
    random -= weights[index];
    if (random <= 0) return monsters[index];
  }

  return monsters[monsters.length - 1];
}

function readTierMultiplier(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 2;
}

function readTierMsReduction(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 50;
}

function readMinimumAttackMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : 800;
}

function readMonsterPowerMultiplier(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MONSTER_POWER_MULTIPLIER;
}

function scaleMonster(
  monster: Monster,
  tier: number,
  tierMultiplier: number,
  tierMsReduction: number,
  minimumAttackMs: number
) {
  const multiplier = Math.pow(tierMultiplier, tier - 1);
  return {
    ...monster,
    str: Math.max(1, Math.round(monster.str * multiplier)),
    dex: Math.max(1, Math.round(monster.dex * multiplier)),
    int: Math.max(1, Math.round(monster.int * multiplier)),
    luk: Math.max(1, Math.round(monster.luk * multiplier)),
    con: Math.max(1, Math.round(monster.con * multiplier)),
    baseMsPerAttack: Math.max(
      minimumAttackMs,
      monster.baseMsPerAttack - (tier - 1) * tierMsReduction
    ),
  };
}

export interface AutoBattleResult {
  won: boolean;
  monsterTier: number;
  monsterType: string;
  monsterName: string;
  monsterMaxHealth: number;
  playerMaxHealth: number;
  monsterDamagePerSecond: number;
  playerDamagePerSecond: number;
  goldEarned?: number;
  experienceEarned?: number;
  durationMs: number;
}

/**
 * Resolve one regular fight without accepting client-calculated combat or rewards.
 */
export async function simulateRegularBattle(
  ctx: MutationCtx,
  player: Player,
  tier: number,
  equipmentBonuses?: EquipmentStatBonuses,
  zone?: CombatZone
): Promise<AutoBattleResult> {
  const allMonsters = await ctx.db.query("monsters").collect();
  if (allMonsters.length === 0) {
    throw new Error("Regular monsters are not configured");
  }
  // Tasks queued before zones existed carry no zone and hunt the full pool.
  const pool =
    zone !== undefined && monstersInZone(allMonsters, zone).length > 0
      ? monstersInZone(allMonsters, zone)
      : allMonsters;

  const [
    tierMultiplierValue,
    tierMsReductionValue,
    minimumAttackMsValue,
    rewardsValue,
    monsterPowerValue,
  ] = await Promise.all([
    getBalanceValue(ctx, "tierScaleMultiplier"),
    getBalanceValue(ctx, "tierScaleMsReduction"),
    getBalanceValue(ctx, "minAttackMs"),
    getBalanceValue(ctx, "autoBattleRewards"),
    getBalanceValue(ctx, "monsterPowerMultiplier"),
  ]);
  const monsterPower = readMonsterPowerMultiplier(monsterPowerValue);

  const monster = scaleMonster(
    pickWeightedMonster(pool),
    tier,
    readTierMultiplier(tierMultiplierValue),
    readTierMsReduction(tierMsReductionValue),
    readMinimumAttackMs(minimumAttackMsValue)
  );
  const rewards = readAutoBattleRewards(rewardsValue);
  const now = Date.now();
  const eventMultipliers = await getActiveEventMultipliers(ctx, now);
  const balance = await readCombatBalance(ctx);
  const resolvedEquipmentBonuses =
    equipmentBonuses ?? (await getEquippedStatBonuses(ctx, player._id));
  const [weapon, armor, combatBoosts, passives] = await Promise.all([
    getEquippedWeapon(ctx, player._id),
    getEquippedArmorTotals(ctx, player._id),
    getActiveCombatBoosts(ctx, player._id, now),
    getPassiveBonuses(ctx, player._id),
  ]);
  const effectiveStats = {
    str: player.str + resolvedEquipmentBonuses.str + combatBoosts.statBonus.str + passives.stats.str,
    dex: player.dex + resolvedEquipmentBonuses.dex + combatBoosts.statBonus.dex + passives.stats.dex,
    int: player.int + resolvedEquipmentBonuses.int + combatBoosts.statBonus.int + passives.stats.int,
    con: player.con + resolvedEquipmentBonuses.con + combatBoosts.statBonus.con + passives.stats.con,
  };

  const weaponDamage = weapon?.baseDamage ?? 2;
  const scalingStat =
    weapon?.damageStat === "dex"
      ? effectiveStats.dex
      : weapon?.damageStat === "int"
        ? effectiveStats.int
        : effectiveStats.str;
  const rawAttack =
    weaponDamage + scalingStat * balance.statAttackCoeff;
  const isMagical = (weapon?.damageType ?? "physical") === "magical";
  const monsterMagDef = Math.max(
    0,
    monster.int * balance.monsterMagDefIntCoeff
  );
  const playerAttack = Math.max(
    1,
    (isMagical ? Math.max(0, rawAttack - monsterMagDef) : rawAttack) *
      (1 + passives.damagePercent)
  );
  const playerHealth = Math.max(1, Math.max(balance.minPlayerHp, effectiveStats.con * 10) * (1 + passives.healthPercent));
  const playerPhysDefense = Math.max(
    0,
    (armor.defense + effectiveStats.con * balance.physDefConCoeff) *
      (1 + passives.defensePercent)
  );
  const playerMagDefense = Math.max(
    0,
    effectiveStats.int * balance.magDefIntCoeff * (1 + passives.defensePercent)
  );
  const playerAttackSpeed =
    computeAttackSpeed(
      weapon?.attackSpeed ?? 1,
      effectiveStats.dex,
      armor.speedPenalty,
      balance
    ) * (1 + passives.attackSpeedPercent);
  const critChance = Math.min(
    1,
    Math.max(0, (player.luk + resolvedEquipmentBonuses.luk + passives.stats.luk) * balance.lukCritChancePerPoint + passives.critChance)
  );
  const monsterHealth = Math.max(
    1,
    (monster.con * 10 + monster.int * 2) * monsterPower
  );
  const monsterPhysical = Math.max(1, monster.str * 1.2 + monster.dex * 0.5);
  const monsterMagical = Math.max(
    0,
    monster.int * balance.monsterMagicCoeff
  );
  const monsterDamagePerHit =
    (Math.max(0, monsterPhysical - playerPhysDefense) +
      Math.max(0, monsterMagical - playerMagDefense)) *
    monsterPower;
  const playerDamagePerSecond =
    playerAttack *
    playerAttackSpeed *
    (1 + critChance * (balance.critDamageMultiplier - 1));
  const monsterDamagePerSecond = Math.max(
    0,
    monsterDamagePerHit * (1000 / monster.baseMsPerAttack) -
      combatBoosts.regenPerSecond
  );
  const timeToDefeatMonster =
    (monsterHealth / playerDamagePerSecond) * 1000;
  const timeToDefeatPlayer =
    monsterDamagePerSecond > 0
      ? (playerHealth / monsterDamagePerSecond) * 1000
      : Number.MAX_SAFE_INTEGER;
  const won = timeToDefeatMonster <= timeToDefeatPlayer;
  const durationMs = Math.max(
    1_000,
    Math.ceil(
      Math.min(
        won ? timeToDefeatMonster : timeToDefeatPlayer,
        Number.MAX_SAFE_INTEGER - 1
      )
    )
  );

  return {
    won,
    monsterTier: tier,
    monsterType: monster.type,
    monsterName: monster.name,
    monsterMaxHealth: monsterHealth,
    playerMaxHealth: playerHealth,
    monsterDamagePerSecond,
    playerDamagePerSecond,
    goldEarned: won
      ? Math.max(
          0,
          Math.floor(
            (tier * rewards.goldPerTier +
              Math.random() * (rewards.goldVariance + 1)) *
              eventMultipliers.goldMultiplier *
              passives.goldMultiplier
          )
        )
      : 0,
    experienceEarned: won
      ? Math.max(
          0,
          Math.floor(
            (tier * rewards.experiencePerTier +
              Math.random() * (rewards.experienceVariance + 1)) *
              eventMultipliers.experienceMultiplier *
              combatBoosts.xpMultiplier *
              passives.xpMultiplier
          )
        )
      : 0,
    durationMs,
  };
}

/**
 * Apply a server-resolved regular fight result to the player's progression.
 */
export async function settleRegularFight(
  ctx: MutationCtx,
  args: {
    playerId: PlayerId;
    monsterTier: number;
    monsterType: string;
    won: boolean;
    settlementKey: string;
    monsterZone?: CombatZone;
    goldEarned?: number;
    experienceEarned?: number;
  }
) {
  const settlement = await settleCombatFight(ctx, {
    playerId: args.playerId,
    settlementKey: args.settlementKey,
    sourceType: "monster",
    sourceId: args.monsterType,
    tier: args.monsterTier,
    won: args.won,
    ...(args.monsterZone === undefined
      ? {}
      : { monsterZone: args.monsterZone }),
    rewardOverride:
      args.won &&
      args.goldEarned !== undefined &&
      args.experienceEarned !== undefined
      ? {
          goldEarned: args.goldEarned,
          experienceEarned: args.experienceEarned,
        }
      : undefined,
  });
  const player = await ctx.db.get(args.playerId);
  return {
    ...settlement,
    playerLevel: player ? await calculateCharacterLevel(ctx, player) : 0,
  };
}

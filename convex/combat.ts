import type { MutationCtx, QueryCtx } from "./_generated/server";
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
import type { Infer } from "convex/values";
import type { battleAttackTimingValidator } from "./taskTiming";

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
 * tune it live.
 */
export const DEFAULT_MONSTER_POWER_MULTIPLIER = 1;

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
  playerAttackSpeed?: number;
  attackTiming?: Infer<typeof battleAttackTimingValidator>;
  goldEarned?: number;
  experienceEarned?: number;
  durationMs: number;
}

export async function readPlayerCombatProfile(
  ctx: QueryCtx | MutationCtx,
  player: Player,
  now?: number,
  equipmentBonuses?: EquipmentStatBonuses
) {
  const [bonuses, weapon, armor, passives, balance] = await Promise.all([
    equipmentBonuses ?? getEquippedStatBonuses(ctx, player._id),
    getEquippedWeapon(ctx, player._id),
    getEquippedArmorTotals(ctx, player._id),
    getPassiveBonuses(ctx, player._id),
    readCombatBalance(ctx),
  ]);
  // Character queries show permanent/equipped stats without a wall-clock dependency.
  const boosts = now === undefined
    ? null
    : await getActiveCombatBoosts(ctx, player._id, now, balance);
  const effectiveStats = {
    str: player.str + bonuses.str + passives.stats.str + (boosts?.statBonus.str ?? 0),
    dex: player.dex + bonuses.dex + passives.stats.dex + (boosts?.statBonus.dex ?? 0),
    int: player.int + bonuses.int + passives.stats.int + (boosts?.statBonus.int ?? 0),
    luk: player.luk + bonuses.luk + passives.stats.luk + (boosts?.statBonus.luk ?? 0),
    con: player.con + bonuses.con + passives.stats.con + (boosts?.statBonus.con ?? 0),
  };
  const scalingStat = weapon?.damageStat === "dex"
    ? effectiveStats.dex
    : weapon?.damageStat === "int"
      ? effectiveStats.int
      : effectiveStats.str;
  const baseAttack = (weapon?.baseDamage ?? 2) + scalingStat * balance.statAttackCoeff;
  const damageMultiplier = (1 + passives.damagePercent) *
    (1 + (weapon?.element ? (passives.elements[weapon.element] ?? 0) : 0));
  const combatStats = {
    health: Math.max(1, Math.max(balance.minPlayerHp, effectiveStats.con * 10) * (1 + passives.healthPercent)),
    attack: Math.max(1, baseAttack * damageMultiplier),
    defense: Math.max(0, (armor.defense + effectiveStats.con * balance.physDefConCoeff) * (1 + passives.defensePercent)),
    magicalDefense: Math.max(0, effectiveStats.int * balance.magDefIntCoeff * (1 + passives.defensePercent)),
    attackSpeed: computeAttackSpeed(weapon?.attackSpeed ?? 1, effectiveStats.dex, armor.speedPenalty, balance) *
      (1 + passives.attackSpeedPercent),
    critChance: Math.min(1, Math.max(0, effectiveStats.luk * balance.lukCritChancePerPoint + passives.critChance)) * 100,
    critDamageMultiplier: balance.critDamageMultiplier,
    attackSpeedMultiplier: balance.attackSpeedMultiplier,
    damageType: weapon?.damageType ?? "physical",
  };
  return { bonuses, weapon, armor, passives, balance, boosts, effectiveStats, baseAttack, damageMultiplier, combatStats };
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
  const profile = await readPlayerCombatProfile(ctx, player, now, equipmentBonuses);
  const { balance, passives, combatStats } = profile;
  const isMagical = combatStats.damageType === "magical";
  const monsterMagDef = Math.max(
    0,
    monster.int * balance.monsterMagDefIntCoeff
  );
  const playerAttack = Math.max(
    1,
    (isMagical ? Math.max(0, profile.baseAttack - monsterMagDef) : profile.baseAttack) *
      profile.damageMultiplier
  );
  const playerHealth = combatStats.health;
  const critChance = combatStats.critChance / 100;
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
    (Math.max(0, monsterPhysical - combatStats.defense) +
      Math.max(0, monsterMagical - combatStats.magicalDefense)) *
    monsterPower;
  const playerDamagePerHit =
    playerAttack * (1 + critChance * (balance.critDamageMultiplier - 1));
  const playerIntervalMs = Math.ceil(1000 / combatStats.attackSpeed);
  const monsterIntervalMs = monster.baseMsPerAttack;
  const monsterNetDamagePerHit = Math.max(
    0,
    monsterDamagePerHit - (profile.boosts?.regenPerSecond ?? 0) * monsterIntervalMs / 1_000
  );
  const playerDamagePerSecond = playerDamagePerHit * (1000 / playerIntervalMs);
  const monsterDamagePerSecond = monsterNetDamagePerHit * (1000 / monsterIntervalMs);
  const timeToDefeatMonster =
    Math.ceil(monsterHealth / playerDamagePerHit) * playerIntervalMs;
  const timeToDefeatPlayer =
    monsterNetDamagePerHit > 0
      ? Math.ceil(playerHealth / monsterNetDamagePerHit) * monsterIntervalMs
      : Number.MAX_SAFE_INTEGER;
  const won = timeToDefeatMonster <= timeToDefeatPlayer;
  const durationMs = Math.max(
    1,
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
    playerAttackSpeed: combatStats.attackSpeed,
    attackTiming: {
      playerIntervalMs, monsterIntervalMs, playerDamagePerHit,
      monsterDamagePerHit: monsterNetDamagePerHit,
    },
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
              (profile.boosts?.xpMultiplier ?? 1) *
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

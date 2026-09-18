import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { calculatePlayerLevel } from "./bossData";
import {
  getEquippedStatBonuses,
  type EquipmentStatBonuses,
} from "./items";
import { getActiveEventMultipliers, settleCombatFight } from "./loot";

type PlayerId = Id<"players">;
type Player = Doc<"players">;
type Monster = Doc<"monsters">;

export const DEFAULT_AUTO_BATTLE_REWARDS = {
  goldPerTier: 100,
  goldVariance: 50,
  experiencePerTier: 50,
  experienceVariance: 25,
};

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
  equipmentBonuses?: EquipmentStatBonuses
): Promise<AutoBattleResult> {
  const monsters = await ctx.db.query("monsters").collect();
  if (monsters.length === 0) {
    throw new Error("Regular monsters are not configured");
  }

  const [
    tierMultiplierValue,
    tierMsReductionValue,
    minimumAttackMsValue,
    rewardsValue,
  ] = await Promise.all([
    getBalanceValue(ctx, "tierScaleMultiplier"),
    getBalanceValue(ctx, "tierScaleMsReduction"),
    getBalanceValue(ctx, "minAttackMs"),
    getBalanceValue(ctx, "autoBattleRewards"),
  ]);

  const monster = scaleMonster(
    pickWeightedMonster(monsters),
    tier,
    readTierMultiplier(tierMultiplierValue),
    readTierMsReduction(tierMsReductionValue),
    readMinimumAttackMs(minimumAttackMsValue)
  );
  const rewards = readAutoBattleRewards(rewardsValue);
  const eventMultipliers = await getActiveEventMultipliers(ctx, Date.now());
  const resolvedEquipmentBonuses =
    equipmentBonuses ?? (await getEquippedStatBonuses(ctx, player._id));
  const effectiveStats = {
    str: player.str + resolvedEquipmentBonuses.str,
    dex: player.dex + resolvedEquipmentBonuses.dex,
    int: player.int + resolvedEquipmentBonuses.int,
    con: player.con + resolvedEquipmentBonuses.con,
  };

  const playerHealth = Math.max(1, effectiveStats.con * 10 + effectiveStats.int * 2);
  const playerAttack = Math.max(
    1,
    effectiveStats.str * 1.2 + effectiveStats.dex * 0.5
  );
  const playerDefense = Math.max(
    0,
    effectiveStats.con * 0.8 + effectiveStats.int * 0.3
  );
  const playerAttackSpeed = Math.max(
    0.5,
    (effectiveStats.dex - 10) * 0.1 + 1
  );
  const monsterHealth = Math.max(1, monster.con * 10 + monster.int * 2);
  const monsterAttack = Math.max(1, monster.str * 1.2 + monster.dex * 0.5);
  const monsterDamage = Math.max(1, monsterAttack - playerDefense);
  const playerDamagePerSecond = playerAttack * playerAttackSpeed;
  const monsterDamagePerSecond =
    monsterDamage * (1000 / monster.baseMsPerAttack);
  const timeToDefeatMonster =
    (monsterHealth / playerDamagePerSecond) * 1000;
  const timeToDefeatPlayer = playerHealth / monsterDamagePerSecond * 1000;
  const won = timeToDefeatMonster <= timeToDefeatPlayer;
  const durationMs = Math.max(
    1_000,
    Math.ceil(won ? timeToDefeatMonster : timeToDefeatPlayer)
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
              eventMultipliers.goldMultiplier
          )
        )
      : 0,
    experienceEarned: won
      ? Math.max(
          0,
          Math.floor(
            (tier * rewards.experiencePerTier +
              Math.random() * (rewards.experienceVariance + 1)) *
              eventMultipliers.experienceMultiplier
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
    playerLevel: player ? calculatePlayerLevel(player) : 0,
  };
}

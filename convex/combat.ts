import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readBalanceMap } from "./balance";
import type { Doc, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  computeAttackSpeed,
  getActiveCombatBoosts,
  getEquippedProfile,
  getEquippedWeapon,
  readCombatBalance,
  type EquipmentStatBonuses,
  type ResolvedEquipment,
} from "./items";
import { getPassiveBonuses } from "./passiveTree";
import {
  getRebirthStatBonuses,
  readRebirthStatBonusPercent,
  rebirthStatMultiplier,
} from "./rebirth";
import { getActiveEventMultipliers, settleCombatFight } from "./loot";
import { getGuildBonusesForPlayer } from "./guilds";
import { conRegenPerSecond, readHpRegenBalance, resolveCurrentHp } from "./playerHp";
import type { PvpEquipmentBundle } from "./pvpLoadout";
import {
  abilityCastsLog,
  abilityWeaponFrom,
  awardAbilityWisdomXp,
  buildAbilityCombatState,
  castDueAbilities,
  damageWithBuffs,
  mitigateWithBuffs,
  type AbilityCombatState,
} from "./abilityCombat";
import { query } from "./_generated/server";
import { requirePlayerRead } from "./playerAuth";
import { v } from "convex/values";
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
  playerStartingHp?: number;
  playerEndingHp?: number;
  conRegenPerSecond?: number;
  // Total in-fight healing per second (CON regen + heal-over-time boosts),
  // stored on the encounter so the live projection heals on its own schedule
  // instead of netting damage per hit.
  regenPerSecond?: number;
  monsterDamagePerSecond: number;
  playerDamagePerSecond: number;
  playerAttackSpeed?: number;
  attackTiming?: Infer<typeof battleAttackTimingValidator>;
  // Ability casts performed during the encounter, for idempotent wisdom XP
  // award at settlement.
  abilityCasts?: Array<{ abilityId: string; level: number; casts: number }>;
  goldEarned?: number;
  experienceEarned?: number;
  durationMs: number;
}

/**
 * Where a combat profile takes its equipment from.
 *
 * `live` reads what the player has equipped right now. `resolved` takes
 * equipment the caller already resolved — a PvP loadout, for instance — so
 * the profile does not read it again. A resolved source must be complete:
 * bonuses, armor, ward, and weapon. Anything missing would silently drop a
 * stat from the fight.
 */
export type CombatProfileSource =
  | { kind: "live" }
  | { kind: "resolved"; equipment: ResolvedEquipment };

export async function readPlayerCombatProfile(
  ctx: QueryCtx | MutationCtx,
  player: Player,
  options: {
    /**
     * Wall-clock instant for time-based boosts. Omit it for a clock-free
     * profile (character sheets show permanent stats only).
     */
    now?: number;
    /** Where the equipment comes from. Defaults to what is equipped now. */
    source?: CombatProfileSource;
  } = {}
) {
  const { now, source } = options;
  const resolved = source?.kind === "resolved" ? source.equipment : null;
  const [equipped, liveWeapon, passives, balance, guildBonuses] = await Promise.all([
    resolved
      ? null
      : getEquippedProfile(ctx, player._id),
    resolved
      ? null
      : getEquippedWeapon(ctx, player._id),
    getPassiveBonuses(ctx, player._id),
    readCombatBalance(ctx),
    getGuildBonusesForPlayer(ctx, player._id),
  ]);
  const weapon = resolved?.weapon ?? liveWeapon;
  const bonuses = resolved?.bonuses ?? equipped?.bonuses ?? {
    str: 0, dex: 0, int: 0, luk: 0, con: 0,
  };
  const armor = resolved?.armor ?? equipped?.armor ?? { defense: 0, speedPenalty: 0 };
  const ward = resolved?.ward ?? equipped?.ward ?? {
    light: 0, dark: 0, water: 0, fire: 0, wind: 0, earth: 0,
  };
  // Character queries show permanent/equipped stats without a wall-clock dependency.
  const boosts = now === undefined
    ? null
    : await getActiveCombatBoosts(ctx, player._id, now, balance);
  // Permanent prestige: each stat banked at the rebirth requirement adds
  // another bonusPercent to that stat's effective value, so the bonus flows
  // into everything the stat does (damage, speed, HP, defense, crit).
  // Base levels (player.str, player.dex, ...) stay untouched so level
  // breakpoints and XP curves never shift — only effectiveness scales.
  // Skips the balance read entirely for players with no banked bonuses.
  const rebirthCounts = getRebirthStatBonuses(player);
  const bankedTotal =
    rebirthCounts.str +
    rebirthCounts.dex +
    rebirthCounts.int +
    rebirthCounts.luk +
    rebirthCounts.con +
    rebirthCounts.wis;
  const rebirthBonusPercent =
    bankedTotal > 0 ? await readRebirthStatBonusPercent(ctx) : 0;
  const guildStatMultiplier = 1 + (guildBonuses.statBonusPercent ?? 0) / 100;
  const effectiveStats = {
    str: (player.str + bonuses.str + passives.stats.str + (boosts?.statBonus.str ?? 0)) * rebirthStatMultiplier(rebirthCounts.str, rebirthBonusPercent) * guildStatMultiplier,
    dex: (player.dex + bonuses.dex + passives.stats.dex + (boosts?.statBonus.dex ?? 0)) * rebirthStatMultiplier(rebirthCounts.dex, rebirthBonusPercent) * guildStatMultiplier,
    int: (player.int + bonuses.int + passives.stats.int + (boosts?.statBonus.int ?? 0)) * rebirthStatMultiplier(rebirthCounts.int, rebirthBonusPercent) * guildStatMultiplier,
    luk: (player.luk + bonuses.luk + passives.stats.luk + (boosts?.statBonus.luk ?? 0)) * rebirthStatMultiplier(rebirthCounts.luk, rebirthBonusPercent) * guildStatMultiplier,
    con: (player.con + bonuses.con + passives.stats.con + (boosts?.statBonus.con ?? 0)) * rebirthStatMultiplier(rebirthCounts.con, rebirthBonusPercent) * guildStatMultiplier,
    wis: (player.wis ?? 1) * rebirthStatMultiplier(rebirthCounts.wis, rebirthBonusPercent) * guildStatMultiplier,
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
  // CON-based HP regen (% of max HP/sec, balance-tuned). Ticks as real healing
  // in fights (auto-battle and boss) and at the same rate out of combat via
  // playerHp.ts.
  let conRegen = 0;
  if (now !== undefined) {
    const regenBalance = await readHpRegenBalance(ctx);
    conRegen = conRegenPerSecond(
      Math.max(1, Math.ceil(combatStats.health)),
      effectiveStats.con,
      regenBalance
    );
  }
  return { bonuses, weapon, armor, ward, passives, balance, boosts, effectiveStats, baseAttack, damageMultiplier, combatStats, conRegenPerSecond: conRegen };
}

/**
 * Event-driven resolution for encounters where the player has usable
 * abilities. Auto-attacks, monster swings, ability casts, and continuous
 * regeneration share one timeline so cooldowns land at the right moments and
 * heals can be gated on missing HP. Abilities cast as soon as they are off
 * cooldown; heals only cast when they will not overheal.
 */
async function simulateAbilityBattle(input: {
  state: AbilityCombatState;
  monster: { element?: string; defense: number; magicalDefense: number };
  monsterHealth: number;
  playerStartingHp: number;
  playerMaxHp: number;
  playerIntervalMs: number;
  playerDamagePerHit: number;
  monsterIntervalMs: number;
  monsterDamagePerHit: number;
  regenPerSecond: number;
}): Promise<{
  won: boolean;
  durationMs: number;
  playerEndingHp: number;
  playerDamagePerSecond: number;
  abilityCasts: Array<{ abilityId: string; level: number; casts: number }>;
}> {
  const {
    state,
    monster,
    monsterHealth,
    playerStartingHp,
    playerMaxHp,
    playerIntervalMs,
    playerDamagePerHit,
    monsterIntervalMs,
    monsterDamagePerHit,
    regenPerSecond,
  } = input;

  const runtimes = state.runtimes;
  const buffs = state.buffs;
  const weapon = {
    weaponType: state.weaponType,
    element: state.weaponElement,
  };

  let playerHp = playerStartingHp;
  let remainingMonsterHp = monsterHealth;
  let now = 0;
  let nextPlayerAttack = playerIntervalMs;
  let nextMonsterAttack = monsterIntervalMs;
  let autoDamage = 0;
  let abilityDamage = 0;
  // Drop expired buffs once the list grows, so long fights that repeatedly
  // re-cast a buff cannot accumulate unbounded dead entries.
  const pruneBuffs = () => {
    if (buffs.length < 8) return;
    for (let index = buffs.length - 1; index >= 0; index -= 1) {
      if (buffs[index].until <= now) buffs.splice(index, 1);
    }
  };
  const retryMs = Math.max(250, playerIntervalMs);
  const maxEvents = 50_000;

  for (let event = 0; event < maxEvents; event += 1) {
    if (playerHp <= 0 || remainingMonsterHp <= 0) break;

    const nextEventAt = Math.min(
      nextPlayerAttack,
      nextMonsterAttack,
      ...runtimes.map((runtime) => runtime.nextAt)
    );
    if (!Number.isFinite(nextEventAt)) break;

    if (nextEventAt > now) {
      if (regenPerSecond > 0) {
        playerHp = Math.min(
          playerMaxHp,
          playerHp + (regenPerSecond * (nextEventAt - now)) / 1_000
        );
      }
      now = nextEventAt;
    }
    pruneBuffs();

    // Abilities resolve before swings: a lethal cast wins the tie against a
    // monster swing scheduled at the same millisecond. The shared core keeps
    // this identical to boss/arena/raid casting.
    const castOutcome = castDueAbilities({
      state,
      at: now,
      retryAt: now + retryMs,
      playerHp,
      playerMaxHp,
      enemyHp: remainingMonsterHp,
      enemyStats: {
        defense: monster.defense,
        magicalDefense: monster.magicalDefense,
      },
      weapon,
    });
    playerHp = castOutcome.playerHp;
    remainingMonsterHp = castOutcome.enemyHp;
    abilityDamage += castOutcome.damageDealt;

    if (remainingMonsterHp <= 0) break;

    if (nextPlayerAttack <= now) {
      const damage = damageWithBuffs(playerDamagePerHit, buffs, now);
      remainingMonsterHp -= damage;
      autoDamage += damage;
      nextPlayerAttack = now + playerIntervalMs;
      if (remainingMonsterHp <= 0) break;
    }

    if (nextMonsterAttack <= now) {
      const damage = mitigateWithBuffs(monsterDamagePerHit, buffs, now);
      playerHp -= damage;
      nextMonsterAttack = now + monsterIntervalMs;
    }
  }

  const won = remainingMonsterHp <= 0 && playerHp > 0;
  const durationMs = Math.max(1, Math.ceil(now));
  return {
    won,
    durationMs,
    playerEndingHp: won
      ? Math.min(playerMaxHp, Math.max(1, Math.ceil(playerHp)))
      : 0,
    playerDamagePerSecond:
      (autoDamage + abilityDamage) / (durationMs / 1_000),
    abilityCasts: abilityCastsLog(state),
  };
}

/**
 * Resolve one regular fight without accepting client-calculated combat or rewards.
 */
export async function simulateRegularBattle(
  ctx: MutationCtx,
  player: Player,
  tier: number,
  options: {
    /** Zone to hunt in. Omit to hunt the full monster pool. */
    zone?: CombatZone;
    /** HP the fight starts from. Omit to start at full. */
    startingHp?: number;
  } = {}
): Promise<AutoBattleResult> {
  const { zone, startingHp: playerStartingHp } = options;
  // Bounded catalog read: monster pool is small content (~9 rows); take()
  // keeps a hard cap so future content growth can't turn encounter rolls
  // into an unbounded scan.
  const allMonsters = await ctx.db.query("monsters").take(500);
  if (allMonsters.length === 0) {
    throw new Error("Regular monsters are not configured");
  }
  // Tasks queued before zones existed carry no zone and hunt the full pool.
  const pool =
    zone !== undefined && monstersInZone(allMonsters, zone).length > 0
      ? monstersInZone(allMonsters, zone)
      : allMonsters;

  const balanceMap = await readBalanceMap(ctx, [
    "tierScaleMultiplier",
    "tierScaleMsReduction",
    "minAttackMs",
    "autoBattleRewards",
    "monsterPowerMultiplier",
  ]);
  const tierMultiplierValue = balanceMap.get("tierScaleMultiplier");
  const tierMsReductionValue = balanceMap.get("tierScaleMsReduction");
  const minimumAttackMsValue = balanceMap.get("minAttackMs");
  const rewardsValue = balanceMap.get("autoBattleRewards");
  const monsterPowerValue = balanceMap.get("monsterPowerMultiplier");
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
  const [eventMultipliers, guildBonuses] = await Promise.all([
    getActiveEventMultipliers(ctx, now),
    getGuildBonusesForPlayer(ctx, player._id),
  ]);
  const profile = await readPlayerCombatProfile(ctx, player, { now });
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
  const playerMaxHp = Math.max(1, Math.ceil(playerHealth));
  const startingHp =
    playerStartingHp === undefined
      ? playerMaxHp
      : Math.min(playerMaxHp, Math.max(0, playerStartingHp));
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
  // Elemental ward: attuned armor augments mitigate matching-element hits.
  const attackerElement =
    typeof monster.element === "string" ? monster.element : null;
  const wardAmount =
    attackerElement !== null &&
    Object.prototype.hasOwnProperty.call(profile.ward, attackerElement)
      ? profile.ward[attackerElement as keyof typeof profile.ward]
      : 0;
  const wardedDamagePerHit = Math.max(0, monsterDamagePerHit - wardAmount);
  const playerDamagePerHit =
    playerAttack * (1 + critChance * (balance.critDamageMultiplier - 1));
  const playerIntervalMs = Math.ceil(1000 / combatStats.attackSpeed);
  const monsterIntervalMs = monster.baseMsPerAttack;
  // CON regen + heal-over-time boosts tick as real healing alongside monster
  // hits (same model as boss fights): HP falls in discrete hits and recovers
  // continuously, so a build that out-regens the threat climbs back toward
  // full instead of pinning at its starting HP. Healing runs on its own
  // schedule rather than netting into each hit, which keeps win/loss timing
  // identical to the equivalent mitigation math while letting future healing
  // sources tick independently of damage.
  const totalRegenPerSecond =
    profile.conRegenPerSecond + (profile.boosts?.regenPerSecond ?? 0);
  const monsterGrossDamagePerHit = wardedDamagePerHit;
  const regenPerMonsterInterval =
    (totalRegenPerSecond * monsterIntervalMs) / 1_000;
  // Death timing only: the first hit instant whose discrete damage exceeds
  // starting HP plus healing accrued to that point. Equivalent to netting
  // per hit, kept separate so the stored encounter carries gross damage.
  const monsterNetDamagePerHit = Math.max(
    0,
    monsterGrossDamagePerHit - regenPerMonsterInterval
  );
  const closedFormPlayerDamagePerSecond =
    playerDamagePerHit * (1000 / playerIntervalMs);
  const monsterDamagePerSecond = monsterGrossDamagePerHit * (1000 / monsterIntervalMs);
  const timeToDefeatMonster =
    Math.ceil(monsterHealth / playerDamagePerHit) * playerIntervalMs;
  const timeToDefeatPlayer =
    monsterNetDamagePerHit > 0 && startingHp > 0
      ? Math.ceil(startingHp / monsterNetDamagePerHit) * monsterIntervalMs
      : monsterNetDamagePerHit <= 0
        ? Number.MAX_SAFE_INTEGER
        : 1;
  const closedFormWon =
    startingHp > 0 && timeToDefeatMonster <= timeToDefeatPlayer;
  const closedFormDurationMs = Math.max(
    1,
    Math.ceil(
      Math.min(
        closedFormWon ? timeToDefeatMonster : timeToDefeatPlayer,
        Number.MAX_SAFE_INTEGER - 1
      )
    )
  );

  const monsterHitsTaken = Math.floor(closedFormDurationMs / monsterIntervalMs);
  const grossDamageTaken = monsterHitsTaken * monsterGrossDamagePerHit;
  const healed = (totalRegenPerSecond * closedFormDurationMs) / 1_000;
  const closedFormPlayerEndingHp = closedFormWon
    ? Math.min(
      playerMaxHp,
      Math.max(1, Math.ceil(startingHp - grossDamageTaken + healed))
    )
    : 0;

  // Equipped abilities add their own cooldown timeline. The cheap take(1)
  // keeps the closed-form path (and its exact timing) for the common case of
  // a player with no abilities equipped.
  let won = closedFormWon;
  let durationMs = closedFormDurationMs;
  let playerEndingHp = closedFormPlayerEndingHp;
  let playerDamagePerSecond = closedFormPlayerDamagePerSecond;
  let abilityCasts: Array<{ abilityId: string; level: number; casts: number }> = [];
  const hasEquippedAbilities =
    (
      await ctx.db
        .query("playerEquippedAbilities")
        .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
        .take(1)
    ).length > 0;
  if (hasEquippedAbilities) {
    const abilityState = await buildAbilityCombatState(
      ctx,
      player._id,
      abilityWeaponFrom(profile.weapon),
      { unit: "ms" }
    );
    if (abilityState.runtimes.length > 0) {
      const outcome = await simulateAbilityBattle({
        state: abilityState,
        monster: {
          element: monster.element,
          defense: 0,
          magicalDefense: monsterMagDef,
        },
        monsterHealth,
        playerStartingHp: startingHp,
        playerMaxHp,
        playerIntervalMs,
        playerDamagePerHit,
        monsterIntervalMs,
        monsterDamagePerHit: monsterGrossDamagePerHit,
        regenPerSecond: totalRegenPerSecond,
      });
      won = outcome.won;
      durationMs = outcome.durationMs;
      playerEndingHp = outcome.playerEndingHp;
      playerDamagePerSecond = outcome.playerDamagePerSecond;
      abilityCasts = outcome.abilityCasts;
    }
  }

  return {
    won,
    monsterTier: tier,
    monsterType: monster.type,
    monsterName: monster.name,
    monsterMaxHealth: monsterHealth,
    playerMaxHealth: playerMaxHp,
    playerStartingHp: Math.ceil(startingHp),
    playerEndingHp,
    conRegenPerSecond: profile.conRegenPerSecond,
    regenPerSecond: totalRegenPerSecond,
    monsterDamagePerSecond,
    playerDamagePerSecond,
    playerAttackSpeed: combatStats.attackSpeed,
    attackTiming: {
      playerIntervalMs, monsterIntervalMs, playerDamagePerHit,
      monsterDamagePerHit: monsterGrossDamagePerHit,
    },
    ...(abilityCasts.length > 0 ? { abilityCasts } : {}),
    goldEarned: won
      ? Math.max(
          0,
          Math.floor(
            (tier * rewards.goldPerTier +
              Math.random() * (rewards.goldVariance + 1)) *
              eventMultipliers.goldMultiplier *
              passives.goldMultiplier *
              (1 + (guildBonuses.goldBonusPercent ?? 0) / 100)
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
              passives.xpMultiplier *
              (1 + (guildBonuses.xpBonusPercent ?? 0) / 100)
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
    abilityCasts?: Array<{ abilityId: string; level: number; casts: number }>;
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
  // Wisdom XP is awarded once per settled fight. Fights are deduped by
  // settlementKey, so re-delivery cannot double-award.
  if (!settlement.duplicate && args.abilityCasts && args.abilityCasts.length > 0) {
    await awardAbilityWisdomXp(ctx, args.playerId, args.abilityCasts);
  }
  const player = await ctx.db.get(args.playerId);
  return {
    ...settlement,
    playerLevel: player ? await calculateCharacterLevel(ctx, player) : 0,
  };
}

/**
 * Persistent HP bar for the HUD: current HP with out-of-combat regen applied
 * as a read-only projection from the last combat write. Regen is a pure
 * function of `currentHpUpdatedAt`, so nothing has to persist it on a cadence;
 * fights and boss strikes are the only writers.
 */
export const getHpStatus = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayerRead(ctx, playerId);
    const now = Date.now();
    const profile = await readPlayerCombatProfile(ctx, player, { now });
    const maxHp = Math.max(1, Math.ceil(profile.combatStats.health));
    const regenBalance = await readHpRegenBalance(ctx);
    const inCombat =
      (await ctx.db
        .query("playerTasks")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "active")
        )
        .first())?.taskType === "battle" ||
      (await ctx.db
        .query("bossSessions")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "open")
        )
        .first()) !== null;
    const state = resolveCurrentHp(
      player,
      maxHp,
      profile.effectiveStats.con,
      regenBalance,
      now,
      inCombat
    );
    const boostRegen = profile.boosts?.regenPerSecond ?? 0;
    return {
      currentHp: Math.ceil(state.currentHp),
      maxHp: state.maxHp,
      inCombat,
      conRegenPerSecond: conRegenPerSecond(maxHp, profile.effectiveStats.con, regenBalance),
      boostRegenPerSecond: boostRegen,
      totalInCombatRegenPerSecond:
        conRegenPerSecond(maxHp, profile.effectiveStats.con, regenBalance) + boostRegen,
    };
  },
});

import { readRebirthRewardBonuses } from "./rebirth";
import { readBalanceValue } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureBossForTier } from "./bossData";
import {
  findFightHistory,
  isPlayerSettlementKey,
  recordFightHistory,
} from "./fightHistory";
import type { CombatZone } from "./zones";
import { grantItemToInventory, getActiveCombatBoosts, getEquippedWeapon, readInventoryForGrants } from "./items";
import { grantInfusionDrops, rollBatchBonusDrops } from "./infusion";
import { awardAbilityWisdomXp } from "./abilityCombat";
import { awardCrossedAchievements } from "./achievements";
import { getPassiveBonuses } from "./passiveTree";
import { accrueGuildXpFromEarned, getGuildBonusesForPlayer } from "./guilds";
import { progressWeeklyObjectives } from "./guildObjectives";
import {
  getSkillXpRequiredForLevel,
  readSkillXpBase,
} from "./skillProgression";

type TrainableStat = "str" | "dex" | "int" | "con";

/**
 * Split a fight's XP across the wielded weapon's stats (70/30 weapon/con,
 * 35/35/30 unarmed) into per-stat XP pools leveled with the skill XP curve.
 * Exported for raid settlements, which pay boss-tier XP without player loot.
 */
export function applyCombatStatXp(
  player: Doc<"players">,
  weaponDamageStat: string | null,
  experienceEarned: number,
  xpBase: number
) {
  const splits: Record<TrainableStat, number> =
    weaponDamageStat === "dex"
      ? { str: 0, dex: 0.7, int: 0, con: 0.3 }
      : weaponDamageStat === "int"
        ? { str: 0, dex: 0, int: 0.7, con: 0.3 }
        : weaponDamageStat === "str"
          ? { str: 0.7, dex: 0, int: 0, con: 0.3 }
          : { str: 0.35, dex: 0.35, int: 0, con: 0.3 };
  const pools = {
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    con: 0,
    ...(player.statXp ?? {}),
  };
  const levels: Partial<Record<TrainableStat, number>> = {};
  for (const stat of ["str", "dex", "int", "con"] as const) {
    const share = splits[stat];
    if (share <= 0) continue;
    let level = player[stat];
    let pool = pools[stat] + experienceEarned * share;
    let required = getSkillXpRequiredForLevel(level, xpBase);
    while (pool >= required) {
      pool -= required;
      level += 1;
      required += level * xpBase;
      if (!Number.isSafeInteger(required)) {
        throw new Error("Stat XP requirement exceeds the supported limit");
      }
    }
    levels[stat] = level;
    pools[stat] = pool;
  }
  return { ...levels, statXp: pools };
}

export async function awardCombatStatXp(
  ctx: MutationCtx,
  playerId: PlayerId,
  experienceEarned: number
) {
  if (!Number.isFinite(experienceEarned) || experienceEarned <= 0) return;
  const [weapon, player, xpBaseValue] = await Promise.all([
    getEquippedWeapon(ctx, playerId),
    ctx.db.get(playerId),
    getBalanceValue(ctx, "skillXpPerLevel"),
  ]);
  if (!player) throw new Error("Player not found");
  await ctx.db.patch(playerId, {
    ...applyCombatStatXp(player, weapon?.damageStat ?? null, experienceEarned, readSkillXpBase(xpBaseValue)),
    lastUpdated: Date.now(),
  });
}

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;
type CombatSourceType = "monster" | "boss";

type CombatSettlementArgs = {
  playerId: PlayerId;
  settlementKey: string;
  sourceType: CombatSourceType;
  sourceId: string;
  tier: number;
  won: boolean;
  monsterZone?: CombatZone;
  rewardOverride?: {
    goldEarned: number;
    experienceEarned: number;
  };
};

export type LootSummary = {
  itemId: Id<"items">;
  itemName: string;
  quantity: number;
  pending: number;
  purpose: "augmentation" | "boss-catalyst";
  // Stable icon-resolution fields. itemId above is a Convex document id
  // (opaque, substring matching on it is meaningless), so the client resolves
  // icons from these instead. Optional so loot summaries recorded before this
  // field existed still validate; clients fall back to itemName matching.
  itemSlug?: string;
  itemFamily?: string;
  category?: string;
};

export type CombatSettlement = {
  recorded: boolean;
  duplicate: boolean;
  goldEarned: number;
  experienceEarned: number;
  loot: LootSummary[];
};

const DEFAULT_BOSS_GOLD_PER_TIER = 500;
const DEFAULT_BOSS_EXPERIENCE_PER_TIER = 250;

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return await readBalanceValue(ctx, key);
}

function readNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export async function getActiveEventMultipliers(ctx: DatabaseCtx, now: number) {
  // Range on endTime so finished events cost nothing however many accumulate,
  // then a start check in JS for events scheduled ahead. Doesn't trust the
  // maintained isActive flag, which can go stale.
  const unfinished = await ctx.db
    .query("gameEvents")
    .withIndex("by_endTime", (q) => q.gt("endTime", now))
    .take(100);
  const events = unfinished.filter((event) => event.startTime <= now);
  let goldMultiplier = 1;
  let experienceMultiplier = 1;
  for (const event of events) {
    if (event.effectType === "gold-multiplier") {
      goldMultiplier *= event.effectValue;
    } else if (event.effectType === "xp-multiplier") {
      experienceMultiplier *= event.effectValue;
    }
  }
  return { goldMultiplier, experienceMultiplier };
}

async function getLootTable(
  ctx: MutationCtx,
  sourceType: CombatSourceType,
  sourceId: string,
  tier: number
) {
  const exactSource = await ctx.db
    .query("lootSources")
    .withIndex("by_sourceType_and_sourceId_and_tier", (q) =>
      q.eq("sourceType", sourceType).eq("sourceId", sourceId).eq("tier", tier)
    )
    .first();
  const source =
    exactSource ??
    (
      await ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId", (q) =>
          q.eq("sourceType", sourceType).eq("sourceId", sourceId)
        )
        .collect()
    ).find((entry) => entry.tier === undefined);
  if (!source) return null;

  const table = await ctx.db
    .query("lootTables")
    .withIndex("by_lootTableId", (q) =>
      q.eq("lootTableId", source.lootTableId)
    )
    .first();
  if (!table || !table.enabled) return null;
  const entries = await ctx.db
    .query("lootTableEntries")
    .withIndex("by_lootTableId", (q) =>
      q.eq("lootTableId", table.lootTableId)
    )
    .take(100);
  return {
    table,
    entries: entries.filter((entry) => entry.enabled),
  };
}

function randomQuantity(entry: Doc<"lootTableEntries">) {
  const span = entry.maxQuantity - entry.minQuantity + 1;
  return entry.minQuantity + Math.floor(Math.random() * Math.max(1, span));
}

function pickLootEntries(
  entries: Doc<"lootTableEntries">[],
  rollCount: number
) {
  const picked = entries.filter((entry) => entry.guaranteed);
  const chanceEntries = entries.filter((entry) => !entry.guaranteed);
  for (let roll = 0; roll < rollCount; roll += 1) {
    for (const entry of chanceEntries) {
      if (Math.random() <= entry.dropChance) picked.push(entry);
    }
  }
  return picked;
}

export type RolledLoot = { itemId: Id<"items">; quantity: number };

/**
 * Roll a boss loot table without granting anything. Raid kills grant the
 * rolled rows to the guild stash instead of player inventories.
 */
export async function rollBossLoot(
  ctx: MutationCtx,
  bossId: string,
  tier: number
): Promise<RolledLoot[]> {
  const tableData = await getLootTable(ctx, "boss", bossId, tier);
  if (!tableData) return [];
  const entries = pickLootEntries(
    tableData.entries,
    Math.min(100, Math.max(0, tableData.table.rollCount))
  );
  const rolled: RolledLoot[] = [];
  for (const entry of entries) {
    assertValidLootEntry(entry);
    rolled.push({ itemId: entry.itemId, quantity: randomQuantity(entry) });
  }
  return rolled;
}

async function resolveLoot(
  ctx: MutationCtx,
  args: CombatSettlementArgs
): Promise<LootSummary[]> {
  if (!args.won) return [];
  const tableData = await getLootTable(
    ctx,
    args.sourceType,
    args.sourceId,
    args.tier
  );
  if (!tableData) return [];

  const entries = pickLootEntries(
    tableData.entries,
    Math.min(100, Math.max(0, tableData.table.rollCount))
  );
  const summary: LootSummary[] = [];
  for (const entry of entries) {
    assertValidLootEntry(entry);
    const quantity = randomQuantity(entry);
    const item = await ctx.db.get(entry.itemId);
    if (!item) throw new Error("Loot table references a missing item");
    const grant = await grantItemToInventory(ctx, {
      playerId: args.playerId,
      itemId: entry.itemId,
      quantity,
      overflowSource: {
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        settlementKey: args.settlementKey,
      },
    });
    const existing = summary.find((row) => row.itemId === entry.itemId);
    if (existing) {
      existing.quantity += quantity;
      existing.pending += grant.pending;
    } else {
      summary.push({
        itemId: entry.itemId,
        itemName: item.name,
        quantity,
        pending: grant.pending,
        purpose: entry.purpose,
        itemSlug: item.itemId,
        itemFamily: item.itemFamily,
        category: item.category,
      });
    }
    await ctx.db.insert("lootAwards", {
      playerId: args.playerId,
      settlementKey: args.settlementKey,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      tier: args.tier,
      itemId: entry.itemId,
      quantity,
      purpose: entry.purpose,
      status: grant.pending > 0 ? "pending" : "granted",
      createdAt: Date.now(),
    });
  }
  return summary;
}

/**
 * Record tier progress on any combat victory (regular or boss). Queue
 * victories settle server-side, so this is what keeps Best tier / Tier in
 * the stats card current. Idempotent per tier — only provisions a boss
 * record when the best actually increases.
 */
async function recordTierProgress(
  ctx: MutationCtx,
  player: Doc<"players">,
  tier: number
) {
  const previousBest = player.maxTierReached ?? player.currentTier ?? 1;
  const newMaxTier = Math.max(previousBest, tier);
  await ctx.db.patch(player._id, {
    maxTierReached: newMaxTier,
    currentTier: tier,
    lastUpdated: Date.now(),
  });
  if (newMaxTier > previousBest) {
    await ensureBossForTier(ctx, newMaxTier);
  }
}

export async function settleCombatFight(
  ctx: MutationCtx,
  args: CombatSettlementArgs
): Promise<CombatSettlement> {
  if (!args.settlementKey.trim()) {
    throw new Error("Fight settlement key is required");
  }
  // Keys are namespaced per player (`${playerId}:...`). Without this, any
  // caller can pre-claim another player's predictable key and force their
  // later settlement to return as a duplicate with no rewards.
  if (!isPlayerSettlementKey(args.playerId, args.settlementKey)) {
    throw new Error("Fight settlement key must belong to the player");
  }
  if (!Number.isSafeInteger(args.tier) || args.tier < 1) {
    throw new Error("Fight tier must be a positive integer");
  }

  const existingFight = await findFightHistory(ctx, args.settlementKey);
  if (existingFight) {
    const awards = await ctx.db
      .query("lootAwards")
      .withIndex("by_settlementKey", (q) =>
        q.eq("settlementKey", args.settlementKey)
      )
      .collect();
    const pendingRewards = await ctx.db
      .query("pendingRewards")
      .withIndex("by_settlementKey", (q) =>
        q.eq("settlementKey", args.settlementKey)
      )
      .collect();
    const pendingByItemId = new Map<string, number>();
    for (const reward of pendingRewards) {
      if (reward.status !== "pending") continue;
      pendingByItemId.set(
        reward.itemId,
        (pendingByItemId.get(reward.itemId) ?? 0) + reward.quantity
      );
    }
    const loot: LootSummary[] = [];
    for (const award of awards) {
      const purpose = award.purpose ?? "augmentation";
      const existing = loot.find(
        (entry) => entry.itemId === award.itemId && entry.purpose === purpose
      );
      if (existing) {
        existing.quantity += award.quantity;
        continue;
      }
      const awardItem = await ctx.db.get(award.itemId);
      loot.push({
        itemId: award.itemId,
        itemName: awardItem?.name ?? "Unknown item",
        quantity: award.quantity,
        pending: pendingByItemId.get(award.itemId) ?? 0,
        purpose,
        itemSlug: awardItem?.itemId,
        itemFamily: awardItem?.itemFamily,
        category: awardItem?.category,
      });
    }
    return {
      recorded: true,
      duplicate: true,
      goldEarned: existingFight.goldEarned,
      experienceEarned: existingFight.experienceEarned,
      loot,
    };
  }

  const player = await ctx.db.get(args.playerId);
  if (!player) throw new Error("Player not found");
  if (args.sourceType === "monster") {
    const monster = await ctx.db
      .query("monsters")
      .withIndex("by_type", (q) => q.eq("type", args.sourceId))
      .first();
    if (!monster) throw new Error("Monster not found");
    const eventMultipliers = await getActiveEventMultipliers(ctx, Date.now());
    const [combatBoosts, passives, guildBonuses, rebirthRewards] = await Promise.all([
      getActiveCombatBoosts(ctx, args.playerId, Date.now()),
      getPassiveBonuses(ctx, args.playerId),
      getGuildBonusesForPlayer(ctx, args.playerId),
      readRebirthRewardBonuses(ctx, player.rebirthCount),
    ]);
    if (
      args.rewardOverride &&
      (!Number.isSafeInteger(args.rewardOverride.goldEarned) ||
        args.rewardOverride.goldEarned < 0 ||
        !Number.isSafeInteger(args.rewardOverride.experienceEarned) ||
        args.rewardOverride.experienceEarned < 0)
    ) {
      throw new Error("Fight reward override is invalid");
    }
    const guildGoldMult = 1 + (guildBonuses.goldBonusPercent ?? 0) / 100;
    const guildXpMult = 1 + (guildBonuses.xpBonusPercent ?? 0) / 100;
    const goldEarned = args.won
      ? args.rewardOverride?.goldEarned ??
        Math.max(
          0,
          Math.floor(
            monster.goldDrop * args.tier * eventMultipliers.goldMultiplier * passives.goldMultiplier * rebirthRewards.goldMultiplier * guildGoldMult
          )
        )
      : 0;
    const experienceEarned = args.won
      ? args.rewardOverride?.experienceEarned ??
        Math.max(
          0,
          Math.floor(
            monster.experienceReward *
              args.tier *
              eventMultipliers.experienceMultiplier *
              combatBoosts.xpMultiplier *
              passives.xpMultiplier *
              rebirthRewards.xpMultiplier *
              guildXpMult
          )
        )
      : 0;
    if (args.won) {
      await ctx.db.patch(args.playerId, {
        gold: player.gold + goldEarned,
        totalExperience: player.totalExperience + experienceEarned,
        lastUpdated: Date.now(),
      });
      await awardCombatStatXp(ctx, args.playerId, experienceEarned);
      await accrueGuildXpFromEarned(ctx, args.playerId, experienceEarned);
      await progressWeeklyObjectives(ctx, args.playerId, {
        wins: 1,
        gold: goldEarned,
        xp: experienceEarned,
      });
      await recordTierProgress(ctx, player, args.tier);
    }
    const loot = await resolveLoot(ctx, args);
    const infusionLoot = await grantInfusionDrops(ctx, {
      playerId: args.playerId,
      tier: args.tier,
      won: args.won,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      settlementKey: args.settlementKey,
    });
    for (const extra of infusionLoot) {
      const existing = loot.find((row) => row.itemId === extra.itemId);
      if (existing) {
        existing.quantity += extra.quantity;
        existing.pending += extra.pending;
      } else {
        loot.push({ ...extra });
      }
    }
    await recordFightHistory(ctx, {
      playerId: args.playerId,
      settlementKey: args.settlementKey,
      monsterTier: args.tier,
      monsterType: args.sourceId,
      won: args.won,
      isBoss: false,
      ...(args.monsterZone === undefined
        ? {}
        : { monsterZone: args.monsterZone }),
      goldEarned,
      experienceEarned,
    });
    return {
      recorded: true,
      duplicate: false,
      goldEarned,
      experienceEarned,
      loot,
    };
  }

  const boss = await ctx.db
    .query("bosses")
    .withIndex("by_bossId", (q) => q.eq("bossId", args.sourceId))
    .first();
  if (!boss || boss.tier !== args.tier) {
    throw new Error("Boss is not configured for this tier");
  }

  const baseGold =
    readNonNegativeNumber(
      await getBalanceValue(ctx, "bossGoldPerTier"),
      DEFAULT_BOSS_GOLD_PER_TIER
    ) *
    args.tier *
    boss.rewardMultiplier;
  const baseExperience =
    readNonNegativeNumber(
      await getBalanceValue(ctx, "bossExperiencePerTier"),
      DEFAULT_BOSS_EXPERIENCE_PER_TIER
    ) *
    args.tier *
    boss.rewardMultiplier;
  const eventMultipliers = await getActiveEventMultipliers(ctx, Date.now());
  const [combatBoosts, passives, guildBonuses, rebirthRewards] = await Promise.all([
    getActiveCombatBoosts(ctx, args.playerId, Date.now()),
    getPassiveBonuses(ctx, args.playerId),
    getGuildBonusesForPlayer(ctx, args.playerId),
    readRebirthRewardBonuses(ctx, player.rebirthCount),
  ]);
  const guildGoldMult = 1 + (guildBonuses.goldBonusPercent ?? 0) / 100;
  const guildXpMult = 1 + (guildBonuses.xpBonusPercent ?? 0) / 100;
  const goldEarned = args.won
    ? Math.max(0, Math.floor(baseGold * eventMultipliers.goldMultiplier * passives.goldMultiplier * rebirthRewards.goldMultiplier * guildGoldMult))
    : 0;
  const experienceEarned = args.won
    ? Math.max(
        0,
        Math.floor(
          baseExperience *
            eventMultipliers.experienceMultiplier *
            combatBoosts.xpMultiplier *
            passives.xpMultiplier *
              rebirthRewards.xpMultiplier *
            guildXpMult
        )
      )
    : 0;

  if (args.won) {
    await ctx.db.patch(args.playerId, {
      gold: player.gold + goldEarned,
      totalExperience: player.totalExperience + experienceEarned,
      lastUpdated: Date.now(),
    });
    await awardCombatStatXp(ctx, args.playerId, experienceEarned);
    await accrueGuildXpFromEarned(ctx, args.playerId, experienceEarned);
    await progressWeeklyObjectives(ctx, args.playerId, {
      wins: 1,
      gold: goldEarned,
      xp: experienceEarned,
    });
    await recordTierProgress(ctx, player, args.tier);
  }

  const loot = await resolveLoot(ctx, args);
  const infusionLoot = await grantInfusionDrops(ctx, {
    playerId: args.playerId,
    tier: args.tier,
    won: args.won,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    settlementKey: args.settlementKey,
  });
  for (const extra of infusionLoot) {
    const existing = loot.find((row) => row.itemId === extra.itemId);
    if (existing) {
      existing.quantity += extra.quantity;
      existing.pending += extra.pending;
    } else {
      loot.push({ ...extra });
    }
  }
  await recordFightHistory(ctx, {
    playerId: args.playerId,
    settlementKey: args.settlementKey,
    monsterTier: args.tier,
    monsterType: args.sourceId,
    won: args.won,
    isBoss: args.sourceType === "boss",
    goldEarned,
    experienceEarned,
  });

  return {
    recorded: true,
    duplicate: false,
    goldEarned,
    experienceEarned,
    loot,
  };
}

export type BatchFight = {
  monsterType: string;
  monsterName: string;
  won: boolean;
  goldEarned: number;
  experienceEarned: number;
  abilityCasts?: Array<{ abilityId: string; level: number; casts: number }>;
};

function assertValidLootEntry(entry: Doc<"lootTableEntries">) {
  if (
    !Number.isSafeInteger(entry.minQuantity) ||
    !Number.isSafeInteger(entry.maxQuantity) ||
    entry.minQuantity < 1 ||
    entry.maxQuantity < entry.minQuantity ||
    !Number.isFinite(entry.dropChance) ||
    entry.dropChance < 0 ||
    entry.dropChance > 1
  ) {
    throw new Error("Loot table contains invalid entry values");
  }
}

/**
 * Settle a run of auto-battle fights as one set of writes.
 *
 * The whole batch commits atomically with the task's progress, so it needs no
 * per-fight dedupe key and writes one fight-history row. Loot tables are read
 * once per monster type, the inventory once per batch, and a loot item that
 * dropped five times is one grant. Rewards were resolved when each encounter
 * was rolled; level-ups earned here apply from the next batch.
 */
export async function settleAutoBattleBatch(
  ctx: MutationCtx,
  args: {
    player: Doc<"players">;
    settlementKey: string;
    tier: number;
    monsterZone?: CombatZone;
    weaponDamageStat: string | null;
    fights: BatchFight[];
  }
): Promise<{ goldEarned: number; experienceEarned: number; loot: LootSummary[] }> {
  const { player, tier, fights } = args;
  const playerId = player._id;
  const wins = fights.filter((fight) => fight.won);
  let goldEarned = 0;
  let experienceEarned = 0;
  for (const fight of wins) {
    goldEarned += fight.goldEarned;
    experienceEarned += fight.experienceEarned;
  }

  if (wins.length > 0) {
    const xpBase = readSkillXpBase(await getBalanceValue(ctx, "skillXpPerLevel"));
    const previousBest = player.maxTierReached ?? player.currentTier ?? 1;
    const maxTierReached = Math.max(previousBest, tier);
    await ctx.db.patch(playerId, {
      ...applyCombatStatXp(player, args.weaponDamageStat, experienceEarned, xpBase),
      gold: player.gold + goldEarned,
      totalExperience: player.totalExperience + experienceEarned,
      maxTierReached,
      currentTier: tier,
      lastUpdated: Date.now(),
    });
    if (maxTierReached > previousBest) await ensureBossForTier(ctx, maxTierReached);
    await accrueGuildXpFromEarned(ctx, playerId, experienceEarned);
    await progressWeeklyObjectives(ctx, playerId, {
      wins: wins.length,
      gold: goldEarned,
      xp: experienceEarned,
    });
    await awardCrossedAchievements(
      ctx,
      playerId,
      { maxTierReached: previousBest, totalExperience: player.totalExperience, rebirthCount: player.rebirthCount },
      {
        maxTierReached,
        totalExperience: player.totalExperience + experienceEarned,
        rebirthCount: player.rebirthCount,
      }
    );
  }

  // Merge casts per ability first: each award is a read-modify-write.
  const castsByAbility = new Map<string, { abilityId: string; level: number; casts: number }>();
  for (const fight of fights) {
    for (const cast of fight.abilityCasts ?? []) {
      const existing = castsByAbility.get(cast.abilityId);
      if (existing) existing.casts += cast.casts;
      else castsByAbility.set(cast.abilityId, { ...cast });
    }
  }
  if (castsByAbility.size > 0) {
    await awardAbilityWisdomXp(ctx, playerId, [...castsByAbility.values()]);
  }

  // Roll loot in memory, then grant each item once.
  const drops = new Map<
    Id<"items">,
    { quantity: number; purpose: LootSummary["purpose"]; sourceId: string }
  >();
  const addDrop = (
    itemId: Id<"items">,
    quantity: number,
    purpose: LootSummary["purpose"],
    sourceId: string
  ) => {
    const existing = drops.get(itemId);
    if (existing) existing.quantity += quantity;
    else drops.set(itemId, { quantity, purpose, sourceId });
  };
  const winsByMonster = new Map<string, number>();
  for (const fight of wins) {
    winsByMonster.set(fight.monsterType, (winsByMonster.get(fight.monsterType) ?? 0) + 1);
  }
  for (const [monsterType, count] of winsByMonster) {
    const tableData = await getLootTable(ctx, "monster", monsterType, tier);
    if (!tableData) continue;
    const rollCount = Math.min(100, Math.max(0, tableData.table.rollCount));
    for (let index = 0; index < count; index += 1) {
      for (const entry of pickLootEntries(tableData.entries, rollCount)) {
        assertValidLootEntry(entry);
        addDrop(entry.itemId, randomQuantity(entry), entry.purpose, monsterType);
      }
    }
  }
  const lastMonster = fights[fights.length - 1]?.monsterType ?? "";
  const bonusDrops = await rollBatchBonusDrops(ctx, tier, wins.length);
  for (const drop of bonusDrops) {
    addDrop(drop.itemId, drop.quantity, drop.purpose, lastMonster);
  }

  const loot: LootSummary[] = [];
  if (drops.size > 0) {
    const inventory = await readInventoryForGrants(ctx, playerId);
    for (const [itemId, drop] of drops) {
      const item = await ctx.db.get(itemId);
      if (!item) throw new Error("Loot table references a missing item");
      const grant = await grantItemToInventory(ctx, {
        playerId,
        itemId,
        quantity: drop.quantity,
        overflowSource: {
          sourceType: "monster",
          sourceId: drop.sourceId,
          settlementKey: args.settlementKey,
        },
        inventory,
      });
      loot.push({
        itemId,
        itemName: item.name,
        quantity: drop.quantity,
        pending: grant.pending,
        purpose: drop.purpose,
        itemSlug: item.itemId,
        itemFamily: item.itemFamily,
        category: item.category,
      });
    }
  }

  await recordFightHistory(ctx, {
    playerId,
    settlementKey: args.settlementKey,
    monsterTier: tier,
    monsterType: lastMonster,
    // Proof of a victory at this tier, so a batch with any win counts as won.
    won: wins.length > 0,
    isBoss: false,
    ...(args.monsterZone === undefined ? {} : { monsterZone: args.monsterZone }),
    goldEarned,
    experienceEarned,
    fightCount: fights.length,
  });
  return { goldEarned, experienceEarned, loot };
}

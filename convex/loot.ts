import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureBossForTier } from "./bossData";
import type { CombatZone } from "./zones";
import { grantItemToInventory, getActiveCombatBoosts, getEquippedWeapon } from "./items";
import { grantInfusionDrops } from "./infusion";
import { getPassiveBonuses } from "./passiveTree";
import {
  getSkillXpRequiredForLevel,
  readSkillXpBase,
} from "./skillProgression";

type TrainableStat = "str" | "dex" | "int" | "con";

/**
 * Split a fight's XP across the wielded weapon's stats (70/30 weapon/con,
 * 35/35/30 unarmed) into per-stat XP pools leveled with the skill XP curve.
 */
async function awardCombatStatXp(
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
  const xpBase = readSkillXpBase(xpBaseValue);
  const splits: Record<TrainableStat, number> =
    weapon?.damageStat === "dex"
      ? { str: 0, dex: 0.7, int: 0, con: 0.3 }
      : weapon?.damageStat === "int"
        ? { str: 0, dex: 0, int: 0.7, con: 0.3 }
        : weapon?.damageStat === "str"
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
  const patch: Record<string, unknown> = { statXp: pools };
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
    patch[stat] = level;
    pools[stat] = pool;
  }
  await ctx.db.patch(playerId, { ...patch, lastUpdated: Date.now() });
}

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

async function getBalanceValue(ctx: MutationCtx, key: string) {
  return (
    await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
  )?.value;
}

function readNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export async function getActiveEventMultipliers(ctx: MutationCtx, now: number) {
  // Indexed range on startTime (events already started), then wall-clock
  // endTime check in JS. Avoids the prior full-table filter() scan while
  // staying correct even if the maintained isActive flag goes stale.
  const candidates = await ctx.db
    .query("gameEvents")
    .withIndex("by_startTime", (q) => q.lte("startTime", now))
    .take(100);
  const events = candidates.filter((event) => event.endTime > now);
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
  if (!args.settlementKey.startsWith(`${args.playerId}:`)) {
    throw new Error("Fight settlement key must belong to the player");
  }
  if (!Number.isSafeInteger(args.tier) || args.tier < 1) {
    throw new Error("Fight tier must be a positive integer");
  }

  const existingFight = await ctx.db
    .query("fightHistory")
    .withIndex("by_settlementKey", (q) =>
      q.eq("settlementKey", args.settlementKey)
    )
    .first();
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
    const [combatBoosts, passives] = await Promise.all([
      getActiveCombatBoosts(ctx, args.playerId, Date.now()),
      getPassiveBonuses(ctx, args.playerId),
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
    const goldEarned = args.won
      ? args.rewardOverride?.goldEarned ??
        Math.max(
          0,
          Math.floor(
            monster.goldDrop * args.tier * eventMultipliers.goldMultiplier * passives.goldMultiplier
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
              passives.xpMultiplier
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
    await ctx.db.insert("fightHistory", {
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
      timestamp: Date.now(),
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
  const [combatBoosts, passives] = await Promise.all([
    getActiveCombatBoosts(ctx, args.playerId, Date.now()),
    getPassiveBonuses(ctx, args.playerId),
  ]);
  const goldEarned = args.won
    ? Math.max(0, Math.floor(baseGold * eventMultipliers.goldMultiplier * passives.goldMultiplier))
    : 0;
  const experienceEarned = args.won
    ? Math.max(
        0,
        Math.floor(
          baseExperience *
            eventMultipliers.experienceMultiplier *
            combatBoosts.xpMultiplier *
            passives.xpMultiplier
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
  await ctx.db.insert("fightHistory", {
    playerId: args.playerId,
    settlementKey: args.settlementKey,
    monsterTier: args.tier,
    monsterType: args.sourceId,
    won: args.won,
    isBoss: args.sourceType === "boss",
    goldEarned,
    experienceEarned,
    timestamp: Date.now(),
  });

  return {
    recorded: true,
    duplicate: false,
    goldEarned,
    experienceEarned,
    loot,
  };
}

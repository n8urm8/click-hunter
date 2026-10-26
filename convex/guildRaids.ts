import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { readPlayerCombatProfile } from "./combat";
import {
  abilityCastsLog,
  abilityWeaponFrom,
  awardAbilityWisdomXp,
  buildAbilityCombatState,
} from "./abilityCombat";
import {
  runRoundExchange,
  type RoundFighter,
  type RoundSide,
  type RoundSwing,
} from "./roundCombat";
import { ensureBossForTier, bossElementForTier } from "./bossData";
import { rollAttackHit, rollPowerHit } from "./hitRoll";
import { fightHistoryKey, recordFightHistory } from "./fightHistory";
import { readBalanceMap } from "./balance";
import {
  getActiveEventMultipliers,
  awardCombatStatXp,
  rollBossLoot,
} from "./loot";
import { getActiveCombatBoosts } from "./items";
import { getPassiveBonuses } from "./passiveTree";
import { accrueGuildXpFromEarned, getGuildBonusesForPlayer } from "./guilds";
import { progressWeeklyObjectives } from "./guildObjectives";
import { grantItemToGuildStash } from "./guildStash";

type DatabaseCtx = QueryCtx | MutationCtx;
type RaidRow = Doc<"guildRaids">;

const rateLimiter = new RateLimiter(components.rateLimiter, {});

// Rounds are server-simulated in batches; combat is fully automatic (no
// manual battling anywhere in the game). Any viewer may tick.
const MAX_ROUNDS_PER_TICK = 25;

// ─── Weekly cadence ─────────────────────────────────────────────────────────
// No cron: raids are gated to Saturday (server/UTC time) and bosses reset to
// T1 every week via the weekStart bucket (Saturday 00:00 UTC). The
// leaderboard for a week is derived from that week's immutable rows, so on
// Sunday it naturally shows Saturday's results.

export function saturdayWeekStart(now: number): number {
  const d = new Date(now);
  const sinceSaturday = (d.getUTCDay() - 6 + 7) % 7;
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - sinceSaturday
  );
}

export function isSaturdayUTC(now: number): boolean {
  return new Date(now).getUTCDay() === 6;
}

// ─── Balance configuration ──────────────────────────────────────────────────
// All tunable raid values live in gameBalance (seeded in guilds.ts,
// editable in the admin General tab). Hardcoded numbers below are validated
// fallback defaults for missing/malformed rows only.

const RAID_BALANCE_KEYS = [
  "guildRaidFormationHours",
  "guildRaidDurationHours",
  "guildRaidRoundIntervalMs",
  "guildRaidPartySize",
  "guildRaidPowerMultiplier",
  "guildRaidTailSwipeEvery",
  "guildRaidTailSwipeMultiplier",
  "guildRaidBreathEvery",
  "guildRaidBreathMultiplier",
  "guildRaidSkinThreshold1",
  "guildRaidSkinThreshold2",
  "guildRaidSkinReductionPercent",
  "guildRaidSkinDurationRounds",
  "guildRaidMinDamageForXp",
  "guildRaidSaturdayGateEnabled",
  "guildRaidSummonGoldCost",
  "guildRaidRewardGoldMultiplier",
  "guildRaidRewardXpMultiplier",
  "bossGoldPerTier",
  "bossExperiencePerTier",
] as const;

const RAID_FALLBACKS = {
  formationHours: 6,
  durationHours: 24,
  roundIntervalMs: 2000,
  partySize: 4,
  powerMultiplier: 4,
  tailEvery: 4,
  tailMult: 0.7,
  breathEvery: 6,
  breathMult: 1.3,
  skinT1: 66,
  skinT2: 33,
  skinReduction: 50,
  skinDuration: 3,
  minDamage: 1,
  saturdayGate: 1,
  summonCost: 0,
  rewardGoldMult: 1,
  rewardXpMult: 1,
  bossGoldPerTier: 500,
  bossExperiencePerTier: 250,
} as const;

type RaidTuning = {
  formationHours: number;
  durationHours: number;
  roundIntervalMs: number;
  partySize: number;
  powerMultiplier: number;
  tailEvery: number;
  tailMult: number;
  breathEvery: number;
  breathMult: number;
  skinT1: number;
  skinT2: number;
  skinReduction: number;
  skinDuration: number;
  minDamage: number;
  saturdayGate: number;
  summonCost: number;
  rewardGoldMult: number;
  rewardXpMult: number;
  bossGoldPerTier: number;
  bossExperiencePerTier: number;
};

function readNum(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function readInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

async function readRaidTuning(ctx: DatabaseCtx): Promise<RaidTuning> {
  const map = await readBalanceMap(ctx, [...RAID_BALANCE_KEYS]);
  const get = (key: string) => map.get(key);
  return {
    formationHours: readNum(
      get("guildRaidFormationHours"),
      RAID_FALLBACKS.formationHours,
      0.05,
      168
    ),
    durationHours: readNum(
      get("guildRaidDurationHours"),
      RAID_FALLBACKS.durationHours,
      0.05,
      168
    ),
    roundIntervalMs: readInt(
      get("guildRaidRoundIntervalMs"),
      RAID_FALLBACKS.roundIntervalMs,
      250,
      60000
    ),
    partySize: readInt(
      get("guildRaidPartySize"),
      RAID_FALLBACKS.partySize,
      1,
      8
    ),
    powerMultiplier: readNum(
      get("guildRaidPowerMultiplier"),
      RAID_FALLBACKS.powerMultiplier,
      1,
      100
    ),
    tailEvery: readInt(
      get("guildRaidTailSwipeEvery"),
      RAID_FALLBACKS.tailEvery,
      2,
      100
    ),
    tailMult: readNum(
      get("guildRaidTailSwipeMultiplier"),
      RAID_FALLBACKS.tailMult,
      0,
      10
    ),
    breathEvery: readInt(
      get("guildRaidBreathEvery"),
      RAID_FALLBACKS.breathEvery,
      2,
      100
    ),
    breathMult: readNum(
      get("guildRaidBreathMultiplier"),
      RAID_FALLBACKS.breathMult,
      0,
      10
    ),
    skinT1: readNum(
      get("guildRaidSkinThreshold1"),
      RAID_FALLBACKS.skinT1,
      1,
      99
    ),
    skinT2: readNum(
      get("guildRaidSkinThreshold2"),
      RAID_FALLBACKS.skinT2,
      1,
      99
    ),
    skinReduction: readNum(
      get("guildRaidSkinReductionPercent"),
      RAID_FALLBACKS.skinReduction,
      0,
      90
    ),
    skinDuration: readInt(
      get("guildRaidSkinDurationRounds"),
      RAID_FALLBACKS.skinDuration,
      1,
      50
    ),
    minDamage: readInt(
      get("guildRaidMinDamageForXp"),
      RAID_FALLBACKS.minDamage,
      0,
      1_000_000_000
    ),
    saturdayGate: readInt(
      get("guildRaidSaturdayGateEnabled"),
      RAID_FALLBACKS.saturdayGate,
      0,
      1
    ),
    summonCost: readInt(
      get("guildRaidSummonGoldCost"),
      RAID_FALLBACKS.summonCost,
      0,
      1_000_000_000
    ),
    rewardGoldMult: readNum(
      get("guildRaidRewardGoldMultiplier"),
      RAID_FALLBACKS.rewardGoldMult,
      0,
      100
    ),
    rewardXpMult: readNum(
      get("guildRaidRewardXpMultiplier"),
      RAID_FALLBACKS.rewardXpMult,
      0,
      100
    ),
    bossGoldPerTier: readNum(
      get("bossGoldPerTier"),
      RAID_FALLBACKS.bossGoldPerTier,
      0,
      1_000_000_000
    ),
    bossExperiencePerTier: readNum(
      get("bossExperiencePerTier"),
      RAID_FALLBACKS.bossExperiencePerTier,
      0,
      1_000_000_000
    ),
  };
}

function requireRaidDay(tuning: RaidTuning, now: number) {
  if (tuning.saturdayGate === 0) return;
  if (!isSaturdayUTC(now)) {
    throw new Error("Guild raids open on Saturday only (UTC)");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getMembership(ctx: DatabaseCtx, playerId: Id<"players">) {
  return await ctx.db
    .query("guildMembers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .first();
}

async function getBonus(ctx: DatabaseCtx, guild: Doc<"guilds">) {
  const row = await ctx.db
    .query("guildBonuses")
    .withIndex("by_level", (q) => q.eq("level", guild.level))
    .first();
  return { raidSlots: row?.raidSlots ?? 1, maxMembers: row?.maxMembers ?? 50 };
}

async function countActiveRaids(ctx: DatabaseCtx, guildId: Id<"guilds">) {
  const forming = await ctx.db
    .query("guildRaids")
    .withIndex("by_guildId_and_status", (q) =>
      q.eq("guildId", guildId).eq("status", "forming")
    )
    .take(20);
  const active = await ctx.db
    .query("guildRaids")
    .withIndex("by_guildId_and_status", (q) =>
      q.eq("guildId", guildId).eq("status", "active")
    )
    .take(20);
  return forming.length + active.length;
}

async function tierRows(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">,
  weekStart: number,
  tier: number
): Promise<RaidRow[]> {
  return await ctx.db
    .query("guildRaids")
    .withIndex("by_guildId_and_weekStart_and_tier", (q) =>
      q.eq("guildId", guildId).eq("weekStart", weekStart).eq("tier", tier)
    )
    .take(200);
}

async function isTierSlain(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">,
  weekStart: number,
  tier: number
): Promise<boolean> {
  return (await tierClaim(ctx, guildId, weekStart, tier)) !== null;
}

async function isTierUnlocked(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">,
  weekStart: number,
  tier: number
): Promise<boolean> {
  if (tier <= 1) return true;
  return await isTierSlain(ctx, guildId, weekStart, tier - 1);
}

/** The single kill claim for (guild, week, tier), if a lobby landed the kill. */
async function tierClaim(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">,
  weekStart: number,
  tier: number
) {
  return await ctx.db
    .query("guildRaidClaims")
    .withIndex("by_guildId_and_weekStart_and_tier", (q) =>
      q.eq("guildId", guildId).eq("weekStart", weekStart).eq("tier", tier)
    )
    .first();
}

/** Claimed kill for this tier by a *different* lobby (the stop signal). */
async function claimedByOther(ctx: DatabaseCtx, row: RaidRow): Promise<boolean> {
  const weekStart = row.weekStart;
  if (weekStart === undefined) return false;
  const claim = await tierClaim(ctx, row.guildId, weekStart, row.tier);
  return claim !== null && claim.raidId !== row._id;
}

/**
 * Record the tier's first kill. Concurrent finishers race here: the index-range
 * read/write makes Convex's OCC reject the loser, which then sees the claim on
 * retry and stands down instead of double-claiming.
 */
async function claimTierRow(
  ctx: MutationCtx,
  row: RaidRow,
  now: number
): Promise<void> {
  const weekStart = row.weekStart;
  if (weekStart === undefined) return;
  if (await tierClaim(ctx, row.guildId, weekStart, row.tier)) return;
  await ctx.db.insert("guildRaidClaims", {
    guildId: row.guildId,
    weekStart,
    tier: row.tier,
    raidId: row._id,
    claimedAt: now,
  });
}

/**
 * Fold a finished lobby into the week's leaderboard aggregate. Called once per
 * settled lobby (never per tick), so the leaderboard subscription only re-reads
 * on settlements — not on every combat round.
 */
async function bumpStanding(
  ctx: MutationCtx,
  row: RaidRow,
  killed: boolean,
  now: number
): Promise<void> {
  const weekStart = row.weekStart;
  if (weekStart === undefined) return;
  const damage = row.participants.reduce(
    (sum, p) => sum + Math.max(0, Math.floor(p.damageDealt)),
    0
  );
  if (damage === 0 && !killed) return;
  const existing = await ctx.db
    .query("guildRaidStandings")
    .withIndex("by_guildId_and_weekStart", (q) =>
      q.eq("guildId", row.guildId).eq("weekStart", weekStart)
    )
    .first();
  if (!existing) {
    await ctx.db.insert("guildRaidStandings", {
      guildId: row.guildId,
      weekStart,
      highestTierKilled: killed ? row.tier : 0,
      totalDamage: damage,
      killTime: killed ? now : undefined,
      updatedAt: now,
    });
    return;
  }
  let highestTierKilled = existing.highestTierKilled;
  let killTime = existing.killTime;
  if (killed) {
    if (row.tier > highestTierKilled) {
      highestTierKilled = row.tier;
      killTime = now;
    } else if (row.tier === highestTierKilled) {
      killTime = killTime === undefined ? now : Math.min(killTime, now);
    }
  }
  await ctx.db.patch(existing._id, {
    highestTierKilled,
    totalDamage: existing.totalDamage + damage,
    killTime,
    updatedAt: now,
  });
}

/** Tuning for an auto-combat tick: frozen snapshot if present, else live read. */
async function readTickTuning(
  ctx: MutationCtx,
  row: RaidRow
): Promise<RaidTuning> {
  return row.raidTuning ?? (await readRaidTuning(ctx));
}

/**
 * Chip damage: finished wipe lobbies (status failed) already subtracted their
 * share. New lobbies start from maxHp minus that total so guilds grind the
 * dragon down across lobbies. Concurrent in-flight lobbies each copy the same
 * basis; overshoot is clamped to 1 HP (the chip-down still needs a final
 * killing blow lobby).
 */
async function wipeDamageTotal(
  ctx: DatabaseCtx,
  guildId: Id<"guilds">,
  weekStart: number,
  tier: number
): Promise<number> {
  const rows = await tierRows(ctx, guildId, weekStart, tier);
  let total = 0;
  for (const row of rows) {
    if (row.status !== "failed") continue;
    for (const p of row.participants) {
      total += Math.max(0, Math.floor(p.damageDealt));
    }
  }
  return total;
}

async function getRaidDragon(ctx: MutationCtx, tier: number, power: number) {
  const boss = await ensureBossForTier(ctx, tier);
  if (!boss) throw new Error("Boss is not configured for this tier");
  const scale = (value: number) => Math.max(1, Math.round(value * power));
  const str = scale(boss.str);
  const dex = scale(boss.dex);
  const int = scale(boss.int);
  const con = scale(boss.con);
  return {
    boss,
    maxHp: Math.max(1, Math.ceil(con * 10 + int * 2)),
    attack: Math.max(1, str * 1.2 + dex * 0.5),
    element: bossElementForTier(tier),
  };
}

function rollDragonHit(base: number) {
  return rollPowerHit({ power: base });
}

type DragonAction = "basic" | "swipe" | "breath";

function pickDragonAction(round: number, tuning: RaidTuning): DragonAction {
  if (round % tuning.breathEvery === 0) return "breath";
  if (round % tuning.tailEvery === 0) return "swipe";
  return "basic";
}

/** Top threat = highest damage dealt among living members (ties: first). */
function topThreatIndex(
  fighters: Array<{ alive: boolean; damageDealt?: number }>
): number {
  let best = -1;
  let bestDamage = -1;
  for (let i = 0; i < fighters.length; i += 1) {
    const p = fighters[i];
    if (p.alive === false) continue;
    const dealt = p.damageDealt ?? 0;
    if (dealt > bestDamage) {
      bestDamage = dealt;
      best = i;
    }
  }
  return best;
}

/**
 * The dragon's retaliation: breath (elemental AoE) > swipe (physical AoE) >
 * basic (single target on top threat). Raw damage only — the round exchange
 * applies the party's mitigation buffs on top.
 */
function planDragonSwing(
  opponents: RoundFighter[],
  action: DragonAction,
  dragonAttack: number,
  tuning: RaidTuning
): RoundSwing[] {
  if (action === "basic") {
    const target = topThreatIndex(opponents);
    if (target === -1) return [];
    const victim = opponents[target];
    return [
      {
        target: victim,
        damage: Math.max(0, rollDragonHit(dragonAttack) - victim.defense),
        isCrit: false,
      },
    ];
  }
  const standing = opponents.filter((o) => o.alive && o.hp > 0);
  if (action === "swipe") {
    // Tail swipe: physical AoE across the whole party.
    const hit = rollDragonHit(dragonAttack * tuning.tailMult);
    return standing.map((target) => ({
      target,
      damage: Math.max(0, hit - target.defense),
      isCrit: false,
    }));
  }
  // Elemental breath: elemental AoE mitigated by magical defense + ward.
  const hit = rollDragonHit(dragonAttack * tuning.breathMult);
  return standing.map((target) => ({
    target,
    damage: Math.max(
      0,
      hit - (target.magicalDefense + (target.ward ?? 0))
    ),
    isCrit: false,
  }));
}

function aliveCount(participants: RaidRow["participants"]): number {
  return participants.filter((p) => p.alive !== false).length;
}

// ─── XP settlement ──────────────────────────────────────────────────────────
// Everyone who deals damage earns full solo-boss-tier gold+XP once per tier
// per week (anti-farm dedup via guildRaidXpGrants). Repeat lobbies still
// count damage for the leaderboard. Item loot goes to the guild stash on the
// killing blow only — never to player inventories.

async function settleRaidXp(
  ctx: MutationCtx,
  row: RaidRow,
  tuning: RaidTuning,
  boss: { bossId: string; rewardMultiplier: number },
  killed: boolean,
  now: number
): Promise<Array<{ playerId: Id<"players">; xp: number; gold: number }>> {
  const weekStart = row.weekStart;
  if (weekStart === undefined) return [];
  const paid: Array<{ playerId: Id<"players">; xp: number; gold: number }> =
    [];
  const events = await getActiveEventMultipliers(ctx, now);
  const baseGold =
    tuning.bossGoldPerTier * row.tier * boss.rewardMultiplier;
  const baseXp =
    tuning.bossExperiencePerTier * row.tier * boss.rewardMultiplier;
  for (const member of row.participants) {
    if (member.damageDealt < tuning.minDamage) continue;
    const dup = await ctx.db
      .query("guildRaidXpGrants")
      .withIndex("by_guild_week_tier_player", (q) =>
        q
          .eq("guildId", row.guildId)
          .eq("weekStart", weekStart)
          .eq("tier", row.tier)
          .eq("playerId", member.playerId)
      )
      .first();
    if (dup) continue;
    const player = await ctx.db.get(member.playerId);
    if (!player) continue;
    const [boosts, passives, guildBonuses] = await Promise.all([
      getActiveCombatBoosts(ctx, member.playerId, now),
      getPassiveBonuses(ctx, member.playerId),
      getGuildBonusesForPlayer(ctx, member.playerId),
    ]);
    const guildGoldMult = 1 + (guildBonuses.goldBonusPercent ?? 0) / 100;
    const guildXpMult = 1 + (guildBonuses.xpBonusPercent ?? 0) / 100;
    const gold = Math.max(
      0,
      Math.floor(
        baseGold *
          tuning.rewardGoldMult *
          events.goldMultiplier *
          passives.goldMultiplier *
          guildGoldMult
      )
    );
    const xp = Math.max(
      0,
      Math.floor(
        baseXp *
          tuning.rewardXpMult *
          events.experienceMultiplier *
          boosts.xpMultiplier *
          passives.xpMultiplier *
          guildXpMult
      )
    );
    await ctx.db.patch(member.playerId, {
      gold: player.gold + gold,
      totalExperience: player.totalExperience + xp,
      lastUpdated: now,
    });
    await awardCombatStatXp(ctx, member.playerId, xp);
    await accrueGuildXpFromEarned(ctx, member.playerId, xp);
    await progressWeeklyObjectives(ctx, member.playerId, {
      wins: killed ? 1 : 0,
      gold,
      xp,
    });
    await ctx.db.insert("guildRaidXpGrants", {
      guildId: row.guildId,
      weekStart,
      tier: row.tier,
      playerId: member.playerId,
      partyId: row._id,
      xp,
      gold,
      createdAt: now,
    });
    await recordFightHistory(ctx, {
      playerId: member.playerId,
      // One row per (player, raid lobby). The key is player-prefixed like
      // every other settlement key.
      settlementKey: fightHistoryKey(member.playerId, "raid", row._id),
      monsterTier: row.tier,
      monsterType: boss.bossId,
      won: killed,
      isBoss: true,
      goldEarned: gold,
      experienceEarned: xp,
      timestamp: now,
    });
    // Wisdom XP for abilities used, awarded once per (guild, week, tier,
    // player) alongside the raid XP grant above.
    if (member.abilityState) {
      await awardAbilityWisdomXp(
        ctx,
        member.playerId,
        abilityCastsLog(member.abilityState)
      );
    }
    paid.push({ playerId: member.playerId, xp, gold });
  }
  return paid;
}

async function markSupersededAndSettle(
  ctx: MutationCtx,
  row: RaidRow,
  tuning: RaidTuning,
  boss: { bossId: string; rewardMultiplier: number },
  now: number
) {
  const paid = await settleRaidXp(ctx, row, tuning, boss, false, now);
  await ctx.db.patch(row._id, { status: "superseded", endedAt: now });
  return {
    stopped: true as const,
    reason: "already-slain" as const,
    bossHp: row.bossHp,
    paid,
  };
}

// ─── Mutations: summon & parties ────────────────────────────────────────────

/**
 * Summon a raid dragon (officers only). Creates the guild's first lobby for
 * the tier; anyone in the guild can then open more lobbies for the same tier
 * via createRaidParty. Tier N unlocks when tier N-1 is completed this week.
 */
export const startRaid = mutation({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
  },
  handler: async (ctx, { playerId, tier }) => {
    await requirePlayer(ctx, playerId);
    const tuning = await readRaidTuning(ctx);
    const now = Date.now();
    requireRaidDay(tuning, now);
    if (!Number.isSafeInteger(tier) || tier < 1) {
      throw new Error("Raid tier must be a positive integer");
    }
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    if (membership.role !== "master" && membership.role !== "officer") {
      throw new Error("Requires officer role or higher");
    }
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) throw new Error("Guild not found");
    const weekStart = saturdayWeekStart(now);
    if (!(await isTierUnlocked(ctx, guild._id, weekStart, tier))) {
      throw new Error(`Defeat tier ${tier - 1} first to unlock this dragon`);
    }
    if (await isTierSlain(ctx, guild._id, weekStart, tier)) {
      throw new Error(`Tier ${tier} is already slain — summon tier ${tier + 1}`);
    }
    const bonus = await getBonus(ctx, guild);
    if ((await countActiveRaids(ctx, guild._id)) >= bonus.raidSlots) {
      throw new Error("All raid slots are in use");
    }
    const dragon = await getRaidDragon(ctx, tier, tuning.powerMultiplier);
    const chip = await wipeDamageTotal(ctx, guild._id, weekStart, tier);
    const startHp = Math.max(1, dragon.maxHp - chip);
    // TODO(summon-cost): first lobby of a tier pays the summon cost from the
    // guild bank (currently 0/free until economy tuning lands).
    const existing = await tierRows(ctx, guild._id, weekStart, tier);
    if (existing.length === 0 && tuning.summonCost > 0) {
      if (guild.gold < tuning.summonCost) {
        throw new Error(
          `Summoning costs ${tuning.summonCost} guild gold`
        );
      }
      await ctx.db.patch(guild._id, {
        gold: guild.gold - tuning.summonCost,
        updatedAt: now,
      });
    }
    const config = tuning;
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const raidId = await ctx.db.insert("guildRaids", {
      guildId: guild._id,
      bossId: dragon.boss.bossId,
      tier,
      status: "forming",
      participants: [
        { playerId, playerName: player.name, damageDealt: 0 },
      ],
      bossHp: startHp,
      bossMaxHp: dragon.maxHp,
      rewardGold: tuning.bossGoldPerTier * tier * dragon.boss.rewardMultiplier,
      rewardXp:
        tuning.bossExperiencePerTier * tier * dragon.boss.rewardMultiplier,
      expiresAt: now + config.formationHours * 60 * 60 * 1000,
      createdAt: now,
      weekStart,
      summonedBy: playerId,
      dragonElement: dragon.element,
      raidRound: 0,
      skinUntilRound: 0,
      skinThresholdsHit: [],
    });
    return await ctx.db.get(raidId);
  },
});

/**
 * Open another 4-person lobby for an unlocked, unslain tier. Any guild
 * member may do this once the dragon is summoned.
 */
export const createRaidParty = mutation({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
  },
  handler: async (ctx, { playerId, tier }) => {
    await requirePlayer(ctx, playerId);
    const tuning = await readRaidTuning(ctx);
    const now = Date.now();
    requireRaidDay(tuning, now);
    if (!Number.isSafeInteger(tier) || tier < 1) {
      throw new Error("Raid tier must be a positive integer");
    }
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) throw new Error("Guild not found");
    const weekStart = saturdayWeekStart(now);
    if (!(await isTierUnlocked(ctx, guild._id, weekStart, tier))) {
      throw new Error(`Defeat tier ${tier - 1} first to unlock this dragon`);
    }
    if (await isTierSlain(ctx, guild._id, weekStart, tier)) {
      throw new Error(`Tier ${tier} is already slain — summon tier ${tier + 1}`);
    }
    const bonus = await getBonus(ctx, guild);
    if ((await countActiveRaids(ctx, guild._id)) >= bonus.raidSlots) {
      throw new Error("All raid slots are in use");
    }
    const dragon = await getRaidDragon(ctx, tier, tuning.powerMultiplier);
    const chip = await wipeDamageTotal(ctx, guild._id, weekStart, tier);
    const startHp = Math.max(1, dragon.maxHp - chip);
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    const raidId = await ctx.db.insert("guildRaids", {
      guildId: guild._id,
      bossId: dragon.boss.bossId,
      tier,
      status: "forming",
      participants: [
        { playerId, playerName: player.name, damageDealt: 0 },
      ],
      bossHp: startHp,
      bossMaxHp: dragon.maxHp,
      rewardGold: tuning.bossGoldPerTier * tier * dragon.boss.rewardMultiplier,
      rewardXp:
        tuning.bossExperiencePerTier * tier * dragon.boss.rewardMultiplier,
      expiresAt: now + tuning.formationHours * 60 * 60 * 1000,
      createdAt: now,
      weekStart,
      summonedBy: playerId,
      dragonElement: dragon.element,
      raidRound: 0,
      skinUntilRound: 0,
      skinThresholdsHit: [],
    });
    return await ctx.db.get(raidId);
  },
});

export const joinRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const tuning = await readRaidTuning(ctx);
    requireRaidDay(tuning, Date.now());
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    if (raid.status !== "forming") throw new Error("Raid is no longer forming");
    const now = Date.now();
    if (now > raid.expiresAt) {
      await ctx.db.patch(raidId, { status: "failed", endedAt: now });
      throw new Error("Raid formation expired");
    }
    if (raid.participants.some((p) => p.playerId === playerId)) {
      throw new Error("You already joined this raid");
    }
    if (raid.participants.length >= tuning.partySize) {
      throw new Error(`Raid parties hold at most ${tuning.partySize} hunters`);
    }
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    await ctx.db.patch(raidId, {
      participants: [
        ...raid.participants,
        { playerId, playerName: player.name, damageDealt: 0 },
      ],
    });
    return await ctx.db.get(raidId);
  },
});

export const beginRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const tuning = await readRaidTuning(ctx);
    const now = Date.now();
    requireRaidDay(tuning, now);
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    if (raid.status !== "forming") throw new Error("Raid is not forming");
    // Party creator or an officer may begin (officer-only was the legacy
    // rule; parties need their creator to start without an officer online).
    const isCreator = raid.summonedBy === playerId;
    if (
      !isCreator &&
      membership.role !== "master" &&
      membership.role !== "officer"
    ) {
      throw new Error("Only the party creator or an officer can begin");
    }
    if (raid.participants.length === 0) throw new Error("Raid has no participants");
    if (now > raid.expiresAt) {
      await ctx.db.patch(raidId, { status: "failed", endedAt: now });
      throw new Error("Raid formation expired");
    }
    if (
      raid.weekStart !== undefined &&
      (await isTierSlain(ctx, raid.guildId, raid.weekStart, raid.tier))
    ) {
      const dragon = await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier);
      await markSupersededAndSettle(ctx, raid, tuning, dragon.boss, now);
      throw new Error("That dragon is already slain — summon the next tier");
    }
    // Fresh combat snapshots + the latest chipped HP copy. Fights that
    // finished while this lobby was forming already reduced the copy.
    const dragon = await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier);
    let startHp = raid.bossMaxHp;
    if (raid.weekStart !== undefined) {
      const chip = await wipeDamageTotal(
        ctx,
        raid.guildId,
        raid.weekStart,
        raid.tier
      );
      startHp = Math.max(1, dragon.maxHp - chip);
    }
    const participants = [];
    for (const p of raid.participants) {
      const player = await ctx.db.get(p.playerId);
      if (!player) throw new Error("Player not found");
      const profile = await readPlayerCombatProfile(ctx, player, { now });
      const maxHp = Math.max(1, Math.ceil(profile.combatStats.health));
      // Freeze equipped abilities with cooldowns in rounds so auto-cast lands
      // on the shared raid round clock.
      const abilityState = await buildAbilityCombatState(
        ctx,
        p.playerId,
        abilityWeaponFrom(profile.weapon),
        { unit: "rounds", roundIntervalMs: tuning.roundIntervalMs },
        { includeAlly: true }
      );
      participants.push({
        playerId: p.playerId,
        playerName: player.name,
        damageDealt: 0,
        hp: maxHp,
        maxHp,
        defense: Math.max(0, profile.combatStats.defense),
        magicalDefense: Math.max(0, profile.combatStats.magicalDefense),
        ward: Math.max(0, profile.ward[dragon.element] ?? 0),
        alive: true,
        attack: Math.max(1, profile.combatStats.attack),
        critChance: Math.max(0, profile.combatStats.critChance),
        critMultiplier: Math.max(1, profile.combatStats.critDamageMultiplier),
        ...(abilityState.runtimes.length > 0 ? { abilityState } : {}),
      });
    }
    await ctx.db.patch(raidId, {
      status: "active",
      participants,
      bossHp: startHp,
      bossMaxHp: dragon.maxHp,
      dragonElement: dragon.element,
      raidRound: 0,
      skinUntilRound: 0,
      skinThresholdsHit: [],
      startedAt: now,
      lastTickAt: now,
      roundIntervalMs: tuning.roundIntervalMs,
      // Frozen for the fight: ticks never re-read gameBalance or bosses.
      raidTuning: tuning,
      dragonAttack: dragon.attack,
      expiresAt: now + tuning.durationHours * 60 * 60 * 1000,
    });
    return await ctx.db.get(raidId);
  },
});

// ─── Mutations: combat ──────────────────────────────────────────────────────
// Fully automatic: there is no manual battling in this game. Any viewer may
// tick an active lobby; the server simulates every due round since the last
// tick (all living members hit, then the dragon retaliates) up to a cap.

export const tickRaid = mutation({
  args: {
    playerId: v.id("players"),
    raidId: v.id("guildRaids"),
  },
  handler: async (ctx, { playerId, raidId }) => {
    await requirePlayer(ctx, playerId);
    const raid = await ctx.db.get(raidId);
    if (!raid) throw new Error("Raid not found");
    const membership = await getMembership(ctx, playerId);
    if (!membership) throw new Error("You are not in a guild");
    if (raid.guildId !== membership.guildId) {
      throw new Error("That raid belongs to a different guild");
    }
    // Cheap guard before any balance/boss read. When several members watch one
    // lobby, the non-due polls (the common case) cost a few point reads and
    // nothing else — no gameBalance scan, no rate-limiter write.
    const idle = (status: RaidRow["status"]) => ({
      bossHp: raid.bossHp,
      round: raid.raidRound ?? 0,
      status,
      advanced: 0,
      changed: false as const,
      killed: false,
      wiped: false,
      stopped: status === "superseded",
    });
    if (raid.status === "superseded") return idle("superseded");
    if (raid.status !== "active") return idle(raid.status);

    const interval = raid.roundIntervalMs ?? RAID_FALLBACKS.roundIntervalMs;
    const now = Date.now();
    const base = raid.lastTickAt ?? raid.startedAt ?? now;
    if (now < base + interval) return idle("active");

    const gate = await rateLimiter.limit(ctx, "raidTick", {
      key: playerId,
      config: { kind: "token bucket", rate: 4, period: 1_000, capacity: 4 },
    });
    if (!gate.ok) return idle("active");

    const tuning = await readTickTuning(ctx, raid);
    if (now > raid.expiresAt) {
      const boss = (await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier))
        .boss;
      await settleRaidXp(ctx, raid, tuning, boss, false, now);
      await bumpStanding(ctx, raid, false, now);
      await ctx.db.patch(raidId, {
        status: "failed",
        endedAt: now,
        lastTickAt: now,
      });
      return {
        bossHp: raid.bossHp,
        round: raid.raidRound ?? 0,
        status: "failed" as const,
        advanced: 0,
        changed: true as const,
        killed: false,
        wiped: false,
        stopped: false as const,
        expired: true as const,
      };
    }
    // Stop signal: another lobby already claimed this tier's kill. Settle
    // this lobby's damage for XP and stand down (keeps leaderboard damage).
    if (await claimedByOther(ctx, raid)) {
      const boss = (await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier))
        .boss;
      const stopped = await markSupersededAndSettle(
        ctx,
        raid,
        tuning,
        boss,
        now
      );
      await bumpStanding(ctx, raid, false, now);
      return {
        bossHp: stopped.bossHp,
        round: raid.raidRound ?? 0,
        status: "superseded" as const,
        advanced: 0,
        changed: true as const,
        killed: false,
        wiped: false,
        stopped: stopped.stopped,
      };
    }
    const dragonAttack =
      raid.dragonAttack ??
      (await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier)).attack;
    // Backfill snapshots for rows begun before snapshots existed.
    const participants = [...raid.participants];
    for (let i = 0; i < participants.length; i += 1) {
      const p = participants[i];
      if (p.maxHp !== undefined && p.attack !== undefined) continue;
      const pl = await ctx.db.get(p.playerId);
      if (!pl) throw new Error("Player not found");
      const profile = await readPlayerCombatProfile(ctx, pl, { now });
      const maxHp = Math.max(1, Math.ceil(profile.combatStats.health));
      const abilityState =
        p.abilityState ??
        (await buildAbilityCombatState(
          ctx,
          p.playerId,
          abilityWeaponFrom(profile.weapon),
          { unit: "rounds", roundIntervalMs: interval },
          { includeAlly: true }
        ));
      participants[i] = {
        ...p,
        hp: p.hp ?? maxHp,
        maxHp,
        defense: p.defense ?? Math.max(0, profile.combatStats.defense),
        magicalDefense:
          p.magicalDefense ?? Math.max(0, profile.combatStats.magicalDefense),
        ward:
          p.ward ??
          Math.max(0, profile.ward[bossElementForTier(raid.tier)] ?? 0),
        alive: p.alive ?? true,
        attack: p.attack ?? Math.max(1, profile.combatStats.attack),
        critChance: p.critChance ?? Math.max(0, profile.combatStats.critChance),
        critMultiplier:
          p.critMultiplier ??
          Math.max(1, profile.combatStats.critDamageMultiplier),
        ...(abilityState.runtimes.length > 0 ? { abilityState } : {}),
      };
    }
    const dueRounds = Math.min(
      MAX_ROUNDS_PER_TICK,
      Math.floor(Math.max(0, now - base) / interval)
    );
    let bossHp = raid.bossHp;
    let round = raid.raidRound ?? 0;
    const thresholdsHit = [...(raid.skinThresholdsHit ?? [])];
    let skinUntilRound = raid.skinUntilRound ?? 0;
    let applied = 0;
    let lastAction: DragonAction | null = null;

    for (let n = 0; n < dueRounds; n += 1) {
      round += 1;
      applied += 1;
      // The whole living party hits at once.
      const skinActive = skinUntilRound > 0 && round <= skinUntilRound;
      const skinMultiplier = skinActive
        ? Math.max(0, (100 - tuning.skinReduction) / 100)
        : 1;
      // The party and the dragon fight through the shared round exchange.
      // The raid supplies the numbers: the party swings at the dragon, the
      // dragon picks an action, and tough skin scales what the dragon takes.
      let dragonAction: DragonAction | null = null;
      const bossFighter: RoundFighter = {
        id: "dragon",
        hp: bossHp,
        maxHp: raid.bossMaxHp,
        alive: bossHp > 0,
        defense: 0,
        magicalDefense: 0,
        // Tough skin: the dragon takes a cut of every incoming hit.
        reduceIncoming: (damage) =>
          skinActive
            ? Math.max(
                1,
                Math.floor((damage * (100 - tuning.skinReduction)) / 100)
              )
            : damage,
        planSwing: (opponents) => {
          dragonAction = pickDragonAction(round, tuning);
          return planDragonSwing(opponents, dragonAction, dragonAttack, tuning);
        },
      };
      const partyViews: RoundFighter[] = [];
      for (let i = 0; i < participants.length; i += 1) {
        const m = participants[i];
        partyViews.push({
          id: m.playerId,
          hp: m.hp ?? 0,
          maxHp: m.maxHp ?? (m.hp ?? 0),
          alive: m.alive !== false,
          defense: m.defense ?? 0,
          magicalDefense: m.magicalDefense ?? 0,
          ward: m.ward ?? 0,
          damageDealt: m.damageDealt,
          ...(m.abilityState ? { abilityState: m.abilityState } : {}),
          // Tough skin also scales the party's ability damage.
          abilityDamageMultiplier: skinMultiplier,
          planSwing: () => {
            const raw = rollAttackHit({
              attack: m.attack ?? 1,
              critChance: m.critChance ?? 0,
              critMultiplier: m.critMultiplier ?? 1,
            });
            return [
              { target: bossFighter, damage: raw.damage, isCrit: raw.isCrit },
            ];
          },
        });
      }
      // Auto-cast abilities fire before the party's swings. Ally heals route
      // to the most-injured living member.
      const healMostInjured = (amount: number): number => {
        let idx = -1;
        let mostMissing = 0;
        for (let j = 0; j < partyViews.length; j += 1) {
          const q = partyViews[j];
          if (!q.alive) continue;
          const missing = q.maxHp - q.hp;
          if (missing > mostMissing) {
            mostMissing = missing;
            idx = j;
          }
        }
        if (idx === -1) return 0;
        const q = partyViews[idx];
        const restored = Math.max(0, Math.min(amount, q.maxHp - q.hp));
        if (restored > 0) {
          q.hp = q.hp + restored;
        }
        return restored;
      };
      const sides: RoundSide[] = [
        { fighters: partyViews, allyHeal: healMostInjured },
        { fighters: [bossFighter] },
      ];
      const exchange = runRoundExchange(sides, {
        round,
        roundIntervalMs: interval,
      });
      bossHp = exchange.hp.dragon;
      for (let i = 0; i < participants.length; i += 1) {
        const view = partyViews[i];
        const m = participants[i];
        participants[i] = {
          ...m,
          hp: view.hp,
          alive: view.alive,
          damageDealt: view.damageDealt ?? m.damageDealt,
        };
      }
      // The dragon only swings when it is still standing.
      if (dragonAction) {
        lastAction = dragonAction;
      }
      // Tough skin: crossing a threshold arms the buff for N rounds.
      const hpFrac = bossHp / Math.max(1, raid.bossMaxHp);
      for (const t of [tuning.skinT1, tuning.skinT2].sort((a, b) => b - a)) {
        if (!thresholdsHit.includes(t) && hpFrac * 100 < t && bossHp > 0) {
          thresholdsHit.push(t);
          skinUntilRound = round + tuning.skinDuration;
        }
      }

      if (bossHp <= 0) {
        // Killing blow — but only the first lobby to land it claims the tier.
        if (await claimedByOther(ctx, raid)) {
          const fresh = (await ctx.db.get(raidId))!;
          const boss = (
            await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier)
          ).boss;
          const stopped = await markSupersededAndSettle(
            ctx,
            { ...fresh, participants, bossHp: fresh.bossHp },
            tuning,
            boss,
            now
          );
          await bumpStanding(ctx, { ...fresh, participants }, false, now);
          return {
            bossHp: stopped.bossHp,
            round,
            status: "superseded" as const,
            advanced: applied,
            changed: true as const,
            killed: false,
            wiped: false,
            stopped: stopped.stopped,
          };
        }
        await claimTierRow(ctx, raid, now);
        await ctx.db.patch(raidId, {
          bossHp: 0,
          participants,
          raidRound: round,
          skinUntilRound,
          skinThresholdsHit: thresholdsHit,
          lastTickAt: base + applied * interval,
          status: "completed",
          endedAt: now,
        });
        const finished = (await ctx.db.get(raidId))!;
        const boss = (
          await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier)
        ).boss;
        await settleRaidXp(ctx, finished, tuning, boss, true, now);
        await bumpStanding(ctx, finished, true, now);
        // Kill loot goes to the guild stash, never to player inventories.
        const rolled = await rollBossLoot(ctx, boss.bossId, raid.tier);
        const stash: Array<{ itemName: string; quantity: number }> = [];
        for (const entry of rolled) {
          await grantItemToGuildStash(ctx, {
            guildId: raid.guildId,
            itemId: entry.itemId,
            quantity: entry.quantity,
          });
          const item = await ctx.db.get(entry.itemId);
          stash.push({
            itemName: item?.name ?? "Unknown item",
            quantity: entry.quantity,
          });
        }
        return {
          bossHp: 0,
          round,
          status: "completed" as const,
          advanced: applied,
          changed: true as const,
          killed: true,
          wiped: false,
          stopped: false as const,
          stash,
        };
      }

      // The dragon's retaliation (breath / swipe / basic) already landed in
      // the round exchange above.

      if (aliveCount(participants) === 0) {
        // Wipe: the fight ends when the dragon kills everyone. Damage stands
        // and chips the tier for the next lobby.
        await ctx.db.patch(raidId, {
          bossHp,
          participants,
          raidRound: round,
          skinUntilRound,
          skinThresholdsHit: thresholdsHit,
          lastTickAt: base + applied * interval,
          status: "failed",
          endedAt: now,
        });
        const finished = (await ctx.db.get(raidId))!;
        const boss = (
          await getRaidDragon(ctx, raid.tier, tuning.powerMultiplier)
        ).boss;
        await settleRaidXp(ctx, finished, tuning, boss, false, now);
        await bumpStanding(ctx, finished, false, now);
        return {
          bossHp,
          round,
          status: "failed" as const,
          advanced: applied,
          changed: true as const,
          killed: false,
          wiped: true,
          stopped: false as const,
          lastAction,
        };
      }
    }

    await ctx.db.patch(raidId, {
      bossHp,
      participants,
      raidRound: round,
      skinUntilRound,
      skinThresholdsHit: thresholdsHit,
      lastTickAt: base + applied * interval,
    });
    return {
      bossHp,
      round,
      status: "active" as const,
      advanced: applied,
      changed: true as const,
      killed: false,
      wiped: false,
      stopped: false as const,
      lastAction,
    };
  },
});

// ─── Queries ────────────────────────────────────────────────────────────────

export const getGuildRaids = query({
  args: {
    playerId: v.id("players"),
    status: v.optional(
      v.union(
        v.literal("forming"),
        v.literal("active"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("superseded")
      )
    ),
    weekStart: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, status, weekStart }) => {
    await requirePlayerRead(ctx, playerId);
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .first();
    if (!membership) return [];
    if (status) {
      const rows = await ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", status)
        )
        .take(50);
      return weekStart === undefined
        ? rows
        : rows.filter((row) => row.weekStart === weekStart);
    }
    const [forming, active, completed, superseded] = await Promise.all([
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "forming")
        )
        .take(20),
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "active")
        )
        .take(20),
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "completed")
        )
        .take(10),
      ctx.db
        .query("guildRaids")
        .withIndex("by_guildId_and_status", (q) =>
          q.eq("guildId", membership.guildId).eq("status", "superseded")
        )
        .take(10),
    ]);
    const all = [...forming, ...active, ...completed, ...superseded];
    return weekStart === undefined
      ? all
      : all.filter((row) => row.weekStart === weekStart);
  },
});

/** Raid-day gating info for the client (button enablement, countdowns). */
export const getRaidStatus = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const tuning = await readRaidTuning(ctx);
    const now = Date.now();
    return {
      isSaturday: tuning.saturdayGate === 0 || isSaturdayUTC(now),
      weekStart: saturdayWeekStart(now),
      partySize: tuning.partySize,
      summonCost: tuning.summonCost,
    };
  },
});

export type RaidStanding = {
  guildId: Id<"guilds">;
  guildName: string;
  guildTag: string;
  highestTierKilled: number;
  totalDamage: number;
  killTime: number | null;
};

/**
 * Highest tier + damage leaderboard for a raid week. Defaults to the live
 * week on Saturday, otherwise the most recent Saturday (frozen): on Sunday
 * it shows Saturday's results with no cron involved.
 */
export const getRaidLeaderboard = query({
  args: {
    playerId: v.id("players"),
    weekStart: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, weekStart, limit }) => {
    await requirePlayerRead(ctx, playerId);
    const week = weekStart ?? saturdayWeekStart(Date.now());
    const capped =
      typeof limit === "number" && Number.isSafeInteger(limit)
        ? Math.min(Math.max(limit, 1), 50)
        : 20;
    // Aggregate rows, one per guild for the week. Updated only when a lobby
    // settles, so a live fight's per-tick writes never re-read this query.
    const rows = await ctx.db
      .query("guildRaidStandings")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", week))
      .take(200);
    const standings = rows
      .map((row) => ({
        guildId: row.guildId,
        highestTierKilled: row.highestTierKilled,
        totalDamage: row.totalDamage,
        killTime: row.killTime ?? null,
      }))
      .sort(
        (a, b) =>
          b.highestTierKilled - a.highestTierKilled ||
          b.totalDamage - a.totalDamage ||
          (a.killTime ?? Number.MAX_SAFE_INTEGER) -
            (b.killTime ?? Number.MAX_SAFE_INTEGER)
      );
    const visible = standings.slice(0, capped);
    const guilds = await Promise.all(
      visible.map((entry) => ctx.db.get(entry.guildId))
    );
    return visible.map((entry, i) => ({
      guildId: entry.guildId,
      guildName: guilds[i]?.name ?? "Unknown",
      guildTag: guilds[i]?.tag ?? "?",
      highestTierKilled: entry.highestTierKilled,
      totalDamage: entry.totalDamage,
      killTime: entry.killTime,
    }));
  },
});

import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import { calculateCombatLevel } from "./characterLevel";
import { readBalanceMap } from "./balance";
import { resolvePvpEquipment, snapshotPvpGear } from "./pvpLoadout";
import { rollHit, snapshotFighter } from "./arena";

type DatabaseCtx = QueryCtx | MutationCtx;

const DAY_MS = 86_400_000;

// ─── Balance configuration ────────────────────────────────────────────────────
// Tunable ranked values: seeded in seed.ts, backfilled in migrations.ts,
// editable in the admin General tab. No gameplay constant lives in client
// code or bare mutations.

export const RANKED_BALANCE_DEFAULTS = [
  {
    key: "rankedMinCombatLevel",
    value: 50,
    description:
      "Minimum combat level (stats only, no skills) required to join the ranked league",
  },
  {
    key: "rankedStartPoints",
    value: 1000,
    description:
      "League points granted on join and restored to everyone at the weekly reset",
  },
  {
    key: "rankedKFactor",
    value: 32,
    description:
      "Elo K-factor: maximum points exchanged in one ranked battle (upsets pay near this)",
  },
  {
    key: "rankedBattlesPerDay",
    value: 5,
    description: "Ranked battles allowed per player per UTC day",
  },
  {
    key: "rankedMaxRounds",
    value: 100,
    description:
      "Maximum rounds in a simulated ranked battle before the higher HP fraction wins",
  },
  {
    key: "rankedMatchCandidates",
    value: 5,
    description: "Opponents offered on the ranked match list",
  },
  {
    key: "rankedWeeklyRewards",
    value: [5000, 4000, 3000, 2000, 1000, 1000, 1000, 1000, 1000, 1000],
    description:
      "Gold paid to weekly placements 1-10 at settlement (shorter lists repeat the last value)",
  },
] as const;

const FALLBACK_WEEKLY_REWARDS = [5000, 4000, 3000, 2000, 1000, 1000, 1000, 1000, 1000, 1000];

const FALLBACKS = {
  minCombat: 50,
  startPoints: 1000,
  kFactor: 32,
  battlesPerDay: 5,
  maxRounds: 100,
  matchCandidates: 5,
} as const;

const LEADERBOARD_LIMIT = 50;
const MATCH_SCAN_LIMIT = 100;
const RANK_COUNT_LIMIT = 2000;
const HISTORY_LIMIT = 20;

type RankedConfig = {
  minCombat: number;
  startPoints: number;
  kFactor: number;
  battlesPerDay: number;
  maxRounds: number;
  matchCandidates: number;
  weeklyRewards: number[];
};

function readRewards(value: unknown): number[] {
  if (!Array.isArray(value)) return [...FALLBACK_WEEKLY_REWARDS];
  const clean = value.filter(
    (entry): entry is number =>
      typeof entry === "number" &&
      Number.isSafeInteger(entry) &&
      entry >= 0 &&
      entry <= 1_000_000_000
  );
  return clean.length > 0 ? clean : [...FALLBACK_WEEKLY_REWARDS];
}

export async function readRankedConfig(
  ctx: DatabaseCtx
): Promise<RankedConfig> {
  const map = await readBalanceMap(
    ctx,
    RANKED_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const get = (key: string) => map.get(key);
  const int = (key: string, fallback: number, min: number, max: number) => {
    const value = get(key);
    return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max
      ? value
      : fallback;
  };
  return {
    minCombat: int("rankedMinCombatLevel", FALLBACKS.minCombat, 1, 100000),
    startPoints: int("rankedStartPoints", FALLBACKS.startPoints, 0, 1000000),
    kFactor: int("rankedKFactor", FALLBACKS.kFactor, 1, 500),
    battlesPerDay: int(
      "rankedBattlesPerDay",
      FALLBACKS.battlesPerDay,
      1,
      1000
    ),
    maxRounds: int("rankedMaxRounds", FALLBACKS.maxRounds, 1, 10000),
    matchCandidates: int(
      "rankedMatchCandidates",
      FALLBACKS.matchCandidates,
      1,
      25
    ),
    weeklyRewards: readRewards(get("rankedWeeklyRewards")),
  };
}

// ─── Elo ──────────────────────────────────────────────────────────────────────

/**
 * Points exchanged when `winnerPoints` beats `loserPoints`. Standard Elo with
 * a 400-point scale, rounded to whole points with a floor of 1 so every
 * decided battle moves the ladder.
 */
export function eloSwing(
  winnerPoints: number,
  loserPoints: number,
  kFactor: number
): number {
  const expected =
    1 / (1 + Math.pow(10, (loserPoints - winnerPoints) / 400));
  return Math.max(1, Math.round(kFactor * (1 - expected)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcDayNumber(now: number): number {
  return Math.floor(now / DAY_MS);
}

async function getMembership(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"rankedFighters"> | null> {
  return await ctx.db
    .query("rankedFighters")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .first();
}

async function requireMembership(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<Doc<"rankedFighters">> {
  const row = await getMembership(ctx, playerId);
  if (!row) throw new Error("Join the ranked league first");
  return row;
}

type BoutRound = {
  round: number;
  damageAttackerToDefender: number;
  damageDefenderToAttacker: number;
  critAttacker: boolean;
  critDefender: boolean;
  attackerHp: number;
  defenderHp: number;
};

/**
 * Instant server-side bout between two frozen snapshots. Same exchange model
 * as arena rounds (simultaneous damage, minimum 1 per side), so results stay
 * consistent with what lobby fights would produce. Returns the full round
 * log so clients can play the bout back visually; callers cap what they
 * send over the wire.
 */
function simulateBout(
  attackerSnapshot: Awaited<ReturnType<typeof snapshotFighter>>,
  defenderSnapshot: Awaited<ReturnType<typeof snapshotFighter>>,
  maxRounds: number
): { winner: "attacker" | "defender" | "draw"; rounds: number; log: BoutRound[] } {
  let hpA = attackerSnapshot.maxHp;
  let hpB = defenderSnapshot.maxHp;
  const log: BoutRound[] = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    const hitA = rollHit(attackerSnapshot, defenderSnapshot);
    const hitB = rollHit(defenderSnapshot, attackerSnapshot);
    hpA = Math.max(0, hpA - hitB.damage);
    hpB = Math.max(0, hpB - hitA.damage);
    log.push({
      round,
      damageAttackerToDefender: hitA.damage,
      damageDefenderToAttacker: hitB.damage,
      critAttacker: hitA.isCrit,
      critDefender: hitB.isCrit,
      attackerHp: hpA,
      defenderHp: hpB,
    });
    if (hpA <= 0 && hpB <= 0) {
      return { winner: "draw", rounds: round, log };
    }
    if (hpA <= 0 || hpB <= 0) {
      return {
        winner: hpA <= 0 ? "defender" : "attacker",
        rounds: round,
        log,
      };
    }
  }
  if (hpA === hpB) {
    return { winner: "draw", rounds: maxRounds, log };
  }
  const fracA = hpA / Math.max(1, attackerSnapshot.maxHp);
  const fracB = hpB / Math.max(1, defenderSnapshot.maxHp);
  if (fracA === fracB) {
    return { winner: "draw", rounds: maxRounds, log };
  }
  return {
    winner: fracA > fracB ? "attacker" : "defender",
    rounds: maxRounds,
    log,
  };
}

// ─── Mutations: league lifecycle ──────────────────────────────────────────────

export const joinRankedLeague = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayer(ctx, playerId);
    const config = await readRankedConfig(ctx);
    const combat = calculateCombatLevel(player);
    if (combat < config.minCombat) {
      throw new Error(
        `The ranked league requires combat level ${config.minCombat} (yours is ${combat})`
      );
    }
    if (await getMembership(ctx, playerId)) {
      throw new Error("You are already in the ranked league");
    }
    const now = Date.now();
    const id = await ctx.db.insert("rankedFighters", {
      playerId,
      playerName: player.name,
      points: config.startPoints,
      wins: 0,
      losses: 0,
      draws: 0,
      battleDay: utcDayNumber(now),
      battlesUsed: 0,
      joinedAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

// ─── Mutations: battles ───────────────────────────────────────────────────────

export const fightRankedBattle = mutation({
  args: {
    playerId: v.id("players"),
    defenderId: v.id("players"),
  },
  handler: async (ctx, { playerId, defenderId }) => {
    const attackerPlayer = await requirePlayer(ctx, playerId);
    if (playerId === defenderId) {
      throw new Error("You cannot fight yourself");
    }
    const config = await readRankedConfig(ctx);
    const now = Date.now();
    const attackerRow = await requireMembership(ctx, playerId);
    const defenderRow = await getMembership(ctx, defenderId);
    if (!defenderRow) {
      throw new Error("That player is not in the ranked league");
    }
    const today = utcDayNumber(now);
    const battlesUsed =
      attackerRow.battleDay === today ? attackerRow.battlesUsed : 0;
    if (battlesUsed >= config.battlesPerDay) {
      throw new Error(
        `Daily ranked battles used (${config.battlesPerDay}/day)`
      );
    }
    const defenderPlayer = await ctx.db.get(defenderId);
    if (!defenderPlayer) throw new Error("Defender not found");
    // Ranked bouts snapshot from saved loadouts (or current gear), resolved
    // once so both corners share the same equipment.
    const [attackerEquipment, defenderEquipment] = await Promise.all([
      resolvePvpEquipment(ctx, playerId),
      resolvePvpEquipment(ctx, defenderId),
    ]);
    const [attackerGear, defenderGear] = await Promise.all([
      snapshotPvpGear(ctx, playerId),
      snapshotPvpGear(ctx, defenderId),
    ]);
    const [attackerSnapshot, defenderSnapshot] = await Promise.all([
      snapshotFighter(
        ctx,
        attackerPlayer,
        now,
        defenderEquipment.weapon?.element ?? undefined,
        attackerEquipment
      ),
      snapshotFighter(
        ctx,
        defenderPlayer,
        now,
        attackerEquipment.weapon?.element ?? undefined,
        defenderEquipment
      ),
    ]);
    const bout = simulateBout(
      attackerSnapshot,
      defenderSnapshot,
      config.maxRounds
    );

    let attackerAfter = attackerRow.points;
    let defenderAfter = defenderRow.points;
    let pointSwing = 0;
    let attackerWon = false;
    const draw = bout.winner === "draw";
    if (!draw) {
      const attackerVictory = bout.winner === "attacker";
      attackerWon = attackerVictory;
      const winnerBefore = attackerVictory
        ? attackerRow.points
        : defenderRow.points;
      const loserBefore = attackerVictory
        ? defenderRow.points
        : attackerRow.points;
      const swing = eloSwing(winnerBefore, loserBefore, config.kFactor);
      pointSwing = attackerVictory ? swing : -swing;
      attackerAfter = Math.max(0, attackerRow.points + pointSwing);
      defenderAfter = Math.max(0, defenderRow.points - pointSwing);
    }

    await ctx.db.patch(attackerRow._id, {
      playerName: attackerPlayer.name,
      points: attackerAfter,
      wins: attackerRow.wins + (!draw && attackerWon ? 1 : 0),
      losses: attackerRow.losses + (!draw && !attackerWon ? 1 : 0),
      draws: attackerRow.draws + (draw ? 1 : 0),
      battleDay: today,
      battlesUsed: battlesUsed + 1,
      updatedAt: now,
    });
    await ctx.db.patch(defenderRow._id, {
      playerName: defenderPlayer.name,
      points: defenderAfter,
      wins: defenderRow.wins + (!draw && !attackerWon ? 1 : 0),
      losses: defenderRow.losses + (!draw && attackerWon ? 1 : 0),
      draws: defenderRow.draws + (draw ? 1 : 0),
      updatedAt: now,
    });
    await ctx.db.insert("rankedBattles", {
      attackerId: playerId,
      attackerName: attackerPlayer.name,
      defenderId,
      defenderName: defenderPlayer.name,
      attackerWon,
      draw,
      rounds: bout.rounds,
      attackerPointsBefore: attackerRow.points,
      attackerPointsAfter: attackerAfter,
      defenderPointsBefore: defenderRow.points,
      defenderPointsAfter: defenderAfter,
      pointSwing,
      createdAt: now,
    });

    return {
      won: attackerWon,
      draw,
      rounds: bout.rounds,
      pointSwing,
      attackerPointsBefore: attackerRow.points,
      attackerPointsAfter: attackerAfter,
      defenderPointsBefore: defenderRow.points,
      defenderPointsAfter: defenderAfter,
      attackerMaxHp: attackerSnapshot.maxHp,
      defenderMaxHp: defenderSnapshot.maxHp,
      attackerGear,
      defenderGear,
      // Full bout for visual playback, bounded for the wire.
      log: bout.log.slice(-500),
    };
  },
});

/**
 * Weekly settlement (Monday 00:00 UTC cron): pay the top 10 a placement
 * reward in gold, record the season, and restore everyone to start points.
 * Idempotent per week — a retry after a recorded settle is a no-op.
 */
export const settleRankedWeek = internalMutation({
  args: {},
  handler: async (ctx) => {
    const config = await readRankedConfig(ctx);
    const now = Date.now();
    const thisMonday =
      now - (now % DAY_MS) - (((new Date(now).getUTCDay() + 6) % 7) * DAY_MS);
    const weekStart = thisMonday - 7 * DAY_MS;
    const already = await ctx.db
      .query("rankedSeasons")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", weekStart))
      .first();
    if (already) {
      return { alreadySettled: true as const, weekStart };
    }
    const fighters = await ctx.db
      .query("rankedFighters")
      .withIndex("by_points")
      .order("desc")
      .take(1000);
    const ordered = [...fighters].sort(
      (a, b) => b.points - a.points || a.joinedAt - b.joinedAt
    );
    const standings: Array<{
      playerId: Id<"players">;
      playerName: string;
      points: number;
      placement: number;
      rewardGold: number;
    }> = [];
    for (const [index, fighter] of ordered.slice(0, 10).entries()) {
      const rewardGold =
        config.weeklyRewards[
          Math.min(index, config.weeklyRewards.length - 1)
        ] ?? 0;
      if (rewardGold > 0) {
        const player = await ctx.db.get(fighter.playerId);
        if (player) {
          await ctx.db.patch(fighter.playerId, {
            gold: player.gold + rewardGold,
            lastUpdated: now,
          });
        }
      }
      standings.push({
        playerId: fighter.playerId,
        playerName: fighter.playerName,
        points: fighter.points,
        placement: index + 1,
        rewardGold,
      });
    }
    await ctx.db.insert("rankedSeasons", {
      weekStart,
      standings,
      fightersReset: fighters.length,
      settledAt: now,
    });
    for (const fighter of fighters) {
      await ctx.db.patch(fighter._id, {
        points: config.startPoints,
        updatedAt: now,
      });
    }
    return { alreadySettled: false as const, weekStart, winners: standings.length };
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getRankedConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await readRankedConfig(ctx);
    return {
      minCombat: config.minCombat,
      startPoints: config.startPoints,
      kFactor: config.kFactor,
      battlesPerDay: config.battlesPerDay,
      maxRounds: config.maxRounds,
      matchCandidates: config.matchCandidates,
    };
  },
});

export const getRankedStatus = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayerRead(ctx, playerId);
    const config = await readRankedConfig(ctx);
    const combat = calculateCombatLevel(player);
    const row = await getMembership(ctx, playerId);
    if (!row) {
      return {
        member: false as const,
        eligible: combat >= config.minCombat,
        combatLevel: combat,
        minCombat: config.minCombat,
      };
    }
    const today = utcDayNumber(Date.now());
    const [above, total] = await Promise.all([
      ctx.db
        .query("rankedFighters")
        .withIndex("by_points", (q) => q.gt("points", row.points))
        .take(RANK_COUNT_LIMIT),
      ctx.db.query("rankedFighters").withIndex("by_points").take(RANK_COUNT_LIMIT),
    ]);
    return {
      member: true as const,
      points: row.points,
      rank: above.length + 1,
      totalFighters: total.length,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      battlesLeft: Math.max(
        0,
        config.battlesPerDay - (row.battleDay === today ? row.battlesUsed : 0)
      ),
      battlesPerDay: config.battlesPerDay,
      combatLevel: combat,
    };
  },
});

export const getRankedLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const capped =
      typeof limit === "number" && Number.isSafeInteger(limit)
        ? Math.min(Math.max(limit, 1), 100)
        : 50;
    const rows = await ctx.db
      .query("rankedFighters")
      .withIndex("by_points")
      .order("desc")
      .take(Math.min(capped, LEADERBOARD_LIMIT));
    return rows.map((row, index) => ({
      playerId: row.playerId,
      playerName: row.playerName,
      points: row.points,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      rank: index + 1,
    }));
  },
});

/**
 * The match list: league members nearest to your points, excluding yourself,
 * each annotated with the Elo swing both ways so the choice is informed.
 */
export const findRankedOpponents = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const row = await requireMembership(ctx, playerId);
    const config = await readRankedConfig(ctx);
    const [above, below] = await Promise.all([
      ctx.db
        .query("rankedFighters")
        .withIndex("by_points", (q) => q.gte("points", row.points))
        .order("asc")
        .take(MATCH_SCAN_LIMIT),
      ctx.db
        .query("rankedFighters")
        .withIndex("by_points", (q) => q.lte("points", row.points))
        .order("desc")
        .take(MATCH_SCAN_LIMIT),
    ]);
    const seen = new Set<string>();
    const pool: Doc<"rankedFighters">[] = [];
    for (const fighter of [...above, ...below]) {
      const key = String(fighter._id);
      if (fighter.playerId === playerId || seen.has(key)) continue;
      seen.add(key);
      pool.push(fighter);
    }
    pool.sort(
      (a, b) =>
        Math.abs(a.points - row.points) - Math.abs(b.points - row.points) ||
        b.points - a.points
    );
    const chosen = pool.slice(0, config.matchCandidates);
    const combatLevels = await Promise.all(
      chosen.map(async (fighter) => {
        const player = await ctx.db.get(fighter.playerId);
        return player ? calculateCombatLevel(player) : null;
      })
    );
    return chosen.map((fighter, index) => ({
      playerId: fighter.playerId,
      playerName: fighter.playerName,
      points: fighter.points,
      wins: fighter.wins,
      losses: fighter.losses,
      draws: fighter.draws,
      combatLevel: combatLevels[index],
      winGain: eloSwing(row.points, fighter.points, config.kFactor),
      lossCost: eloSwing(fighter.points, row.points, config.kFactor),
    }));
  },
});

export const getMyRankedBattles = query({
  args: {
    playerId: v.id("players"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, limit }) => {
    await requirePlayerRead(ctx, playerId);
    const capped =
      typeof limit === "number" && Number.isSafeInteger(limit)
        ? Math.min(Math.max(limit, 1), 50)
        : HISTORY_LIMIT;
    const [asAttacker, asDefender] = await Promise.all([
      ctx.db
        .query("rankedBattles")
        .withIndex("by_attacker", (q) => q.eq("attackerId", playerId))
        .order("desc")
        .take(capped),
      ctx.db
        .query("rankedBattles")
        .withIndex("by_defender", (q) => q.eq("defenderId", playerId))
        .order("desc")
        .take(capped),
    ]);
    const seen = new Set<string>();
    const merged: Array<(typeof asAttacker)[number]> = [];
    for (const battle of [...asAttacker, ...asDefender]) {
      const key = String(battle._id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(battle);
    }
    merged.sort((a, b) => b.createdAt - a.createdAt);
    return merged.slice(0, capped);
  },
});

export const getLastRankedSeason = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("rankedSeasons")
      .withIndex("by_weekStart")
      .order("desc")
      .first();
  },
});

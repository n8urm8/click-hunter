import { mutation } from "./_generated/server";
import { requirePlayer } from "./playerAuth";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { Doc } from "./_generated/dataModel";
import { readPlayerCombatProfile } from "./combat";
import { settleCombatFight } from "./loot";
import {
  getTierScale,
  getTierScaleMultiplier,
  scaleBossStat,
} from "./bossData";
import { settleTasksBeforeInteraction } from "./taskSettlement";

const rateLimiter = new RateLimiter(components.rateLimiter, {});

const MAX_MONSTER_HITS_PER_CALL = 600;

type BossSession = Doc<"bossSessions">;

async function getScaledBoss(ctx: MutationCtx, tier: number) {
  const boss = await ctx.db
    .query("bosses")
    .withIndex("by_tier", (q) => q.eq("tier", tier))
    .first();
  if (!boss) return null;
  const mult = boss.statsTierScaled
    ? 1
    : getTierScale(tier, await getTierScaleMultiplier(ctx));
  return {
    ...boss,
    str: scaleBossStat(boss.str, mult),
    dex: scaleBossStat(boss.dex, mult),
    int: scaleBossStat(boss.int, mult),
    luk: scaleBossStat(boss.luk, mult),
    con: scaleBossStat(boss.con, mult),
  };
}

function monsterDerivedStats(boss: { str: number; dex: number; con: number; int: number }) {
  // Mirrors calculateDerivedStats for the client HP bar.
  return {
    maxHp: Math.max(1, Math.round(boss.con * 10 + boss.int * 2)),
    attack: Math.max(1, boss.str * 1.2 + boss.dex * 0.5),
    attackSpeed: Math.max(0.5, (boss.dex - 10) * 0.1 + 1.0),
  };
}

function rollPlayerHit(attack: number, critChance: number, critMultiplier: number) {
  const isCrit = Math.random() * 100 < critChance;
  const variance = 1 + (Math.random() - 0.5) * 0.2;
  return {
    damage: Math.max(1, Math.ceil(attack * (isCrit ? critMultiplier : 1) * variance)),
    isCrit,
  };
}

function rollMonsterHit(monsterAttack: number) {
  const base = Math.max(1, Math.ceil(monsterAttack));
  return base + Math.floor(Math.random() * (base / 2));
}

async function applyPendingMonsterDamage(
  session: BossSession,
  monsterAttackSpeed: number,
  monsterAttack: number,
  now: number
) {
  const intervalMs = Math.max(500, 1000 / monsterAttackSpeed);
  const elapsedMs = Math.max(0, now - session.lastStrikeAt);
  const hits = Math.min(
    MAX_MONSTER_HITS_PER_CALL,
    Math.floor(elapsedMs / intervalMs)
  );
  let playerHp = session.playerHp;
  for (let i = 0; i < hits; i += 1) {
    playerHp -= rollMonsterHit(monsterAttack);
    if (playerHp <= 0) break;
  }
  return { playerHp: Math.max(0, Math.ceil(playerHp)), hits };
}

function toClientState(session: BossSession) {
  return {
    sessionId: session._id,
    settlementKey: session.settlementKey,
    monsterHp: session.monsterHp,
    monsterMaxHp: session.monsterMaxHp,
    playerHp: session.playerHp,
    playerMaxHp: session.playerMaxHp,
    strikes: session.strikes,
    status: session.status,
  };
}

/**
 * Open a server-authoritative boss fight. Returns the session the client
 * renders; every strike and the final settlement are validated here.
 */
export const startBossFight = mutation({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
  },
  handler: async (ctx, { playerId, tier }) => {
    const player = await requirePlayer(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);

    if (!Number.isSafeInteger(tier) || tier < 1) {
      throw new Error("Boss tier must be a positive integer");
    }
    const provenMax = player.maxTierReached ?? player.currentTier ?? 1;
    if (tier > provenMax + 1) {
      throw new Error("That boss tier is not unlocked yet");
    }

    // Manual bosses and the auto-battle queue both pay rewards: never both.
    const [activeTask, queuedTask] = await Promise.all([
      ctx.db
        .query("playerTasks")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "active")
        )
        .first(),
      ctx.db
        .query("playerTasks")
        .withIndex("by_playerId_and_status", (q) =>
          q.eq("playerId", playerId).eq("status", "queued")
        )
        .first(),
    ]);
    if (activeTask || queuedTask) {
      throw new Error("Finish or stop queued tasks before challenging a boss.");
    }

    const boss = await getScaledBoss(ctx, tier);
    if (!boss) {
      throw new Error("Boss is not configured for this tier");
    }

    // One open session at a time; stale opens never settled anything.
    const stale = await ctx.db
      .query("bossSessions")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "open")
      )
      .collect();
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    const monster = monsterDerivedStats(boss);
    const { combatStats } = await readPlayerCombatProfile(ctx, player, Date.now());
    const now = Date.now();
    const sessionId = await ctx.db.insert("bossSessions", {
      playerId,
      bossId: boss.bossId,
      tier,
      monsterHp: monster.maxHp,
      monsterMaxHp: monster.maxHp,
      monsterAttack: monster.attack,
      monsterAttackSpeed: monster.attackSpeed,
      playerHp: Math.max(1, Math.ceil(combatStats.health)),
      playerMaxHp: Math.max(1, Math.ceil(combatStats.health)),
      settlementKey: `${playerId}:boss-session:${crypto.randomUUID()}`,
      status: "open",
      strikes: 0,
      startedAt: now,
      lastStrikeAt: now,
    });
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Boss session could not be created");
    return {
      ...toClientState(session),
      bossId: boss.bossId,
      bossName: boss.name,
    };
  },
});

/**
 * Land one player strike: server cooldown gate, server damage roll, pending
 * monster damage, and server-declared win/loss with immediate settlement.
 */
export const strikeBoss = mutation({
  args: {
    playerId: v.id("players"),
    sessionId: v.id("bossSessions"),
  },
  handler: async (ctx, { playerId, sessionId }) => {
    const player = await requirePlayer(ctx, playerId);
    const session = await ctx.db.get(sessionId);
    if (!session || session.playerId !== playerId) {
      throw new Error("Boss session not found");
    }
    if (session.status !== "open") {
      if (session.status === "won") {
        const recorded = await ctx.db
          .query("fightHistory")
          .withIndex("by_settlementKey", (q) =>
            q.eq("settlementKey", session.settlementKey)
          )
          .first();
        return {
          ...toClientState(session),
          status: "won" as const,
          allowed: true,
          isCrit: false,
          damage: 0,
          rewards: {
            gold: recorded?.goldEarned ?? 0,
            experience: recorded?.experienceEarned ?? 0,
            loot: [] as { itemName: string; quantity: number; pending: number }[],
          },
        };
      }
      return {
        ...toClientState(session),
        status: "lost" as const,
        allowed: true,
        isCrit: false,
        damage: 0,
      };
    }

    const now = Date.now();
    const profile = await readPlayerCombatProfile(ctx, player, now);
    const cooldownMs = Math.ceil(1000 / profile.combatStats.attackSpeed);
    const status = await rateLimiter.limit(ctx, "manualAttack", {
      key: playerId,
      config: { kind: "token bucket", rate: 1, period: cooldownMs, capacity: 1 },
    });
    if (!status.ok) {
      return {
        ...toClientState(session),
        status: "open" as const,
        allowed: false,
        retryAfterMs: status.retryAfter,
        isCrit: false,
        damage: 0,
      };
    }

    // Monster hits first from accumulated time, then the player's strike.
    const pending = await applyPendingMonsterDamage(
      session,
      session.monsterAttackSpeed,
      session.monsterAttack,
      now
    );
    if (pending.playerHp <= 0) {
      await settleCombatFight(ctx, {
        playerId,
        settlementKey: session.settlementKey,
        sourceType: "boss",
        sourceId: session.bossId,
        tier: session.tier,
        won: false,
      });
      await ctx.db.patch(session._id, {
        playerHp: 0,
        status: "lost",
        lastStrikeAt: now,
      });
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "lost" as const,
        allowed: true,
        isCrit: false,
        damage: 0,
      };
    }

    const hit = rollPlayerHit(
      profile.combatStats.attack,
      profile.combatStats.critChance,
      profile.combatStats.critDamageMultiplier
    );
    const monsterHp = Math.max(0, session.monsterHp - hit.damage);
    if (monsterHp <= 0) {
      const settlement = await settleCombatFight(ctx, {
        playerId,
        settlementKey: session.settlementKey,
        sourceType: "boss",
        sourceId: session.bossId,
        tier: session.tier,
        won: true,
      });
      await ctx.db.patch(session._id, {
        monsterHp: 0,
        playerHp: pending.playerHp,
        status: "won",
        strikes: session.strikes + 1,
        lastStrikeAt: now,
      });
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "won" as const,
        allowed: true,
        isCrit: hit.isCrit,
        damage: hit.damage,
        rewards: {
          gold: settlement.goldEarned,
          experience: settlement.experienceEarned,
          loot: settlement.loot,
        },
      };
    }

    await ctx.db.patch(session._id, {
      monsterHp,
      playerHp: pending.playerHp,
      strikes: session.strikes + 1,
      lastStrikeAt: now,
    });
    const updated = await ctx.db.get(session._id);
    return {
      ...toClientState(updated!),
      status: "open" as const,
      allowed: true,
      isCrit: hit.isCrit,
      damage: hit.damage,
    };
  },
});

/**
 * Monster-tick poll for the client fight timer: applies pending monster
 * damage only (no player strike, no cooldown). The client never decides
 * death locally.
 */
export const checkBossFight = mutation({
  args: {
    playerId: v.id("players"),
    sessionId: v.id("bossSessions"),
  },
  handler: async (ctx, { playerId, sessionId }) => {
    await requirePlayer(ctx, playerId);
    const session = await ctx.db.get(sessionId);
    if (!session || session.playerId !== playerId) {
      throw new Error("Boss session not found");
    }
    if (session.status !== "open") {
      return {
        ...toClientState(session),
        status: session.status,
        changed: false as const,
      };
    }
    const check = await rateLimiter.limit(ctx, "bossCheck", {
      key: playerId,
      config: { kind: "token bucket", rate: 2, period: 1_000, capacity: 2 },
    });
    if (!check.ok) {
      return {
        ...toClientState(session),
        status: "open" as const,
        changed: false as const,
      };
    }
    const now = Date.now();
    const pending = await applyPendingMonsterDamage(
      session,
      session.monsterAttackSpeed,
      session.monsterAttack,
      now
    );
    if (pending.playerHp >= session.playerHp) {
      return {
        ...toClientState(session),
        status: "open" as const,
        changed: false as const,
      };
    }
    if (pending.playerHp <= 0) {
      await settleCombatFight(ctx, {
        playerId,
        settlementKey: session.settlementKey,
        sourceType: "boss",
        sourceId: session.bossId,
        tier: session.tier,
        won: false,
      });
      await ctx.db.patch(session._id, {
        playerHp: 0,
        status: "lost",
        lastStrikeAt: now,
      });
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "lost" as const,
        changed: true as const,
      };
    }
    await ctx.db.patch(session._id, {
      playerHp: pending.playerHp,
      lastStrikeAt: now,
    });
    const updated = await ctx.db.get(session._id);
    return {
      ...toClientState(updated!),
      status: "open" as const,
      changed: true as const,
    };
  },
});

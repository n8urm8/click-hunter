import { mutation } from "./_generated/server";
import { requirePlayer } from "./playerAuth";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { Doc, Id } from "./_generated/dataModel";
import { readPlayerCombatProfile } from "./combat";
import { rollAttackHit, rollPowerHit } from "./hitRoll";
import {
  abilityCastsLog,
  abilityWeaponFrom,
  awardAbilityWisdomXp,
  buildAbilityCombatState,
  castDueAbilities,
  nextAbilityAt,
} from "./abilityCombat";
import { resolveCurrentHp, readHpRegenBalance, writePlayerHp } from "./playerHp";
import { tickEquippedConsumables } from "./consumableSlots";
import { settleCombatFight } from "./loot";
import { consumeBossKey } from "./infusion";
import {
  getTierScale,
  getTierScaleMultiplier,
  bossElementForTier,
  scaleBossStat,
} from "./bossData";
import { settleTasksBeforeInteraction } from "./taskSettlement";

const rateLimiter = new RateLimiter(components.rateLimiter, {});

const MAX_MONSTER_HITS_PER_CALL = 600;

type BossSession = Doc<"bossSessions">;

/**
 * Settle a boss win/loss once. `settleCombatFight` dedupes by settlementKey;
 * wisdom XP is gated on the settlement not being a duplicate so a re-delivered
 * settle cannot double-award.
 */
async function settleBossFight(
  ctx: MutationCtx,
  playerId: Id<"players">,
  session: BossSession,
  outcome: {
    won: boolean;
    playerHp: number;
    abilityCasts: Array<{ abilityId: string; level: number; casts: number }>;
  },
  now: number
) {
  const settlement = await settleCombatFight(ctx, {
    playerId,
    settlementKey: session.settlementKey,
    sourceType: "boss",
    sourceId: session.bossId,
    tier: session.tier,
    won: outcome.won,
  });
  if (!settlement.duplicate && outcome.abilityCasts.length > 0) {
    await awardAbilityWisdomXp(ctx, playerId, outcome.abilityCasts);
  }
  await ctx.db.patch(session._id, {
    monsterHp: outcome.won ? 0 : session.monsterHp,
    playerHp: outcome.won ? outcome.playerHp : 0,
    status: outcome.won ? "won" : "lost",
    lastStrikeAt: now,
  });
  await writePlayerHp(
    ctx,
    playerId,
    outcome.won ? outcome.playerHp : 0,
    session.playerMaxHp,
    now
  );
  return settlement;
}

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

function rollMonsterHit(monsterAttack: number, ward = 0) {
  return rollPowerHit({ power: monsterAttack, mitigation: ward, minimum: 0 });
}

export interface BossTimelineResult {
  playerHp: number;
  monsterHp: number;
  abilityCasts: Array<{ abilityId: string; level: number; casts: number }>;
}

/**
 * Advance the boss fight's real-time timeline from `session.lastStrikeAt` to
 * `now`, interleaving monster swings with auto-cast abilities so a lethal
 * ability cast wins the tie against a same-millisecond swing (mirroring the
 * auto-battle resolver). The fast path (no abilities equipped) is unchanged
 * from the original monster-only loop, so its timing stays bit-for-bit.
 */
function advanceBossTimeline(args: {
  session: BossSession;
  monsterAttackSpeed: number;
  monsterAttack: number;
  now: number;
  regenPerSecond: number;
  retryMs: number;
}): BossTimelineResult {
  const {
    session,
    monsterAttackSpeed,
    monsterAttack,
    now,
    regenPerSecond,
    retryMs,
  } = args;
  const intervalMs = Math.max(500, 1000 / monsterAttackSpeed);
  const from = session.lastStrikeAt;
  const elapsedMs = Math.max(0, now - from);
  const cappedHits = Math.min(
    MAX_MONSTER_HITS_PER_CALL,
    Math.floor(elapsedMs / intervalMs)
  );
  // If the hit cap kicks in (a long AFK gap), stop the ability timeline at the
  // last applied swing too, so idle time can't free-cast the boss to death.
  const timelineEnd =
    cappedHits >= MAX_MONSTER_HITS_PER_CALL
      ? from + cappedHits * intervalMs
      : now;
  const maxHp = Math.max(1, session.playerMaxHp);

  // Attuned armor augments ward matching-element boss hits.
  const ward =
    typeof session.monsterWard === "number" &&
    Number.isFinite(session.monsterWard) &&
    session.monsterWard > 0
      ? session.monsterWard
      : 0;

  const state = session.abilityState;
  if (!state || state.runtimes.length === 0) {
    let playerHp = session.playerHp;
    for (let i = 0; i < cappedHits; i += 1) {
      playerHp -= rollMonsterHit(monsterAttack, ward);
      if (playerHp <= 0) break;
    }
    // CON + heal-over-time regen ticks alongside monster hits so weak bosses
    // can't grind you down when your build out-regens them.
    if (playerHp > 0 && regenPerSecond > 0 && elapsedMs > 0) {
      playerHp = Math.min(maxHp, playerHp + (regenPerSecond * elapsedMs) / 1000);
    }
    return {
      playerHp: Math.max(0, Math.ceil(playerHp)),
      monsterHp: session.monsterHp,
      abilityCasts: [],
    };
  }

  let playerHp = session.playerHp;
  let monsterHp = session.monsterHp;
  let cursor = from;
  let hitsDone = 0;
  let nextHitAt = from + intervalMs;
  const regenTo = (at: number) => {
    if (regenPerSecond > 0 && at > cursor) {
      playerHp = Math.min(
        maxHp,
        playerHp + (regenPerSecond * (at - cursor)) / 1000
      );
    }
    if (at > cursor) cursor = at;
  };

  const castBudget = state.runtimes.reduce((sum, runtime) => {
    if (!Number.isFinite(runtime.cooldown) || runtime.cooldown <= 0) return sum + 1;
    return sum + Math.ceil(elapsedMs / runtime.cooldown) + 1;
  }, 0);
  const guardLimit = cappedHits + castBudget + 64;

  for (let guard = 0; guard < guardLimit; guard += 1) {
    if (playerHp <= 0 || monsterHp <= 0) break;
    const abilityAt = nextAbilityAt(state);
    const abilityDue = abilityAt !== null && abilityAt <= timelineEnd;
    const hitDue = hitsDone < cappedHits && nextHitAt <= timelineEnd;
    if (!abilityDue && !hitDue) break;

    if (abilityDue && (!hitDue || abilityAt! <= nextHitAt)) {
      const at = Math.max(abilityAt!, cursor);
      regenTo(at);
      const outcome = castDueAbilities({
        state,
        at,
        retryAt: at + retryMs,
        playerHp,
        playerMaxHp: maxHp,
        enemyHp: monsterHp,
        enemyStats: { defense: 0, magicalDefense: 0 },
        weapon: {
          weaponType: state.weaponType,
          element: state.weaponElement,
        },
      });
      playerHp = outcome.playerHp;
      monsterHp = outcome.enemyHp;
    } else {
      regenTo(nextHitAt);
      playerHp -= rollMonsterHit(monsterAttack, ward);
      hitsDone += 1;
      nextHitAt += intervalMs;
    }
  }

  if (playerHp > 0 && regenPerSecond > 0 && timelineEnd > cursor) {
    playerHp = Math.min(
      maxHp,
      playerHp + (regenPerSecond * (timelineEnd - cursor)) / 1000
    );
  }

  return {
    playerHp: Math.max(0, Math.ceil(playerHp)),
    monsterHp: Math.max(0, Math.floor(monsterHp)),
    abilityCasts: abilityCastsLog(state),
  };
}

function toClientState(session: BossSession) {
  return {
    sessionId: session._id,
    settlementKey: session.settlementKey,
    monsterHp: session.monsterHp,
    monsterMaxHp: session.monsterMaxHp,
    monsterElement: session.monsterElement ?? null,
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

    // Boss keys are consumed on start, even if the attempt is abandoned.
    try {
      await consumeBossKey(ctx, playerId, tier);
    } catch (e) {
      throw new Error(
        `Requires 1x Tier ${tier} Boss Key to challenge this boss`
      );
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
    const now = Date.now();
    await tickEquippedConsumables(ctx, playerId, { kind: "boss" }, now);
    const profile = await readPlayerCombatProfile(ctx, player, { now });
    const { combatStats, ward } = profile;
    const bossElement = bossElementForTier(tier);
    const maxHp = Math.max(1, Math.ceil(combatStats.health));
    const regenBalance = await readHpRegenBalance(ctx);
    const hpState = resolveCurrentHp(
      player,
      maxHp,
      profile.effectiveStats.con,
      regenBalance,
      now,
      false
    );
    if (hpState.currentHp <= 0) {
      throw new Error("You are defeated — wait to recover before challenging a boss.");
    }
    await writePlayerHp(ctx, playerId, hpState.currentHp, hpState.maxHp, now);
    const abilityState = await buildAbilityCombatState(
      ctx,
      playerId,
      abilityWeaponFrom(profile.weapon),
      { unit: "ms" },
      { includeAlly: true }
    );
    const sessionId = await ctx.db.insert("bossSessions", {
      playerId,
      bossId: boss.bossId,
      tier,
      monsterHp: monster.maxHp,
      monsterMaxHp: monster.maxHp,
      monsterAttack: monster.attack,
      monsterAttackSpeed: monster.attackSpeed,
      monsterElement: bossElement,
      monsterWard: ward[bossElement] ?? 0,
      playerHp: Math.ceil(hpState.currentHp),
      playerMaxHp: hpState.maxHp,
      settlementKey: `${playerId}:boss-session:${crypto.randomUUID()}`,
      status: "open",
      strikes: 0,
      startedAt: now,
      lastStrikeAt: now,
      ...(abilityState.runtimes.length > 0 ? { abilityState } : {}),
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
    await tickEquippedConsumables(ctx, playerId, { kind: "boss" }, now);
    const profile = await readPlayerCombatProfile(ctx, player, { now });
    const totalRegen =
      profile.conRegenPerSecond + (profile.boosts?.regenPerSecond ?? 0);
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

    // Advance the real-time timeline: monster swings interleaved with
    // auto-cast abilities. Abilities resolve before a same-ms swing.
    const timeline = advanceBossTimeline({
      session,
      monsterAttackSpeed: session.monsterAttackSpeed,
      monsterAttack: session.monsterAttack,
      now,
      regenPerSecond: totalRegen,
      retryMs: Math.max(250, Math.ceil(1000 / session.monsterAttackSpeed)),
    });

    // An auto-cast ability can finish the boss before the strike lands.
    if (timeline.monsterHp <= 0 && timeline.playerHp > 0) {
      const settlement = await settleBossFight(
        ctx,
        playerId,
        session,
        {
          won: true,
          playerHp: timeline.playerHp,
          abilityCasts: timeline.abilityCasts,
        },
        now
      );
      await ctx.db.patch(session._id, { strikes: session.strikes + 1 });
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "won" as const,
        allowed: true,
        isCrit: false,
        damage: 0,
        rewards: {
          gold: settlement.goldEarned,
          experience: settlement.experienceEarned,
          loot: settlement.loot,
        },
      };
    }

    if (timeline.playerHp <= 0) {
      await settleBossFight(
        ctx,
        playerId,
        session,
        { won: false, playerHp: 0, abilityCasts: timeline.abilityCasts },
        now
      );
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "lost" as const,
        allowed: true,
        isCrit: false,
        damage: 0,
      };
    }

    const hit = rollAttackHit({
      attack: profile.combatStats.attack,
      critChance: profile.combatStats.critChance,
      critMultiplier: profile.combatStats.critDamageMultiplier,
    });
    const monsterHp = Math.max(0, timeline.monsterHp - hit.damage);
    if (monsterHp <= 0) {
      const settlement = await settleBossFight(
        ctx,
        playerId,
        session,
        {
          won: true,
          playerHp: timeline.playerHp,
          abilityCasts: timeline.abilityCasts,
        },
        now
      );
      await ctx.db.patch(session._id, { strikes: session.strikes + 1 });
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
      playerHp: timeline.playerHp,
      strikes: session.strikes + 1,
      lastStrikeAt: now,
      ...(session.abilityState ? { abilityState: session.abilityState } : {}),
    });
    await writePlayerHp(ctx, playerId, timeline.playerHp, session.playerMaxHp, now);
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
    const player = await requirePlayer(ctx, playerId);
    await tickEquippedConsumables(ctx, playerId, { kind: "boss" }, now);
    const regenProfile = await readPlayerCombatProfile(ctx, player, { now });
    const regenTotal =
      regenProfile.conRegenPerSecond + (regenProfile.boosts?.regenPerSecond ?? 0);
    const timeline = advanceBossTimeline({
      session,
      monsterAttackSpeed: session.monsterAttackSpeed,
      monsterAttack: session.monsterAttack,
      now,
      regenPerSecond: regenTotal,
      retryMs: Math.max(250, Math.ceil(1000 / session.monsterAttackSpeed)),
    });

    // Auto-cast abilities can win the fight between strikes; report it.
    if (timeline.monsterHp <= 0 && timeline.playerHp > 0) {
      await settleBossFight(
        ctx,
        playerId,
        session,
        {
          won: true,
          playerHp: timeline.playerHp,
          abilityCasts: timeline.abilityCasts,
        },
        now
      );
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "won" as const,
        changed: true as const,
      };
    }

    if (timeline.playerHp >= session.playerHp && timeline.monsterHp >= session.monsterHp) {
      return {
        ...toClientState(session),
        status: "open" as const,
        changed: false as const,
      };
    }
    if (timeline.playerHp <= 0) {
      await settleBossFight(
        ctx,
        playerId,
        session,
        { won: false, playerHp: 0, abilityCasts: timeline.abilityCasts },
        now
      );
      const closed = await ctx.db.get(session._id);
      return {
        ...toClientState(closed!),
        status: "lost" as const,
        changed: true as const,
      };
    }
    await ctx.db.patch(session._id, {
      playerHp: timeline.playerHp,
      monsterHp: timeline.monsterHp,
      lastStrikeAt: now,
      ...(session.abilityState ? { abilityState: session.abilityState } : {}),
    });
    await writePlayerHp(ctx, playerId, timeline.playerHp, session.playerMaxHp, now);
    const updated = await ctx.db.get(session._id);
    return {
      ...toClientState(updated!),
      status: "open" as const,
      changed: true as const,
    };
  },
});

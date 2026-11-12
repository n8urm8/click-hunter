import { mutation, query } from "./_generated/server";
import { requirePlayer, requirePlayerOwner } from "./playerAuth";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { Doc, Id } from "./_generated/dataModel";
import { readPlayerCombatProfile, type PlayerCombatProfile } from "./combat";
import { rollAttackHit, rollPowerHit } from "./hitRoll";
import {
  abilityCastsLog,
  abilityWeaponFrom,
  awardAbilityWisdomXp,
  buildAbilityCombatState,
  castDueAbilities,
  damageWithBuffs,
  mitigateWithBuffs,
  nextAbilityAt,
} from "./abilityCombat";
import {
  readHpRegenBalance,
  readPlayerHpOrNull,
  resolveCurrentHp,
  writePlayerHp,
} from "./playerHp";
import { tickEquippedConsumables } from "./consumableSlots";
import { settleCombatFight } from "./loot";
import { consumeBossKey } from "./infusion";
import { bossElementForTier, readScaledBoss } from "./bossData";
import {
  bossAttackSpeed,
  bossTierDefense,
  monsterBaseHealth,
  monsterPhysicalAttack,
} from "./monsterStats";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import { getTierClearStatus } from "./tierClears";
import {
  assertTierUnlocked,
  endgameGateStatus,
  readEndgameGate,
} from "./endgameGate";

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

function monsterDerivedStats(boss: { str: number; dex: number; con: number; int: number }) {
  return {
    maxHp: Math.max(1, Math.round(monsterBaseHealth(boss))),
    attack: monsterPhysicalAttack(boss),
    attackSpeed: bossAttackSpeed(boss),
  };
}

type BossPlayerCombat = NonNullable<BossSession["playerCombat"]>;

/** Freeze the numbers a boss fight uses from the player's combat profile. */
function bossPlayerCombat(profile: PlayerCombatProfile): BossPlayerCombat {
  const { combatStats } = profile;
  return {
    attack: combatStats.attack,
    critChance: combatStats.critChance,
    critMultiplier: combatStats.critDamageMultiplier,
    strikeCooldownMs: Math.ceil(1000 / combatStats.attackSpeed),
    defense: Math.max(0, combatStats.defense),
    regenPerSecond:
      profile.conRegenPerSecond + (profile.boosts?.regenPerSecond ?? 0),
  };
}

/**
 * The session's frozen combat numbers. Sessions opened before snapshots
 * existed fall back to the live profile.
 */
async function sessionPlayerCombat(
  ctx: MutationCtx,
  session: BossSession,
  now: number
): Promise<BossPlayerCombat> {
  if (session.playerCombat) return session.playerCombat;
  const player = await ctx.db.get(session.playerId);
  if (!player) throw new Error("Player not found");
  return bossPlayerCombat(await readPlayerCombatProfile(ctx, player, { now }));
}

function bossSwingIntervalMs(monsterAttackSpeed: number) {
  return Math.max(500, 1000 / monsterAttackSpeed);
}

export interface BossTimelineResult {
  playerHp: number;
  monsterHp: number;
  abilityCasts: Array<{ abilityId: string; level: number; casts: number }>;
  /** How far the timeline was resolved; persist as `lastStrikeAt`. */
  advancedTo: number;
  /** When the boss swings next; persist as `nextMonsterHitAt`. */
  nextMonsterHitAt: number;
  /** Monster swings and ability casts resolved. Zero means only regen ran. */
  events: number;
}

/**
 * Advance the boss fight's real-time timeline from `session.lastStrikeAt` to
 * `now` on one event loop: monster swings, auto-cast abilities, and
 * continuous regen between them. A lethal ability cast wins the tie against a
 * same-millisecond swing (mirroring the auto-battle resolver).
 *
 * The boss's swing clock lives on the session (`nextMonsterHitAt`), so a
 * player strike never resets it. Swings are mitigated like a raid dragon's:
 * flat defense and elemental ward off the roll, then defense buffs.
 */
function advanceBossTimeline(args: {
  session: BossSession;
  combat: BossPlayerCombat;
  now: number;
}): BossTimelineResult {
  const { session, combat, now } = args;
  const intervalMs = bossSwingIntervalMs(session.monsterAttackSpeed);
  const retryMs = Math.max(250, Math.ceil(intervalMs));
  const from = session.lastStrikeAt;
  const maxHp = Math.max(1, session.playerMaxHp);
  const regenPerSecond = Math.max(0, combat.regenPerSecond);

  // Attuned armor augments ward matching-element boss hits.
  const ward =
    typeof session.monsterWard === "number" &&
    Number.isFinite(session.monsterWard) &&
    session.monsterWard > 0
      ? session.monsterWard
      : 0;
  const mitigation = Math.max(0, combat.defense) + ward;

  let nextHitAt = session.nextMonsterHitAt ?? from + intervalMs;
  const hitsDue =
    nextHitAt <= now ? Math.floor((now - nextHitAt) / intervalMs) + 1 : 0;
  const cappedHits = Math.min(MAX_MONSTER_HITS_PER_CALL, hitsDue);
  // If the hit cap kicks in (a long AFK gap), stop the timeline at the last
  // applied swing; the rest resolves on the next call, so idle time can
  // neither free-cast the boss to death nor skip swings.
  const timelineEnd =
    hitsDue > MAX_MONSTER_HITS_PER_CALL
      ? nextHitAt + (cappedHits - 1) * intervalMs
      : now;

  const state =
    session.abilityState && session.abilityState.runtimes.length > 0
      ? session.abilityState
      : null;
  let playerHp = session.playerHp;
  let monsterHp = session.monsterHp;
  let cursor = from;
  let hitsDone = 0;
  let events = 0;
  const regenTo = (at: number) => {
    if (at <= cursor) return;
    if (regenPerSecond > 0) {
      playerHp = Math.min(
        maxHp,
        playerHp + (regenPerSecond * (at - cursor)) / 1000
      );
    }
    cursor = at;
  };

  const spanMs = Math.max(0, timelineEnd - from);
  const castBudget = (state?.runtimes ?? []).reduce((sum, runtime) => {
    if (!Number.isFinite(runtime.cooldown) || runtime.cooldown <= 0) return sum + 1;
    return sum + Math.ceil(spanMs / Math.min(runtime.cooldown, retryMs)) + 1;
  }, 0);
  const guardLimit = cappedHits + castBudget + 64;

  for (let guard = 0; guard < guardLimit; guard += 1) {
    if (playerHp <= 0 || monsterHp <= 0) break;
    const abilityAt = state ? nextAbilityAt(state) : null;
    const abilityDue = abilityAt !== null && abilityAt <= timelineEnd;
    const hitDue = hitsDone < cappedHits && nextHitAt <= timelineEnd;
    if (!abilityDue && !hitDue) break;

    if (state && abilityDue && (!hitDue || abilityAt! <= nextHitAt)) {
      const at = Math.max(abilityAt!, cursor);
      regenTo(at);
      const outcome = castDueAbilities({
        state,
        at,
        retryAt: at + retryMs,
        playerHp,
        playerMaxHp: maxHp,
        enemyHp: monsterHp,
        enemyStats: {
          defense: session.monsterDefense ?? 0,
          magicalDefense: session.monsterDefense ?? 0,
        },
        weapon: {
          weaponType: state.weaponType,
          element: state.weaponElement,
        },
      });
      playerHp = outcome.playerHp;
      monsterHp = outcome.enemyHp;
      events += outcome.casts;
    } else {
      regenTo(nextHitAt);
      const raw = rollPowerHit({
        power: session.monsterAttack,
        mitigation,
        minimum: 0,
      });
      playerHp -= state ? mitigateWithBuffs(raw, state.buffs, nextHitAt) : raw;
      hitsDone += 1;
      events += 1;
      nextHitAt += intervalMs;
    }
  }

  if (playerHp > 0) regenTo(timelineEnd);

  return {
    playerHp: Math.max(0, Math.ceil(playerHp)),
    monsterHp: Math.max(0, Math.floor(monsterHp)),
    abilityCasts: state ? abilityCastsLog(state) : [],
    advancedTo: Math.max(from, timelineEnd),
    nextMonsterHitAt: nextHitAt,
    events,
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

/** Monsters still to defeat on a tier before its boss can be challenged. */
export const getBossRequirements = query({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
  },
  handler: async (ctx, { playerId, tier }) => {
    await requirePlayerOwner(ctx, playerId);
    return await getTierClearStatus(ctx, playerId, tier);
  },
});

/**
 * The endgame gate as it stands for this player: which tier is the first
 * locked one, what it needs, and whether this player has it.
 */
export const getEndgameGateStatus = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const player = await requirePlayer(ctx, playerId);
    return endgameGateStatus(player, await readEndgameGate(ctx));
  },
});

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
    await assertTierUnlocked(ctx, player, tier);

    const clears = await getTierClearStatus(ctx, playerId, tier);
    if (clears.missingNames.length > 0) {
      throw new Error(
        `Defeat every monster on Tier ${tier} first (${clears.missingNames.length} left: ${clears.missingNames.join(", ")})`
      );
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

    const boss = await readScaledBoss(ctx, tier);
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
    const storedHp = await readPlayerHpOrNull(ctx, playerId);
    const hpState = resolveCurrentHp(
      storedHp,
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
      { unit: "ms" }
    );
    const playerCombat = bossPlayerCombat(profile);
    const sessionId = await ctx.db.insert("bossSessions", {
      playerId,
      bossId: boss.bossId,
      tier,
      monsterHp: monster.maxHp,
      monsterMaxHp: monster.maxHp,
      monsterAttack: monster.attack,
      monsterAttackSpeed: monster.attackSpeed,
      monsterDefense: bossTierDefense(
        tier,
        profile.balance.monsterDefensePerTier,
        profile.balance.bossDefenseMultiplier
      ),
      monsterElement: bossElement,
      monsterWard: ward[bossElement] ?? 0,
      playerHp: Math.ceil(hpState.currentHp),
      playerMaxHp: hpState.maxHp,
      settlementKey: `${playerId}:boss-session:${crypto.randomUUID()}`,
      status: "open",
      strikes: 0,
      startedAt: now,
      lastStrikeAt: now,
      nextMonsterHitAt: now + bossSwingIntervalMs(monster.attackSpeed),
      playerCombat,
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
    await requirePlayer(ctx, playerId);
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
    // Stats were frozen when the fight started (consumables included), so
    // gear swaps and mid-fight consumables don't change the fight.
    const combat = await sessionPlayerCombat(ctx, session, now);
    const status = await rateLimiter.limit(ctx, "manualAttack", {
      key: playerId,
      config: {
        kind: "token bucket",
        rate: 1,
        period: combat.strikeCooldownMs,
        capacity: 1,
      },
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
    const timeline = advanceBossTimeline({ session, combat, now });

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

    const roll = rollAttackHit({
      attack: combat.attack,
      critChance: combat.critChance,
      critMultiplier: combat.critMultiplier,
    });
    // Active offense buffs from auto-cast abilities boost the strike, then the
    // boss's defense comes off. A strike always deals at least 1.
    const buffed = session.abilityState
      ? damageWithBuffs(roll.damage, session.abilityState.buffs, now)
      : roll.damage;
    const hit = {
      isCrit: roll.isCrit,
      damage: Math.max(1, Math.ceil(buffed - (session.monsterDefense ?? 0))),
    };
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
      lastStrikeAt: timeline.advancedTo,
      nextMonsterHitAt: timeline.nextMonsterHitAt,
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
    await requirePlayerOwner(ctx, playerId);
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
    const combat = await sessionPlayerCombat(ctx, session, now);
    const timeline = advanceBossTimeline({ session, combat, now });

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

    // Nothing but regen happened: skip the write. Regen is continuous and
    // deterministic, so the next call resolves it from the same point. Any
    // swing or cast is always kept, whichever way it went, so re-polling
    // can't re-roll swings until they come out badly.
    if (timeline.events === 0) {
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
      lastStrikeAt: timeline.advancedTo,
      nextMonsterHitAt: timeline.nextMonsterHitAt,
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

/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords, playerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { eloSwing } from "./ranked";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const strong = { str: 200, dex: 12, int: 12, luk: 12, con: 200 };
  const average = { str: 12, dex: 12, int: 12, luk: 12, con: 12 };
  const weak = { str: 1, dex: 1, int: 1, luk: 1, con: 1 };
  const make = async (
    subject: string,
    name: string,
    stats: { str: number; dex: number; int: number; luk: number; con: number }
  ) =>
    base.run(async (ctx) => {
      return await insertPlayerWithRecords(ctx, {
        anonymousId: `ranked-${subject}`,
        name,
        authSubject: ownerFor(subject),
        role: "admin",
        ...stats,
        gold: 10_000,
        totalExperience: 0,
        rebirthCount: 0,
        rebirthTierThreshold: 5,
        currentTier: 1,
        maxTierReached: 1,
        autoAttackEnabled: true,
        autoStartFightEnabled: false,
        createdAt: 0,
        lastUpdated: 0,
      });
    });
  const [champion, rival, rookie, weakling] = await Promise.all([
    make("ranked-champion", "Champion", strong),
    make("ranked-rival", "Rival", average),
    make("ranked-rookie", "Rookie", average),
    make("ranked-weakling", "Weakling", weak),
  ]);
  const t = base.withIdentity(testIdentity("ranked-champion"));
  const t2 = base.withIdentity(testIdentity("ranked-rival"));
  return { base, t, t2, champion, rival, rookie, weakling };
}

async function join(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Id<"players">
) {
  return await t.mutation(api.ranked.joinRankedLeague, { playerId });
}

test("elo rewards upsets and taxes favorites symmetrically", () => {
  // Even match: ~16 points move.
  expect(eloSwing(1000, 1000, 32)).toBe(16);
  // Upset pays near K; favorite pays little.
  expect(eloSwing(1000, 1200, 32)).toBe(24);
  expect(eloSwing(1200, 1000, 32)).toBe(8);
  // Losses mirror: crushed by a weaker foe costs what they gained.
  expect(eloSwing(1000, 1200, 32)).toBe(24);
  // Massive gaps never pay zero.
  expect(eloSwing(3000, 500, 32)).toBeGreaterThanOrEqual(1);
  expect(eloSwing(500, 3000, 32)).toBe(32);
});

test("league entry requires combat level 50 and starts at 1000", async () => {
  const { base, t, champion, weakling } = await setup();
  const weakCtx = base.withIdentity(testIdentity("ranked-weakling"));
  await expect(
    weakCtx.mutation(api.ranked.joinRankedLeague, { playerId: weakling })
  ).rejects.toThrow("combat level 50");
  const row = await join(t, champion);
  expect(row?.points).toBe(1000);
  expect(row?.wins).toBe(0);
  await expect(join(t, champion)).rejects.toThrow("already in the ranked league");
});

test("async battles resolve instantly with zero-sum points", async () => {
  const { base, t, t2, champion, rival } = await setup();
  await join(t, champion);
  await join(t2, rival);
  const result = await t.mutation(api.ranked.fightRankedBattle, {
    playerId: champion,
    defenderId: rival,
  });
  // Overwhelming stat gap: the challenger ends it in round one.
  expect(result.draw).toBe(false);
  expect(result.won).toBe(true);
  expect(result.rounds).toBe(1);
  expect(result.pointSwing).toBeGreaterThan(0);
  expect(result.attackerPointsAfter).toBe(1000 + result.pointSwing);
  expect(result.defenderPointsAfter).toBe(1000 - result.pointSwing);
  expect(result.log.length).toBeGreaterThan(0);
  // Neither corner wears anything: empty gear lists, still present.
  expect(result.attackerGear).toEqual([]);
  expect(result.defenderGear).toEqual([]);

  const status = await t.query(api.ranked.getRankedStatus, {
    playerId: champion,
  });
  expect(status).toMatchObject({
    member: true,
    wins: 1,
    battlesLeft: 4,
  });
  const history = await t.query(api.ranked.getMyRankedBattles, {
    playerId: champion,
  });
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    attackerName: "Champion",
    defenderName: "Rival",
    attackerWon: true,
  });
  // The defender sees the same battle from their side.
  const defenderHistory = await t2.query(api.ranked.getMyRankedBattles, {
    playerId: rival,
  });
  expect(defenderHistory).toHaveLength(1);
});

test("defenders must be league members and daily battles are capped", async () => {
  const { base, t, t2, champion, rival, rookie } = await setup();
  await join(t, champion);
  const rookieCtx = base.withIdentity(testIdentity("ranked-rookie"));
  await expect(
    t.mutation(api.ranked.fightRankedBattle, {
      playerId: champion,
      defenderId: rookie,
    })
  ).rejects.toThrow("not in the ranked league");

  await join(t2, rival);
  await rookieCtx.mutation(api.ranked.joinRankedLeague, { playerId: rookie });
  // Exhaust today's allowance directly (day 0 is today at t=1M ms).
  await base.run(async (ctx) => {
    const row = await ctx.db
      .query("rankedFighters")
      .withIndex("by_player", (q) => q.eq("playerId", champion))
      .first();
    if (!row) throw new Error("Missing ranked row");
    await ctx.db.patch(row._id, { battlesUsed: 5, battleDay: 0 });
  });
  await expect(
    t.mutation(api.ranked.fightRankedBattle, {
      playerId: champion,
      defenderId: rival,
    })
  ).rejects.toThrow("Daily ranked battles used");

  // A new UTC day refreshes the allowance.
  vi.setSystemTime(1_000_000 + 86_400_000);
  const result = await t.mutation(api.ranked.fightRankedBattle, {
    playerId: champion,
    defenderId: rival,
  });
  expect(result.draw).toBe(false);
});

test("match list offers the five nearest point totals with previews", async () => {
  const { base, t, champion } = await setup();
  await join(t, champion);
  // Six sparring partners spread across the ladder.
  const specs: Array<[string, number]> = [
    ["ranked-a", 1500],
    ["ranked-b", 1200],
    ["ranked-c", 1050],
    ["ranked-d", 950],
    ["ranked-e", 800],
    ["ranked-f", 500],
  ];
  for (const [subject, points] of specs) {
    const id = await base.run((ctx) =>
      insertPlayerWithRecords(ctx, {
        anonymousId: `ranked-${subject}`,
        name: subject,
        authSubject: ownerFor(subject),
        role: "admin",
        str: 12, dex: 12, int: 12, luk: 12, con: 12,
        gold: 0, totalExperience: 0, rebirthCount: 0,
        rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
        autoAttackEnabled: true, autoStartFightEnabled: false,
        createdAt: 0, lastUpdated: 0,
      })
    );
    const client = base.withIdentity(testIdentity(subject));
    await client.mutation(api.ranked.joinRankedLeague, { playerId: id });
    await base.run(async (ctx) => {
      const row = await ctx.db
        .query("rankedFighters")
        .withIndex("by_player", (q) => q.eq("playerId", id))
        .first();
      if (!row) throw new Error("Missing ranked row");
      await ctx.db.patch(row._id, { points });
    });
  }
  const opponents = await t.query(api.ranked.findRankedOpponents, {
    playerId: champion,
  });
  // Five nearest to 1000, self excluded, closest first.
  expect(opponents.map((o) => o.points)).toEqual([1050, 950, 1200, 800, 1500]);
  for (const opponent of opponents) {
    expect(opponent.winGain).toBeGreaterThanOrEqual(1);
    expect(opponent.lossCost).toBeGreaterThanOrEqual(1);
  }
  // Favorite pays little, underdog gains much.
  const favorite = opponents.find((o) => o.points === 800)!;
  const underdog = opponents.find((o) => o.points === 1500)!;
  expect(favorite.winGain).toBeLessThan(underdog.winGain);
  expect(favorite.lossCost).toBeGreaterThan(underdog.lossCost);
});

test("weekly settlement pays the top 10 and resets the ladder", async () => {
  const { base, t, t2, champion, rival } = await setup();
  await join(t, champion);
  await join(t2, rival);
  await base.run(async (ctx) => {
    for (const [id, points] of [
      [champion, 1500],
      [rival, 1200],
    ] as const) {
      const row = await ctx.db
        .query("rankedFighters")
        .withIndex("by_player", (q) => q.eq("playerId", id))
        .first();
      if (!row) throw new Error("Missing ranked row");
      await ctx.db.patch(row._id, { points });
    }
  });
  const before: Record<string, number> = {};
  for (const id of [champion, rival]) {
    const row: Awaited<ReturnType<typeof playerWithRecords>> = await base.run((ctx) => playerWithRecords(ctx, id)
    );
    before[String(id)] = row?.gold ?? 0;
  }
  const settled = await base.run((ctx) =>
    ctx.runMutation(internal.ranked.settleRankedWeek, {})
  );
  expect(settled).toMatchObject({ alreadySettled: false, winners: 2 });
  const afterChampion: Awaited<ReturnType<typeof playerWithRecords>> = await base.run((ctx) => playerWithRecords(ctx, champion)
  );
  const afterRival: Awaited<ReturnType<typeof playerWithRecords>> = await base.run((ctx) => playerWithRecords(ctx, rival)
  );
  expect((afterChampion?.gold ?? 0) - before[String(champion)]).toBe(5000);
  expect((afterRival?.gold ?? 0) - before[String(rival)]).toBe(4000);
  const rows = await base.run((ctx) =>
    ctx.db.query("rankedFighters").collect()
  );
  expect(rows.every((row) => row.points === 1000)).toBe(true);
  const season = await base.run((ctx) =>
    ctx.db.query("rankedSeasons").collect()
  );
  expect(season).toHaveLength(1);
  expect(season[0].standings.map((s) => s.placement)).toEqual([1, 2]);
  // Retries in the same week are a no-op (no double payout).
  const again = await base.run((ctx) =>
    ctx.runMutation(internal.ranked.settleRankedWeek, {})
  );
  expect(again).toMatchObject({ alreadySettled: true });
  const rechampion: Awaited<ReturnType<typeof playerWithRecords>> = await base.run((ctx) => playerWithRecords(ctx, champion)
  );
  expect(rechampion?.gold).toBe(afterChampion?.gold);
});

test("ranked balance backfill is idempotent", async () => {
  const { t } = await setup();
  const first = await t.mutation(internal.migrations.backfillRankedBalance, {});
  expect(first.created).toBe(7);
  expect(await t.mutation(internal.migrations.backfillRankedBalance, {})).toEqual({
    created: 0,
  });
});

test("admin rejects malformed ranked balance values", async () => {
  const { t, champion } = await setup();
  await t.mutation(internal.migrations.backfillRankedBalance, {});
  const row = await t.query((ctx) =>
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "rankedKFactor"))
      .unique()
  );
  if (!row) throw new Error("Missing ranked balance row");
  await expect(
    t.mutation(api.admin.updateGameBalance, {
      playerId: champion,
      balanceId: row._id,
      value: 0,
      description: "Too low",
    })
  ).rejects.toThrow("between 1 and 1000000");
});

async function seedRankedStaff(
  base: ReturnType<typeof convexTest>,
  playerId: Id<"players">,
  withAbility: boolean
) {
  await base.run(async (ctx) => {
    const now = Date.now();
    const staff = await ctx.db.insert("items", {
      itemId: "ranked-test-staff",
      name: "Ranked Staff",
      category: "equipment",
      description: "d",
      stackable: false,
      maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"],
      rarityLevel: 10,
      baseDamage: 5,
      attackSpeed: 1,
      damageStat: "int",
      damageType: "magical",
      weaponType: "staff",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId,
      itemId: staff,
      quantity: 1,
      equippedSlot: "mainHand",
      acquiredAt: now,
      updatedAt: now,
    });
    if (!withAbility) return;
    await ctx.db.insert("abilities", {
      abilityId: "ranked_bolt",
      name: "Ranked Bolt",
      description: "d",
      type: "attack",
      target: "enemy",
      weaponType: "staff",
      basePower: 20,
      powerScalingPerLevel: 0,
      cooldownMs: 1_000,
      tier: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: "ranked_bolt",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId,
      slot: 0,
      abilityId: "ranked_bolt",
      equippedAt: now,
    });
  });
}

async function fightOneRankedBout(withAbility: boolean) {
  const { base, t, t2, champion, rival } = await setup();
  await seedRankedStaff(base, champion, withAbility);
  await join(t, champion);
  await join(t2, rival);
  // Equalize after the league level gate so auto-attacks are identical and
  // the only difference between runs is the ability cast.
  await base.run(async (ctx) => {
    const equal = { str: 20, dex: 20, int: 20, luk: 20, con: 200 };
    await ctx.db.patch(champion, equal);
    await ctx.db.patch(rival, equal);
  });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  return await t.mutation(api.ranked.fightRankedBattle, {
    playerId: champion,
    defenderId: rival,
  });
}

test("ranked bouts auto-cast equipped abilities into the round log", async () => {
  const control = await fightOneRankedBout(false);
  const boosted = await fightOneRankedBout(true);

  expect(control.log.length).toBeGreaterThan(0);
  expect(boosted.log.length).toBeGreaterThan(0);
  const extra =
    boosted.log[0].damageAttackerToDefender -
    control.log[0].damageAttackerToDefender;
  expect(extra).toBeGreaterThan(0);
  expect(boosted.draw).toBe(false);
});

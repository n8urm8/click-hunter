/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords, patchPlayerWithRecords, playerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { awardAbilityWisdomXp, buildAbilityCombatState } from "./abilityCombat";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity(testIdentity("boss-fix-user"));
  const playerId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await insertPlayerWithRecords(ctx, {
      anonymousId: "boss-fix",
      name: "Caster",
      authSubject: ownerFor("boss-fix-user"),
      str: 10,
      dex: 10,
      int: 10,
      luk: 5,
      con: 200,
      gold: 0,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });

    // A staff enables the arcane bolt below.
    const staff = await ctx.db.insert("items", {
      itemId: "test-staff",
      name: "Test Staff",
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
      playerId: id,
      itemId: staff,
      quantity: 1,
      equippedSlot: "mainHand",
      acquiredAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("bosses", {
      bossId: "boss_tier_1",
      tier: 1,
      name: "B1",
      str: 1,
      dex: 1,
      int: 1,
      luk: 1,
      con: 1,
      rewardMultiplier: 1,
      createdAt: now,
    });
    const key = await ctx.db.insert("items", {
      itemId: "boss-key-tier-1",
      name: "Key 1",
      category: "crafting",
      description: "d",
      stackable: true,
      maxStackSize: 25,
      allowedEquipmentSlots: [],
      rarityLevel: 10,
      itemFamily: "boss-key",
      craftingSkillId: "infusion",
      craftingTier: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId: id,
      itemId: key,
      quantity: 1,
      acquiredAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("abilities", {
      abilityId: "arcane_bolt",
      name: "Arcane Bolt",
      description: "Starter spell",
      type: "attack",
      target: "enemy",
      weaponType: "staff",
      element: "arcane",
      basePower: 4,
      powerScalingPerLevel: 0,
      cooldownMs: 7_000,
      tier: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId: id,
      abilityId: "arcane_bolt",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId: id,
      slot: 0,
      abilityId: "arcane_bolt",
      equippedAt: now,
    });
    return id;
  });
  return { t, playerId };
}


/** No abilities, a fast staff, and a boss that swings every 2s. */
async function prepBoss(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Awaited<ReturnType<typeof setup>>["playerId"],
  boss: { str: number; con?: number } = { str: 60 }
) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("playerEquippedAbilities").collect()) {
      await ctx.db.delete(row._id);
    }
    const staff = await ctx.db
      .query("items")
      .filter((q) => q.eq(q.field("itemId"), "test-staff"))
      .first();
    await ctx.db.patch(staff!._id, { attackSpeed: 3 });
    const row = await ctx.db
      .query("bosses")
      .withIndex("by_tier", (q) => q.eq("tier", 1))
      .first();
    await ctx.db.patch(row!._id, {
      con: boss.con ?? 100_000,
      str: boss.str,
      dex: 1,
      statsTierScaled: true,
    });
  });
  return await t.mutation(api.bossFights.startBossFight, { playerId, tier: 1 });
}

/** Zero regen, defense, and ward so a test counts raw swings exactly. */
async function neutralize(
  t: Awaited<ReturnType<typeof setup>>["t"],
  sessionId: Awaited<ReturnType<typeof prepBoss>>["sessionId"]
) {
  await t.run(async (ctx) => {
    const row = await ctx.db.get(sessionId);
    await ctx.db.patch(sessionId, {
      monsterWard: 0,
      playerCombat: { ...row!.playerCombat!, defense: 0, regenPerSecond: 0 },
    });
  });
}

test("striking faster than the boss swings does not skip its swings", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const striker = await setup();
  const strikeSession = await prepBoss(striker.t, striker.playerId, { str: 20 });
  await neutralize(striker.t, strikeSession.sessionId);
  let last = null as null | { playerHp: number; allowed: boolean };
  for (let second = 1; second <= 30; second += 1) {
    vi.setSystemTime(second * 1_000);
    last = await striker.t.mutation(api.bossFights.strikeBoss, {
      playerId: striker.playerId,
      sessionId: strikeSession.sessionId,
    });
    expect(last.allowed).toBe(true);
  }

  vi.setSystemTime(0);
  const idler = await setup();
  const idleSession = await prepBoss(idler.t, idler.playerId, { str: 20 });
  await neutralize(idler.t, idleSession.sessionId);
  vi.setSystemTime(30_000);
  const idle = await idler.t.mutation(api.bossFights.checkBossFight, {
    playerId: idler.playerId,
    sessionId: idleSession.sessionId,
  });

  // str 20, dex 1: attack 24.5, so each swing rolls 25 + 6 = 31. Fifteen
  // swings land in 30s whether the player strikes every second or idles.
  expect(idle.playerHp).toBe(idleSession.playerHp - 15 * 31);
  expect(last!.playerHp).toBe(idle.playerHp);
});

test("boss swings are mitigated by the player's defense", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { t, playerId } = await setup();
  const session = await prepBoss(t, playerId, { str: 500 });
  await t.run(async (ctx) => {
    const row = await ctx.db.get(session.sessionId);
    await ctx.db.patch(session.sessionId, {
      playerCombat: { ...row!.playerCombat!, defense: 1_000_000 },
    });
  });
  vi.setSystemTime(30_000);
  const result = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(result.status).toBe("open");
  expect(result.playerHp).toBe(session.playerHp);
});

test("player stats are frozen at the start, so swapping gear mid-fight changes nothing", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { t, playerId } = await setup();
  const session = await prepBoss(t, playerId, { str: 1 });
  vi.setSystemTime(1_000);
  const first = await t.mutation(api.bossFights.strikeBoss, {
    playerId,
    sessionId: session.sessionId,
  });
  await t.run(async (ctx) => {
    const staff = await ctx.db
      .query("playerItems")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .filter((q) => q.eq(q.field("equippedSlot"), "mainHand"))
      .first();
    await ctx.db.patch(staff!._id, { equippedSlot: undefined });
  });
  vi.setSystemTime(3_000);
  const second = await t.mutation(api.bossFights.strikeBoss, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(second.allowed).toBe(true);
  expect(second.damage).toBe(first.damage);
});

test("a poll always keeps a resolved swing, and skips the write when only regen ran", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { t, playerId } = await setup();
  const session = await prepBoss(t, playerId, { str: 1 });
  // A tiny swing that regen out-heals: the old poll discarded it and re-rolled.
  await t.run((ctx) => ctx.db.patch(session.sessionId, { playerHp: 100 }));

  vi.setSystemTime(2_500);
  const hit = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(hit.changed).toBe(true);
  let stored = await t.run((ctx) => ctx.db.get(session.sessionId));
  expect(stored?.lastStrikeAt).toBe(2_500);
  expect(stored?.nextMonsterHitAt).toBe(4_000);

  vi.setSystemTime(3_000);
  const quiet = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(quiet.changed).toBe(false);
  stored = await t.run((ctx) => ctx.db.get(session.sessionId));
  expect(stored?.lastStrikeAt).toBe(2_500);
});

test("regen between swings counts for players without abilities", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { t, playerId } = await setup();
  // str 50, dex 1: attack 60.5, so each swing rolls 61 + 15 = 76.
  const session = await prepBoss(t, playerId, { str: 50 });
  await t.run(async (ctx) => {
    const row = await ctx.db.get(session.sessionId);
    await ctx.db.patch(session.sessionId, {
      playerHp: 80,
      monsterWard: 0,
      playerCombat: { ...row!.playerCombat!, defense: 0, regenPerSecond: 50 },
    });
  });
  vi.setSystemTime(4_500);
  const result = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  // 80 +100 -76 = 104, +100 -76 = 128, +25 = 153. Applying all hits first
  // and regen last (the old fast path) killed the player at the second swing.
  expect(result.status).toBe("open");
  expect(result.playerHp).toBe(153);
});

test("banked rebirth bonuses raise ability power, cut cooldown, and add wisdom XP", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(playerId, { rebirthAbilityBonuses: { arcane_bolt: 2 } })
  );
  const state = await t.run((ctx) =>
    buildAbilityCombatState(
      ctx,
      playerId,
      { weaponType: "staff" },
      { unit: "ms" }
    )
  );
  // Seeded defaults: +3% power and -2% cooldown per bonus.
  expect(state.runtimes[0].powerMultiplier).toBeCloseTo(1.06);
  expect(state.runtimes[0].cooldown).toBe(6_720);

  await t.run((ctx) =>
    awardAbilityWisdomXp(ctx, playerId, [
      { abilityId: "arcane_bolt", level: 1, casts: 1 },
    ])
  );
  const after = await t.run((ctx) => playerWithRecords(ctx, playerId));
  // 10 base XP per use, +5% per banked bonus.
  expect(after?.statXp?.wis).toBe(11);
});

test("ally heals are kept for auto-battle and land on the caster", async () => {
  const { t, playerId } = await setup();
  const state = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("abilities", {
      abilityId: "mend_ally",
      name: "Mend Ally",
      description: "d",
      type: "heal",
      target: "ally",
      weaponType: "any",
      basePower: 20,
      powerScalingPerLevel: 0,
      cooldownMs: 5_000,
      tier: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: "mend_ally",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId,
      slot: 1,
      abilityId: "mend_ally",
      equippedAt: now,
    });
    return await buildAbilityCombatState(ctx, playerId, null, { unit: "ms" });
  });
  expect(state.runtimes.map((runtime) => runtime.spec.abilityId)).toContain(
    "mend_ally"
  );
});

test("bosses have three times a regular monster's tier defense, taken off every strike", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { t, playerId } = await setup();
  const session = await prepBoss(t, playerId, { str: 1 });
  const stored = await t.run((ctx) => ctx.db.get(session.sessionId));
  // Tier 1: 1 defense per tier, times the default boss multiplier of 3.
  expect(stored?.monsterDefense).toBe(3);
  vi.setSystemTime(1_000);
  const strike = await t.mutation(api.bossFights.strikeBoss, {
    playerId,
    sessionId: session.sessionId,
  });
  const attack = stored!.playerCombat!.attack;
  expect(strike.damage).toBe(Math.max(1, Math.ceil(attack - 3)));
  expect(strike.monsterHp).toBe(session.monsterHp - strike.damage);
});

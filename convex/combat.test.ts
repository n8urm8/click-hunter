/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  DEFAULT_MONSTER_POWER_MULTIPLIER,
  readPlayerCombatProfile,
  simulateRegularBattle,
} from "./combat";
import {
  COMBAT_BALANCE_DEFAULTS,
  computeAttackSpeed,
  readCombatBalance,
} from "./items";
import schema from "./schema";
import { projectBattleHealth } from "./taskTiming";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(weaponSpeed = 1.3) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const fixture = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "combat-test", name: "Hunter", role: "admin",
      str: 10, dex: 10, int: 10, luk: 0, con: 50,
      gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
      currentTier: 1, autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    const itemId = await ctx.db.insert("items", {
      itemId: "test-bow", name: "Test Bow", category: "equipment",
      description: "Test weapon", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], baseDamage: 8,
      attackSpeed: weaponSpeed, damageStat: "dex", damageType: "physical",
      effectType: "stat-bonus", effectStat: "dex", effectAmount: 2,
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId, quantity: 1, equippedSlot: "mainHand",
      acquiredAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("monsters", {
      type: "training", name: "Training Monster", str: 1, dex: 1, int: 1,
      luk: 1, con: 1_000, goldDrop: 10, experienceReward: 5,
      baseMsPerAttack: 2_000, strength: 1, createdAt: 0,
    });
    return { playerId, itemId };
  });
  return { t, ...fixture };
}

test("every weapon is exactly half speed, including slow weapons and the speed floor", () => {
  const rates = [
    [1, 0.5], [1.6, 0.8], [0.65, 0.325], [1.3, 0.65], [0.8, 0.4],
  ];
  for (const [speed, expected] of rates) {
    expect(computeAttackSpeed(speed, 5, 0, {
      dexSpeedCoeff: 0.1, minAttackSpeed: 0.5, attackSpeedMultiplier: 0.5,
    })).toBeCloseTo(expected);
    for (const dex of [5, 20]) {
      for (const armorPenalty of [0, 0.08, 3]) {
        const previous = Math.max(0.5, speed + Math.max(0, dex - 10) * 0.1 - armorPenalty);
        expect(computeAttackSpeed(speed, dex, armorPenalty, {
          dexSpeedCoeff: 0.1, minAttackSpeed: 0.5, attackSpeedMultiplier: 0.5,
        })).toBeCloseTo(previous / 2);
      }
    }
  }
});

test("existing weapons, displayed stats, inventory and real auto-battle use configured speed", async () => {
  const { t, playerId } = await setup();
  const player = await t.query(api.players.getPlayerById, { playerId });
  expect(player?.autoAttackEnabled).toBe(true);
  expect(player?.effectiveStats.dex).toBe(12);
  expect(player?.combatStats).toMatchObject({
    attack: 22.4, health: 500, defense: 40, attackSpeed: 0.75, critChance: 0,
  });
  const result = await t.mutation(async (ctx) => {
    const row = await ctx.db.get(playerId);
    if (!row) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, row, 1);
  });
  expect(result.playerAttackSpeed).toBe(player?.combatStats.attackSpeed);
  expect(result.playerDamagePerSecond).toBeCloseTo(22.4 * 1000 / 1_334);
  expect(result.playerMaxHealth).toBe(player?.combatStats.health);
  expect((await t.query(api.items.getPlayerInventory, { playerId })).attackSpeedMultiplier).toBe(0.5);
});

test("regular monster power defaults to original strength and honors the balance override", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    const monster = await ctx.db.query("monsters").unique();
    if (!monster) throw new Error("Missing test monster");
    await ctx.db.patch(monster._id, { str: 100, int: 100 });
  });

  const simulate = () => t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  const originalStrength = await simulate();
  expect(DEFAULT_MONSTER_POWER_MULTIPLIER).toBe(1);

  await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "monsterPowerMultiplier", value: 0.5, description: "Previous default",
    lastUpdated: 0,
  }));
  const reduced = await simulate();
  expect(originalStrength.monsterMaxHealth).toBe(reduced.monsterMaxHealth * 2);
  const originalHitDamage =
    originalStrength.attackTiming?.monsterDamagePerHit ?? 0;
  const reducedHitDamage = reduced.attackTiming?.monsterDamagePerHit ?? 0;
  expect(originalHitDamage).toBeGreaterThan(0);
  expect(originalHitDamage).toBe(reducedHitDamage * 2);
});

test("halving speed halves authoritative DPS and doubles win duration, not enemy speed or damage", async () => {
  const { t, playerId } = await setup();
  const multiplierId = await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "combatAttackSpeedMultiplier", value: 1, description: "Speed", lastUpdated: 0,
  }));
  const simulate = () => t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  const original = await simulate();
  await t.run((ctx) => ctx.db.patch(multiplierId, { value: 0.5 }));
  const slowed = await simulate();
  expect(original.won).toBe(true);
  expect(slowed.won).toBe(true);
  expect(slowed.playerDamagePerSecond).toBeCloseTo(original.playerDamagePerSecond / 2);
  expect(Math.abs(slowed.durationMs - original.durationMs * 2)).toBeLessThanOrEqual(1);
  expect(slowed.monsterDamagePerSecond).toBe(original.monsterDamagePerSecond);
  expect(slowed.monsterMaxHealth).toBe(original.monsterMaxHealth);
});

test("boss attack cooldown agrees with the equipped rate and rejects early attacks", async () => {
  const { t, playerId } = await setup(0.65);
  await t.run((ctx) => ctx.db.patch(playerId, { dex: 5 }));
  const player = await t.query(api.players.getPlayerById, { playerId });
  expect(player?.combatStats.attackSpeed).toBeCloseTo(0.325);
  expect(await t.mutation(api.players.attemptAttack, { playerId }))
    .toMatchObject({ allowed: true, cooldownMs: 3_077 });
  vi.setSystemTime(3_076);
  expect((await t.mutation(api.players.attemptAttack, { playerId })).allowed).toBe(false);
  vi.setSystemTime(3_077);
  expect((await t.mutation(api.players.attemptAttack, { playerId })).allowed).toBe(true);
});

test("slower attacks can turn a formerly winning encounter into an authoritative loss", async () => {
  const { t, playerId } = await setup();
  const multiplierId = await t.run(async (ctx) => {
    const monster = await ctx.db.query("monsters").unique();
    if (!monster) throw new Error("Missing test monster");
    await ctx.db.patch(monster._id, { str: 150, con: 20 });
    return ctx.db.insert("gameBalance", {
      key: "combatAttackSpeedMultiplier", value: 1, description: "Speed", lastUpdated: 0,
    });
  });
  const simulate = () => t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  expect((await simulate()).won).toBe(true);
  await t.run((ctx) => ctx.db.patch(multiplierId, { value: 0.5 }));
  expect(await simulate()).toMatchObject({ won: false, goldEarned: 0, experienceEarned: 0 });
});

test("shared equipment stats preserve speed passives and elemental damage", async () => {
  const { t, playerId, itemId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.patch(itemId, { element: "fire" });
    for (const [nodeId, effectType, effectAmount] of [
      ["speed", "attack-speed-percent", 0.2],
      ["damage", "damage-percent", 0.1],
      ["fire", "elemental-damage-percent", 0.4],
    ] as const) {
      await ctx.db.insert("passiveNodes", {
        nodeId, branch: "bow", name: nodeId, description: nodeId,
        effectType, effectAmount, ...(nodeId === "fire" ? { element: "fire" } : {}),
        requires: [], positionX: 0, positionY: 0, enabled: true,
        createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("playerPassives", { playerId, nodeId, unlockedAt: 0 });
    }
  });
  const player = await t.query(api.players.getPlayerById, { playerId });
  expect(player?.combatStats.attackSpeed).toBeCloseTo(0.75 * 1.2);
  expect(player?.combatStats.attack).toBeCloseTo(22.4 * 1.1 * 1.4);
  const result = await t.mutation(async (ctx) => {
    const row = await ctx.db.get(playerId);
    if (!row) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, row, 1);
  });
  expect(result.playerDamagePerSecond).toBeCloseTo(22.4 * 1.1 * 1.4 * 1000 / 1_112);
});

test("real slow-weapon encounters cannot damage or finish before the first swing", async () => {
  const { t, playerId } = await setup(0.65);
  const result = await t.mutation(async (ctx) => {
    await ctx.db.patch(playerId, { dex: 5 });
    const monster = await ctx.db.query("monsters").unique();
    const player = await ctx.db.get(playerId);
    if (!monster || !player) throw new Error("Missing test combatants");
    await ctx.db.patch(monster._id, { con: 1, int: 1 });
    return simulateRegularBattle(ctx, player, 1);
  });
  expect(result.attackTiming?.playerIntervalMs).toBe(3_077);
  expect(result.durationMs).toBeGreaterThanOrEqual(3_077);
  expect(projectBattleHealth(result, 3_076).currentMonsterHealth).toBe(Math.ceil(result.monsterMaxHealth));
  expect(projectBattleHealth(result, 3_077).currentMonsterHealth).toBeLessThan(result.monsterMaxHealth);
  expect(projectBattleHealth(result, result.durationMs).currentMonsterHealth).toBe(0);
});

test("fractional per-hit damage reaches zero health on the authoritative lethal swing", () => {
  const result = {
    won: true, monsterTier: 1, monsterType: "training", monsterName: "Training",
    monsterMaxHealth: 67.2, playerMaxHealth: 100,
    playerDamagePerSecond: 22.4, monsterDamagePerSecond: 0,
    durationMs: 3_000,
    attackTiming: {
      playerIntervalMs: 1_000, monsterIntervalMs: 2_000,
      playerDamagePerHit: 22.4, monsterDamagePerHit: 0,
    },
  };
  expect(projectBattleHealth(result, 2_999).currentMonsterHealth).toBeGreaterThan(0);
  expect(projectBattleHealth(result, 3_000).currentMonsterHealth).toBe(0);
});

test("live speed buffs affect encounters and cooldowns without adding clock-dependent player queries", async () => {
  const { t, playerId, itemId } = await setup();
  await t.run((ctx) => ctx.db.insert("playerCombatBoosts", {
    playerId, sourceItemId: itemId, effectType: "combat-stat-boost",
    effectStat: "dex", effectAmount: 10, startedAt: 0, expiresAt: 10_000,
    createdAt: 0, updatedAt: 0,
  }));
  const profileAt = (now: number) => t.query(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return readPlayerCombatProfile(ctx, player, now);
  });
  expect((await profileAt(0)).combatStats.attackSpeed).toBe(1.25);
  expect((await profileAt(10_000)).combatStats.attackSpeed).toBe(0.75);
  expect((await t.mutation(api.players.attemptAttack, { playerId })).cooldownMs).toBe(800);
  const before = await t.query(api.players.getPlayerById, { playerId });
  vi.setSystemTime(100_000);
  expect(await t.query(api.players.getPlayerById, { playerId })).toEqual(before);
});

test("new and reborn players always auto attack; old clients cannot disable it", async () => {
  const { t, playerId } = await setup();
  expect((await t.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "new-player", name: "New Hunter",
  }))?.autoAttackEnabled).toBe(true);
  await expect(t.mutation(api.players.setAutoAttack, { playerId, enabled: false }))
    .rejects.toThrow("Auto attack is always enabled");
  await t.mutation(api.players.setAutoAttack, { playerId, enabled: true });
  await t.run((ctx) => ctx.db.patch(playerId, { maxTierReached: 5 }));
  await t.mutation(api.players.rebirth, { playerId });
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.autoAttackEnabled).toBe(true);
});

test("legacy client-calculated regular fights cannot bypass server auto-battle", async () => {
  const { t, playerId } = await setup();
  await expect(t.mutation(api.upgrades.recordFight, {
    playerId, monsterTier: 1, monsterType: "training", isBoss: false, won: true,
    settlementKey: "legacy-win",
  })).rejects.toThrow("auto-battle queue");
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.gold).toBe(0);
});

test("combat balance backfill is idempotent, preserves tuning and validates bad multipliers", async () => {
  const { t, playerId } = await setup();
  expect((await t.mutation(internal.migrations.backfillCombatBalance, {})).created)
    .toBe(COMBAT_BALANCE_DEFAULTS.length);
  expect(await t.mutation(internal.migrations.backfillCombatBalance, {})).toEqual({ created: 0 });
  const row = await t.query((ctx) => ctx.db.query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "combatAttackSpeedMultiplier")).unique());
  if (!row) throw new Error("Missing speed setting");
  for (const value of [0, -1, "invalid"]) {
    await expect(t.mutation(api.admin.updateGameBalance, {
      playerId, balanceId: row._id, value, description: "Invalid",
    })).rejects.toThrow("positive finite");
    await t.run((ctx) => ctx.db.patch(row._id, { value }));
    expect((await t.query((ctx) => readCombatBalance(ctx))).attackSpeedMultiplier).toBe(0.5);
  }
  await t.mutation(api.admin.updateGameBalance, {
    playerId, balanceId: row._id, value: 0.25, description: "Slower",
  });
  await t.mutation(internal.migrations.backfillCombatBalance, {});
  expect((await t.query((ctx) => readCombatBalance(ctx))).attackSpeedMultiplier).toBe(0.25);
});

test("enemy power restoration updates the old default and preserves other tuning", async () => {
  const { t } = await setup();
  const balanceId = await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "monsterPowerMultiplier", value: 0.5, description: "Previous default",
    lastUpdated: 0,
  }));

  expect(await t.mutation(internal.migrations.restoreMonsterPowerMultiplier, {}))
    .toEqual({ created: false, updated: true });
  expect((await t.run((ctx) => ctx.db.get(balanceId)))?.value).toBe(1);
  expect(await t.mutation(internal.migrations.restoreMonsterPowerMultiplier, {}))
    .toEqual({ created: false, updated: false });

  await t.run((ctx) => ctx.db.patch(balanceId, { value: 0.75 }));
  expect(await t.mutation(internal.migrations.restoreMonsterPowerMultiplier, {}))
    .toEqual({ created: false, updated: false });
  expect((await t.run((ctx) => ctx.db.get(balanceId)))?.value).toBe(0.75);
});

test("enemy power restoration creates the original-strength setting when missing", async () => {
  const { t } = await setup();
  expect(await t.mutation(internal.migrations.restoreMonsterPowerMultiplier, {}))
    .toEqual({ created: true, updated: false });
  const row = await t.query((ctx) => ctx.db.query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "monsterPowerMultiplier")).unique());
  expect(row?.value).toBe(1);
});

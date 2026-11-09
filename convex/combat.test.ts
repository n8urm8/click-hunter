/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { awardAbilityWisdomXp } from "./abilityCombat";
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
  DEX_SPEED_COEFF_DEFAULT,
  computeAttackSpeed,
  inferWeaponType,
  readCombatBalance,
} from "./items";
import {
  STAFF_BASE_DAMAGE_PER_TIER,
  STARTER_STAFF_BASE_DAMAGE,
} from "./forestCraftingSeed";
import { HP_REGEN_BALANCE_DEFAULTS, readHpRegenBalance, resolveCurrentHp } from "./playerHp";
import { LEATHER_BALANCE_DEFAULTS } from "./leatherwork";
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
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "combat-user" });
  const fixture = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "combat-test", name: "Hunter", role: "admin",
      authSubject: "combat-user",
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
    // These tests pin speed math; batchSettlement.test.ts covers the compensation.
    await ctx.db.insert("gameBalance", {
      key: "weaponSpeedDamageExponent", value: 0, description: "Test", lastUpdated: 0,
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
        const previous = Math.max(0.5, speed * (1 + Math.max(0, dex - 10) * 0.1 - armorPenalty));
        expect(computeAttackSpeed(speed, dex, armorPenalty, {
          dexSpeedCoeff: 0.1, minAttackSpeed: 0.5, attackSpeedMultiplier: 0.5,
        })).toBeCloseTo(previous / 2);
      }
    }
  }
});

test("auto-battle applies the player's elemental ward", async () => {
  const { t, playerId } = await setup();
  // One fire monster so the fight is deterministic.
  await t.run(async (ctx) => {
    for (const monster of await ctx.db.query("monsters").collect()) {
      await ctx.db.delete(monster._id);
    }
    await ctx.db.insert("monsters", {
      type: "ember",
      name: "Ember Beast",
      str: 60,
      dex: 1,
      int: 1,
      luk: 1,
      con: 1_000,
      element: "fire",
      goldDrop: 10,
      experienceReward: 5,
      baseMsPerAttack: 2_000,
      strength: 1,
      createdAt: 0,
    });
  });

  const fight = async () =>
    await t.mutation(async (ctx) => {
      const row = await ctx.db.get(playerId);
      if (!row) throw new Error("Missing test player");
      return simulateRegularBattle(ctx, row, 1);
    });

  const unwarded = await fight();

  // An attuned chest piece wards fire damage.
  await t.run(async (ctx) => {
    const chest = await ctx.db.insert("items", {
      itemId: "warded-chest",
      name: "Warded Chest",
      category: "equipment",
      description: "Attuned armor",
      stackable: false,
      maxStackSize: 1,
      allowedEquipmentSlots: ["chest"],
      baseDefense: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    const owned = await ctx.db.insert("playerItems", {
      playerId,
      itemId: chest,
      quantity: 1,
      equippedSlot: "chest",
      acquiredAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert("playerItemAugments", {
      playerId,
      playerItemId: owned,
      augmentationId: "ward-of-fire",
      name: "Ward of Fire",
      effectType: "defense-bonus",
      effectElement: "fire",
      effectAmount: 5,
      appliedAt: 0,
    });
  });

  const warded = await fight();
  const profile = await t.mutation(async (ctx) => {
    const row = await ctx.db.get(playerId);
    if (!row) throw new Error("Missing test player");
    return readPlayerCombatProfile(ctx, row, { now: 0 });
  });

  expect(profile.ward.fire).toBe(5);
  // The infusion grants flat defense *and* the ward, so the fire monster's
  // hit lands five points lighter on defense and five more on the ward.
  expect(
    (unwarded.attackTiming?.monsterDamagePerHit ?? 0) -
      (warded.attackTiming?.monsterDamagePerHit ?? 0)
  ).toBe(5 + profile.ward.fire);
});

test("existing weapons, displayed stats, inventory and real auto-battle use configured speed", async () => {
  const { t, playerId } = await setup();
  const player = await t.query(api.players.getPlayerById, { playerId });
  expect(player?.autoAttackEnabled).toBe(true);
  expect(player?.effectiveStats.dex).toBe(12);
  expect(player?.combatStats).toMatchObject({
    attack: 22.4, health: 500, defense: 40, attackSpeed: 1.3 * 1.01 * 0.5, critChance: 0,
  });
  const result = await t.mutation(async (ctx) => {
    const row = await ctx.db.get(playerId);
    if (!row) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, row, 1);
  });
  expect(result.playerAttackSpeed).toBe(player?.combatStats.attackSpeed);
  expect(result.playerDamagePerSecond).toBeCloseTo(22.4 * 1000 / 1_524);
  expect(result.playerMaxHealth).toBe(player?.combatStats.health);
  expect((await t.query(api.items.getPlayerInventory, { playerId })).attackSpeedMultiplier).toBe(0.5);
});

test("regular monster power defaults to original strength and honors the balance override", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    const monster = await ctx.db.query("monsters").unique();
    if (!monster) throw new Error("Missing test monster");
    await ctx.db.patch(monster._id, { str: 100, int: 100 });
    // Zero CON regen so raw monster-power scaling is exact (regen is applied
    // as separate healing, but zeroing it keeps the fixture deterministic).
    for (const [key, value] of [
      ["combatConRegenBasePercent", 0],
      ["combatConRegenPerPoint", 0],
    ] as const) {
      await ctx.db.insert("gameBalance", { key, value, description: "Test", lastUpdated: 0 });
    }
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
  const { t, playerId, itemId } = await setup();
  // Pin base speed to 2.0 so the halved rate lands on an exact 500ms/1000ms
  // interval pair; whole-ms rounding otherwise skews the ratio and accumulates.
  await t.run((ctx) => ctx.db.patch(itemId, {
    attackSpeed: 2 - (12 - 10) * DEX_SPEED_COEFF_DEFAULT,
  }));
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
  expect(player?.combatStats.attackSpeed).toBeCloseTo(0.6565 * 1.2);
  expect(player?.combatStats.attack).toBeCloseTo(22.4 * 1.1 * 1.4);
  const result = await t.mutation(async (ctx) => {
    const row = await ctx.db.get(playerId);
    if (!row) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, row, 1);
  });
  expect(result.playerDamagePerSecond).toBeCloseTo(22.4 * 1.1 * 1.4 * 1000 / 1_270);
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

test("in-fight regen heals on its own schedule instead of netting into hits", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    const monster = await ctx.db.query("monsters").unique();
    if (!monster) throw new Error("Missing test monster");
    // ~8.5 gross per 2s swing against 7.5/s CON regen: regen wins.
    await ctx.db.patch(monster._id, { str: 40 });
  });
  const result = await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1, { startingHp: 100 });
  });
  expect(result.won).toBe(true);
  // Gross damage is stored (not netted to zero), with healing alongside it.
  expect(result.attackTiming?.monsterDamagePerHit).toBeCloseTo(8.5);
  expect(result.regenPerSecond).toBeCloseTo(10);
  // The bar climbs back toward full instead of pinning at starting HP.
  expect(
    projectBattleHealth(result, 2_000).currentPlayerHealth
  ).toBeGreaterThan(result.playerStartingHp ?? 0);
  expect(result.playerEndingHp).toBe(result.playerMaxHealth);
});

test("out-of-combat HP ticks at the same rate as in-fight regen", async () => {
  const { t, playerId } = await setup();
  const state = await t.run(async (ctx) => {
    await ctx.db.patch(playerId, { currentHp: 5, currentHpUpdatedAt: 0 });
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return resolveCurrentHp(player, 500, 50, await readHpRegenBalance(ctx), 30_000, false);
  });
  // 10/s for 30s from 5 HP. The old 3x out-of-combat multiplier would clamp to 500.
  expect(state.maxHp).toBe(500);
  expect(state.currentHp).toBeCloseTo(305);
  expect(state.currentHp).toBeLessThan(500);
});

test("retired out-of-combat regen multiplier is removed idempotently", async () => {
  const { t } = await setup();
  await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "combatOutOfCombatRegenMultiplier", value: 3,
    description: "Retired", lastUpdated: 0,
  }));
  expect(await t.mutation(internal.migrations.removeOutOfCombatRegenMultiplier, {}))
    .toEqual({ deleted: true });
  expect(await t.mutation(internal.migrations.removeOutOfCombatRegenMultiplier, {}))
    .toEqual({ deleted: false });
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
    return readPlayerCombatProfile(ctx, player, { now });
  });
  expect((await profileAt(0)).combatStats.attackSpeed).toBeCloseTo(0.689);
  expect((await profileAt(10_000)).combatStats.attackSpeed).toBeCloseTo(0.6565);
  expect((await t.mutation(api.players.attemptAttack, { playerId })).cooldownMs).toBe(1_452);
  const before = await t.query(api.players.getPlayerById, { playerId });
  vi.setSystemTime(100_000);
  expect(await t.query(api.players.getPlayerById, { playerId })).toEqual(before);
});

test("new and reborn players always auto attack; old clients cannot disable it", async () => {
  const { t, playerId } = await setup();
  // Fresh identity (no character yet) so creation actually runs.
  const newcomer = t.withIdentity({ subject: "brand-new-user" });
  expect((await newcomer.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "new-player", name: "New Hunter",
  }))?.autoAttackEnabled).toBe(true);
  await expect(t.mutation(api.players.setAutoAttack, { playerId, enabled: false }))
    .rejects.toThrow("Auto attack is always enabled");
  await t.mutation(api.players.setAutoAttack, { playerId, enabled: true });
  await t.run((ctx) => ctx.db.patch(playerId, { str: 99 }));
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
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("gameBalance").collect()) await ctx.db.delete(row._id);
  });
  expect((await t.mutation(internal.migrations.backfillCombatBalance, {})).created)
    .toBe(COMBAT_BALANCE_DEFAULTS.length + HP_REGEN_BALANCE_DEFAULTS.length + LEATHER_BALANCE_DEFAULTS.length);
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

test("dex speed rebalance lowers the old default and preserves other tuning", async () => {
  const { t } = await setup();
  const balanceId = await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "combatDexSpeedCoeff", value: 0.1, description: "Old default",
    lastUpdated: 0,
  }));

  expect(await t.mutation(internal.migrations.rebalanceDexSpeedCoeff, {}))
    .toEqual({ created: false, updated: true });
  expect((await t.run((ctx) => ctx.db.get(balanceId)))?.value)
    .toBe(DEX_SPEED_COEFF_DEFAULT);
  expect(await t.mutation(internal.migrations.rebalanceDexSpeedCoeff, {}))
    .toEqual({ created: false, updated: false });

  // Any non-default value is live admin tuning and must be left alone.
  await t.run((ctx) => ctx.db.patch(balanceId, { value: 0.05 }));
  expect(await t.mutation(internal.migrations.rebalanceDexSpeedCoeff, {}))
    .toEqual({ created: false, updated: false });
  expect((await t.run((ctx) => ctx.db.get(balanceId)))?.value).toBe(0.05);
});

test("dex speed rebalance creates the setting when missing", async () => {
  const { t } = await setup();
  expect(await t.mutation(internal.migrations.rebalanceDexSpeedCoeff, {}))
    .toEqual({ created: true, updated: false });
  const row = await t.query((ctx) => ctx.db.query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", "combatDexSpeedCoeff")).unique());
  expect(row?.value).toBe(DEX_SPEED_COEFF_DEFAULT);
});

async function setupCaster(options: {
  monsterCon?: number;
  monsterDealsDamage?: boolean;
  abilities?: Array<{
    slot: number;
    ability: {
      abilityId: string;
      name: string;
      type: "attack" | "heal" | "buff_offense" | "buff_defense" | "utility";
      target: "self" | "enemy" | "ally";
      weaponType: "sword" | "dagger" | "mace" | "bow" | "staff" | "any";
      element?: string;
      basePower: number;
      powerScalingPerLevel: number;
      cooldownMs: number;
      buffDurationMs?: number;
      buffStat?: string;
      buffIsPercent?: boolean;
      tier: number;
    };
  }>;
} = {}) {
  const { monsterCon = 1000, monsterDealsDamage = true, abilities = [] } = options;
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "caster-user" });
  const fixture = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "caster-test", name: "Caster", role: "admin",
      authSubject: "caster-user",
      str: 1, dex: 1, int: 10, luk: 0, con: 50,
      gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
      currentTier: 1, autoAttackEnabled: true, autoStartFightEnabled: false,
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0, wis: 0 },
      createdAt: 0, lastUpdated: 0,
    });
    const weaponId = await ctx.db.insert("items", {
      itemId: "test-staff", name: "Test Staff", category: "equipment",
      description: "Test staff", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"],
      baseDamage: STARTER_STAFF_BASE_DAMAGE, attackSpeed: 0.8,
      damageStat: "int", damageType: "magical", weaponType: "staff",
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: weaponId, quantity: 1, equippedSlot: "mainHand",
      acquiredAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("monsters", {
      type: "training", name: "Training Monster",
      str: monsterDealsDamage ? 1 : 0, dex: 0,
      int: monsterDealsDamage ? 1 : 0, luk: 1, con: monsterCon,
      goldDrop: 10, experienceReward: 5, baseMsPerAttack: 2_000,
      strength: 1, createdAt: 0,
    });
    for (const entry of abilities) {
      await ctx.db.insert("abilities", {
        description: "",
        enabled: true,
        ...entry.ability,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("playerAbilities", {
        playerId,
        abilityId: entry.ability.abilityId,
        level: 1,
        experience: 0,
        totalExperience: 0,
        learnedAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("playerEquippedAbilities", {
        playerId,
        slot: entry.slot,
        abilityId: entry.ability.abilityId,
        equippedAt: 0,
      });
    }
    return { playerId, weaponId };
  });
  return { t, ...fixture };
}

const ARCANE_BOLT = {
  abilityId: "arcane_bolt", name: "Arcane Bolt",
  type: "attack" as const, target: "enemy" as const, weaponType: "staff" as const,
  element: "arcane", basePower: 4, powerScalingPerLevel: 0.05,
  cooldownMs: 7000, tier: 0,
};

test("staff base damage is 25% below the previous values", () => {
  expect(STARTER_STAFF_BASE_DAMAGE).toBeCloseTo(5 * 0.75);
  expect(STAFF_BASE_DAMAGE_PER_TIER).toBeCloseTo(12 * 0.75);
});

test("weapon type is inferred from family, item id, explicit tag, or magical stat", () => {
  expect(inferWeaponType({ itemId: "oak-staff", itemFamily: "woodworking-staff" })).toBe("staff");
  expect(inferWeaponType({ itemId: "worn-sword" })).toBe("sword");
  expect(inferWeaponType({ itemId: "plain", weaponType: "mace" })).toBe("mace");
  expect(inferWeaponType({ itemId: "odd", damageType: "magical" })).toBe("staff");
  expect(inferWeaponType({ itemId: "cloth-robe" })).toBeNull();
});

test("staff starter's arcane bolt auto-casts on cooldown and shortens fights", async () => {
  const { t, playerId } = await setupCaster({
    monsterCon: 40,
    abilities: [{ slot: 0, ability: ARCANE_BOLT }],
  });

  const withAbility = await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  expect(withAbility.won).toBe(true);
  const bolt = withAbility.abilityCasts?.find(
    (cast) => cast.abilityId === "arcane_bolt"
  );
  expect(bolt?.casts ?? 0).toBeGreaterThan(0);

  // Unequipping the spell must remove its casts and lengthen the fight.
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("playerEquippedAbilities").collect()) {
      await ctx.db.delete(row._id);
    }
  });
  const withoutAbility = await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  expect(withoutAbility.abilityCasts).toBeUndefined();
  expect(withAbility.durationMs).toBeLessThan(withoutAbility.durationMs);
});

test("healing abilities never cast when they would overheal", async () => {
  const { t, playerId } = await setupCaster({
    monsterCon: 60,
    monsterDealsDamage: false,
    abilities: [
      { slot: 0, ability: ARCANE_BOLT },
      {
        slot: 1,
        ability: {
          abilityId: "healing_touch", name: "Healing Touch",
          type: "heal", target: "self", weaponType: "any",
          basePower: 1000, powerScalingPerLevel: 0, cooldownMs: 5000, tier: 1,
        },
      },
    ],
  });

  const result = await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  expect(result.won).toBe(true);
  // At full HP the oversized heal would be wasted, so it is never cast.
  expect(
    result.abilityCasts?.some((cast) => cast.abilityId === "healing_touch")
  ).toBe(false);
  expect(
    result.abilityCasts?.some((cast) => cast.abilityId === "arcane_bolt")
  ).toBe(true);
});

test("abilities do not fire while a mismatched weapon is equipped", async () => {
  const { t, playerId, weaponId } = await setupCaster({
    monsterCon: 60,
    abilities: [{ slot: 0, ability: ARCANE_BOLT }],
  });
  await t.run((ctx) =>
    ctx.db.patch(weaponId, {
      weaponType: "sword",
      damageType: "physical",
      damageStat: "str",
    })
  );

  const result = await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    return simulateRegularBattle(ctx, player, 1);
  });
  expect(result.abilityCasts).toBeUndefined();
});

test("ability casts award wisdom XP and keep the wisdom level current", async () => {
  const { t, playerId } = await setupCaster({
    monsterCon: 30,
    abilities: [{ slot: 0, ability: ARCANE_BOLT }],
  });

  await t.mutation(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    const result = await simulateRegularBattle(ctx, player, 1);
    await awardAbilityWisdomXp(ctx, playerId, result.abilityCasts ?? []);
  });

  const after = await t.run((ctx) => ctx.db.get(playerId));
  expect(after?.statXp?.wis ?? 0).toBeGreaterThan(0);
  // Combat and rebirth read the level, so XP has to move it. Enough XP for
  // level 2 at the default curve is awarded by a large cast count below.
  await t.mutation((ctx) =>
    awardAbilityWisdomXp(ctx, playerId, [{ abilityId: ARCANE_BOLT.abilityId, level: 1, casts: 10_000 }])
  );
  const levelled = await t.run((ctx) => ctx.db.get(playerId));
  expect(levelled?.wis ?? 1).toBeGreaterThan(1);
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { readBalanceMap, readBalanceValue, rebuildBalanceSnapshot } from "./balance";
import { getActiveEventMultipliers } from "./loot";
import { loadBattleContext, monsterRewardScale, readPlayerCombatProfile, rollEncounter } from "./combat";
import { awardWisdomXp } from "./wisdom";
import { buildAbilityCombatState, castDueAbilities } from "./abilityCombat";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const SUBJECT = "batch-user";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type PlayerFields = Partial<Doc<"players">>;

function playerFields(overrides: PlayerFields = {}) {
  return {
    anonymousId: "batch", name: "Batch", authSubject: SUBJECT,
    str: 50, dex: 10, int: 1, luk: 1, con: 50,
    gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
    currentTier: 1, autoAttackEnabled: true, autoStartFightEnabled: false,
    createdAt: 0, lastUpdated: 0,
    ...overrides,
  };
}

async function insertMonster(ctx: MutationCtx, overrides: Partial<Doc<"monsters">> = {}) {
  return ctx.db.insert("monsters", {
    type: "rat", name: "Rat", str: 1, dex: 1, int: 1, luk: 1, con: 1,
    goldDrop: 50, experienceReward: 25, baseMsPerAttack: 1_000,
    strength: 1, createdAt: 0, ...overrides,
  });
}

async function setup(player: PlayerFields = {}) {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: SUBJECT });
  const playerId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("players", playerFields(player));
    await ctx.db.insert("playerOwners", { playerId: id, authSubject: SUBJECT });
    await insertMonster(ctx);
    return id;
  });
  return { t, base, playerId };
}

async function startHunt(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Id<"players">,
  overrides: Partial<Doc<"playerTasks">> = {}
) {
  return t.run((ctx) => ctx.db.insert("playerTasks", {
    playerId, taskType: "battle", definitionId: "auto_battle", displayName: "Battle",
    status: "active", queueOrder: 1, canProgressOffline: false, requiresOnline: true,
    battleMode: "until-stopped", tier: 1,
    progressMs: 0, completedBattles: 0, onlineCreditMs: 0,
    lastResolvedAt: 1_000_000, lastHeartbeatAt: 1_000_000, offlineCapped: false,
    createdAt: 0, updatedAt: 1_000_000, ...overrides,
  }));
}

test("a batch of fights settles as one history row, with stats and rewards summed", async () => {
  const { t, playerId } = await setup();
  const taskId = await startHunt(t, playerId);
  await t.mutation(api.tasks.sync, { playerId });
  // 30 seconds online at the 2 second fight floor.
  vi.setSystemTime(1_030_000);
  const metrics = await t.mutation(async (ctx) => {
    await ctx.runMutation(api.tasks.sync, { playerId });
    return ctx.meta.getTransactionMetrics();
  });
  const task = await t.run((ctx) => ctx.db.get(taskId));
  expect(task?.completedBattles).toBe(15);
  const history = await t.run((ctx) => ctx.db.query("fightHistory").collect());
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ fightCount: 15, won: true, monsterTier: 1 });
  const stats = await t.run((ctx) => ctx.db.query("taskBattleStats").collect());
  expect(stats).toHaveLength(1);
  expect(stats[0].defeatedCount).toBe(15);
  const player = await t.run((ctx) => ctx.db.get(playerId));
  expect(player?.gold).toBe(history[0].goldEarned);
  expect(player?.totalExperience).toBe(history[0].experienceEarned);
  expect(player?.gold).toBeGreaterThan(0);
  // Fifteen fights cost about what one does.
  expect(metrics.documentsRead.used).toBeLessThan(40);
  expect(metrics.documentsWritten.used).toBeLessThan(20);
});

test("a hunt settles on the batch interval, except when a defeat or its target is sooner", async () => {
  const { t, playerId } = await setup();
  const rolled = {
    won: true, monsterTier: 1, monsterType: "rat", monsterName: "Rat",
    monsterMaxHealth: 10, playerMaxHealth: 500,
    monsterDamagePerSecond: 1, playerDamagePerSecond: 10,
    goldEarned: 5, experienceEarned: 5, durationMs: 2_000,
  };
  const nextSettlement = async (task: Partial<Doc<"playerTasks">>) => {
    const taskId = await startHunt(t, playerId, task);
    const plan = await t.query(api.tasks.getActivePlan, { playerId });
    await t.run((ctx) => ctx.db.delete(taskId));
    return (plan.active?.nextSettlementAt ?? 0) - 1_000_000;
  };
  expect(await nextSettlement({ battleEncounter: rolled })).toBe(30_000);
  expect(await nextSettlement({
    battleEncounter: { ...rolled, won: false, durationMs: 5_000 },
  })).toBe(5_000);
  expect(await nextSettlement({
    battleMode: "count", targetBattles: 3, battleEncounter: rolled,
  })).toBe(6_000);
  expect(await nextSettlement({
    battleMode: "duration", targetDurationMs: 8_000, battleEncounter: rolled,
  })).toBe(8_000);
  // A fight longer than the interval still gets to finish first.
  expect(await nextSettlement({
    battleEncounter: { ...rolled, durationMs: 45_000 },
  })).toBe(45_000);
});

test("a defeat inside a batch banks the wins before it and ends the hunt", async () => {
  const { t, playerId } = await setup();
  const taskId = await startHunt(t, playerId);
  await t.run(async (ctx) => {
    const monster = await ctx.db.query("monsters").first();
    if (monster) await ctx.db.patch(monster._id, { str: 400, con: 40, baseMsPerAttack: 500 });
  });
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(1_060_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toBeNull();
  const queue = await t.query(api.tasks.getQueue, { playerId });
  expect(queue.history[0]).toMatchObject({ status: "failed" });
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.currentHp).toBe(0);
});

test("stacked drops grant once and full inventories overflow to pending rewards", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const { t, playerId } = await setup();
  const itemId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("items", {
      itemId: "fang", name: "Fang", category: "crafting", description: "d",
      stackable: true, maxStackSize: 5, allowedEquipmentSlots: [],
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("lootSources", {
      sourceType: "monster", sourceId: "rat", lootTableId: "rats", createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("lootTables", {
      lootTableId: "rats", name: "Rats", sourceType: "monster", rollCount: 1, enabled: true, createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("lootTableEntries", {
      lootTableId: "rats", itemId: id, weight: 1, dropChance: 1, minQuantity: 1, maxQuantity: 1,
      guaranteed: true, purpose: "augmentation", enabled: true, createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("gameBalance", {
      key: "inventorySlotCapacity", value: 2, description: "Test", lastUpdated: 0,
    });
    return id;
  });
  await startHunt(t, playerId);
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(1_030_000);
  await t.mutation(api.tasks.sync, { playerId });
  const stacks = await t.run((ctx) =>
    ctx.db.query("playerItems").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).collect()
  );
  // Fifteen fangs, two stacks of five, five left over. Keeps its running count
  // across grants, so the second stack isn't overfilled.
  expect(stacks.filter((row) => row.itemId === itemId).map((row) => row.quantity)).toEqual([5, 5]);
  const pending = await t.run((ctx) => ctx.db.query("pendingRewards").collect());
  expect(pending.find((row) => row.itemId === itemId)?.quantity).toBe(5);
});

test("balance reads memoize per transaction and use the snapshot for many keys", async () => {
  const { t } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 20; index += 1) {
      await ctx.db.insert("gameBalance", { key: `k${index}`, value: index, description: "d", lastUpdated: 5 });
    }
    await rebuildBalanceSnapshot(ctx);
  });
  const metrics = await t.run(async (ctx) => {
    expect(await readBalanceValue(ctx, "k1")).toBe(1);
    expect(await readBalanceValue(ctx, "k1")).toBe(1);
    const first = await readBalanceMap(ctx, ["k1", "k2", "k3"]);
    const second = await readBalanceMap(ctx, ["k4", "k5", "missing"]);
    expect(first.get("k3")).toBe(3);
    expect(second.get("k5")).toBe(5);
    expect(second.has("missing")).toBe(false);
    return ctx.meta.getTransactionMetrics();
  });
  // One point read, then the snapshot and the row proving it is current.
  expect(metrics.documentsRead.used).toBe(3);
});

test("a row newer than the snapshot is never hidden, and the cron catches it up", async () => {
  const { t } = await setup();
  const rowId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("gameBalance", { key: "a", value: 1, description: "d", lastUpdated: 5 });
    await ctx.db.insert("gameBalance", { key: "b", value: 2, description: "d", lastUpdated: 5 });
    await ctx.db.insert("gameBalance", { key: "c", value: 3, description: "d", lastUpdated: 5 });
    await rebuildBalanceSnapshot(ctx);
    return id;
  });
  await t.run((ctx) => ctx.db.patch(rowId, { value: 99, lastUpdated: 6 }));
  expect(await t.run(async (ctx) => (await readBalanceMap(ctx, ["a", "b", "c"])).get("a"))).toBe(99);
  await t.mutation(internal.maintenance.refreshBalanceSnapshot, {});
  const snapshot = await t.run((ctx) => ctx.db.query("balanceSnapshots").first());
  expect(snapshot?.values.a).toBe(99);
  const metrics = await t.mutation(async (ctx) => {
    await ctx.runMutation(internal.maintenance.refreshBalanceSnapshot, {});
    return ctx.meta.getTransactionMetrics();
  });
  expect(metrics.documentsWritten.used).toBe(0);
  expect(metrics.documentsRead.used).toBe(2);
});

test("ownership checks use the owner row, reject strangers, and fall back for old characters", async () => {
  const { t, base, playerId } = await setup();
  await expect(
    base.withIdentity({ subject: "stranger" }).query(api.tasks.getActivePlan, { playerId })
  ).rejects.toThrow("different signed-in session");
  await t.run(async (ctx) => {
    const owner = await ctx.db.query("playerOwners").first();
    if (owner) await ctx.db.delete(owner._id);
  });
  expect(await t.query(api.tasks.getActivePlan, { playerId })).toMatchObject({ active: null });
  await expect(
    base.withIdentity({ subject: "stranger" }).query(api.tasks.getActivePlan, { playerId })
  ).rejects.toThrow("different signed-in session");
});

test("events past the first hundred still apply, and finished ones cost no reads", async () => {
  const { t } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 150; index += 1) {
      await ctx.db.insert("gameEvents", {
        eventId: `old-${index}`, name: "Old", description: "d", startTime: index, endTime: index + 1,
        effectType: "gold-multiplier", effectValue: 9, isActive: false, createdAt: 0,
      });
    }
    await ctx.db.insert("gameEvents", {
      eventId: "live", name: "Live", description: "d", startTime: 500_000, endTime: 2_000_000,
      effectType: "gold-multiplier", effectValue: 2, isActive: true, createdAt: 0,
    });
    await ctx.db.insert("gameEvents", {
      eventId: "soon", name: "Soon", description: "d", startTime: 1_500_000, endTime: 2_000_000,
      effectType: "gold-multiplier", effectValue: 7, isActive: false, createdAt: 0,
    });
  });
  const metrics = await t.run(async (ctx) => {
    const multipliers = await getActiveEventMultipliers(ctx, 1_000_000);
    expect(multipliers.goldMultiplier).toBe(2);
    return ctx.meta.getTransactionMetrics();
  });
  expect(metrics.documentsRead.used).toBe(2);
});

test("wisdom XP raises the wisdom level combat reads", async () => {
  const { t, playerId } = await setup();
  await t.mutation((ctx) => awardWisdomXp(ctx, playerId, 60_000_000));
  const player = await t.run((ctx) => ctx.db.get(playerId));
  expect(player?.wis ?? 1).toBeGreaterThan(1);
});

test("fights have a floor, and rewards scale with the monster", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "minFightDurationMs", value: 5_000, description: "Test", lastUpdated: 0,
  }));
  const encounter = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return rollEncounter(await loadBattleContext(ctx, player, 1));
  });
  expect(encounter.durationMs).toBe(5_000);
  expect(encounter.combatMs).toBeLessThan(5_000);
  expect(monsterRewardScale(200, 50)).toBe(2);
  expect(monsterRewardScale(50, 200)).toBe(0.5);
});

test("ability cooldowns carry across fights", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("abilities", {
      abilityId: "smite", name: "Smite", type: "attack", target: "enemy", weaponType: "any",
      basePower: 5, powerScalingPerLevel: 0, cooldownMs: 10_000, maxLevel: 10, enabled: true,
      tier: 1, description: "d", createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("playerAbilities", {
      playerId, abilityId: "smite", level: 1, experience: 0, totalExperience: 0, learnedAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerEquippedAbilities", { playerId, abilityId: "smite", slot: 0, equippedAt: 0 } as never);
  });
  const { first, second, third } = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    const battle = await loadBattleContext(ctx, player, 1);
    const first = rollEncounter(battle);
    const second = rollEncounter(battle, { abilityCooldowns: first.abilityCooldowns ?? [] });
    const third = rollEncounter(battle, { abilityCooldowns: second.abilityCooldowns ?? [] });
    return { first, second, third };
  });
  expect(first.abilityCasts?.[0]?.casts).toBe(1);
  expect(first.abilityCooldowns?.[0]?.remainingMs).toBe(8_000);
  // The next fight ends before the cooldown does, so the ability doesn't fire.
  expect(second.abilityCasts).toBeUndefined();
  expect(second.abilityCooldowns?.[0]?.remainingMs).toBe(6_000);
  expect(third.abilityCooldowns?.[0]?.remainingMs).toBe(4_000);
});

test("slow weapons hit harder in real-time fights but not in round-based ones", async () => {
  const { t, playerId } = await setup();
  const attacks = await t.run(async (ctx) => {
    const weaponId = await ctx.db.insert("items", {
      itemId: "maul", name: "Maul", category: "equipment", description: "d",
      stackable: false, maxStackSize: 1, allowedEquipmentSlots: ["mainHand"],
      baseDamage: 10, attackSpeed: 0.5, damageStat: "str", damageType: "physical",
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: weaponId, quantity: 1, equippedSlot: "mainHand", acquiredAt: 0, updatedAt: 0,
    });
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return (await readPlayerCombatProfile(ctx, player)).combatStats;
  });
  expect(attacks.attack).toBeCloseTo(attacks.roundAttack * 2);
});

test("rebirth takes gold sheltered in the guild bank, and open buy orders block it", async () => {
  const { t, playerId } = await setup({ str: 99, gold: 1_000 });
  const guildId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("guilds", {
      name: "G", tag: "G", description: "d", ownerId: playerId, level: 1, xp: 0, gold: 500,
      createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("guildMembers", {
      guildId: id, playerId, role: "master", joinedAt: 0, contributionXp: 0, contributionGold: 0, lastActiveAt: 0,
    } as never);
    return id;
  });
  await t.mutation(api.guilds.depositGold, { playerId, amount: 1_000 });
  await t.mutation(api.guilds.withdrawGold, { playerId, amount: 300 });
  const member = await t.run((ctx) => ctx.db.query("guildMembers").first());
  expect(member?.netGoldDeposited).toBe(700);

  const orderId = await t.run(async (ctx) => {
    const itemId = await ctx.db.insert("items", {
      itemId: "ore", name: "Ore", category: "crafting", description: "d",
      stackable: true, maxStackSize: 5, allowedEquipmentSlots: [],
      createdAt: 0, updatedAt: 0,
    });
    return ctx.db.insert("marketOrders", {
      playerId, itemId, side: "buy", status: "open", unitPrice: 1,
      quantity: 10, originalQuantity: 10, escrowedGold: 10,
      createdAt: 0, updatedAt: 0, expiresAt: 0,
    } as never);
  });
  await expect(t.mutation(api.players.rebirth, { playerId })).rejects.toThrow("buy orders");
  await t.run((ctx) => ctx.db.delete(orderId));

  await t.mutation(api.players.rebirth, { playerId });
  const guild = await t.run((ctx) => ctx.db.get(guildId));
  // 500 + 1,000 - 300 banked, minus the 700 this player sheltered.
  expect(guild?.gold).toBe(500);
  expect((await t.run((ctx) => ctx.db.query("guildMembers").first()))?.netGoldDeposited).toBe(0);
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.gold).toBe(0);
});

test("leaderboards fill from players and write nothing when nothing moved", async () => {
  const { t, playerId } = await setup({ totalExperience: 500, maxTierReached: 3, rebirthCount: 1, name: "Top" });
  await t.run(async (ctx) => {
    await ctx.db.insert("players", playerFields({
      anonymousId: "sim", authSubject: "sim-live:1", totalExperience: 9_999, maxTierReached: 9, rebirthCount: 9,
    }));
    await ctx.db.insert("players", playerFields({
      anonymousId: "fresh", authSubject: "fresh", totalExperience: 0, rebirthCount: 0, maxTierReached: 1, name: "Fresh",
    }));
  });
  await t.mutation(internal.leaderboards.refreshLeaderboards, {});
  const board = await t.query(api.leaderboards.getTopByExperience, { limit: 10 });
  expect(board.map((row) => row.playerId)).toEqual([playerId]);
  expect(await t.query(api.leaderboards.getPlayerRanks, { playerId })).toMatchObject({
    expRank: 1, rebirthRank: 1,
  });
  expect((await t.query(api.leaderboards.getTopByTier, { limit: 10 }))[0].playerId).toBe(playerId);

  const metrics = await t.mutation(async (ctx) => {
    await ctx.runMutation(internal.leaderboards.refreshLeaderboards, {});
    return ctx.meta.getTransactionMetrics();
  });
  expect(metrics.documentsWritten.used).toBe(0);

  await t.run((ctx) => ctx.db.patch(playerId, { totalExperience: 800 }));
  await t.mutation(internal.leaderboards.refreshLeaderboards, {});
  expect((await t.query(api.leaderboards.getTopByExperience, { limit: 10 }))[0].totalExperience).toBe(800);
});

test("achievements unlock when a settlement crosses a milestone, once", async () => {
  const { t, playerId } = await setup({ totalExperience: 9_999 });
  await startHunt(t, playerId);
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(1_030_000);
  await t.mutation(api.tasks.sync, { playerId });
  const unlocked = await t.run((ctx) => ctx.db.query("playerAchievements").collect());
  expect(unlocked.map((row) => row.achievementId)).toEqual(["tier-100-xp"]);
  vi.setSystemTime(1_060_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.query("playerAchievements").collect())).toHaveLength(1);
});

test("pruning removes only expired history", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("fightHistory", {
      playerId, monsterTier: 1, monsterType: "rat", won: true,
      goldEarned: 0, experienceEarned: 0, timestamp: 0,
    });
  });
  await t.mutation(internal.maintenance.pruneHistory, {});
  expect(await t.run((ctx) => ctx.db.query("fightHistory").collect())).toHaveLength(1);
  vi.setSystemTime(Date.now() + 31 * DAY_MS);
  await t.mutation(internal.maintenance.pruneHistory, {});
  expect(await t.run((ctx) => ctx.db.query("fightHistory").collect())).toHaveLength(0);
});

test("ability books drop from fights and are created on demand", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    for (const [key, value] of [["abilityBookDropChance", 1], ["essenceDropChance", 0], ["t1KeyDropChance", 0]] as const) {
      await ctx.db.insert("gameBalance", { key, value, description: "Test", lastUpdated: 0 });
    }
    await ctx.db.insert("abilities", {
      abilityId: "smite", name: "Smite", type: "attack", target: "enemy", weaponType: "any",
      basePower: 5, powerScalingPerLevel: 0, cooldownMs: 10_000, maxLevel: 10, enabled: true,
      tier: 1, description: "d", createdAt: 0, updatedAt: 0,
    } as never);
  });
  await startHunt(t, playerId);
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(1_030_000);
  await t.mutation(api.tasks.sync, { playerId });
  const rows = await t.run(async (ctx) => {
    const owned = await ctx.db.query("playerItems").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).collect();
    return Promise.all(owned.map(async (row) => ({ row, item: await ctx.db.get(row.itemId) })));
  });
  const book = rows.find((entry) => entry.item?.itemId === "ability_book_smite_1");
  expect(book?.row.quantity).toBe(15);
  expect(book?.item?.category).toBe("abilityBook");
});

test("the update migration retunes defaults, keeps custom tuning, and backfills players", async () => {
  const { t, playerId } = await setup({ statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0, wis: 60_000_000 }, totalExperience: 20_000, maxTierReached: 6 });
  const bossId = await t.run(async (ctx) => {
    const owner = await ctx.db.query("playerOwners").first();
    if (owner) await ctx.db.delete(owner._id);
    await ctx.db.insert("gameBalance", { key: "tierScaleMultiplier", value: 2, description: "d", lastUpdated: 0 });
    await ctx.db.insert("gameBalance", { key: "taskPresenceIntervalMs", value: 20_000, description: "custom", lastUpdated: 0 });
    await ctx.db.insert("gameBalance", { key: "statUpgradeCostMultiplier", value: 2, description: "d", lastUpdated: 0 });
    await ctx.db.insert("hiddenSpots", { spotId: "s", x: 1, y: 1, rewardUpgradeId: "str_boost_1", radius: 1, createdAt: 0 });
    for (const upgradeId of ["str_boost_1", "luk_boost_1"]) {
      await ctx.db.insert("upgrades", {
        upgradeId, name: upgradeId, category: "stat-boost", cost: 1, description: "d",
        effectType: "stat-boost", createdAt: 0,
      });
    }
    await ctx.db.insert("playerUpgrades", { playerId, upgradeId: "str_boost_1", quantity: 1, purchaseCount: 3, purchasedAt: 0 });
    return ctx.db.insert("bosses", {
      bossId: "boss_tier_3", tier: 3, name: "B", str: 400, dex: 400, int: 400, luk: 400, con: 400,
      statsTierScaled: true, rewardMultiplier: 1, createdAt: 0,
    });
  });
  const run = () => t.mutation(internal.migrations.applyPerformanceAndBalanceUpdate, {});
  await run();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const value = (key: string) => t.run(async (ctx) =>
    (await ctx.db.query("gameBalance").withIndex("by_key", (q) => q.eq("key", key)).first())?.value
  );
  expect(await value("tierScaleMultiplier")).toBe(1.4);
  expect(await value("taskPresenceIntervalMs")).toBe(20_000);
  expect(await value("statUpgradeCostMultiplier")).toBeNull();
  expect(await value("minFightDurationMs")).toBe(2_000);
  const upgrades = await t.run((ctx) => ctx.db.query("upgrades").collect());
  expect(upgrades.map((row) => row.upgradeId)).toEqual(["str_boost_1"]);
  // 400 was scaled by 2^2; at 1.4^2 it is 400 * 1.96 / 4.
  expect((await t.run((ctx) => ctx.db.get(bossId)))?.str).toBe(196);
  await run();
  expect((await t.run((ctx) => ctx.db.get(bossId)))?.str).toBe(196);
  const owner = await t.run((ctx) => ctx.db.query("playerOwners").first());
  expect(owner).toMatchObject({ playerId, authSubject: SUBJECT });
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.wis ?? 1).toBeGreaterThan(1);
  const achievements = await t.run((ctx) => ctx.db.query("playerAchievements").collect());
  expect(achievements.map((row) => row.achievementId).sort()).toEqual(["first-kill", "tier-100-xp", "tier-5"]);
  const claimed = await t.run((ctx) => ctx.db.query("playerUpgrades").first());
  expect(claimed?.purchaseCount).toBeUndefined();
  const snapshot = await t.run((ctx) => ctx.db.query("balanceSnapshots").first());
  expect(snapshot?.values.tierScaleMultiplier).toBe(1.4);
});

test("new characters are plain players, and the CLI can grant admin", async () => {
  const { base } = await setup();
  const as = base.withIdentity({ subject: "newcomer" });
  const created = await as.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "newcomer", name: "Newcomer",
  });
  expect(created?.role).toBe("player");
  await base.mutation(internal.admin.setPlayerRole, { name: "Newcomer", role: "admin" });
  expect((await base.run((ctx) => ctx.db.query("players").withIndex("by_anonymousId", (q) => q.eq("anonymousId", "newcomer")).first()))?.role).toBe("admin");
});

async function insertChat(
  ctx: MutationCtx,
  senderId: Id<"players">,
  senderName: string,
  createdAt: number,
  fields: Partial<Doc<"chatMessages">> = {}
) {
  return ctx.db.insert("chatMessages", {
    channelType: "world", channelId: "world", senderId, senderName,
    content: `at ${createdAt}`, createdAt, ...fields,
  });
}

test("reports save the messages around them, and survive chat pruning", async () => {
  const { t, base, playerId } = await setup({ name: "Reporter", role: "admin" });
  const { targetId, messageId } = await t.run(async (ctx) => {
    const targetId = await ctx.db.insert("players", playerFields({ anonymousId: "target", authSubject: "target", name: "Target" }));
    let messageId: Id<"chatMessages"> | null = null;
    for (let index = 0; index < 30; index += 1) {
      const id = await insertChat(ctx, targetId, "Target", index);
      if (index === 15) messageId = id;
    }
    if (!messageId) throw new Error("Missing message");
    return { targetId, messageId };
  });
  const report = await t.mutation(api.chat.reportMessage, {
    playerId, messageId, reason: "harassment", details: "  rude  ",
  });
  expect(report.duplicate).toBe(false);
  expect((await t.mutation(api.chat.reportMessage, { playerId, messageId, reason: "spam" })).duplicate).toBe(true);

  const [saved] = await t.query(api.chat.listReports, { playerId, status: "open" });
  expect(saved).toMatchObject({ reportedPlayerId: targetId, reason: "harassment", details: "rude" });
  // Ten before, the message itself, and ten after, in order.
  expect(saved.context.map((row) => row.createdAt)).toEqual(
    Array.from({ length: 21 }, (_, index) => index + 5)
  );

  vi.setSystemTime(Date.now() + 4 * DAY_MS);
  await t.mutation(internal.chat.pruneMessages, {});
  expect(await t.run((ctx) => ctx.db.query("chatMessages").collect())).toHaveLength(0);
  const [kept] = await t.query(api.chat.listReports, { playerId, status: "open" });
  expect(kept.context).toHaveLength(21);

  await t.mutation(api.chat.resolveReport, { playerId, reportId: report.reportId, status: "dismissed" });
  expect(await t.query(api.chat.listReports, { playerId, status: "open" })).toHaveLength(0);

  // Reading the queue is admin only.
  const stranger = base.withIdentity({ subject: "target" });
  await expect(stranger.query(api.chat.listReports, { playerId: targetId, status: "dismissed" }))
    .rejects.toThrow("admin role required");
});

test("chat pruning keeps the last three days", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) => insertChat(ctx, playerId, "Batch", 0));
  vi.setSystemTime(Date.now() + 2 * DAY_MS);
  await t.mutation(internal.chat.pruneMessages, {});
  expect(await t.run((ctx) => ctx.db.query("chatMessages").collect())).toHaveLength(1);
  vi.setSystemTime(Date.now() + 2 * DAY_MS);
  await t.mutation(internal.chat.pruneMessages, {});
  expect(await t.run((ctx) => ctx.db.query("chatMessages").collect())).toHaveLength(0);
});

test("a player can't report their own messages or a private chat they aren't in", async () => {
  const { t, playerId } = await setup();
  const { own, hidden } = await t.run(async (ctx) => {
    const other = await ctx.db.insert("players", playerFields({ anonymousId: "o", authSubject: "o", name: "O" }));
    const third = await ctx.db.insert("players", playerFields({ anonymousId: "t", authSubject: "t", name: "T" }));
    return {
      own: await insertChat(ctx, playerId, "Batch", 1),
      hidden: await insertChat(ctx, other, "O", 2, {
        channelType: "private", channelId: `${other}:${third}`, recipientId: third, recipientName: "T",
      }),
    };
  });
  await expect(t.mutation(api.chat.reportMessage, { playerId, messageId: own, reason: "spam" }))
    .rejects.toThrow("cannot report yourself");
  await expect(t.mutation(api.chat.reportMessage, { playerId, messageId: hidden, reason: "spam" }))
    .rejects.toThrow("Message not found");
});

test("a hunter rests below the threshold instead of starting a fight", async () => {
  const { t, playerId } = await setup({ currentHp: 100, currentHpUpdatedAt: 1_000_000, con: 50 });
  const taskId = await startHunt(t, playerId);
  await t.mutation(api.tasks.sync, { playerId });
  const task = await t.run((ctx) => ctx.db.get(taskId));
  // 100 of 500 HP at 10 HP/s, up to 90%: 35 seconds.
  expect(task?.battleEncounter).toBeUndefined();
  expect(task?.respawnUntil).toBe(1_035_000);
  vi.setSystemTime(1_035_000);
  await t.mutation(api.tasks.sync, { playerId });
  const rested = await t.run((ctx) => ctx.db.get(taskId));
  expect(rested?.respawnUntil).toBeUndefined();
  expect(rested?.battleEncounter).toBeDefined();
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.currentHp).toBeGreaterThanOrEqual(450);
});

test("weapons of every speed deal the same base damage per second", async () => {
  const dpsAt = async (attackSpeed: number) => {
    const { t, playerId } = await setup({ str: 100 });
    return t.run(async (ctx) => {
      const itemId = await ctx.db.insert("items", {
        itemId: "w", name: "W", category: "equipment", description: "d", stackable: false, maxStackSize: 1,
        allowedEquipmentSlots: ["mainHand"], baseDamage: 20, attackSpeed, damageStat: "str", damageType: "physical",
        createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("playerItems", { playerId, itemId, quantity: 1, equippedSlot: "mainHand", acquiredAt: 0, updatedAt: 0 });
      const player = await ctx.db.get(playerId);
      if (!player) throw new Error("Missing player");
      const { combatStats } = await readPlayerCombatProfile(ctx, player);
      return combatStats.attack * combatStats.attackSpeed;
    });
  };
  const slow = await dpsAt(0.65);
  expect(await dpsAt(1)).toBeCloseTo(slow);
  expect(await dpsAt(1.6)).toBeCloseTo(slow);
});

test("rebirth milestones apply gold, XP, stat and crit rewards", async () => {
  const { t, playerId } = await setup({ rebirthCount: 3, luk: 0, str: 100 });
  await t.run(async (ctx) => {
    for (const [rebirthLevel, effectType, effectValue] of [
      [1, "gold-multiplier", 1.1], [2, "xp-multiplier", 1.15], [3, "stat-multiplier", 1.05], [4, "crit-chance", 0.1],
    ] as const) {
      await ctx.db.insert("rebirthRewards", { rebirthLevel, name: "R", description: "d", effectType, effectValue, createdAt: 0 });
    }
  });
  const profile = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return readPlayerCombatProfile(ctx, player);
  });
  expect(profile.rebirthRewards).toEqual({ goldMultiplier: 1.1, xpMultiplier: 1.15, statMultiplier: 1.05, critChance: 0 });
  expect(profile.effectiveStats.str).toBeCloseTo(105);
});

test("heals restore a percentage of max HP", async () => {
  const { t, playerId } = await setup({ con: 100 });
  const state = await t.run(async (ctx) => {
    await ctx.db.insert("abilities", {
      abilityId: "mend", name: "Mend", type: "heal", target: "self", weaponType: "any",
      basePower: 15, powerScalingPerLevel: 0, cooldownMs: 10_000, maxLevel: 10, enabled: true,
      tier: 1, description: "d", createdAt: 0, updatedAt: 0,
    } as never);
    await ctx.db.insert("playerAbilities", { playerId, abilityId: "mend", level: 1, experience: 0, totalExperience: 0, learnedAt: 0, updatedAt: 0 });
    await ctx.db.insert("playerEquippedAbilities", { playerId, abilityId: "mend", slot: 0, equippedAt: 0 } as never);
    return buildAbilityCombatState(ctx, playerId, null, { unit: "ms" });
  });
  const outcome = castDueAbilities({
    state, at: 0, retryAt: 1, playerHp: 100, playerMaxHp: 1_000, enemyHp: 10,
    enemyStats: { defense: 0, magicalDefense: 0 }, weapon: null,
  });
  expect(outcome.playerHp).toBe(250);
});

test("modules the client imports never register Convex functions", () => {
  const sources = import.meta.glob(
    ["./balance.ts", "./taskTiming.ts", "./rebirth.ts", "./itemTypes.ts", "./skillProgression.ts", "./adminConfig.ts"],
    { query: "?raw", import: "default", eager: true }
  ) as Record<string, string>;
  expect(Object.keys(sources)).toHaveLength(6);
  for (const source of Object.values(sources)) {
    expect(source).not.toMatch(/^import \{[^}]*\} from "\.\/_generated\/server"/m);
  }
});

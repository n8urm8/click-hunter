/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import * as combat from "./combat";
import { projectBattleHealth, readTaskSyncSettings } from "./taskTiming";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const encounter = {
  won: true, monsterTier: 1, monsterType: "rat", monsterName: "Rat",
  monsterMaxHealth: 600, playerMaxHealth: 1_000,
  monsterDamagePerSecond: 1, playerDamagePerSecond: 10,
  goldEarned: 50, experienceEarned: 25, durationMs: 60_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(overrides: Partial<Doc<"playerTasks">> = {}) {
  const t = convexTest(schema, modules).withIdentity({ subject: "timing-user" });
  const { playerId, taskId, itemId } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "test", name: "Test", authSubject: "timing-user",
      str: 1, dex: 1, int: 1, luk: 1, con: 1,
      gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
      currentTier: 1, autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    await ctx.db.insert("monsters", {
      type: "rat", name: "Rat", str: 1, dex: 1, int: 1, luk: 1, con: 1,
      goldDrop: 50, experienceReward: 25, baseMsPerAttack: 1_000,
      strength: 1, createdAt: 0,
    });
    const itemId = await ctx.db.insert("items", {
      itemId: "wood", name: "Wood", category: "crafting", description: "Wood",
      stackable: true, maxStackSize: 100_000, allowedEquipmentSlots: [],
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("skillDefinitions", {
      skillId: "logging", name: "Logging", category: "gathering",
      description: "Logging", enabled: true, createdAt: 0, updatedAt: 0,
    });
    const taskId = await ctx.db.insert("playerTasks", {
      playerId, taskType: "battle", definitionId: "auto_battle", displayName: "Battle",
      status: "active", queueOrder: 1, canProgressOffline: false, requiresOnline: true,
      battleMode: "count", targetBattles: 1, tier: 1,
      progressMs: 0, completedBattles: 0, onlineCreditMs: 0,
      lastResolvedAt: 0, lastHeartbeatAt: 0, offlineCapped: false,
      createdAt: 0, updatedAt: 0, ...overrides,
    });
    return { playerId, taskId, itemId };
  });
  return { t, playerId, taskId, itemId };
}

async function setupSkill(canProgressOffline = true) {
  const fixture = await setup({
    taskType: "timed", definitionId: "skill_action", displayName: "Logging",
    battleMode: undefined, targetBattles: undefined, tier: undefined,
    canProgressOffline, requiresOnline: !canProgressOffline, durationMs: 100_000,
  });
  await fixture.t.run((ctx) => ctx.db.patch(fixture.taskId, {
    payload: {
      skillTaskVersion: 1, actionType: "gathering", actionId: "chop",
      skillId: "logging", skillCategory: "gathering", targetActionCount: 100,
      completedActions: 0, totalExperienceEarned: 0, outputSummary: [],
      skillActionSnapshot: {
        actionType: "gathering", actionId: "chop", skillId: "logging",
        skillCategory: "gathering", baseExperienceReward: 10,
        gathering: { outputItemId: fixture.itemId, minYield: 1, maxYield: 1 },
      },
    },
  }));
  return fixture;
}

test("routine presence only reads the player, presence and grace; gameplay stays unchanged", async () => {
  const { t, playerId, taskId } = await setup({ battleEncounter: encounter });
  await t.mutation(api.tasks.sync, { playerId });
  const before = await t.run((ctx) => ctx.db.get(taskId));
  vi.setSystemTime(10_000);
  const metrics = await t.mutation(async (ctx) => {
    await ctx.runMutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
    return ctx.meta.getTransactionMetrics();
  });
  expect(metrics.databaseQueries.used).toBe(3);
  expect(metrics.documentsRead.used).toBe(3);
  expect(metrics.documentsWritten.used).toBe(1);
  expect(metrics.bytesRead.used).toBeLessThan(2_048);
  expect(await t.run((ctx) => ctx.db.get(taskId))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("taskPresence").unique()))
    .toMatchObject({ taskId, segmentStartedAt: 0, lastSeenAt: 10_000 });
});

test("encounters are rolled once, early syncs preserve them and rewards settle exactly once", async () => {
  const simulate = vi.spyOn(combat, "simulateRegularBattle").mockResolvedValue(encounter);
  const { t, playerId, taskId } = await setup();
  expect(await t.mutation(api.tasks.sync, { playerId }))
    .toMatchObject({ serverTime: 0, nextSettlementAt: 30_000, requiresPresence: true });
  for (const now of [10_000, 20_000]) {
    vi.setSystemTime(now);
    await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  }
  vi.setSystemTime(30_000);
  await t.mutation(api.tasks.sync, { playerId });
  await t.mutation(api.tasks.sync, { playerId });
  expect(simulate).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ battleEncounter: encounter, onlineCreditMs: 30_000, completedBattles: 0 });
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 0 });
  for (const now of [40_000, 50_000]) {
    vi.setSystemTime(now);
    await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  }
  vi.setSystemTime(60_000);
  await t.mutation(api.tasks.sync, { playerId });
  await t.mutation(api.tasks.sync, { playerId });
  expect(simulate).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.get(taskId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(playerId)))
    .toMatchObject({ gold: 50, totalExperience: 25 });
  expect(await t.run((ctx) => ctx.db.query("fightHistory").collect())).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("taskPresence").collect())).toHaveLength(0);
});

test("reconnect preserves confirmed online time but never credits the disconnected gap", async () => {
  const { t, playerId, taskId } = await setup({ battleEncounter: encounter });
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(10_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  vi.setSystemTime(60_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ onlineCreditMs: 10_000 });
  vi.setSystemTime(70_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  vi.setSystemTime(80_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ onlineCreditMs: 30_000 });
});

test("ending a duration run mid-encounter grants no full-fight reward", async () => {
  const { t, playerId, taskId } = await setup({
    battleEncounter: encounter, battleMode: "duration",
    targetBattles: undefined, targetDurationMs: 5_000,
  });
  expect(await t.mutation(api.tasks.sync, { playerId }))
    .toMatchObject({ nextSettlementAt: 5_000 });
  vi.setSystemTime(5_000);
  await t.mutation(api.tasks.sync, { playerId });
  const queue = await t.query(api.tasks.getQueue, { playerId });
  expect(queue.active).toBeNull();
  expect(queue.history[0]).toMatchObject({
    taskId, progressMs: 5_000, completedBattles: 0, status: "completed",
  });
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 0 });
  expect(await t.run((ctx) => ctx.db.query("fightHistory").collect())).toHaveLength(0);
});

test("recovery excludes elapsed time and begins a fresh encounter afterward", async () => {
  const simulate = vi.spyOn(combat, "simulateRegularBattle").mockResolvedValue(encounter);
  const { t, playerId, taskId } = await setup({
    targetBattles: 2, battleEncounter: { ...encounter, won: false, durationMs: 10_000 },
  });
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(10_000);
  expect(await t.mutation(api.tasks.sync, { playerId }))
    .toMatchObject({ nextSettlementAt: 15_000 });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ completedBattles: 1, onlineCreditMs: 0, respawnUntil: 15_000 });
  vi.setSystemTime(15_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(simulate).toHaveBeenCalledTimes(1);
  vi.setSystemTime(20_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ completedBattles: 1, onlineCreditMs: 5_000, battleEncounter: encounter });
});

test("batch-limit continuation drains pending credit without duplicating fights", async () => {
  vi.spyOn(combat, "simulateRegularBattle").mockResolvedValue({ ...encounter, durationMs: 10_000 });
  const { t, playerId, taskId } = await setup({
    targetBattles: 2, battleEncounter: { ...encounter, durationMs: 10_000 },
  });
  await t.run((ctx) => ctx.db.insert("gameBalance", {
    key: "autoBattleBatchLimit", value: 1, description: "Test limit", lastUpdated: 0,
  }));
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(10_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  vi.setSystemTime(20_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  vi.setSystemTime(25_000);
  expect(await t.mutation(api.tasks.sync, { playerId }))
    .toMatchObject({ nextSettlementAt: 25_000 });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ completedBattles: 1, onlineCreditMs: 15_000 });
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 100 });
  expect(await t.run((ctx) => ctx.db.query("fightHistory").collect())).toHaveLength(2);
});

test("long encounters accumulate partial progress beyond the spillover credit cap", async () => {
  const { t, playerId, taskId } = await setup({
    battleEncounter: { ...encounter, durationMs: 360_000 },
  });
  await t.mutation(api.tasks.sync, { playerId });
  for (let now = 10_000; now <= 360_000; now += 10_000) {
    vi.setSystemTime(now);
    if (now % 30_000 === 0) {
      await t.mutation(api.tasks.sync, { playerId });
    } else {
      await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
    }
  }
  expect(await t.run((ctx) => ctx.db.get(taskId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 50 });
});

test("offline work does not advance a following online-only task", async () => {
  const { t, playerId, taskId } = await setup({
    taskType: "timed", canProgressOffline: true, requiresOnline: false,
    durationMs: 1_000, battleMode: undefined, targetBattles: undefined, tier: undefined,
  });
  const nextId = await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Missing fixture");
    const { _id, _creationTime, ...fields } = task;
    return ctx.db.insert("playerTasks", {
      ...fields, status: "queued", queueOrder: 2,
      canProgressOffline: false, requiresOnline: true, durationMs: 60_000,
    });
  });
  vi.setSystemTime(60_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(nextId)))
    .toMatchObject({ status: "active", progressMs: 0, lastResolvedAt: 60_000 });
  vi.setSystemTime(70_000);
  await t.mutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
  vi.setSystemTime(80_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(nextId))).toMatchObject({ progressMs: 20_000 });
});

test("skill batches aggregate earned XP and outputs; boosts cannot apply retroactively", async () => {
  const { t, playerId, taskId } = await setupSkill();
  const boostId = await t.run(async (ctx) => {
    const itemId = await ctx.db.insert("items", {
      itemId: "boost", name: "XP boost", category: "crafting", description: "Boost",
      stackable: true, maxStackSize: 10, allowedEquipmentSlots: [],
      effectType: "skill-xp-multiplier", effectScope: "all", effectAmount: 2,
      effectDurationMs: 10_000, createdAt: 0, updatedAt: 0,
    });
    return ctx.db.insert("playerItems", {
      playerId, itemId, quantity: 1, acquiredAt: 0, updatedAt: 0,
    });
  });
  vi.setSystemTime(3_500);
  await t.mutation(api.items.useSkillBoost, { playerId, playerItemId: boostId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ payload: { completedActions: 3, totalExperienceEarned: 30 } });
  vi.setSystemTime(5_500);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ payload: { completedActions: 5, totalExperienceEarned: 60 } });
  expect(await t.run((ctx) => ctx.db.query("playerSkills").unique()))
    .toMatchObject({ totalExperience: 60, actionsCompleted: 5 });
});

test("deferred online skill progress survives reconnect with no new online interval", async () => {
  const { t, playerId, taskId } = await setupSkill(false);
  await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId);
    await ctx.db.patch(taskId, {
      payload: { ...task?.payload, progressSegments: [{ startAt: 0, remainingMs: 2_000 }] },
    });
  });
  vi.setSystemTime(60_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ progressMs: 2_000, payload: { completedActions: 2 } });
});

test("cancellation settles earned battle work and removes the presence record", async () => {
  const { t, playerId, taskId } = await setup({
    battleEncounter: { ...encounter, durationMs: 10_000 }, targetBattles: 2,
  });
  vi.spyOn(combat, "simulateRegularBattle").mockResolvedValue(encounter);
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(10_000);
  await t.mutation(api.tasks.cancel, { playerId, taskId });
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 50 });
  const queue = await t.query(api.tasks.getQueue, { playerId });
  expect(queue.history[0]).toMatchObject({ status: "cancelled", completedBattles: 1 });
  expect(await t.run((ctx) => ctx.db.query("taskPresence").collect())).toHaveLength(0);
});

test("rebirth cancels saved and queued battles rather than retaining pre-reset encounters", async () => {
  const { t, playerId, taskId } = await setup({ battleEncounter: encounter });
  await t.run(async (ctx) => {
    await ctx.db.patch(playerId, { maxTierReached: 5 });
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Missing fixture");
    const { _id, _creationTime, ...fields } = task;
    await ctx.db.insert("playerTasks", { ...fields, status: "queued", queueOrder: 2 });
  });
  await t.mutation(api.players.rebirth, { playerId });
  expect(await t.run((ctx) => ctx.db.query("playerTasks").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("taskPresence").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ rebirthCount: 1 });
});

test("configuration defaults are idempotently seeded, validated and grace-clamped", async () => {
  const { t, playerId } = await setup();
  await t.mutation(internal.migrations.backfillTaskQueueConfig, {});
  await t.mutation(internal.migrations.backfillTaskQueueConfig, {});
  const rows = await t.run((ctx) => ctx.db.query("gameBalance").collect());
  expect(rows.filter((row) => row.key === "taskSettlementIntervalMs")).toHaveLength(1);
  expect(await t.query((ctx) => readTaskSyncSettings(ctx, 15_000)))
    .toEqual({ settlementIntervalMs: 30_000, presenceIntervalMs: 10_000 });
  const interval = rows.find((row) => row.key === "taskPresenceIntervalMs");
  if (!interval) throw new Error("Missing seeded interval");
  await t.run((ctx) => ctx.db.patch(interval._id, { value: 60_000 }));
  expect(await t.query((ctx) => readTaskSyncSettings(ctx, 15_000)))
    .toMatchObject({ presenceIntervalMs: 10_000 });
  await t.run((ctx) => ctx.db.patch(interval._id, { value: "invalid" }));
  expect(await t.query((ctx) => readTaskSyncSettings(ctx, 15_000)))
    .toMatchObject({ presenceIntervalMs: 10_000 });
  await t.run((ctx) => ctx.db.patch(playerId, { role: "admin" }));
  await expect(t.mutation(api.admin.updateGameBalance, {
    playerId, balanceId: interval._id, value: 0, description: "Invalid",
  })).rejects.toThrow("Task sync intervals");
});

test("queue timestamps are stable between writes, and health projects without server calls", async () => {
  const { t, playerId } = await setup({ battleEncounter: encounter });
  const before = await t.query(api.tasks.getQueue, { playerId });
  vi.setSystemTime(60_000);
  expect(await t.query(api.tasks.getQueue, { playerId })).toEqual(before);
  expect(projectBattleHealth(encounter, 30_000)).toEqual({
    currentMonsterHealth: 300, currentMonsterMaxHealth: 600,
    currentPlayerHealth: 970, currentPlayerMaxHealth: 1_000,
  });
});

test("the real simulation result persists safely for legacy tasks without encounters", async () => {
  const { t, playerId, taskId } = await setup();
  await t.mutation(api.tasks.sync, { playerId });
  const before = await t.run((ctx) => ctx.db.get(taskId));
  expect(before?.battleEncounter?.monsterType).toBe("rat");
  expect(before?.battleEncounter?.durationMs).toBeGreaterThanOrEqual(1_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect((await t.run((ctx) => ctx.db.get(taskId)))?.battleEncounter)
    .toEqual(before?.battleEncounter);
});

test("older clients still settle through heartbeats until they reload", async () => {
  const { t, playerId, taskId } = await setup({ battleEncounter: encounter });
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(2_000);
  await t.mutation(api.tasks.heartbeat, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ onlineCreditMs: 2_000 });
});

test("long offline-capable tasks checkpoint at the offline cap to preserve continuous play", async () => {
  const { t, playerId } = await setup({
    taskType: "timed", durationMs: 8 * 60 * 60 * 1_000,
    canProgressOffline: true, requiresOnline: false,
  });
  expect(await t.mutation(api.tasks.sync, { playerId }))
    .toMatchObject({ nextSettlementAt: 4 * 60 * 60 * 1_000 });
});

test("modifier changes cannot discard or reinterpret a partially drained catch-up", async () => {
  const { t, playerId, taskId } = await setupSkill(false);
  await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId);
    await ctx.db.patch(taskId, {
      durationMs: 20_000_000,
      payload: {
        ...task?.payload, targetActionCount: 20_000,
        progressSegments: [{ startAt: 0, remainingMs: 11_000_000 }],
      },
    });
  });
  vi.setSystemTime(60_000);
  await expect(t.mutation(internal.tasks.settleForInteraction, { playerId }))
    .rejects.toThrow("Task catch-up is still running");
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ progressMs: 0 });
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ payload: { completedActions: 10_000 } });
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ payload: { completedActions: 11_000 } });
});

test("craft cancellation settles the finished actions and refunds only unused reservations", async () => {
  const { t, playerId, taskId, itemId } = await setup({
    taskType: "timed", definitionId: "skill_action", durationMs: 3_000,
    canProgressOffline: true, requiresOnline: false,
  });
  await t.run(async (ctx) => {
    const skill = await ctx.db.query("skillDefinitions").unique();
    if (!skill) throw new Error("Missing skill");
    await ctx.db.patch(skill._id, { category: "crafting" });
    await ctx.db.patch(taskId, {
      payload: {
        skillTaskVersion: 1, actionType: "crafting", actionId: "plank",
        skillId: "logging", skillCategory: "crafting", targetActionCount: 3,
        completedActions: 0, totalExperienceEarned: 0, outputSummary: [],
        reservedIngredients: [{ itemId, quantity: 2 }],
        skillActionSnapshot: {
          actionType: "crafting", actionId: "plank", skillId: "logging",
          skillCategory: "crafting", baseExperienceReward: 10,
          recipe: {
            recipeId: "plank", skillId: "logging", tier: 1, experienceReward: 10,
            outputs: [{ itemId, quantity: 1 }],
          },
        },
      },
    });
  });
  vi.setSystemTime(1_500);
  await t.mutation(api.tasks.cancel, { playerId, taskId });
  expect(await t.run((ctx) => ctx.db.query("playerItems").unique()))
    .toMatchObject({ itemId, quantity: 5 });
  expect(await t.run((ctx) => ctx.db.query("playerSkills").unique()))
    .toMatchObject({ totalExperience: 10, actionsCompleted: 1 });
});

test("equipment changes preserve the current encounter and affect the next fresh-player snapshot", async () => {
  const simulate = vi.spyOn(combat, "simulateRegularBattle").mockImplementation(
    async (_ctx, _player, _tier, bonuses) => ({
      ...encounter, durationMs: 10_000, goldEarned: 50 + (bonuses?.str ?? 0),
    })
  );
  const { t, playerId, taskId } = await setup({ targetBattles: 2 });
  const gearId = await t.run(async (ctx) => {
    const itemId = await ctx.db.insert("items", {
      itemId: "sword", name: "Sword", category: "equipment", description: "Sword",
      stackable: false, maxStackSize: 1, allowedEquipmentSlots: ["mainHand"],
      effectType: "stat-bonus", effectStat: "str", effectAmount: 12,
      createdAt: 0, updatedAt: 0,
    });
    return ctx.db.insert("playerItems", {
      playerId, itemId, quantity: 1, acquiredAt: 0, updatedAt: 0,
    });
  });
  await t.mutation(api.tasks.sync, { playerId });
  vi.setSystemTime(5_000);
  await t.mutation(api.items.equipItem, { playerId, playerItemId: gearId, slot: "mainHand" });
  expect(simulate).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ battleEncounter: { goldEarned: 50 }, onlineCreditMs: 5_000 });
  vi.setSystemTime(10_000);
  await t.mutation(api.tasks.sync, { playerId });
  expect(simulate).toHaveBeenCalledTimes(2);
  expect(simulate.mock.calls[1][1].totalExperience).toBe(25);
  expect(simulate.mock.calls[1][3]).toMatchObject({ str: 12 });
  expect(await t.run((ctx) => ctx.db.get(taskId)))
    .toMatchObject({ battleEncounter: { goldEarned: 62 }, completedBattles: 1 });
});

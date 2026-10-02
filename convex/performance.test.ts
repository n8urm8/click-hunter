/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { getSkillXpRequiredForLevel } from "./skillProgression";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const timestamps = { createdAt: 0, updatedAt: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules).withIdentity({ subject: "perf-user" });
  const fixtures = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "test-player", name: "Test player",
      authSubject: "perf-user",
      str: 1, dex: 1, int: 1, luk: 1, con: 1,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    const itemId = await ctx.db.insert("items", {
      itemId: "wood", name: "Wood", category: "crafting",
      description: "Test material", stackable: true, maxStackSize: 100,
      allowedEquipmentSlots: [], ...timestamps,
    });
    await ctx.db.insert("skillDefinitions", {
      skillId: "woodworking", name: "Woodworking", category: "crafting",
      description: "Test skill", enabled: true, ...timestamps,
    });
    await ctx.db.insert("skillTierDefinitions", {
      skillId: "woodworking", tier: 1, name: "Tier one",
      description: "Test tier", requiredLevel: 1, enabled: true, ...timestamps,
    });
    await ctx.db.insert("skillTierDefinitions", {
      skillId: "woodworking", tier: 2, name: "Disabled tier",
      description: "Test tier", requiredLevel: 2, enabled: false, ...timestamps,
    });
    const playerSkillId = await ctx.db.insert("playerSkills", {
      playerId, skillId: "woodworking", level: 2, experience: 100,
      totalExperience: 1_100, actionsCompleted: 10, ...timestamps,
    });
    for (const [recipeId, tier] of [["plank", 1], ["beam", 1], ["hidden", 2]] as const) {
      await ctx.db.insert("recipes", {
        recipeId, skillId: "woodworking", tier, name: recipeId,
        description: "Test recipe", experienceReward: 10,
        enabled: true, ...timestamps,
      });
      await ctx.db.insert("recipeIngredients", { recipeId, itemId, quantity: 2 });
      await ctx.db.insert("recipeOutputs", { recipeId, itemId, quantity: 1 });
    }
    await ctx.db.insert("augmentationDefinitions", {
      augmentationId: "wood-strength", skillId: "woodworking", tier: 1,
      name: "Wood strength", description: "Test augmentation",
      allowedEquipmentSlots: [], requiredMaterialItemId: itemId,
      requiredMaterialQuantity: 1, bossCatalystItemId: itemId,
      bossCatalystQuantity: 1, effectType: "stat", effectAmount: 1,
      enabled: true, ...timestamps,
    });
    return { playerId, itemId, playerSkillId };
  });
  return { t, ...fixtures };
}

test("catalog reads each item once and never depends on player state", async () => {
  const { t, playerId, itemId } = await setup();
  const measure = () => t.query(async (ctx) => {
    const catalog = await ctx.runQuery(api.skills.getSkillCatalog, {});
    return { catalog, metrics: await ctx.meta.getTransactionMetrics() };
  });
  const { catalog, metrics } = await measure();
  expect(catalog.recipes.map((recipe) => recipe.recipeId)).toEqual(["plank", "beam"]);
  expect(catalog.recipes[0].ingredients[0].item?._id).toBe(itemId);
  expect(catalog.augmentations[0].bossCatalystItem?._id).toBe(itemId);
  expect(catalog.skillXpBase).toBe(1_000);
  expect(metrics.documentsRead.used).toBe(11);

  await t.run(async (ctx) => {
    await ctx.db.patch(playerId, { name: "Longer player name", gold: 10 });
    await ctx.db.insert("playerSkills", {
      playerId, skillId: "other", level: 1, experience: 0,
      totalExperience: 0, actionsCompleted: 0, ...timestamps,
    });
  });
  const after = await measure();
  expect(after.catalog).toEqual(catalog);
  expect(after.metrics.bytesRead.used).toBe(metrics.bytesRead.used);
  expect(after.metrics.documentsRead.used).toBe(metrics.documentsRead.used);
});

test("split queries preserve the panel shape and keep progress reads small", async () => {
  const { t, playerId } = await setup();
  const catalog = await t.query(api.skills.getSkillCatalog, {});
  const rows = await t.query(api.skills.getPlayerSkills, { playerId });
  const composed = {
    ...catalog,
    playerSkills: rows.map((row) => ({
      ...row,
      xpRequiredForNextLevel: getSkillXpRequiredForLevel(row.level, catalog.skillXpBase),
    })),
  };
  expect(composed).toEqual(await t.query(api.skills.getSkillPanel, { playerId }));

  const metrics = await t.query(async (ctx) => {
    await ctx.runQuery(api.skills.getPlayerSkills, { playerId });
    return await ctx.meta.getTransactionMetrics();
  });
  // Player row (ownership check) + playerSkills rows.
  expect(metrics.documentsRead.used).toBe(3);
  expect(metrics.databaseQueries.used).toBe(3);
});

test("progress, configuration edits, and missing item references remain correct", async () => {
  const { t, playerId, playerSkillId, itemId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.patch(playerSkillId, { experience: 500 });
    await ctx.db.patch(playerId, { gold: 200 });
    await ctx.db.insert("gameBalance", {
      key: "skillXpPerLevel", value: 2_000, description: "Test XP base", lastUpdated: 0,
    });
    await ctx.db.delete(itemId);
  });
  const catalog = await t.query(api.skills.getSkillCatalog, {});
  expect(catalog.skillXpBase).toBe(2_000);
  expect(catalog.recipes[0].ingredients[0].item).toBeNull();
  expect(catalog.augmentations[0].bossCatalystItem).toBeNull();
  expect((await t.query(api.skills.getPlayerSkills, { playerId }))[0].experience).toBe(500);
});

test("idle heartbeat returns no snapshot and performs no history or balance reads", async () => {
  const { t, playerId } = await setup();
  const { result, metrics } = await t.mutation(async (ctx) => {
    const result = await ctx.runMutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(result).toBeNull();
  expect(metrics.documentsRead.used).toBe(1);
  expect(metrics.databaseQueries.used).toBe(2);
});

test("presence does not advance offline work; sync settles it and activates the queue", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000);
  const { t, playerId } = await setup();
  const [activeId, queuedId] = await t.run(async (ctx) => {
    const task = {
      playerId, taskType: "timed" as const, definitionId: "test",
      displayName: "Test task", canProgressOffline: true, requiresOnline: false,
      durationMs: 3_000, progressMs: 0, completedBattles: 0, onlineCreditMs: 0,
      lastResolvedAt: 0, lastHeartbeatAt: 0, offlineCapped: false, ...timestamps,
    };
    return [
      await ctx.db.insert("playerTasks", { ...task, status: "active", queueOrder: 1 }),
      await ctx.db.insert("playerTasks", { ...task, status: "queued", queueOrder: 2 }),
    ];
  });

  const { result, metrics } = await t.mutation(async (ctx) => {
    const result = await ctx.runMutation(api.tasks.heartbeat, { playerId, presenceOnly: true });
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(result).toBeNull();
  expect(metrics.databaseQueries.used).toBe(2);
  expect(metrics.documentsWritten.used).toBe(0);
  expect(await t.run((ctx) => ctx.db.get(activeId))).toMatchObject({ progressMs: 0 });
  await t.mutation(api.tasks.sync, { playerId });
  expect(await t.run((ctx) => ctx.db.get(activeId))).toMatchObject({ progressMs: 2_000 });

  vi.setSystemTime(4_000);
  await t.mutation(api.tasks.sync, { playerId });
  const queue = await t.query(api.tasks.getQueue, { playerId, now: 4_000 });
  expect(queue.active).toMatchObject({ _id: queuedId, progressMs: 1_000 });
  expect(queue.history).toHaveLength(1);
  expect(queue.history[0]).toMatchObject({ taskId: activeId, status: "completed" });
});

test("sync still settles offline progress without returning a duplicate snapshot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const { t, playerId } = await setup();
  const taskId = await t.run((ctx) => ctx.db.insert("playerTasks", {
    playerId, taskType: "timed", definitionId: "offline", displayName: "Offline task",
    status: "active", queueOrder: 1, canProgressOffline: true, requiresOnline: false,
    durationMs: 20_000, progressMs: 0, completedBattles: 0, onlineCreditMs: 0,
    lastResolvedAt: 0, lastHeartbeatAt: 0, offlineCapped: false, ...timestamps,
  }));
  expect(await t.mutation(api.tasks.sync, { playerId })).toEqual({
    serverTime: 10_000, nextSettlementAt: 20_000, requiresPresence: false,
    settlementIntervalMs: 30_000, presenceIntervalMs: 10_000,
  });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ progressMs: 10_000 });
});

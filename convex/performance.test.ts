/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords, patchPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const timestamps = { createdAt: 0, updatedAt: 0 };
// Documents one skill-page read touches in the fixture: owner, skill, tiers, player skill, two recipes with their parts, items, augmentation and balance snapshot.
const EXPECTED_PAGE_DOCS = 13;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules).withIdentity(testIdentity("perf-user"));
  const fixtures = await t.run(async (ctx) => {
    const playerId = await insertPlayerWithRecords(ctx, {
      anonymousId: "test-player", name: "Test player",
      authSubject: ownerFor("perf-user"),
      str: 1, dex: 1, int: 1, luk: 1, con: 1,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    await ctx.db.insert("playerOwners", { playerId, authSubject: ownerFor("perf-user") });
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

test("the skill page reads each item once and never depends on player state", async () => {
  const { t, playerId, itemId } = await setup();
  const measure = () => t.query(async (ctx) => {
    const page = await ctx.runQuery(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 1 });
    return { page, metrics: await ctx.meta.getTransactionMetrics() };
  });
  const { page, metrics } = await measure();
  expect(page.selectedTier).toBe(1);
  expect(page.recipes.map((recipe) => recipe.recipeId)).toEqual(["plank", "beam"]);
  expect(page.recipes[0].ingredients[0].itemId).toBe(itemId);
  expect(page.items[itemId]?._id).toBe(itemId);
  expect(page.augmentations[0].bossCatalystItemId).toBe(itemId);
  expect(page.skillXpBase).toBe(1_000);
  expect(metrics.documentsRead.used).toBe(EXPECTED_PAGE_DOCS);

  await t.run(async (ctx) => {
    await patchPlayerWithRecords(ctx, playerId, { name: "Longer player name", gold: 10 });
    await ctx.db.insert("playerSkills", {
      playerId, skillId: "other", level: 1, experience: 0,
      totalExperience: 0, actionsCompleted: 0, ...timestamps,
    });
  });
  const after = await measure();
  expect(after.page).toEqual(page);
  expect(after.metrics.bytesRead.used).toBe(metrics.bytesRead.used);
  expect(after.metrics.documentsRead.used).toBe(metrics.documentsRead.used);
});

test("the skill page opens the highest unlocked tier, and honours explicit tiers", async () => {
  const { t, playerId, playerSkillId } = await setup();
  // Tier 3 needs level 3; the fixture player is level 2.
  await t.run(async (ctx) => {
    await ctx.db.insert("skillTierDefinitions", {
      skillId: "woodworking", tier: 3, name: "Tier three",
      description: "Test tier", requiredLevel: 3, enabled: true, ...timestamps,
    });
    await ctx.db.insert("recipes", {
      recipeId: "tall", skillId: "woodworking", tier: 3, name: "tall",
      description: "Test recipe", experienceReward: 10, enabled: true, ...timestamps,
    });
  });
  const ids = (page: { recipes: Array<{ recipeId: string }> }) => page.recipes.map((recipe) => recipe.recipeId);

  const locked = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking" });
  expect(locked.selectedTier).toBe(1);
  expect(locked.tierNumbers).toEqual([1, 3]);
  expect(ids(locked)).toEqual(["plank", "beam"]);

  // Locked tiers still open when asked for explicitly.
  const explicitLocked = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 3 });
  expect(explicitLocked.selectedTier).toBe(3);
  expect(ids(explicitLocked)).toEqual(["tall"]);

  const everything = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: "all" });
  expect(everything.selectedTier).toBe("all");
  expect(ids(everything)).toEqual(["plank", "beam", "tall"]);

  const unknownTier = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 99 });
  expect(unknownTier.selectedTier).toBe(1);
  // The disabled tier 2 recipe never shows, even under "all".
  expect(ids(everything)).not.toContain("hidden");

  // Reaching level 3 unlocks tier 3, and the default moves up with it.
  await t.run((ctx) => ctx.db.patch(playerSkillId, { level: 3 }));
  const unlocked = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking" });
  expect(unlocked.selectedTier).toBe(3);
  expect(ids(unlocked)).toEqual(["tall"]);
});

test("a player with no progress in the skill opens its lowest tier", async () => {
  const { t, playerId, playerSkillId } = await setup();
  await t.run((ctx) => ctx.db.delete(playerSkillId));
  const page = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking" });
  expect(page.selectedTier).toBe(1);
});

test("the skill page falls back to the first skill for an unknown id", async () => {
  const { t, playerId } = await setup();
  const page = await t.query(api.skills.getSkillPage, { playerId, skillId: "not-a-skill" });
  expect(page.skill?.skillId).toBe("woodworking");
});

test("split queries keep progress reads small", async () => {
  const { t, playerId } = await setup();
  const metrics = await t.query(async (ctx) => {
    await ctx.runQuery(api.skills.getPlayerSkills, { playerId });
    return await ctx.meta.getTransactionMetrics();
  });
  // Owner row (ownership check) + playerSkills rows.
  expect(metrics.documentsRead.used).toBe(3);
  // +1 query over the owner read: the account ban check (a point read that
  // returns no documents for an unbanned account). Documents and bytes unchanged.
  expect(metrics.databaseQueries.used).toBe(4);
});

test("progress, configuration edits, and missing item references remain correct", async () => {
  const { t, playerId, playerSkillId, itemId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.patch(playerSkillId, { experience: 500 });
    await patchPlayerWithRecords(ctx, playerId, { gold: 200 });
    await ctx.db.insert("gameBalance", {
      key: "skillXpPerLevel", value: 2_000, description: "Test XP base", lastUpdated: 0,
    });
    await ctx.db.delete(itemId);
  });
  const page = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 1 });
  expect(page.skillXpBase).toBe(2_000);
  expect(page.items[itemId]).toBeUndefined();
  expect(page.recipes[0].ingredients[0].itemId).toBe(itemId);
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
  // +1 query over the owner read: the account ban check (a point read that
  // returns no documents for an unbanned account). Documents and bytes unchanged.
  expect(metrics.databaseQueries.used).toBe(3);
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
  // +1 for the account ban check (see the owner-read case above).
  expect(metrics.databaseQueries.used).toBe(3);
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
    settlementIntervalMs: 30_000, presenceIntervalMs: 45_000,
    skillSettlementGapMs: 300_000,
  });
  expect(await t.run((ctx) => ctx.db.get(taskId))).toMatchObject({ progressMs: 10_000 });
});

test("a tier returns every enabled recipe, not just the first 300", async () => {
  const { t, itemId, playerId } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 305; index += 1) {
      const recipeId = `bulk-${index}`;
      await ctx.db.insert("recipes", {
        recipeId, skillId: "woodworking", tier: 1, name: recipeId,
        description: "Bulk recipe", experienceReward: 1,
        enabled: true, ...timestamps,
      });
      await ctx.db.insert("recipeIngredients", { recipeId, itemId, quantity: 1 });
      await ctx.db.insert("recipeOutputs", { recipeId, itemId, quantity: 1 });
    }
  });
  const page = await t.query(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 1 });
  expect(page.recipes).toHaveLength(307);
  expect(Object.keys(page.items)).toEqual([itemId]);
});

test("the augmentation catalog keeps augmentations and their items, and reads far fewer documents", async () => {
  const { t, itemId, playerId } = await setup();
  const measure = (fn: "getSkillPage" | "getAugmentationCatalog") =>
    t.query(async (ctx) => {
      const result =
        fn === "getSkillPage"
          ? await ctx.runQuery(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: "all" })
          : await ctx.runQuery(api.skills.getAugmentationCatalog, {});
      return { result, metrics: await ctx.meta.getTransactionMetrics() };
    });
  const full = await measure("getSkillPage");
  const light = await measure("getAugmentationCatalog");
  expect(light.result.augmentations.map((row) => row.augmentationId)).toEqual(["wood-strength"]);
  expect(light.result.items[itemId]?._id).toBe(itemId);
  expect(light.result.recipes).toEqual([]);
  expect(light.result.activities).toEqual([]);
  expect(light.result.definitions).toEqual(full.result.definitions);
  expect(light.result.infusionRates).toEqual(full.result.infusionRates);
  expect(light.metrics.documentsRead.used).toBeLessThan(full.metrics.documentsRead.used);
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  ALL_ITEMS,
  BLIGHTED_GEAR_FIRST_STEP,
  BLIGHTED_GEAR_GROWTH,
  CRAFTING_SEED_SECTIONS,
  buildAugmentationPlans,
  buildLootTablePlans,
  buildRecipePlans,
  seedForestCraftingContent,
} from "./forestCraftingSeed";
import { populateMonsters } from "./seed";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const totals = (results: Awaited<ReturnType<typeof seedForestCraftingContent>>) =>
  Object.values(results).reduce(
    (sum, counts) => ({
      inserted: sum.inserted + (counts?.inserted ?? 0),
      updated: sum.updated + (counts?.updated ?? 0),
      deleted: sum.deleted + (counts?.deleted ?? 0),
    }),
    { inserted: 0, updated: 0, deleted: 0 }
  );

test("every slug the plans reference is a seeded item", () => {
  const seeded = new Set(ALL_ITEMS.map((item) => item.itemId));
  const missing = new Set<string>();
  const check = (slug: string) => {
    if (!seeded.has(slug)) missing.add(slug);
  };
  for (const recipe of buildRecipePlans(10)) {
    check(recipe.outputItemId);
    recipe.ingredients.forEach((ingredient) => check(ingredient.itemId));
  }
  for (const table of buildLootTablePlans()) {
    table.entries.forEach((entry) => check(entry.itemId));
  }
  for (const augmentation of buildAugmentationPlans()) {
    check(augmentation.requiredMaterialSlug);
  }
  expect([...missing]).toEqual([]);
});

test("recipe and loot ids are unique", () => {
  const recipeIds = buildRecipePlans(10).map((recipe) => recipe.recipeId);
  expect(new Set(recipeIds).size).toBe(recipeIds.length);
  const tableIds = buildLootTablePlans().map((table) => table.lootTableId);
  expect(new Set(tableIds).size).toBe(tableIds.length);
});

test("the Blighted ladder grows tier 8 gear through tiers 9–16", () => {
  const byId = new Map(ALL_ITEMS.map((item) => [item.itemId, item]));
  const recipes = new Map(buildRecipePlans(10).map((recipe) => [recipe.recipeId, recipe]));
  const sword8 = byId.get("starforged-sword")!;
  const sword9 = byId.get("starforged-sword-t9")!;
  const sword16 = byId.get("starforged-sword-t16")!;
  expect(sword9).toMatchObject({ name: "Overgrown Starforged Sword", craftingTier: 9, itemFamily: "forging-sword" });
  expect(sword9.baseDamage).toBeCloseTo(sword8.baseDamage! * BLIGHTED_GEAR_FIRST_STEP);
  expect(sword16.baseDamage! / sword9.baseDamage!).toBeCloseTo(Math.pow(BLIGHTED_GEAR_GROWTH, 7), 1);
  expect(byId.get("worldheart-vest-t12")!.baseDefense).toBeGreaterThan(byId.get("worldheart-vest")!.baseDefense! * 3);

  expect(recipes.get("starforged-sword-t9")!.ingredients).toEqual([
    { itemId: "starforged-sword", quantity: 1 },
    { itemId: "blighted-grove-bone", quantity: 4 },
    { itemId: "starforged-ingot", quantity: 3 },
    { itemId: "forest-boss-token-8", quantity: 1 },
  ]);
  expect(recipes.get("worldheart-bow-t16")).toMatchObject({ skillId: "woodworking", tier: 16 });
  expect(recipes.get("worldheart-bow-t16")!.ingredients.map((row) => row.itemId)).toEqual([
    "worldheart-bow-t15",
    "blighted-starforged-hide",
    "worldheart-lumber",
    "forest-boss-token-15",
  ]);
});

test("boss tables pay out a set of tokens, extra trophies, materials and shards", () => {
  const tables = new Map(buildLootTablePlans().map((table) => [table.lootTableId, table]));
  const slugs = (id: string) => tables.get(id)!.entries.map((entry) => entry.itemId);
  const token = tables.get("loot-boss-tier-9")!.entries.find((entry) => entry.itemId === "forest-boss-token-9");
  expect(token).toMatchObject({ guaranteed: true, minQuantity: 5 });
  expect(tables.get("loot-boss-tier-9")!.entries.every((entry) => entry.guaranteed)).toBe(true);
  expect(slugs("loot-boss-tier-9")).toEqual(expect.arrayContaining(["blighted-grove-trophy", "blighted-grove-bone", "rift-shard"]));
  expect(slugs("loot-boss-tier-3")).not.toContain("rift-shard");
  expect(slugs("loot-boss-tier-18")).toEqual(["forest-boss-token-18", "rift-shard"]);
});

// Full seeds are slow under a parallel test run.
test("a re-run on an up-to-date database writes nothing", { timeout: 30_000 }, async () => {
  const t = convexTest(schema, modules);
  const first = await t.run(async (ctx) => {
    await populateMonsters(ctx);
    return await seedForestCraftingContent(ctx);
  });
  expect(totals(first).inserted).toBeGreaterThan(1000);

  const second = await t.run((ctx) => seedForestCraftingContent(ctx));
  expect(totals(second)).toEqual({ inserted: 0, updated: 0, deleted: 0 });
});

// Full seeds are slow under a parallel test run.
test("a re-run restores seed-owned rows and keeps tuned balance defaults", { timeout: 30_000 }, async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedForestCraftingContent(ctx);
    const recipe = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "verdant-tonic"))
      .first();
    const ingredient = await ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "verdant-tonic"))
      .first();
    const tuned = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "endgameRebirthRequirement"))
      .first();
    await ctx.db.patch(recipe!._id, { name: "Edited" });
    await ctx.db.patch(ingredient!._id, { quantity: 99 });
    await ctx.db.patch(tuned!._id, { value: 7 });
  });

  const rerun = await t.run((ctx) => seedForestCraftingContent(ctx));
  expect(rerun["recipes:alchemy"]).toMatchObject({ updated: 1 });

  const state = await t.run(async (ctx) => {
    const recipe = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "verdant-tonic"))
      .first();
    const ingredients = await ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "verdant-tonic"))
      .collect();
    const tuned = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "endgameRebirthRequirement"))
      .first();
    return {
      name: recipe?.name,
      quantities: ingredients.map((row) => row.quantity).sort(),
      tuned: tuned?.value,
    };
  });
  expect(state).toEqual({ name: "Brew Verdant Tonic", quantities: [1, 2], tuned: 7 });
});

// Full seeds are slow under a parallel test run.
test("upsertForestCrafting syncs every section in its own transaction and validates", { timeout: 30_000 }, async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => populateMonsters(ctx));
  const result = await t.action(internal.seed.upsertForestCrafting, {});
  expect(Object.keys(result.sections).sort()).toEqual([...CRAFTING_SEED_SECTIONS].sort());
  expect(result.validatedRecipes).toBeGreaterThan(100);

  const again = await t.action(internal.seed.upsertForestCrafting, {});
  const writes = Object.values(again.sections).reduce(
    (sum, counts) => sum + counts.inserted + counts.updated + counts.deleted,
    0
  );
  expect(writes).toBe(0);
});

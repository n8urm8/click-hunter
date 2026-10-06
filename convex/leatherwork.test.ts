/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { seedForestCraftingContent } from "./forestCraftingSeed";
import { getConsumableSlotCount } from "./consumableSlots";
import { getInventorySlotCapacity } from "./items";
import { validateRecipeChain } from "./recipeValidation";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SUBJECT = "leather-user";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({ subject: SUBJECT });
  const playerId = await t.run(async (ctx) => {
    return await ctx.db.insert("players", {
      anonymousId: "leather", name: "Leatherworker", authSubject: SUBJECT,
      str: 5, dex: 5, int: 5, luk: 5, con: 10,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
  });
  await t.run((ctx) => seedForestCraftingContent(ctx));
  return { t, playerId };
}

async function equipSeeded(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Awaited<ReturnType<typeof setup>>["playerId"],
  itemId: string,
  slot: "belt" | "bag"
) {
  return await t.run(async (ctx) => {
    const def = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
      .first();
    if (!def) throw new Error(`Missing seeded item ${itemId}`);
    return await ctx.db.insert("playerItems", {
      playerId, itemId: def._id, quantity: 1, equippedSlot: slot,
      acquiredAt: 0, updatedAt: 0,
    });
  });
}

test("seed plants leathercrafting skill, tiers, leather, belts, bags, and armor", async () => {
  const { t } = await setup();
  const rows = await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", "leathercrafting"))
      .first();
    const tiers = await ctx.db
      .query("skillTierDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", "leathercrafting"))
      .collect();
    const items = await ctx.db.query("items").collect();
    const leather = items.filter((item) => item.itemFamily?.startsWith("leather-") && item.category === "crafting");
    const belts = items.filter((item) => item.itemFamily?.startsWith("leather-belt-"));
    const bags = items.filter((item) => item.itemFamily === "leather-bag");
    const armor = items.filter((item) => item.itemFamily?.startsWith("leather-armor-"));
    return { skill, tiers, leather, belts, bags, armor };
  });
  expect(rows.skill).toMatchObject({ skillId: "leathercrafting", category: "crafting", enabled: true });
  expect(rows.tiers.length).toBe(8);
  // 3 monsters × 8 tiers of tier-marked leather.
  expect(rows.leather.length).toBe(24);
  expect(rows.belts.length).toBe(24);
  expect(rows.bags.length).toBe(8);
  // 3 monsters × 4 pieces × 8 tiers.
  expect(rows.armor.length).toBe(96);
});

test("belts grant slots by tier and carry their monster stat", async () => {
  const { t } = await setup();
  const defs = await t.run(async (ctx) => {
    const byItemId = async (itemId: string) =>
      await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", itemId)).first();
    return {
      troll1: await byItemId("trollhide-belt-t1"),
      wyvern4: await byItemId("wyvernscale-belt-t4"),
      dragon8: await byItemId("dragonhide-belt-t8"),
    };
  });
  expect(defs.troll1).toMatchObject({
    effectType: "stat-bonus", effectStat: "str", effectAmount: 1, baseDefense: 0,
    allowedEquipmentSlots: ["belt"],
  });
  expect(defs.wyvern4).toMatchObject({ effectStat: "dex", effectAmount: 4 });
  expect(defs.dragon8).toMatchObject({ effectStat: "int", effectAmount: 8 });
});

test("belt tiers set consumable slots: t1 → 1, t4 → 2, t8 → 3", async () => {
  const { t, playerId } = await setup();
  expect(await t.run((ctx) => getConsumableSlotCount(ctx, playerId))).toBe(1);

  const beltRow = await equipSeeded(t, playerId, "trollhide-belt-t1", "belt");
  expect(await t.run((ctx) => getConsumableSlotCount(ctx, playerId))).toBe(1);
  await t.run((ctx) => ctx.db.delete(beltRow));

  await equipSeeded(t, playerId, "wyvernscale-belt-t4", "belt");
  expect(await t.run((ctx) => getConsumableSlotCount(ctx, playerId))).toBe(2);

  const rows = await t.run((ctx) => ctx.db.query("playerItems").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).collect());
  for (const row of rows) await t.run((ctx) => ctx.db.delete(row._id));
  await equipSeeded(t, playerId, "dragonhide-belt-t8", "belt");
  expect(await t.run((ctx) => getConsumableSlotCount(ctx, playerId))).toBe(3);
});

test("bags grant +10 inventory slots per tier with no stat bonus", async () => {
  const { t, playerId } = await setup();
  const base = await t.run((ctx) => getInventorySlotCapacity(ctx, playerId));
  const bag = await t.run(async (ctx) =>
    await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", "traveler-bag-t3")).first()
  );
  expect(bag).toMatchObject({ allowedEquipmentSlots: ["bag"] });
  expect(bag?.effectType).toBeUndefined();
  await equipSeeded(t, playerId, "traveler-bag-t3", "bag");
  expect(await t.run((ctx) => getInventorySlotCapacity(ctx, playerId))).toBe(base + 30);
});

test("leather armor trades defense for a monster stat", async () => {
  const { t } = await setup();
  const vest = await t.run(async (ctx) =>
    await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", "trollhide-vest-t2")).first()
  );
  const hood = await t.run(async (ctx) =>
    await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", "dragonhide-cap-t5")).first()
  );
  // Wood T2 vest is 8 defense; leather T2 vest is 6 with +2 str.
  expect(vest).toMatchObject({
    baseDefense: 6, effectType: "stat-bonus", effectStat: "str", effectAmount: 2,
    allowedEquipmentSlots: ["chest"],
  });
  expect(hood).toMatchObject({ baseDefense: 5, effectStat: "int", effectAmount: 5 });
});

test("leather recipes are stageless, tier-gated, and skip chain validation", async () => {
  const { t } = await setup();
  // Stageless recipes bypass the refinement/product chain rules (hides come
  // from combat loot, not a paired gathering skill).
  await t.run((ctx) => validateRecipeChain(ctx, "trollhide-belt-t4"));
  await t.run((ctx) => validateRecipeChain(ctx, "traveler-bag-t8"));
  await t.run((ctx) => validateRecipeChain(ctx, "wyvernscale-boots-t1"));
  const recipe = await t.run(async (ctx) =>
    await ctx.db.query("recipes").withIndex("by_recipeId", (q) => q.eq("recipeId", "trollhide-belt-t4")).first()
  );
  expect(recipe).toMatchObject({ skillId: "leathercrafting", tier: 4 });
  expect(recipe?.stage).toBeUndefined();
  const ingredients = await t.run(async (ctx) =>
    await ctx.db.query("recipeIngredients").withIndex("by_recipeId", (q) => q.eq("recipeId", "trollhide-belt-t4")).collect()
  );
  expect(ingredients.length).toBe(2);
});

test("armor infusions accept belts and talismans accept the amulet slot", async () => {
  const { t } = await setup();
  const rows = await t.run(async (ctx) => {
    const armor2 = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) => q.eq("augmentationId", "augment-armor-tier-2"))
      .first();
    const talisman = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "rat-fang-talisman"))
      .first();
    return { armor2, talisman };
  });
  expect(rows.armor2?.allowedEquipmentSlots).toContain("belt");
  expect(rows.talisman?.allowedEquipmentSlots).toContain("amulet");
});

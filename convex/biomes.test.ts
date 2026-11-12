/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  applyBlight,
  biomeMonsterSeeds,
  blightForTier,
  enchantMaterialItemId,
  materialItemIdForTier,
  monsterDropsForTier,
  monsterNameForTier,
  monstersForTier,
  tierAreaName,
  tierStatScale,
} from "./biomes";
import { seedForestCraftingContent } from "./forestCraftingSeed";
import { validateAllRecipeChains } from "./recipeValidation";
import { populateMonsters } from "./seed";
import { ensureBossForTier } from "./bossData";
import { getTierClearStatus } from "./tierClears";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("tier rosters", () => {
  const roster = biomeMonsterSeeds();

  test("48 monsters, six per biome, unique types", () => {
    expect(roster.length).toBe(48);
    expect(new Set(roster.map((monster) => monster.type)).size).toBe(48);
  });

  test("tiers 1–8 each get their own biome", () => {
    expect(monstersForTier(roster, 1).map((monster) => monster.name)).toEqual([
      "Burrow Rat",
      "Thorn Goblin",
      "Moss Troll",
      "Briar Wolf",
      "Bramble Fiend",
      "Grove Treant",
    ]);
    expect(monstersForTier(roster, 5).every((monster) => monster.biomeTier === 5)).toBe(true);
    expect(tierAreaName(5)).toBe("Emberfall");
  });

  test("tier 8+N is the Blighted version of biome N", () => {
    const blighted = monstersForTier(roster, 9);
    expect(blighted.every((monster) => monster.biomeTier === 1)).toBe(true);
    expect(monsterNameForTier(blighted[0], 9)).toBe("Blighted Burrow Rat");
    expect(tierAreaName(12)).toBe("Blighted Deepwood");
    expect(blightForTier(blighted[0], 9)?.label).toBe("Overgrown");
    expect(blightForTier(blighted[0], 1)).toBeNull();
  });

  test("the Rift draws the two hard archetypes from every biome", () => {
    const rift = monstersForTier(roster, 17);
    expect(rift.length).toBe(16);
    expect(new Set(rift.map((monster) => monster.archetype))).toEqual(
      new Set(["fiend", "apex"])
    );
    expect(monsterNameForTier(rift[0], 20)).toMatch(/^Riftborn /);
    expect(tierAreaName(18)).toBe("The Rift");
  });

  test("unassigned monster rows appear on every tier", () => {
    const loose: { name: string; strength: number; biomeTier?: number } = {
      name: "Test Rat",
      strength: 1,
    };
    expect(monstersForTier([loose], 14)).toEqual([loose]);
    expect(monsterNameForTier(loose, 14)).toBe("Test Rat");
  });
});

describe("scaling", () => {
  test("the endgame jump applies once from the gate tier up", () => {
    const jump = { gateTier: 9, jumpMultiplier: 3 };
    expect(tierStatScale(8, 1.4, jump)).toBeCloseTo(Math.pow(1.4, 7));
    expect(tierStatScale(9, 1.4, jump)).toBeCloseTo(Math.pow(1.4, 8) * 3);
    expect(tierStatScale(12, 1.4, jump) / tierStatScale(11, 1.4, jump)).toBeCloseTo(1.4);
  });

  test("blight twists multiply stats and speed up attacks", () => {
    const monster = { str: 10, dex: 10, int: 10, luk: 10, con: 10, baseMsPerAttack: 2000 };
    const deepwood = blightForTier({ biomeTier: 4 }, 12);
    const twisted = applyBlight(monster, deepwood, 800);
    expect(twisted.baseMsPerAttack).toBe(1400);
    const grove = applyBlight(monster, blightForTier({ biomeTier: 1 }, 9), 800);
    expect(grove.con).toBe(16);
  });
});

describe("materials", () => {
  test("drops follow the tier band", () => {
    const treant = { archetype: "apex" as const, biomeTier: 1 };
    expect(monsterDropsForTier(treant, 1).map((drop) => drop.itemId)).toEqual([
      "grove-bone",
      "grove-trophy",
    ]);
    expect(monsterDropsForTier(treant, 9).map((drop) => drop.itemId)).toEqual([
      "blighted-grove-bone",
      "blighted-grove-trophy",
    ]);
    expect(monsterDropsForTier(treant, 17).map((drop) => drop.itemId)).toEqual([
      "blighted-grove-bone",
      "rift-shard",
    ]);
  });

  test("enchant levels walk regular, Blighted, then Rift materials", () => {
    expect(enchantMaterialItemId(3, true)).toBe("ancient-bone");
    expect(enchantMaterialItemId(3, false)).toBe("ancient-hide");
    expect(enchantMaterialItemId(10, false)).toBe("blighted-moonlit-hide");
    expect(enchantMaterialItemId(19, true)).toBe("rift-shard");
    expect(materialItemIdForTier(16, "trophy")).toBe("blighted-starforged-trophy");
  });
});

test("seeded content: recipes validate, loot is tier-aware, bosses follow the roster", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await populateMonsters(ctx);
    await seedForestCraftingContent(ctx);
    await validateAllRecipeChains(ctx);
  });

  const result = await t.run(async (ctx) => {
    const sourcesFor = (sourceId: string) =>
      ctx.db
        .query("lootSources")
        .withIndex("by_sourceType_and_sourceId", (q) =>
          q.eq("sourceType", "monster").eq("sourceId", sourceId)
        )
        .collect();
    const treantSources = await sourcesFor("grove-treant");
    const ratSources = await sourcesFor("burrow-rat");
    const sword = await ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "moonstone-sword"))
      .collect();
    const swordItems = await Promise.all(sword.map((row) => ctx.db.get(row.itemId)));
    const greater = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "greater-verdant-tonic"))
      .first();
    const boss9 = await ensureBossForTier(ctx, 9);
    const boss1 = await ensureBossForTier(ctx, 1);
    return {
      treantTiers: treantSources.map((row) => row.tier ?? null).sort(),
      ratTiers: ratSources.map((row) => row.tier ?? null).sort(),
      swordIngredients: swordItems.map((item) => item?.itemId).sort(),
      greater,
      boss1,
      boss9,
    };
  });
  // Main tier (tierless), Blighted tier 9, and Rift tiers 17–20.
  expect(result.treantTiers).toEqual([17, 18, 19, 20, 9, null]);
  expect(result.ratTiers).toEqual([9, null]);
  expect(result.swordIngredients).toContain("grove-bone");
  expect(result.greater).toMatchObject({ itemFamily: "alchemy-greater", effectAmount: 3 });
  expect(result.boss1?.name).toMatch(/of Grove$/);
  expect(result.boss9?.name).toMatch(/of Blighted Grove$/);
  // Boss 9 is the Treant shape × 3 boss multiplier × tier scale × endgame jump.
  expect(result.boss9!.str).toBeGreaterThan(result.boss1!.str * Math.pow(1.4, 8) * 2.9);
});

test("a tier's boss gate counts only that tier's roster", async () => {
  const t = convexTest(schema, modules);
  const status = await t.run(async (ctx) => {
    await populateMonsters(ctx);
    const playerId = await ctx.db.insert("players", {
      anonymousId: "gate",
      name: "Gate",
      str: 1, dex: 1, int: 1, luk: 1, con: 1,
      rebirthCount: 0, rebirthTierThreshold: 5, currentTier: 1,
      autoAttackEnabled: true, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    return {
      grove: await getTierClearStatus(ctx, playerId, 1),
      rift: await getTierClearStatus(ctx, playerId, 17),
    };
  });
  expect(status.grove.total).toBe(6);
  expect(status.rift.total).toBe(16);
  expect(status.rift.missingNames[0]).toMatch(/^Riftborn /);
});

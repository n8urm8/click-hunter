/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { insertPlayerWithRecords } from "./testPlayers";
import { ALL_ITEMS } from "./forestCraftingSeed";
import {
  DRAGON_SCALE_ITEM_IDS,
  GUILD_BUILDINGS,
  GUILD_BUILDING_MAX_LEVEL,
  bonusesFromLevels,
  guildBuildingDef,
  guildBuildingLevelCost,
  raidScaleDrop,
} from "./guildBuildings";
import { getGuildBonusesForPlayer } from "./guilds";
import { readPlayerCombatProfile } from "./combat";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("every building material is a seeded item", () => {
  const seeded = new Set(ALL_ITEMS.map((item) => item.itemId));
  const missing = GUILD_BUILDINGS.flatMap((def) =>
    Array.from({ length: GUILD_BUILDING_MAX_LEVEL }, (_, index) =>
      guildBuildingLevelCost(def, index + 1).map((entry) => entry.itemId)
    ).flat()
  ).filter((slug) => !seeded.has(slug));
  expect(missing).toEqual([]);
  for (const slug of Object.values(DRAGON_SCALE_ITEM_IDS)) expect(seeded.has(slug)).toBe(true);
});

test("level costs climb from scales to Blighted and Rift scales", () => {
  const warHall = guildBuildingDef("war-hall")!;
  expect(guildBuildingLevelCost(warHall, 1)).toEqual([
    { itemId: "dragon-scale", quantity: 10 },
    { itemId: "moonstone-ingot", quantity: 20 },
  ]);
  expect(guildBuildingLevelCost(warHall, 6).map((row) => row.itemId)).toEqual([
    "dragon-scale",
    "blighted-dragon-scale",
    "voidquartz-ingot",
  ]);
  expect(guildBuildingLevelCost(warHall, 10)).toEqual([
    { itemId: "dragon-scale", quantity: 100 },
    { itemId: "blighted-dragon-scale", quantity: 25 },
    { itemId: "rift-dragon-scale", quantity: 6 },
    { itemId: "starforged-ingot", quantity: 200 },
  ]);
});

test("raid kills drop the tier band's scales per raider", () => {
  expect(raidScaleDrop(1, 4)).toEqual({ itemId: "dragon-scale", quantity: 8 });
  expect(raidScaleDrop(8, 4)).toEqual({ itemId: "dragon-scale", quantity: 24 });
  expect(raidScaleDrop(9, 2)).toEqual({ itemId: "blighted-dragon-scale", quantity: 4 });
  expect(raidScaleDrop(20, 1)).toEqual({ itemId: "rift-dragon-scale", quantity: 4 });
});

test("bonuses sum per building and ignore unknown rows", () => {
  const bonuses = bonusesFromLevels([
    { buildingId: "war-hall", level: 3 },
    { buildingId: "bastion", level: 10 },
    { buildingId: "treasury", level: 2 },
    { buildingId: "barracks", level: 5 },
    { buildingId: "retired-building", level: 9 },
  ]);
  expect(bonuses.stats).toMatchObject({ str: 6, con: 20, dex: 0 });
  expect(bonuses.goldPercent).toBe(6);
  expect(bonuses.memberSlots).toBe(10);
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const officer = base.withIdentity(testIdentity("officer"));
  const recruit = base.withIdentity(testIdentity("recruit"));
  const ids = await base.run(async (ctx) => {
    const now = Date.now();
    const newPlayer = (subject: string) =>
      insertPlayerWithRecords(ctx, {
        anonymousId: `${subject}-anon`,
        name: subject,
        authSubject: ownerFor(subject),
        str: 50, dex: 10, int: 1, luk: 1, con: 30,
        gold: 0, totalExperience: 0,
        rebirthCount: 0, rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
        autoAttackEnabled: true, autoStartFightEnabled: false,
        createdAt: now, lastUpdated: now,
      });
    const officerId = await newPlayer("officer");
    const recruitId = await newPlayer("recruit");
    const guildId = await ctx.db.insert("guilds", {
      name: "Builders", tag: "BLD", description: "", ownerId: officerId,
      gold: 0, xp: 0, level: 1, createdAt: now, updatedAt: now,
    });
    for (const [playerId, role] of [[officerId, "officer"], [recruitId, "member"]] as const) {
      await ctx.db.insert("guildMembers", {
        guildId, playerId, role, joinedAt: now, contributionXp: 0, contributionGold: 0, lastActiveAt: now,
      });
    }
    const item = (itemId: string, name: string) =>
      ctx.db.insert("items", {
        itemId, name, category: "crafting", description: name, stackable: true,
        maxStackSize: 1000, allowedEquipmentSlots: [], createdAt: now, updatedAt: now,
      });
    const scaleId = await item("dragon-scale", "Dragon Scale");
    const ingotId = await item("moonstone-ingot", "Moonstone Ingot");
    await ctx.db.insert("playerItems", { playerId: recruitId, itemId: ingotId, quantity: 25, acquiredAt: now, updatedAt: now });
    return { officerId, recruitId, guildId, scaleId, ingotId };
  });
  return { base, officer, recruit, ...ids };
}

const stashTotal = async (ctx: MutationCtx, guildId: Id<"guilds">, itemId: Id<"items">) =>
  (
    await ctx.db
      .query("guildStashItems")
      .withIndex("by_guildId_and_itemId", (q) => q.eq("guildId", guildId).eq("itemId", itemId))
      .collect()
  ).reduce((sum, row) => sum + row.quantity, 0);

test("members donate, officers build, and every member's stats rise", async () => {
  const t = await setup();
  await t.recruit.mutation(api.guildBuildings.donateBuildingMaterial, {
    playerId: t.recruitId,
    itemSlug: "moonstone-ingot",
    quantity: 20,
  });
  await expect(
    t.officer.mutation(api.guildBuildings.upgradeGuildBuilding, { playerId: t.officerId, buildingId: "war-hall" })
  ).rejects.toThrow(/Not enough Dragon Scale/);

  const before = await t.base.run(async (ctx) => {
    await ctx.db.insert("guildStashItems", {
      guildId: t.guildId, itemId: t.scaleId, quantity: 12, acquiredAt: 0, updatedAt: 0,
    });
    const recruit = (await ctx.db.get(t.recruitId)) as Doc<"players">;
    return (await readPlayerCombatProfile(ctx, recruit)).combatStats.attack;
  });

  await expect(
    t.recruit.mutation(api.guildBuildings.upgradeGuildBuilding, { playerId: t.recruitId, buildingId: "war-hall" })
  ).rejects.toThrow(/officer/);
  await t.officer.mutation(api.guildBuildings.upgradeGuildBuilding, { playerId: t.officerId, buildingId: "war-hall" });

  const after = await t.base.run(async (ctx) => {
    const recruit = (await ctx.db.get(t.recruitId)) as Doc<"players">;
    return {
      attack: (await readPlayerCombatProfile(ctx, recruit)).combatStats.attack,
      bonuses: await getGuildBonusesForPlayer(ctx, t.recruitId),
      scales: await stashTotal(ctx, t.guildId, t.scaleId),
      ingots: await stashTotal(ctx, t.guildId, t.ingotId),
    };
  });
  expect(after.bonuses.statBonusByStat.str).toBe(2);
  expect(after.attack).toBeGreaterThan(before);
  expect(after.scales).toBe(2);
  expect(after.ingots).toBe(0);

  const view = await t.recruit.query(api.guildBuildings.getGuildBuildings, { playerId: t.recruitId });
  const warHall = view!.buildings.find((row) => row.buildingId === "war-hall")!;
  expect(warHall).toMatchObject({ level: 1, bonus: "+2% STR", nextBonus: "+4% STR" });
  expect(warHall.cost.find((row) => row.itemSlug === "dragon-scale")).toMatchObject({ needed: 20, inStash: 2, donatable: false });
  expect(view!.canUpgrade).toBe(false);
});

test("only building goods can be donated", async () => {
  const t = await setup();
  await expect(
    t.recruit.mutation(api.guildBuildings.donateBuildingMaterial, {
      playerId: t.recruitId,
      itemSlug: "dragon-scale",
      quantity: 1,
    })
  ).rejects.toThrow(/No guild building uses/);
});

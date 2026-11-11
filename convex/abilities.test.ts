/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { STAFF_BASE_DAMAGE_PER_TIER, STARTER_STAFF_BASE_DAMAGE } from "./forestCraftingSeed";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function seedStarterContent(ctx: MutationCtx) {
  await ctx.db.insert("items", {
    itemId: "worn-staff", name: "Worn Staff", category: "equipment",
    description: "A starter staff", stackable: false, maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"], baseDamage: 5, attackSpeed: 0.8,
    damageStat: "int", damageType: "magical",
    createdAt: 0, updatedAt: 0,
  });
  await ctx.db.insert("items", {
    itemId: "worn-robe", name: "Worn Robe", category: "equipment",
    description: "A starter robe", stackable: false, maxStackSize: 1,
    allowedEquipmentSlots: ["chest"], baseDefense: 3,
    createdAt: 0, updatedAt: 0,
  });
  await ctx.db.insert("abilities", {
    abilityId: "arcane_bolt",
    name: "Arcane Bolt",
    description: "Starter spell",
    type: "attack",
    target: "enemy",
    weaponType: "staff",
    element: "arcane",
    basePower: 4,
    powerScalingPerLevel: 0.05,
    cooldownMs: 7000,
    tier: 0,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  });
}

test("staff starters learn and auto-equip their arcane bolt", async () => {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "starter-user" });
  await t.run((ctx) => seedStarterContent(ctx));

  const player = await t.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "staff-starter",
    name: "Staff Starter",
    starterId: "staff",
  });
  expect(player).toBeTruthy();
  const playerId = player!._id;

  const learned = await t.run((ctx) =>
    ctx.db
      .query("playerAbilities")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect()
  );
  expect(learned.map((row) => row.abilityId)).toContain("arcane_bolt");

  const equipped = await t.run((ctx) =>
    ctx.db
      .query("playerEquippedAbilities")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect()
  );
  expect(equipped).toHaveLength(1);
  expect(equipped[0]).toMatchObject({ abilityId: "arcane_bolt", slot: 0 });
});

test("re-picking the staff kit re-grants the cleared ability", async () => {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "repick-user" });
  await t.run((ctx) => seedStarterContent(ctx));

  // A character waiting on a starter pick models the post-rebirth state.
  const player = await t.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "repick",
    name: "Re-pick",
  });
  expect(player?.pendingStarterPick).toBe(true);
  const playerId = player!._id;

  await t.mutation(api.players.chooseStarter, { playerId, starterId: "staff" });
  const equipped = await t.run((ctx) =>
    ctx.db
      .query("playerEquippedAbilities")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect()
  );
  expect(equipped.map((row) => row.abilityId)).toContain("arcane_bolt");
});

test("rebalanceStaffWeapons overwrites staff damage and backfills weapon types idempotently", async () => {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "migration-user" });

  const ids = await t.run(async (ctx) => {
    const worn = await ctx.db.insert("items", {
      itemId: "worn-staff", name: "Worn Staff", category: "equipment",
      description: "starter", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], baseDamage: 5, attackSpeed: 0.8,
      damageStat: "int", damageType: "magical", createdAt: 0, updatedAt: 0,
    });
    const crafted = await ctx.db.insert("items", {
      itemId: "oak-staff", name: "Oak Staff", category: "equipment",
      description: "crafted", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], baseDamage: 36, attackSpeed: 0.8,
      damageStat: "int", damageType: "magical", itemFamily: "woodworking-staff",
      craftingTier: 3, createdAt: 0, updatedAt: 0,
    });
    const sword = await ctx.db.insert("items", {
      itemId: "worn-sword", name: "Worn Sword", category: "equipment",
      description: "sword", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], baseDamage: 4, attackSpeed: 1,
      damageStat: "str", damageType: "physical", createdAt: 0, updatedAt: 0,
    });
    const robe = await ctx.db.insert("items", {
      itemId: "cloth-robe", name: "Cloth Robe", category: "equipment",
      description: "armor", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["chest"], baseDefense: 3, createdAt: 0, updatedAt: 0,
    });
    return { worn, crafted, sword, robe };
  });

  const first = await t.mutation(internal.migrations.rebalanceStaffWeapons, {});
  expect(first.staffDamageUpdated).toBe(2);
  expect(first.weaponTypesBackfilled).toBe(3);

  const readItem = (id: (typeof ids)[keyof typeof ids]) =>
    t.run((ctx) => ctx.db.get(id));
  expect(await readItem(ids.worn)).toMatchObject({
    baseDamage: STARTER_STAFF_BASE_DAMAGE, weaponType: "staff",
  });
  expect(await readItem(ids.crafted)).toMatchObject({
    baseDamage: STAFF_BASE_DAMAGE_PER_TIER * 3, weaponType: "staff",
  });
  expect(await readItem(ids.sword)).toMatchObject({ weaponType: "sword" });
  expect((await readItem(ids.robe))?.weaponType).toBeUndefined();

  const second = await t.mutation(internal.migrations.rebalanceStaffWeapons, {});
  expect(second.staffDamageUpdated).toBe(0);
  expect(second.weaponTypesBackfilled).toBe(0);
  expect(await readItem(ids.crafted)).toMatchObject({
    baseDamage: STAFF_BASE_DAMAGE_PER_TIER * 3, weaponType: "staff",
  });
});

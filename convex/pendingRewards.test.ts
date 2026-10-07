/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { grantItemToInventory } from "./items";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "pending-test", name: "Hunter", role: "admin",
      authSubject: "pending-user",
      str: 10, dex: 10, int: 10, luk: 0, con: 50,
      gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
      currentTier: 1, autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    await ctx.db.insert("gameBalance", {
      key: "inventorySlotCapacity",
      value: 1,
      description: "Single-slot inventory forces overflow in tests",
      lastUpdated: 0,
    });
    const itemId = await ctx.db.insert("items", {
      itemId: "moonlit-rat-fang", name: "Moonlit Rat Fang",
      category: "crafting", description: "Test material",
      stackable: true, maxStackSize: 10,
      allowedEquipmentSlots: [], createdAt: 0, updatedAt: 0,
    });
    return { playerId, itemId };
  });
  return { t, ...fixture };
}

async function pendingRewards(t: Awaited<ReturnType<typeof setup>>["t"]) {
  return await t.run((ctx) =>
    ctx.db.query("pendingRewards").collect()
  );
}

test("overflows from different settlements stack into one cache row", async () => {
  const { t, playerId, itemId } = await setup();

  // 5 fit in the single inventory stack (max 10), nothing pending.
  await t.run((ctx) =>
    grantItemToInventory(ctx, {
      playerId,
      itemId,
      quantity: 5,
      overflowSource: {
        sourceType: "monster",
        sourceId: "rat-a",
        settlementKey: "settle-a",
      },
    })
  );
  expect(await pendingRewards(t)).toHaveLength(0);

  // 8 more: 5 top up the stack, 3 overflow into the cache.
  await t.run((ctx) =>
    grantItemToInventory(ctx, {
      playerId,
      itemId,
      quantity: 8,
      overflowSource: {
        sourceType: "monster",
        sourceId: "rat-b",
        settlementKey: "settle-b",
      },
    })
  );
  let rewards = await pendingRewards(t);
  expect(rewards).toHaveLength(1);
  expect(rewards[0].quantity).toBe(3);

  // Another settlement overflows the same item: stacks onto the same row.
  await t.run((ctx) =>
    grantItemToInventory(ctx, {
      playerId,
      itemId,
      quantity: 4,
      overflowSource: {
        sourceType: "monster",
        sourceId: "rat-c",
        settlementKey: "settle-c",
      },
    })
  );
  rewards = await pendingRewards(t);
  expect(rewards).toHaveLength(1);
  expect(rewards[0].quantity).toBe(7);
});

test("overflows with a different source type stay on their own row", async () => {
  const { t, playerId, itemId } = await setup();

  // Fill the single inventory stack completely first.
  await t.run((ctx) =>
    grantItemToInventory(ctx, { playerId, itemId, quantity: 10 })
  );

  await t.run((ctx) =>
    grantItemToInventory(ctx, {
      playerId,
      itemId,
      quantity: 2,
      overflowSource: {
        sourceType: "monster",
        sourceId: "rat-a",
        settlementKey: "settle-a",
      },
    })
  );
  await t.run((ctx) =>
    grantItemToInventory(ctx, {
      playerId,
      itemId,
      quantity: 3,
      overflowSource: {
        sourceType: "boss",
        sourceId: "boss-a",
        settlementKey: "settle-b",
      },
    })
  );

  const rewards = await pendingRewards(t);
  expect(rewards).toHaveLength(2);
  const bySource = new Map(rewards.map((r) => [r.sourceType, r.quantity]));
  expect(bySource.get("monster")).toBe(2);
  expect(bySource.get("boss")).toBe(3);
});

test("consolidatePendingRewards folds pre-existing duplicate rows", async () => {
  const { t, playerId, itemId } = await setup();

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("pendingRewards", {
      playerId, itemId, quantity: 1, sourceType: "monster",
      sourceId: "rat-a", settlementKey: "settle-a",
      status: "pending", createdAt: now,
    });
    await ctx.db.insert("pendingRewards", {
      playerId, itemId, quantity: 2, sourceType: "monster",
      sourceId: "rat-b", settlementKey: "settle-b",
      status: "pending", createdAt: now + 1,
    });
    await ctx.db.insert("pendingRewards", {
      playerId, itemId, quantity: 5, sourceType: "boss",
      sourceId: "boss-a", settlementKey: "settle-c",
      status: "pending", createdAt: now + 2,
    });
  });

  const result = await t.mutation(
    internal.migrations.consolidatePendingRewards,
    {}
  );
  expect(result.consolidatedGroups).toBe(1);
  expect(result.mergedRows).toBe(1);

  const rewards = await pendingRewards(t);
  expect(rewards).toHaveLength(2);
  const monster = rewards.find((r) => r.sourceType === "monster");
  expect(monster?.quantity).toBe(3);
  // Earliest row survives, keeping its provenance.
  expect(monster?.settlementKey).toBe("settle-a");

  // Idempotent: a second run changes nothing.
  const rerun = await t.mutation(
    internal.migrations.consolidatePendingRewards,
    {}
  );
  expect(rerun.consolidatedGroups).toBe(0);
  expect(rerun.mergedRows).toBe(0);
});

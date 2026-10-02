/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { ADMIN_CONFIG_TABLES, type AdminConfigSection } from "./adminConfig";
import schema from "./schema";
import { DEFAULT_ITEM_RARITY_LEVEL } from "./itemTypes";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup() {
  const t = convexTest(schema, modules).withIdentity({ subject: "admin-user" });
  await t.mutation(internal.init.default, {});
  const playerId = await t.run((ctx) => ctx.db.insert("players", {
    anonymousId: "admin-test", name: "Admin", role: "admin",
      authSubject: "admin-user",
    str: 1, dex: 1, int: 1, luk: 1, con: 1,
    gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
    currentTier: 1, autoAttackEnabled: true, autoStartFightEnabled: false,
    createdAt: 0, lastUpdated: 0,
  }));
  return { t, playerId };
}

test("each admin section preserves its records and reads only its declared tables", async () => {
  const { t, playerId } = await setup();
  const full = await t.query(async (ctx) => {
    const data = await ctx.runQuery(api.admin.getConfig, { playerId });
    return { data, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(full.metrics.databaseQueries.used).toBe(23);
  const sections = Object.keys(ADMIN_CONFIG_TABLES) as AdminConfigSection[];

  for (const section of sections) {
    const { data, metrics } = await t.query(async (ctx) => {
      const data = await ctx.runQuery(api.admin.getConfig, { playerId, section });
      return { data, metrics: await ctx.meta.getTransactionMetrics() };
    });
    const tables = new Set<string>(ADMIN_CONFIG_TABLES[section]);
    for (const table of Object.keys(full.data) as Array<keyof typeof full.data>) {
      expect(data[table], `${section}: ${table}`).toEqual(
        tables.has(table) ? full.data[table] : []
      );
    }
    const expectedRecords = ADMIN_CONFIG_TABLES[section].reduce(
      (count, table) => count + full.data[table].length, 1
    );
    expect(metrics.documentsRead.used, section).toBe(expectedRecords);
    expect(metrics.databaseQueries.used, section).toBe(tables.size + 1);
    expect(metrics.bytesRead.used, section).toBeLessThan(full.metrics.bytesRead.used);
  }
});

test("the admin player snapshot does not load the configuration catalog", async () => {
  const { t, playerId } = await setup();
  const { players, metrics } = await t.query(async (ctx) => {
    const players = await ctx.runQuery(api.admin.getPlayers, { playerId });
    return { players, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(players).toHaveLength(1);
  expect(players[0]).toMatchObject({ _id: playerId, name: "Admin" });
  expect(metrics.databaseQueries.used).toBe(4);
});

test("scoped reads and saves still reject a revoked admin role", async () => {
  const { t, playerId } = await setup();
  const { gameBalance } = await t.query(api.admin.getConfig, { playerId, section: "general" });
  await t.run((ctx) => ctx.db.patch(playerId, { role: "player" }));
  for (const section of Object.keys(ADMIN_CONFIG_TABLES) as AdminConfigSection[]) {
    await expect(t.query(api.admin.getConfig, { playerId, section }))
      .rejects.toThrow("admin role required");
  }
  await expect(t.query(api.admin.getPlayers, { playerId }))
    .rejects.toThrow("admin role required");
  const balance = gameBalance[0];
  await expect(t.mutation(api.admin.updateGameBalance, {
    playerId, balanceId: balance._id, value: balance.value, description: "Changed",
  })).rejects.toThrow("admin role required");
});

test("fresh snapshots reflect saved rarities and their item references", async () => {
  const { t, playerId } = await setup();
  const before = await t.query(api.admin.getConfig, { playerId, section: "items" });
  const rarity = before.itemRarities.find((row) => row.level === DEFAULT_ITEM_RARITY_LEVEL);
  if (!rarity) throw new Error("Missing seeded rarity");
  await t.mutation(api.admin.updateItemRarity, {
    playerId, rarityId: rarity._id, level: 11, name: "Updated rarity", color: "#abcdef",
  });
  const after = await t.query(api.admin.getConfig, { playerId, section: "items" });
  expect(after.itemRarities.find((row) => row._id === rarity._id))
    .toMatchObject({ name: "Updated rarity", level: 11 });
  for (const item of before.items.filter((row) =>
    (row.rarityLevel ?? DEFAULT_ITEM_RARITY_LEVEL) === DEFAULT_ITEM_RARITY_LEVEL
  )) {
    expect(after.items.find((row) => row._id === item._id)?.rarityLevel).toBe(11);
  }
  const skills = await t.query(api.admin.getConfig, { playerId, section: "skills" });
  expect(skills.items).toEqual(after.items);
});

test("character snapshots do not weaken the stale-edit guard", async () => {
  const { t, playerId } = await setup();
  const [player] = await t.query(api.admin.getPlayers, { playerId });
  await t.run((ctx) => ctx.db.patch(playerId, { gold: 10, lastUpdated: 1 }));
  await expect(t.mutation(api.admin.updatePlayer, {
    adminPlayerId: playerId, targetPlayerId: playerId,
    expectedLastUpdated: player.lastUpdated, name: player.name,
    str: player.str, dex: player.dex, int: player.int, luk: player.luk, con: player.con,
    gold: 0, totalExperience: player.totalExperience,
    currentTier: player.currentTier, maxTierReached: player.maxTierReached,
    rebirthCount: player.rebirthCount, rebirthTierThreshold: player.rebirthTierThreshold,
  })).rejects.toThrow("Character data changed while you were editing");
  const [latest] = await t.query(api.admin.getPlayers, { playerId });
  expect(latest.gold).toBe(10);
  expect(latest.lastUpdated).toBe(1);
});

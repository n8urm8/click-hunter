/// <reference types="vite/client" />
import { ownerFor } from "./testIdentity";
import { insertPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import {
  fightHistoryKey,
  findFightHistory,
  isPlayerSettlementKey,
  recordFightHistory,
} from "./fightHistory";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const playerId = await t.run((ctx) =>
    insertPlayerWithRecords(ctx, {
      anonymousId: "fight-history-test",
      name: "Hunter",
      role: "admin",
      authSubject: ownerFor("fight-history-user"),
      str: 10,
      dex: 10,
      int: 10,
      luk: 0,
      con: 50,
      gold: 0,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      autoAttackEnabled: false,
      autoStartFightEnabled: false,
      createdAt: 0,
      lastUpdated: 0,
    })
  );
  return { t, playerId };
}

test("settlement keys are player-prefixed and scoped", () => {
  const key = fightHistoryKey("player-1", "raid", "lobby-9");
  expect(key).toBe("player-1:raid:lobby-9");
  expect(isPlayerSettlementKey("player-1", key)).toBe(true);
  expect(isPlayerSettlementKey("player-2", key)).toBe(false);
});

test("a settled fight is recorded once and found by its key", async () => {
  const { t, playerId } = await setup();
  const key = fightHistoryKey(playerId, "raid", "lobby-1");

  await t.run((ctx) =>
    recordFightHistory(ctx, {
      playerId,
      settlementKey: key,
      monsterTier: 3,
      monsterType: "raid_dragon",
      won: true,
      isBoss: true,
      goldEarned: 120,
      experienceEarned: 340,
      timestamp: 1_000,
    })
  );

  const found = await t.run((ctx) => findFightHistory(ctx, key));
  expect(found).not.toBeNull();
  expect(found?.playerId).toBe(playerId);
  expect(found?.monsterTier).toBe(3);
  expect(found?.isBoss).toBe(true);
  expect(found?.goldEarned).toBe(120);
  expect(found?.experienceEarned).toBe(340);
  expect(found?.timestamp).toBe(1_000);

  const rows = await t.run((ctx) => ctx.db.query("fightHistory").collect());
  expect(rows).toHaveLength(1);
});

test("a key that belongs to another player is rejected", async () => {
  const { t, playerId } = await setup();
  await expect(
    t.run((ctx) =>
      recordFightHistory(ctx, {
        playerId,
        settlementKey: "someone-else:raid:lobby-1",
        monsterTier: 1,
        monsterType: "rat",
        won: true,
        goldEarned: 1,
        experienceEarned: 1,
      })
    )
  ).rejects.toThrow("must belong to the player");
});

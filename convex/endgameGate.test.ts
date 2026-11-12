/// <reference types="vite/client" />
import { insertPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { settleCombatFight } from "./loot";
import { endgameGateStatus, endgameLockReason } from "./endgameGate";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const GATE = { gateTier: 9, rebirthRequirement: 3 };

describe("endgameLockReason", () => {
  test("tiers below the gate are always open", () => {
    const status = endgameGateStatus({ rebirthCount: 0 }, GATE);
    expect(endgameLockReason(status, 8)).toBeNull();
  });

  test("the gate tier needs the rebirths first", () => {
    const status = endgameGateStatus(
      { rebirthCount: 1, highestBossDefeated: 8 },
      GATE
    );
    expect(status.unlocked).toBe(false);
    expect(endgameLockReason(status, 9)).toBe(
      "Tier 9+ requires 3 rebirths (you have 1)"
    );
  });

  test("with the rebirths, it still needs this life's boss below the gate", () => {
    const status = endgameGateStatus(
      { rebirthCount: 3, highestBossDefeated: 7 },
      GATE
    );
    expect(endgameLockReason(status, 12)).toBe(
      "Defeat the Tier 8 boss in this life to break into Tier 9"
    );
  });

  test("rebirths plus the boss kill open every endgame tier", () => {
    const status = endgameGateStatus(
      { rebirthCount: 3, highestBossDefeated: 8 },
      GATE
    );
    expect(status.unlocked).toBe(true);
    expect(endgameLockReason(status, 20)).toBeNull();
  });
});

async function setup(player: { rebirthCount: number; highestBossDefeated?: number }) {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "endgame-user" });
  const playerId = await t.run(async (ctx) => {
    const now = Date.now();
    return await insertPlayerWithRecords(ctx, {
      anonymousId: "endgame",
      name: "Hunter",
      authSubject: "endgame-user",
      str: 10,
      dex: 10,
      int: 10,
      luk: 5,
      con: 50,
      gold: 0,
      totalExperience: 0,
      rebirthCount: player.rebirthCount,
      rebirthTierThreshold: 5,
      currentTier: 8,
      maxTierReached: 8,
      ...(player.highestBossDefeated === undefined
        ? {}
        : { highestBossDefeated: player.highestBossDefeated }),
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });
  });
  return { t, playerId };
}

const huntTier = (tier: number) => ({
  tier,
  mode: "count" as const,
  targetBattles: 1,
});

test("auto-battle refuses endgame tiers without enough rebirths", async () => {
  const { t, playerId } = await setup({ rebirthCount: 0, highestBossDefeated: 8 });
  await expect(
    t.mutation(api.tasks.enqueueAutoBattle, { playerId, ...huntTier(9) })
  ).rejects.toThrow("Tier 9+ requires 3 rebirths (you have 0)");
});

test("auto-battle refuses endgame tiers without this life's gate boss", async () => {
  const { t, playerId } = await setup({ rebirthCount: 5 });
  await expect(
    t.mutation(api.tasks.enqueueAutoBattle, { playerId, ...huntTier(9) })
  ).rejects.toThrow("Defeat the Tier 8 boss in this life to break into Tier 9");
});

test("auto-battle gets past the gate once both requirements are met", async () => {
  const { t, playerId } = await setup({ rebirthCount: 3, highestBossDefeated: 8 });
  // The gate passes; this bare test deployment then stops at the missing task
  // definition, which proves validation reached the end.
  await expect(
    t.mutation(api.tasks.enqueueAutoBattle, { playerId, ...huntTier(9) })
  ).rejects.toThrow("Auto-battle task definition is not configured");
});

test("endgame bosses are behind the same gate", async () => {
  const { t, playerId } = await setup({ rebirthCount: 0 });
  await t.run(async (ctx) => {
    await ctx.db.patch(playerId, { maxTierReached: 9 });
  });
  await expect(
    t.mutation(api.bossFights.startBossFight, { playerId, tier: 9 })
  ).rejects.toThrow("Tier 9+ requires 3 rebirths (you have 0)");
});

test("a won boss fight records this life's best boss kill", async () => {
  const { t, playerId } = await setup({ rebirthCount: 0, highestBossDefeated: 7 });
  await t.run(async (ctx) => {
    await ctx.db.insert("bosses", {
      bossId: "boss_tier_8",
      tier: 8,
      name: "B8",
      str: 1,
      dex: 1,
      int: 1,
      luk: 1,
      con: 1,
      rewardMultiplier: 1,
      createdAt: Date.now(),
    });
    await settleCombatFight(ctx, {
      playerId,
      settlementKey: `${playerId}:boss-8-win`,
      sourceType: "boss",
      sourceId: "boss_tier_8",
      tier: 8,
      won: true,
    });
  });

  const status = await t.query(api.bossFights.getEndgameGateStatus, { playerId });
  expect(status).toMatchObject({
    gateTier: 9,
    rebirthRequirement: 3,
    highestBossDefeated: 8,
    hasGateBoss: true,
    hasRebirths: false,
    unlocked: false,
  });
});

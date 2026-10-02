/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SUBJECT = "audit-user";

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: SUBJECT });
  const ids = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "audit", name: "Audit", authSubject: SUBJECT,
      str: 1, dex: 1, int: 1, luk: 1, con: 10,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
      autoAttackEnabled: true, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    await ctx.db.insert("taskDefinitions", {
      taskId: "test-task", name: "Test", category: "gather",
      description: "d", durationMs: 1000,
      canProgressOffline: true, requiresOnline: false, enabled: true,
      createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("hiddenSpots", {
      spotId: "spot_1", x: 1, y: 1, rewardUpgradeId: "str_boost_1", radius: 20, createdAt: 0,
    });
    await ctx.db.insert("upgrades", {
      upgradeId: "str_boost_1", name: "S", category: "stat-boost", cost: 100,
      description: "d", effectType: "stat-boost", effectStat: "str", effectAmount: 5,
      createdAt: 0,
    });
    await ctx.db.insert("upgrades", {
      upgradeId: "evil", name: "E", category: "stat-boost", cost: 100,
      description: "d", effectType: "stat-boost", effectStat: "str", effectAmount: 999,
      createdAt: 0,
    });
    await ctx.db.insert("bosses", {
      bossId: "boss1", tier: 1, name: "B1",
      str: 1, dex: 1, int: 1, luk: 1, con: 1, rewardMultiplier: 1, createdAt: 0,
    });
    return { playerId };
  });
  return { base, t, ...ids };
}

afterEach(() => {
  vi.useRealTimers();
});

test("unauthenticated and cross-session callers are rejected", async () => {
  const { base, t, playerId } = await setup();
  await expect(base.mutation(api.tasks.sync, { playerId }))
    .rejects.toThrow("Authentication required");
  const intruder = base.withIdentity({ subject: "intruder" });
  await expect(intruder.mutation(api.tasks.sync, { playerId }))
    .rejects.toThrow("different signed-in session");
  await expect(intruder.query(api.tasks.getQueue, { playerId }))
    .rejects.toThrow("different signed-in session");
  // Owner works.
  expect((await t.mutation(api.tasks.sync, { playerId })).serverTime)
    .toEqual(expect.any(Number));
});

test("skill payloads cannot enter through the generic task path", async () => {
  const { t, playerId } = await setup();
  await expect(t.mutation(api.tasks.enqueueTimedTask, {
    playerId, definitionId: "skill_action", payload: { skillTaskVersion: 1 },
  })).rejects.toThrow("enqueueSkillAction");
  await expect(t.mutation(api.tasks.enqueueTimedTask, {
    playerId, definitionId: "test-task",
    payload: { skillTaskVersion: 1, baseExperienceReward: 999999 },
  })).rejects.toThrow("enqueueSkillAction");
});

test("hidden spots only grant their own configured reward", async () => {
  const { t, playerId } = await setup();
  await expect(t.mutation(api.upgrades.claimHiddenSpotReward, {
    playerId, upgradeId: "evil", spotId: "spot_1",
  })).rejects.toThrow("does not grant");
  const claim = await t.mutation(api.upgrades.claimHiddenSpotReward, {
    playerId, upgradeId: "str_boost_1", spotId: "spot_1",
  });
  expect(claim.success).toBe(true);
});

test("tiers cannot be skipped and keys cannot cross players", async () => {
  const { t, playerId } = await setup();
  const other = await t.run(async (ctx) => ctx.db.insert("players", {
    anonymousId: "victim", name: "Victim", authSubject: "victim-user",
    str: 1, dex: 1, int: 1, luk: 1, con: 1,
    gold: 0, totalExperience: 0, rebirthCount: 0,
    rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
    autoAttackEnabled: true, autoStartFightEnabled: false,
    createdAt: 0, lastUpdated: 0,
  }));
  await expect(t.mutation(api.players.advanceTierProgression, {
    playerId, tierJustBeaten: 50,
  })).rejects.toThrow("one tier at a time");
  await expect(t.mutation(api.upgrades.recordFight, {
    playerId, monsterTier: 1, monsterType: "boss1", isBoss: true, won: true,
    settlementKey: `${other}:boss:boss1:1:0`,
  })).rejects.toThrow("must belong to the player");
  await expect(t.mutation(api.upgrades.recordFight, {
    playerId, monsterTier: 9, monsterType: "boss1", isBoss: true, won: true,
  })).rejects.toThrow("not unlocked");
});

test("forged boss wins settle nothing; server strikes do", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { t, playerId } = await setup();

  // Direct win claim with no session: rejected, no rewards.
  await expect(t.mutation(api.upgrades.recordFight, {
    playerId, monsterTier: 1, monsterType: "boss1", isBoss: true, won: true,
    settlementKey: `${playerId}:boss:boss1:1:0`,
  })).rejects.toThrow("strikeBoss");
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ gold: 0 });

  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId, tier: 1,
  });
  expect(session.monsterHp).toBeGreaterThan(0);

  // Grind through server-validated strikes (cooldown-gated).
  let status = "open";
  for (let i = 0; i < 25 && status === "open"; i += 1) {
    vi.advanceTimersByTime(5_000);
    status = (
      await t.mutation(api.bossFights.strikeBoss, {
        playerId,
        sessionId: session.sessionId,
      })
    ).status;
  }
  expect(status).toBe("won");
  expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({
    gold: expect.any(Number),
  });
  const gold = (await t.run((ctx) => ctx.db.get(playerId)))?.gold ?? 0;
  expect(gold).toBeGreaterThan(0);

  // Re-reporting the same victory is an idempotent duplicate, not double pay.
  const again = await t.mutation(api.upgrades.recordFight, {
    playerId, monsterTier: 1, monsterType: "boss1", isBoss: true, won: true,
    sessionId: session.sessionId,
  });
  expect(again.duplicate).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(playerId)))?.gold).toBe(gold);
});

test("direct currency/stat cheats are no longer public", async () => {
  const { readFileSync } = await import("node:fs");
  const hooks = readFileSync("app/hooks/usePlayer.ts", "utf8");
  expect(hooks).not.toContain("updateGold");
  expect(hooks).not.toContain("addExperience");
  expect(hooks).not.toContain("increaseStat");
});

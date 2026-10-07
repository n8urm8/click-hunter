/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { readPlayerCombatProfile } from "./combat";
import { skillSpeedMultiplier } from "./rebirth";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const BASE_STATS = { str: 1, dex: 1, int: 1, luk: 1, con: 1 };

async function setup(stats: Partial<typeof BASE_STATS> = {}) {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({ subject: "rebirth-user" });
  const fixture = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "rebirth-test", name: "Hunter", role: "admin",
      authSubject: "rebirth-user",
      ...BASE_STATS,
      ...stats,
      gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
      currentTier: 1, maxTierReached: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    return { playerId };
  });
  return { t, ...fixture };
}

test("canRebirth is false when every stat is below 99", async () => {
  const { t, playerId } = await setup({ str: 98, con: 50 });
  expect(await t.query(api.players.canRebirth, { playerId })).toBe(false);
});

test("canRebirth is true when at least one stat reaches 99", async () => {
  const { t, playerId } = await setup({ luk: 99 });
  expect(await t.query(api.players.canRebirth, { playerId })).toBe(true);
});

test("rebirth rejects an ineligible player", async () => {
  const { t, playerId } = await setup();
  await expect(t.mutation(api.players.rebirth, { playerId })).rejects.toThrow(
    /level 99/
  );
});

test("rebirth banks bonuses for qualifying stats and resets to level 1", async () => {
  const { t, playerId } = await setup({ str: 99, con: 120, dex: 40 });

  const result = await t.mutation(api.players.rebirth, { playerId });
  expect(result.rebirthCount).toBe(1);
  expect(result.qualifyingStats).toEqual(["str", "con"]);
  expect(result.rebirthStatBonuses).toMatchObject({
    str: 1, dex: 0, int: 0, luk: 0, con: 1,
  });

  const player = await t.run((ctx) => ctx.db.get(playerId));
  expect(player).toMatchObject({
    ...BASE_STATS,
    rebirthCount: 1,
    currentTier: 1,
    maxTierReached: 1,
  });
  expect(player?.rebirthStatBonuses).toMatchObject({ str: 1, con: 1 });
});

test("bonuses stack additively across rebirths and boost effective stats", async () => {
  const { t, playerId } = await setup({ str: 99 });

  await t.mutation(api.players.rebirth, { playerId });
  // Train STR back to 99 and rebirth again.
  await t.run((ctx) => ctx.db.patch(playerId, { str: 99 }));
  const second = await t.mutation(api.players.rebirth, { playerId });
  expect(second.rebirthStatBonuses).toMatchObject({ str: 2 });

  // 1 base STR x (1 + 2 x 5%) = 1.1 effective.
  const profile = await t.run((ctx) =>
    ctx.db.get(playerId).then((player) => readPlayerCombatProfile(ctx, player!))
  );
  expect(profile.effectiveStats.str).toBeCloseTo(1.1);
  expect(profile.effectiveStats.dex).toBeCloseTo(1);
});

test("canRebirth is true when a skill reaches 99 without any stat there", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("playerSkills", {
      playerId,
      skillId: "harvesting",
      level: 99,
      experience: 0,
      totalExperience: 0,
      actionsCompleted: 0,
      createdAt: 0,
      updatedAt: 0,
    })
  );
  expect(await t.query(api.players.canRebirth, { playerId })).toBe(true);
});

test("rebirth banks skill bonuses and resets skills to level 1", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("playerSkills", {
      playerId,
      skillId: "harvesting",
      level: 99,
      experience: 500,
      totalExperience: 12345,
      actionsCompleted: 77,
      createdAt: 0,
      updatedAt: 0,
    })
  );

  const result = await t.mutation(api.players.rebirth, { playerId });
  expect(result.qualifyingStats).toEqual([]);
  expect(result.qualifyingSkills).toEqual(["harvesting"]);
  expect(result.rebirthSkillBonuses).toEqual({ harvesting: 1 });

  const row = await t.run((ctx) =>
    ctx.db
      .query("playerSkills")
      .withIndex("by_playerId_and_skillId", (q) =>
        q.eq("playerId", playerId).eq("skillId", "harvesting")
      )
      .first()
  );
  expect(row).toMatchObject({
    level: 1,
    experience: 0,
    totalExperience: 0,
    actionsCompleted: 0,
  });
});

test("skillSpeedMultiplier combines level speed and banked bonuses", () => {
  // Level 1, no bonuses: exactly 1x.
  expect(skillSpeedMultiplier(1, 0, 0.01, 0.05)).toBe(1);
  // Level 99 at 1% per level: ~2x speed.
  expect(skillSpeedMultiplier(99, 0, 0.01, 0.05)).toBeCloseTo(1.98);
  // One banked bonus stacks another +5% on top.
  expect(skillSpeedMultiplier(99, 1, 0.01, 0.05)).toBeCloseTo(1.98 * 1.05);
  // Zeroed tuning disables both layers.
  expect(skillSpeedMultiplier(99, 3, 0, 0)).toBe(1);
});
test("players without banked bonuses see no change in effective stats", async () => {
  const { t, playerId } = await setup();
  const profile = await t.run((ctx) =>
    ctx.db.get(playerId).then((player) => readPlayerCombatProfile(ctx, player!))
  );
  expect(profile.effectiveStats).toMatchObject({
    str: 1, dex: 1, int: 1, luk: 1, con: 1,
  });
});

test("custom balance requirement and bonus percent are honored", async () => {
  const { t, playerId } = await setup({ str: 50 });
  await t.run((ctx) =>
    ctx.db.insert("gameBalance", {
      key: "rebirthStatLevelRequirement",
      value: 50,
      description: "test",
      lastUpdated: 0,
    })
  );
  await t.run((ctx) =>
    ctx.db.insert("gameBalance", {
      key: "rebirthStatBonusPercent",
      value: 0.1,
      description: "test",
      lastUpdated: 0,
    })
  );

  expect(await t.query(api.players.canRebirth, { playerId })).toBe(true);
  await t.mutation(api.players.rebirth, { playerId });

  const profile = await t.run((ctx) =>
    ctx.db.get(playerId).then((player) => readPlayerCombatProfile(ctx, player!))
  );
  expect(profile.effectiveStats.str).toBeCloseTo(1.1);
});

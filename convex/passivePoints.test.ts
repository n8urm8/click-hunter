/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  earnedPointsForSchedule,
  getPassivePoints,
  nextPointGapForSchedule,
} from "./passiveTree";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("triangular pacing matches the published table (step 3, base 13)", () => {
  const schedule = { mode: "triangular", step: 3 } as const;
  const cases: Array<[number, number]> = [
    [15, 0],
    [25, 2],
    [50, 4],
    [100, 7],
    [200, 10],
    [300, 13],
    [500, 17],
  ];
  for (const [level, expected] of cases) {
    expect(
      earnedPointsForSchedule(level, 13, schedule),
      `level ${level}`
    ).toBe(expected);
  }
});

test("triangular closed form agrees with brute force for every level 0..2000", () => {
  const schedule = { mode: "triangular", step: 3 } as const;
  const brute = (effective: number) => {
    let n = 0;
    while ((3 * (n + 1) * (n + 2)) / 2 <= effective) n += 1;
    return n;
  };
  for (let level = 0; level <= 2000; level += 1) {
    const effective = Math.max(0, level - 13);
    expect(earnedPointsForSchedule(level, 13, schedule)).toBe(brute(effective));
  }
});

test("triangular gaps grow 3, 6, 9… and flat keeps the legacy interval", () => {
  const tri = { mode: "triangular", step: 3 } as const;
  expect(
    [0, 1, 2, 3, 4].map((earned) => nextPointGapForSchedule(earned, tri))
  ).toEqual([3, 6, 9, 12, 15]);
  const flat = { mode: "flat", interval: 5 } as const;
  expect(earnedPointsForSchedule(100, 13, flat)).toBe(18);
  expect(nextPointGapForSchedule(9, flat)).toBe(5);
});

test("schedule prefers the gap step and falls back to the legacy interval", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "points-user" });
  const playerId = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "points", name: "Pointer", authSubject: "points-user",
      str: 40, dex: 30, int: 20, luk: 10, con: 10,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    for (const skillId of ["a", "b", "c"]) {
      await ctx.db.insert("skillDefinitions", {
        skillId, name: skillId, category: "gathering",
        description: "d", enabled: true, createdAt: 0, updatedAt: 0,
      });
    }
    return playerId;
  });
  // No balance rows: legacy flat pacing (interval 5, base 5 + 3 skills = 8).
  const legacy = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return getPassivePoints(ctx, player);
  });
  expect(legacy.schedule).toEqual({ mode: "flat", interval: 5 });
  expect(legacy.earned).toBe(Math.floor(110 / 5) - Math.floor(8 / 5));

  await t.run(async (ctx) => {
    await ctx.db.insert("gameBalance", {
      key: "passivePointGapStep", value: 3, description: "d", lastUpdated: 0,
    });
  });
  const triangular = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return getPassivePoints(ctx, player);
  });
  expect(triangular.schedule).toEqual({ mode: "triangular", step: 3 });
  // Level 110, base 8 → E = 102 → T7 = 84 ≤ 102 < 108 = T8.
  expect(triangular.earned).toBe(7);
  expect(triangular.nextGap).toBe(24);
});
